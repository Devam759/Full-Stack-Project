import { describe, it, expect } from 'vitest';
import {
  integerPaiseSchema,
  walletPaiseSchema,
  paginationQuerySchema,
  geoPointSchema,
  idempotencyKeySchema,
  createItemSchema,
} from '../src/schemas/index.js';

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

  it('validates createItemSchema with sanitization, category, and wallet cap invariant', () => {
    const validData = {
      title: '<b>Drill Machine</b>  with bits  ',
      description: '<p>A heavy duty drill machine in perfect condition.</p>',
      category: 'tools_and_diy',
      condition: 'good',
      photos: ['https://res.cloudinary.com/demo/image/upload/borrowloop/items/user123/drill.jpg'],
      rentPerDayPaise: 200_00, // Rs 200
      depositPaise: 1000_00, // Rs 1000
      minDays: 1,
      maxDays: 7,
      communityIds: ['507f1f77bcf86cd799439011'],
    };

    const parsed = createItemSchema.parse(validData);
    expect(parsed.title).toBe('Drill Machine with bits');
    expect(parsed.description).toBe('A heavy duty drill machine in perfect condition.');

    // Prohibited category fails
    const invalidCategory = { ...validData, category: 'weapons and ammunition' };
    expect(createItemSchema.safeParse(invalidCategory).success).toBe(false);

    // Electronics category requires electronicsWarningAccepted
    const electronicsWithoutAck = {
      ...validData,
      category: 'electronics_and_gadgets',
      electronicsWarningAccepted: false,
    };
    expect(createItemSchema.safeParse(electronicsWithoutAck).success).toBe(false);

    const electronicsWithAck = {
      ...validData,
      category: 'electronics_and_gadgets',
      electronicsWarningAccepted: true,
    };
    expect(createItemSchema.safeParse(electronicsWithAck).success).toBe(true);

    // Wallet cap invariant failure (rent * maxDays + deposit > 50,000,00)
    const overCap = {
      ...validData,
      rentPerDayPaise: 5000_00,
      maxDays: 10,
      depositPaise: 1000_00, // 50,000 + 1,000 = 51,000 > 50,000
    };
    expect(createItemSchema.safeParse(overCap).success).toBe(false);
  });
});
