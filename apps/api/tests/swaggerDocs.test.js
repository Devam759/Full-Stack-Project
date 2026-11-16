import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDB, teardownTestDB } from './setup/dbTestHelper.js';

describe('Interactive OpenAPI & Swagger Documentation Routes', () => {
  beforeAll(async () => {
    await setupTestDB();
  }, 60000);

  afterAll(async () => {
    await teardownTestDB();
  });

  it('GET /v1/docs/openapi.json returns valid OpenAPI 3.0 specification', async () => {
    const res = await request(app).get('/v1/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toBe('BorrowLoop REST API');
    expect(res.body.paths).toHaveProperty('/auth/login');
    expect(res.body.paths).toHaveProperty('/items');
    expect(res.body.paths).toHaveProperty('/bookings');
    expect(res.body.paths).toHaveProperty('/wallet');
  });

  it('GET /docs redirects to /v1/docs', async () => {
    const res = await request(app).get('/docs');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/v1/docs');
  });

  it('GET /v1/docs/ serves HTML containing Swagger UI assets', async () => {
    const res = await request(app).get('/v1/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
