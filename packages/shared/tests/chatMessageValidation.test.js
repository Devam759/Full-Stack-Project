import { describe, it, expect } from 'vitest';
import {
  createMessageSchema,
  confirmPinSchema,
  listMessagesQuerySchema,
  notificationQuerySchema,
  sanitizeChatMessage,
  haversineDistanceKm,
  ERROR_CODES,
  BUSINESS_CONFIG,
} from '../src/index.js';

describe('Chat and Notification Validation (Phase 6)', () => {
  describe('Sanitization', () => {
    it('strips HTML tags from text messages', () => {
      const dirty = '<script>alert("hack")</script>Hello <b>world</b>!';
      const clean = sanitizeChatMessage(dirty);
      expect(clean).toBe('Hello world!');
    });

    it('strips unprintable control characters while preserving newline and tab', () => {
      const dirty = 'Line 1\x00\x08\x1b\nLine 2\tEnd';
      const clean = sanitizeChatMessage(dirty);
      expect(clean).toBe('Line 1\nLine 2\tEnd');
    });

    it('rejects text messages that are empty or whitespace only', () => {
      expect(() =>
        createMessageSchema.parse({
          clientMessageId: 'cmsg-12345678',
          type: 'text',
          text: '   ',
        }),
      ).toThrow();
      expect(() =>
        createMessageSchema.parse({
          clientMessageId: 'cmsg-12345678',
          type: 'text',
          text: '',
        }),
      ).toThrow();
    });

    it('rejects text messages exceeding max characters (1,000)', () => {
      const tooLong = 'a'.repeat(BUSINESS_CONFIG.CHAT.MAX_MESSAGE_LENGTH + 1);
      expect(() =>
        createMessageSchema.parse({
          clientMessageId: 'cmsg-12345678',
          type: 'text',
          text: tooLong,
        }),
      ).toThrow();
      const valid = 'a'.repeat(BUSINESS_CONFIG.CHAT.MAX_MESSAGE_LENGTH);
      expect(
        createMessageSchema.parse({
          clientMessageId: 'cmsg-12345678',
          type: 'text',
          text: valid,
        }).text,
      ).toBe(valid);
    });

    it('validates clientMessageId: required, min 8, max 128 chars', () => {
      expect(() =>
        createMessageSchema.parse({
          type: 'text',
          text: 'Hello',
        }),
      ).toThrow();
      expect(() =>
        createMessageSchema.parse({
          clientMessageId: 'short',
          type: 'text',
          text: 'Hello',
        }),
      ).toThrow();
      expect(() =>
        createMessageSchema.parse({
          clientMessageId: 'a'.repeat(129),
          type: 'text',
          text: 'Hello',
        }),
      ).toThrow();
      const parsed = createMessageSchema.parse({
        clientMessageId: 'cmsg-valid-id-12345',
        type: 'text',
        text: 'Hello',
      });
      expect(parsed.clientMessageId).toBe('cmsg-valid-id-12345');
    });
  });

  describe('Pin Message Validation', () => {
    it('accepts valid pin coordinates and label', () => {
      const validPin = {
        clientMessageId: 'cmsg-pin-12345678',
        type: 'pin',
        pin: {
          lat: 12.9716,
          lng: 77.5946,
          label: 'Metro Gate 2 Coffee Shop',
        },
      };
      const parsed = createMessageSchema.parse(validPin);
      expect(parsed.clientMessageId).toBe('cmsg-pin-12345678');
      expect(parsed.pin.lat).toBe(12.9716);
      expect(parsed.pin.lng).toBe(77.5946);
      expect(parsed.pin.label).toBe('Metro Gate 2 Coffee Shop');
      expect(confirmPinSchema.parse({})).toBeDefined();
    });

    it('rejects invalid pin coordinates', () => {
      expect(() =>
        createMessageSchema.parse({
          clientMessageId: 'cmsg-pin-12345678',
          type: 'pin',
          pin: { lat: 95.0, lng: 77.59, label: 'Invalid Lat' },
        }),
      ).toThrow();

      expect(() =>
        createMessageSchema.parse({
          clientMessageId: 'cmsg-pin-12345678',
          type: 'pin',
          pin: { lat: 12.97, lng: 190.0, label: 'Invalid Lng' },
        }),
      ).toThrow();
    });

    it('rejects pin message with missing label or label over 100 chars', () => {
      expect(() =>
        createMessageSchema.parse({
          clientMessageId: 'cmsg-pin-12345678',
          type: 'pin',
          pin: { lat: 12.97, lng: 77.59, label: '' },
        }),
      ).toThrow();

      expect(() =>
        createMessageSchema.parse({
          clientMessageId: 'cmsg-pin-12345678',
          type: 'pin',
          pin: { lat: 12.97, lng: 77.59, label: 'a'.repeat(101) },
        }),
      ).toThrow();
    });
  });

  describe('Haversine Distance & Pin Boundary', () => {
    it('calculates distance accurately between two coordinates', () => {
      const dist = haversineDistanceKm(12.9716, 77.5946, 12.9698, 77.75);
      expect(dist).toBeGreaterThan(15);
      expect(dist).toBeLessThan(18);
    });

    it('detects pins within and outside the 50 km boundary', () => {
      const nearDist = haversineDistanceKm(12.9716, 77.5946, 13.05, 77.5946);
      expect(nearDist).toBeLessThanOrEqual(BUSINESS_CONFIG.CHAT.MAX_PIN_RADIUS_KM);

      const farDist = haversineDistanceKm(12.9716, 77.5946, 12.2958, 76.6394);
      expect(farDist).toBeGreaterThan(BUSINESS_CONFIG.CHAT.MAX_PIN_RADIUS_KM);
    });
  });

  describe('Message Query & Notification Query Schemas', () => {
    it('parses message query with defaults and limits', () => {
      const parsed = listMessagesQuerySchema.parse({});
      expect(parsed.limit).toBe(30);
      expect(parsed.direction).toBe('before');

      const custom = listMessagesQuerySchema.parse({ limit: '50', direction: 'after' });
      expect(custom.limit).toBe(50);
      expect(custom.direction).toBe('after');

      expect(() => listMessagesQuerySchema.parse({ limit: '101' })).toThrow();
    });

    it('parses notification query with defaults and filters', () => {
      const parsed = notificationQuerySchema.parse({});
      expect(parsed.limit).toBe(20);
      expect(parsed.unreadOnly).toBe(false);

      const unread = notificationQuerySchema.parse({ unreadOnly: 'true', limit: '10' });
      expect(unread.unreadOnly).toBe(true);
      expect(unread.limit).toBe(10);
    });
  });

  describe('Phase 6 Error Codes', () => {
    it('contains all required error codes for chat, pin, and notifications', () => {
      expect(ERROR_CODES.PIN_OUT_OF_BOUNDS).toBe('PIN_OUT_OF_BOUNDS');
      expect(ERROR_CODES.CANNOT_CONFIRM_OWN_PIN).toBe('CANNOT_CONFIRM_OWN_PIN');
      expect(ERROR_CODES.NO_ACTIVE_PIN_PROPOSAL).toBe('NO_ACTIVE_PIN_PROPOSAL');
      expect(ERROR_CODES.PIN_ALREADY_CONFIRMED).toBe('PIN_ALREADY_CONFIRMED');
      expect(ERROR_CODES.BOOKING_TERMINAL_CHAT_CLOSED).toBe('BOOKING_TERMINAL_CHAT_CLOSED');
      expect(ERROR_CODES.CONVERSATION_NOT_FOUND).toBe('CONVERSATION_NOT_FOUND');
      expect(ERROR_CODES.NOTIFICATION_NOT_FOUND).toBe('NOTIFICATION_NOT_FOUND');
    });
  });
});
