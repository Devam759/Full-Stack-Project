import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import Booking from '../src/models/Booking.js';
import Wallet from '../src/models/Wallet.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import User from '../src/models/User.js';
import Membership from '../src/models/Membership.js';
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
    }, 25000);

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

describe('Suite 15: Multi-Instance API Concurrency (Separate Processes Competing on Replica Set)', () => {
  let procA;
  let procB;
  let portA;
  let portB;

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
    await Booking.init();
    await ItemDayLock.init();
  }, 45000);

  afterAll(async () => {
    try {
      if (procA) procA.kill('SIGKILL');
    } catch {
      // ignore
    }
    try {
      if (procB) procB.kill('SIGKILL');
    } catch {
      // ignore
    }
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('two distinct API server processes accept overlapping bookings concurrently: exactly 1 wins, 0 double-booking', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    // Create a second borrower
    const borrower2 = await User.create({
      name: 'Borrower Two',
      email: `borrower2_${Date.now()}@test.com`,
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    await Membership.create({
      communityId: fixtures.community._id,
      userId: borrower2._id,
      role: 'member',
      status: 'active',
    });

    await Wallet.create({
      userId: borrower2._id,
      availablePaise: 500000,
      frozenPaise: 0,
      pendingPaise: 0,
    });

    await LedgerEntry.create([
      {
        txnId: new User()._id,
        userId: borrower2._id,
        account: 'available',
        amountPaise: 500000,
        balanceAfterPaise: 500000,
        type: 'deposit_funds',
        idempotencyKey: `init_b2_${Date.now()}`,
      },
      {
        txnId: new User()._id,
        userId: null,
        account: 'demo_funding',
        amountPaise: -500000,
        type: 'deposit_funds',
        idempotencyKey: `init_demo_b2_${Date.now()}`,
      },
    ]);

    const borrower2Token = signAccessToken({ sub: borrower2._id.toString(), role: 'user' });

    // Request 1: borrower 1 requests Dec 10 to Dec 12 via Instance A
    const req1Res = await fetch(`http://127.0.0.1:${portA}/v1/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fixtures.borrowerToken}`,
        'Idempotency-Key': 'ik-multi-req-1',
      },
      body: JSON.stringify({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      }),
    });
    expect(req1Res.status).toBe(201);
    const booking1 = (await req1Res.json()).booking;

    // Request 2: borrower 2 requests Dec 11 to Dec 14 (overlapping) via Instance B
    const req2Res = await fetch(`http://127.0.0.1:${portB}/v1/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${borrower2Token}`,
        'Idempotency-Key': 'ik-multi-req-2',
      },
      body: JSON.stringify({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-11',
        endDate: '2026-12-14',
      }),
    });
    expect(req2Res.status).toBe(201);
    const booking2 = (await req2Res.json()).booking;

    // Fire accept for Booking 1 to Instance A, and accept for Booking 2 to Instance B, concurrently!
    const [accept1Res, accept2Res] = await Promise.all([
      fetch(`http://127.0.0.1:${portA}/v1/bookings/${booking1._id}/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fixtures.lenderToken}`,
          'Idempotency-Key': 'ik-multi-acc-1',
        },
      }),
      fetch(`http://127.0.0.1:${portB}/v1/bookings/${booking2._id}/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fixtures.lenderToken}`,
          'Idempotency-Key': 'ik-multi-acc-2',
        },
      }),
    ]);

    const statuses = [accept1Res.status, accept2Res.status];
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);

    // Verify DB integrity
    const b1Doc = await Booking.findById(booking1._id);
    const b2Doc = await Booking.findById(booking2._id);

    const winner = b1Doc.status === 'accepted' ? b1Doc : b2Doc;
    const loser = b1Doc.status === 'accepted' ? b2Doc : b1Doc;

    expect(winner.status).toBe('accepted');
    expect(loser.status).toBe('cancelled');

    // Winner has day locks, loser has zero
    const winningLocks = await ItemDayLock.find({ bookingId: winner._id });
    const losingLocks = await ItemDayLock.find({ bookingId: loser._id });

    expect(winningLocks.length).toBe(winner.days);
    expect(losingLocks.length).toBe(0);

    // Money frozen only for winner
    const winnerWallet = await Wallet.findOne({ userId: winner.borrowerId });
    const loserWallet = await Wallet.findOne({ userId: loser.borrowerId });

    expect(winnerWallet.frozenPaise).toBe(winner.rentPaise + winner.depositPaise);
    expect(loserWallet.frozenPaise).toBe(0);
    expect(loserWallet.availablePaise).toBe(500000);
  }, 35000);
});
