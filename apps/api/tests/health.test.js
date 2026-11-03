import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDB, teardownTestDB } from './setup/dbTestHelper.js';

describe('API Health and Readiness Routes', () => {
  beforeAll(async () => {
    await setupTestDB();
  }, 60000);

  afterAll(async () => {
    await teardownTestDB();
  });

  it('GET /health returns 200 OK with status and uptime', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptimeSeconds');
  });

  it('GET /v1/health returns 200 OK', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /ready returns checks for database and redis', async () => {
    const res = await request(app).get('/ready');
    // DB is connected via setupTestDB; redis may or may not be connected in local unit test
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body.checks.database).toBe('healthy');
  });
});
