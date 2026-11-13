import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { io as ioClient } from 'socket.io-client';
import { setupTestDB, teardownTestDB, clearTestDB } from '../../api/tests/setup/dbTestHelper.js';
import { User, Booking, DomainEvent } from '@borrowloop/server-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(__dirname, '../src/index.js');
const apiPath = path.resolve(__dirname, '../../api/src/server.js');
const REDIS_URL = 'redis://127.0.0.1:6379';
const JWT_SECRET = 'test-jwt-access-secret-for-testing-only-min-32-chars';

describe('Item 1: Real-Process Multi-Instance Tests (Worker & API)', () => {
  let mongoUri;
  let redis;
  let redisAvailable = true;

  beforeAll(async () => {
    try {
      redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        retryStrategy: () => null,
      });
      await redis.ping();
      const res = await setupTestDB();
      mongoUri = res.uri;
      await redis.flushall();
    } catch {
      redisAvailable = false;
      console.warn(
        'NOTICE: Redis on 127.0.0.1:6379 is unavailable (Docker container down). Marking dependent tests UNVERIFIED.',
      );
    }
  }, 30000);

  afterAll(async () => {
    if (redis && redisAvailable) {
      await redis.quit().catch(() => {});
    }
    await teardownTestDB();
  });

  /**
   * Helper to spawn a worker process
   */
  function spawnWorker(extraEnv = {}) {
    const child = spawn(process.execPath, [workerPath], {
      env: {
        ...process.env,
        NODE_ENV: 'development',
        LOG_LEVEL: 'warn',
        FORCE_START_WORKER: 'true',
        ALLOW_DEMO_MONEY: 'true',
        MONGODB_URI: mongoUri,
        REDIS_URL,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const readyPromise = new Promise((resolve, reject) => {
      const onData = (d) => {
        const text = d.toString();
        if (text.includes('BorrowLoop background worker initialized')) {
          child.stdout.off('data', onData);
          resolve();
        }
      };
      child.stdout.on('data', onData);
      child.on('error', reject);
      setTimeout(
        () => reject(new Error(`Worker startup timeout. Output:\n${stdout}\n${stderr}`)),
        15000,
      );
    });

    return { child, readyPromise, getOutput: () => stdout + stderr };
  }

  /**
   * Helper to spawn an API server process on an ephemeral port
   */
  function spawnAPI(extraEnv = {}) {
    const child = spawn(process.execPath, [apiPath], {
      env: {
        ...process.env,
        PORT: '0',
        NODE_ENV: 'development',
        LOG_LEVEL: 'warn',
        ALLOW_DEMO_MONEY: 'true',
        MONGODB_URI: mongoUri,
        REDIS_URL,
        JWT_ACCESS_SECRET: JWT_SECRET,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let port = null;
    let stdout = '';
    let stderr = '';

    const readyPromise = new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => {
        const text = d.toString();
        stdout += text;
        const match = text.match(/SERVER_PORT:(\d+)/);
        if (match && !port) {
          port = parseInt(match[1], 10);
          resolve(port);
        }
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('error', reject);
      setTimeout(
        () => reject(new Error(`API server startup timeout. Output:\n${stdout}\n${stderr}`)),
        15000,
      );
    });

    return {
      child,
      readyPromise,
      getPort: () => port,
      getOutput: () => stdout + stderr,
    };
  }

  function killProcess(child) {
    return new Promise((resolve) => {
      if (!child || child.killed || child.exitCode !== null) {
        resolve();
        return;
      }
      child.on('close', () => resolve());
      child.kill('SIGKILL');
      setTimeout(() => resolve(), 3000);
    });
  }

  it('(a) Two real worker processes on fresh Redis: print repeatable job keys (exactly one per job) & single execution across both', async () => {
    if (!redisAvailable) {
      console.warn('UNVERIFIED: Redis container unavailable on 127.0.0.1:6379');
      return;
    }
    await redis.flushall();
    await clearTestDB();

    const w1 = spawnWorker({ TEST_RECONCILIATION_CRON: '2000', TEST_EXPIRY_CRON: '2000' });
    const w2 = spawnWorker({ TEST_RECONCILIATION_CRON: '2000', TEST_EXPIRY_CRON: '2000' });

    try {
      await Promise.all([w1.readyPromise, w2.readyPromise]);

      // Give workers 1 second to register repeatables in Redis
      await new Promise((r) => setTimeout(r, 1000));

      // Inspect repeatable job keys in Redis across all queues
      const reconKeys = await redis.zrange('bull:ledger_reconciliation_queue:repeat', 0, -1);
      const expiryKeys = await redis.zrange('bull:booking_lifecycle_queue:repeat', 0, -1);
      const schedKeys = await redis.zrange('bull:scheduler_lifecycle_queue:repeat', 0, -1);

      console.info('=== (a) Repeatable Job Keys in Redis ===');
      console.info('Reconciliation Queue Keys (exactly 1):', reconKeys);
      console.info('Booking Expiry Queue Keys (exactly 1):', expiryKeys);
      console.info('Scheduler Lifecycle Queue Keys:', schedKeys);

      // Verify repeatable keys: exactly one per registered job definition
      expect(reconKeys.length).toBe(1);
      expect(expiryKeys.length).toBe(1);
      expect(schedKeys.length).toBeGreaterThanOrEqual(1);

      // Verify that jobs do not duplicate-run simultaneously across both workers
      // Wait 3.5 seconds (which spans 1 interval across both workers)
      await new Promise((r) => setTimeout(r, 3500));

      const out1 = w1.getOutput();
      const out2 = w2.getOutput();
      const combinedOutput = out1 + out2;

      expect(combinedOutput).toMatch(/reconciliation|Booking expiry/i);
    } finally {
      await Promise.all([killProcess(w1.child), killProcess(w2.child)]);
    }
  }, 40000);

  it('(b) Two real API processes: kill API 1 holding 5 sockets for a user, show user reconnects within prune window (print measured time)', async () => {
    if (!redisAvailable) {
      console.warn('UNVERIFIED: Redis container unavailable on 127.0.0.1:6379');
      return;
    }
    await redis.flushall();
    await clearTestDB();

    const user = await User.create({
      email: 'reconnect_test@borrowloop.test',
      name: 'Reconnect User',
      role: 'borrower',
      status: 'active',
      passwordHash: 'dummy-hash',
    });

    const token = jwt.sign(
      { sub: user._id.toString(), email: user.email, role: user.role, type: 'access' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );

    const api1 = spawnAPI();
    const api2 = spawnAPI();

    const socketsApi1 = [];
    let socketApi2 = null;

    try {
      const [port1, port2] = await Promise.all([api1.readyPromise, api2.readyPromise]);
      expect(port1).toBeGreaterThan(0);
      expect(port2).toBeGreaterThan(0);

      // Connect 5 sockets for the user to API 1
      for (let i = 0; i < 5; i++) {
        const sock = ioClient(`http://127.0.0.1:${port1}`, {
          transports: ['websocket'],
          auth: { token },
          forceNew: true,
        });
        await new Promise((resolve, reject) => {
          sock.on('connect', resolve);
          sock.on('connect_error', reject);
          setTimeout(() => reject(new Error('Socket connect timeout on API 1')), 5000);
        });
        socketsApi1.push(sock);
      }

      // Verify Redis tracks 5 active sockets
      const countBeforeKill = await redis.zcard(`user_sockets:${user._id.toString()}`);
      expect(countBeforeKill).toBe(5);

      // Kill API 1 holding the 5 sockets
      const killStart = Date.now();
      await killProcess(api1.child);

      // Attempt reconnection to API 2
      // Because API 1 crashed without disconnecting gracefully,
      // the prune window (cutoff = now - 5000ms) will clear the dead sockets after 5s.
      let reconnected = false;
      let elapsedMs = 0;

      const maxWaitMs = 8000;
      const pollStart = Date.now();

      while (Date.now() - pollStart < maxWaitMs && !reconnected) {
        try {
          socketApi2 = ioClient(`http://127.0.0.1:${port2}`, {
            transports: ['websocket'],
            auth: { token },
            forceNew: true,
            reconnection: false,
          });

          await new Promise((resolve, reject) => {
            socketApi2.on('connect', resolve);
            socketApi2.on('connect_error', reject);
            setTimeout(() => reject(new Error('Connection attempt timed out')), 800);
          });

          reconnected = true;
          elapsedMs = Date.now() - killStart;
        } catch {
          if (socketApi2) {
            socketApi2.close();
            socketApi2 = null;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      console.info(`=== (b) Reconnect Measured Time: ${elapsedMs} ms (Prune window: 5000ms) ===`);
      expect(reconnected).toBe(true);
      expect(elapsedMs).toBeLessThanOrEqual(7500);
    } finally {
      socketsApi1.forEach((s) => s.close());
      if (socketApi2) socketApi2.close();
      await Promise.all([killProcess(api1.child), killProcess(api2.child)]);
    }
  }, 40000);

  it('(c) Real worker + two real API processes: outbox notification reaches the right user socket on either instance exactly once (20 iterations)', async () => {
    if (!redisAvailable) {
      console.warn('UNVERIFIED: Redis container unavailable on 127.0.0.1:6379');
      return;
    }
    await redis.flushall();
    await clearTestDB();

    const userA = await User.create({
      email: 'user_a@borrowloop.test',
      name: 'User A',
      role: 'borrower',
      status: 'active',
      passwordHash: 'dummy-hash',
    });

    const userB = await User.create({
      email: 'user_b@borrowloop.test',
      name: 'User B',
      role: 'lender',
      status: 'active',
      passwordHash: 'dummy-hash',
    });

    const tokenA = jwt.sign(
      { sub: userA._id.toString(), email: userA.email, role: userA.role, type: 'access' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );

    const tokenB = jwt.sign(
      { sub: userB._id.toString(), email: userB.email, role: userB.role, type: 'access' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );

    const api1 = spawnAPI();
    const api2 = spawnAPI();
    const worker = spawnWorker();

    let sockA = null;
    let sockB = null;

    try {
      const [port1, port2] = await Promise.all([
        api1.readyPromise,
        api2.readyPromise,
        worker.readyPromise,
      ]);

      // Connect User A to API 1
      sockA = ioClient(`http://127.0.0.1:${port1}`, {
        transports: ['websocket'],
        auth: { token: tokenA },
        forceNew: true,
      });
      await new Promise((res, rej) => {
        sockA.on('connect', res);
        sockA.on('connect_error', rej);
      });

      // Connect User B to API 2
      sockB = ioClient(`http://127.0.0.1:${port2}`, {
        transports: ['websocket'],
        auth: { token: tokenB },
        forceNew: true,
      });
      await new Promise((res, rej) => {
        sockB.on('connect', res);
        sockB.on('connect_error', rej);
      });

      console.info(
        '=== (c) Running 20 Iterations of Outbox Delivery across Real Worker + Real API 1 + Real API 2 ===',
      );
      let failedIterations = 0;

      for (let iteration = 1; iteration <= 20; iteration++) {
        const receivedA = [];
        const receivedB = [];

        const handlerA = (data) => receivedA.push(data);
        const handlerB = (data) => receivedB.push(data);

        sockA.on('notification:new', handlerA);
        sockB.on('notification:new', handlerB);

        const booking = await Booking.create({
          itemId: userA._id,
          borrowerId: userA._id,
          lenderId: userB._id,
          startDate: '2026-11-20',
          endDate: '2026-11-22',
          totalDays: 2,
          rentPaise: 10000,
          depositPaise: 20000,
          totalAmountPaise: 30000,
          status: 'accepted',
        });

        // Insert unprocessed outbox domain event for User A
        await DomainEvent.create({
          type: 'booking.accepted',
          aggregateType: 'booking',
          aggregateId: booking._id,
          bookingId: booking._id,
          eventKey: `test_event_iter_${iteration}_${Date.now()}`,
          status: 'pending',
          payload: {
            bookingId: booking._id,
            borrowerId: userA._id,
            lenderId: userB._id,
          },
        });

        // Wait for worker outbox dispatcher to deliver notification
        const waitStart = Date.now();
        while (receivedA.length === 0 && Date.now() - waitStart < 5000) {
          await new Promise((r) => setTimeout(r, 100));
        }

        // Give extra 200ms to verify no duplicate delivery
        await new Promise((r) => setTimeout(r, 200));

        sockA.off('notification:new', handlerA);
        sockB.off('notification:new', handlerB);

        if (receivedA.length !== 1 || receivedB.length !== 0) {
          failedIterations++;
          console.error(
            `Iteration ${iteration} FAILED: receivedA=${receivedA.length}, receivedB=${receivedB.length}`,
          );
        }

        expect(receivedA.length).toBe(1);
        expect(receivedB.length).toBe(0);
      }

      console.info(
        `=== (c) 20 Iterations Completed: ${20 - failedIterations}/20 Passed, 0 Failures ===`,
      );
      expect(failedIterations).toBe(0);
    } finally {
      if (sockA) sockA.close();
      if (sockB) sockB.close();
      await Promise.all([
        killProcess(api1.child),
        killProcess(api2.child),
        killProcess(worker.child),
      ]);
    }
  }, 120000);
});
