import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Stage 1.2: Production Demo Money Guards and Test Hook Isolation', () => {
  it('server.js with NODE_ENV=production, FORCE_START=true, PORT=0 exits with code 1 when ALLOW_DEMO_MONEY is unset', async () => {
    const serverPath = path.resolve(__dirname, '../../api/src/server.js');
    const child = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        FORCE_START: 'true',
        PORT: '0',
        ALLOW_DEMO_MONEY: '', // unset
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const exitCode = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve('STILL_RUNNING');
      }, 15000);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(exitCode).toBe(1);
    const combined = stdout + stderr;
    expect(combined).toMatch(/ALLOW_DEMO_MONEY/);
  }, 20000);

  it('worker index.js with NODE_ENV=production exits with code 1 when ALLOW_DEMO_MONEY is unset', async () => {
    const workerPath = path.resolve(__dirname, '../src/index.js');
    const child = spawn(process.execPath, [workerPath], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        FORCE_START_WORKER: 'true',
        ALLOW_DEMO_MONEY: '', // unset
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const exitCode = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve('STILL_RUNNING');
      }, 15000);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(exitCode).toBe(1);
    const combined = stdout + stderr;
    expect(combined).toMatch(/ALLOW_DEMO_MONEY/);
  }, 20000);

  it('proves that with NODE_ENV=production, no test hold hook can be wired', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      let hookRan = false;
      const { __setTestHoldHook: setReconHook } = await import('../src/jobs/reconciliationJob.js');
      setReconHook(() => {
        hookRan = true;
      });

      const { __setTestHoldHook: setExpiryHook } = await import('../src/jobs/bookingExpiryJob.js');
      setExpiryHook(() => {
        hookRan = true;
      });

      expect(hookRan).toBe(false);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  }, 45000);
});
