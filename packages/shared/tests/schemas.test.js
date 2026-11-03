import { describe, it, expect } from 'vitest';
import {
  integerPaiseSchema,
  walletPaiseSchema,
  paginationQuerySchema,
  geoPointSchema,
  idempotencyKeySchema,
} from '../src/schemas/common.js';

describe('packages/shared/schemas', () => {
  it('validates integer paise schema', () => {
    expect(integerPaiseSchema.safeParse(100).success).toBe(true);
    expect(integerPaiseSchema.safeParse(0).success).toBe(true);
    expect(integerPaiseSchema.safeParse(10.5).success).toBe(false);
    expect(integerPaiseSchema.safeParse(-5).success).toBe(false);
  });

  it('validates wallet cap limit', () => {
    expect(walletPaiseSchema.safeParse(5000000).success).toBe(true);
    expect(walletPaiseSchema.safeParse(5000001).success).toBe(false);
  });

  it('validates pagination query parameters', () => {
    const defaultParsed = paginationQuerySchema.parse({});
    expect(defaultParsed.limit).toBe(20);
    expect(defaultParsed.cursor).toBeUndefined();

    const customParsed = paginationQuerySchema.parse({ limit: '35', cursor: 'abc_123' });
    expect(customParsed.limit).toBe(35);
    expect(customParsed.cursor).toBe('abc_123');

    expect(paginationQuerySchema.safeParse({ limit: 100 }).success).toBe(false); // max 50
  });

  it('validates GeoJSON Point schema', () => {
    const validPoint = { type: 'Point', coordinates: [77.5946, 12.9716] };
    expect(geoPointSchema.safeParse(validPoint).success).toBe(true);

    const invalidCoords = { type: 'Point', coordinates: [200, 12.9716] };
    expect(geoPointSchema.safeParse(invalidCoords).success).toBe(false);
  });

  it('validates idempotency key length', () => {
    expect(idempotencyKeySchema.safeParse('key-12345').success).toBe(true);
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false); // min 8
  });
});
