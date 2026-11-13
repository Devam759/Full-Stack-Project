/**
 * @file apps/web/tests/webChatAndPinUI.test.js
 * Unit and logic tests for Web UI Chat, Map Pin, and Notification Bell components.
 */

import { describe, it, expect } from 'vitest';
import {
  BUSINESS_CONFIG,
  createMessageSchema,
  sanitizeChatMessage,
  haversineDistanceKm,
} from '@borrowloop/shared';

describe('Web UI: Chat, Pin & Notification Invariants (Phase 6)', () => {
  describe('Chat Input & Character Constraints', () => {
    it('enforces 1,000 character limit on message input', () => {
      const validText = 'a'.repeat(1000);
      const parsed = createMessageSchema.parse({
        clientMessageId: 'cmsg-ui-12345678',
        type: 'text',
        text: validText,
      });
      expect(parsed.text).toHaveLength(1000);

      const invalidText = 'a'.repeat(1001);
      expect(() =>
        createMessageSchema.parse({
          clientMessageId: 'cmsg-ui-12345678',
          type: 'text',
          text: invalidText,
        }),
      ).toThrow();
    });

    it('sanitizes HTML tags before submitting to prevent XSS in chat UI', () => {
      const payload = '<img src=x onerror=alert(1)>Meet at entrance';
      const clean = sanitizeChatMessage(payload);
      expect(clean).toBe('Meet at entrance');
    });
  });

  describe('Map Pin UI Logic', () => {
    it('validates pin coordinates within valid geographic bounds', () => {
      const validPin = { lat: 12.9716, lng: 77.5946, label: 'Central Gate' };
      const parsed = createMessageSchema.parse({
        clientMessageId: 'cmsg-ui-12345678',
        type: 'pin',
        pin: validPin,
      });
      expect(parsed.pin.lat).toBe(12.9716);
      expect(parsed.pin.lng).toBe(77.5946);
      expect(parsed.pin.label).toBe('Central Gate');
    });

    it('calculates pin distance from item location and validates 50 km boundary', () => {
      const itemLat = 12.9716;
      const itemLng = 77.5946;

      // 5 km away
      const nearLat = 12.9352;
      const nearLng = 77.6245;
      const nearDistance = haversineDistanceKm(itemLat, itemLng, nearLat, nearLng);
      expect(nearDistance).toBeLessThan(BUSINESS_CONFIG.CHAT.MAX_PIN_RADIUS_KM);

      // 80 km away
      const farLat = 12.2958;
      const farLng = 76.6394;
      const farDistance = haversineDistanceKm(itemLat, itemLng, farLat, farLng);
      expect(farDistance).toBeGreaterThan(BUSINESS_CONFIG.CHAT.MAX_PIN_RADIUS_KM);
    });
  });

  describe('Notification Badge Formatter', () => {
    it('formats unread badge count correctly including 99+ ceiling', () => {
      const formatBadge = (count) => (count > 99 ? '99+' : count.toString());

      expect(formatBadge(1)).toBe('1');
      expect(formatBadge(5)).toBe('5');
      expect(formatBadge(99)).toBe('99');
      expect(formatBadge(100)).toBe('99+');
      expect(formatBadge(250)).toBe('99+');
    });
  });
});
