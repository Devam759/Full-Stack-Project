import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { AppError, ERROR_CODES } from '@borrowloop/shared';
import errorHandler from '../src/common/errorHandler.js';
import requestIdMiddleware from '../src/common/requestId.js';
import validate from '../src/common/validate.js';
import { z } from 'zod';

describe('Error Handling Middleware', () => {
  function createTestApp() {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json({ limit: '1mb' }));

    app.get('/error/custom', () => {
      throw new AppError(
        ERROR_CODES.BOOKING_DATES_TAKEN,
        'Selected dates are already booked',
        409,
        {
          dates: ['2026-11-10', '2026-11-11'],
        },
      );
    });

    app.post(
      '/validate-test',
      validate({
        body: z.object({
          name: z.string().min(3),
          amountPaise: z.number().int().positive(),
        }),
      }),
      (_req, res) => {
        res.json({ success: true });
      },
    );

    app.get('/error/unexpected', () => {
      throw new Error('Something broke unexpectedly');
    });

    app.use(errorHandler);
    return app;
  }

  const app = createTestApp();

  it('formats AppError matching docs/API_SPEC.md standard error format', async () => {
    const res = await request(app).get('/error/custom');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'BOOKING_DATES_TAKEN',
        message: 'Selected dates are already booked',
        details: {
          dates: ['2026-11-10', '2026-11-11'],
        },
      },
    });
  });

  it('formats Zod validation errors as 400 with details', async () => {
    const res = await request(app).post('/validate-test').send({ name: 'A', amountPaise: -10 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(res.body.error.details.body).toHaveProperty('name');
    expect(res.body.error.details.body).toHaveProperty('amountPaise');
  });

  it('formats unexpected errors as 500 INTERNAL_ERROR', async () => {
    const res = await request(app).get('/error/unexpected');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(res.body.error).toHaveProperty('message');
  });
});
