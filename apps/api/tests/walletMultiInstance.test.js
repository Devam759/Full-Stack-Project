import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import { signAccessToken } from '../src/common/jwt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.resolve(__dirname, '../src/server.js');

function spawnServerInstance(baseEnv) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [serverScript], {
      env: { ...baseEnv, PORT: '0' },
      stdio: 'pipe',
    });

    let port = null;
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Server instance startup timed out. Stderr: ${stderr}, Stdout: ${stdout}`));
    }, 20000);

    proc.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      const match = text.match(/SERVER_PORT:(\d+)/);
      if (match && !port) {
        port = parseInt(match[1], 10);
        clearTimeout(timer);
        resolve({ proc, port });
      }
    });

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (!port) {
        reject(
          new Error(`Server exited with code ${code} before reporting port. Stderr: ${stderr}`),
        );
      }
    });
  });
}

async function waitForServer(port, maxAttempts = 60) {
  let lastError = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ready`);
      if (res.ok || res.status === 200) return true;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `[STARTUP TIMEOUT] API Server on port ${port} failed to report /ready within timeout. Last error: ${lastError?.message || 'Connection refused'}`,
  );
}

describe('Suite 9: Multi-Instance API Concurrency & Balance Consistency (Separate Processes)', () => {
  let procA;
  let procB;
  let portA;
  let portB;
  let user;
  let token;

  beforeAll(async () => {
    const dbInfo = await setupTestDB();
    const mongoUri = dbInfo.uri;

    const baseEnv = {
      ...process.env,
      NODE_ENV: 'test',
      FORCE_START: 'true',
      ALLOW_DEMO_MONEY: 'true',
      MONGODB_URI: mongoUri,
      JWT_SECRET: process.env.JWT_SECRET || 'testsecretkey12345678901234567890',
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'testrefreshkey12345678901234567890',
    };

    const instanceA = await spawnServerInstance(baseEnv);
    procA = instanceA.proc;
    portA = instanceA.port;

    const instanceB = await spawnServerInstance(baseEnv);
    procB = instanceB.proc;
    portB = instanceB.port;

    await Promise.all([waitForServer(portA), waitForServer(portB)]);
  }, 45000);

  afterAll(async () => {
    try {
      if (procA) {
        procA.kill('SIGKILL');
      }
    } catch {
      // ignore termination errors
    }
    try {
      if (procB) {
        procB.kill('SIGKILL');
      }
    } catch {
      // ignore termination errors
    }
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    user = await User.create({
      name: 'Multi Instance User',
      email: 'multi@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    token = signAccessToken({
      sub: user._id.toString(),
      role: 'user',
    });
  });

  it('keeps balances and ledger consistent across two separate API child processes', async () => {
    // Add Rs 500 via Instance A
    const addResA = await fetch(`http://127.0.0.1:${portA}/v1/wallet/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': 'ik-instA-add',
      },
      body: JSON.stringify({ amountPaise: 50000 }),
    });
    expect(addResA.status).toBe(200);

    // Concurrently add Rs 300 via Instance B while Instance A withdraws Rs 200
    const [addResB, withdrawResA] = await Promise.all([
      fetch(`http://127.0.0.1:${portB}/v1/wallet/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': 'ik-instB-add',
        },
        body: JSON.stringify({ amountPaise: 30000 }),
      }),
      fetch(`http://127.0.0.1:${portA}/v1/wallet/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': 'ik-instA-withdraw',
        },
        body: JSON.stringify({ amountPaise: 20000 }),
      }),
    ]);

    expect(addResB.status).toBe(200);
    expect(withdrawResA.status).toBe(200);

    // Query balance on both instances
    const queryA = await fetch(`http://127.0.0.1:${portA}/v1/wallet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const queryB = await fetch(`http://127.0.0.1:${portB}/v1/wallet`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(queryA.status).toBe(200);
    expect(queryB.status).toBe(200);

    const bodyA = await queryA.json();
    const bodyB = await queryB.json();

    // Final balance: 50000 + 30000 - 20000 = 60000 paise
    expect(bodyA.availablePaise).toBe(60000);
    expect(bodyB.availablePaise).toBe(60000);

    // Global ledger sum across DB must be exactly 0
    const entries = await LedgerEntry.find();
    const sum = entries.reduce((acc, curr) => acc + curr.amountPaise, 0);
    expect(sum).toBe(0);

    // Wallet balance must equal its ledger sum
    const wallet = await Wallet.findOne({ userId: user._id });
    const userLedgerEntries = await LedgerEntry.find({ userId: user._id, account: 'available' });
    const userSum = userLedgerEntries.reduce((acc, curr) => acc + curr.amountPaise, 0);
    expect(wallet.availablePaise).toBe(userSum);
  });
});
