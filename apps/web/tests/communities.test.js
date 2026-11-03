import { describe, it, expect } from 'vitest';
import { formatDistanceBand } from '../../api/src/modules/communities/communityService.js';
import { createCommunitySchema, joinCommunitySchema } from '@borrowloop/shared';

describe('Web Communities Logic & Distance Bands', () => {
  it('formats distance bands for location privacy', () => {
    expect(formatDistanceBand(450)).toBe('< 1 km');
    expect(formatDistanceBand(1800)).toBe('~2 km');
    expect(formatDistanceBand(4200)).toBe('~5 km');
    expect(formatDistanceBand(8500)).toBe('~10 km');
    expect(formatDistanceBand(23400)).toBe('~23 km');
  });

  it('validates community creation constraints', () => {
    const valid = {
      name: 'Indiranagar Circle',
      description: 'Neighborhood sharing',
      type: 'public',
      city: 'Bengaluru',
      location: { type: 'Point', coordinates: [77.64, 12.98] },
    };
    expect(createCommunitySchema.safeParse(valid).success).toBe(true);

    // Reserved name
    const reserved = { ...valid, name: 'admin' };
    expect(createCommunitySchema.safeParse(reserved).success).toBe(false);
  });

  it('validates join community invite code constraint', () => {
    expect(joinCommunitySchema.safeParse({}).success).toBe(true);
    expect(joinCommunitySchema.safeParse({ inviteCode: 'ABCDEF1234' }).success).toBe(true);
    expect(joinCommunitySchema.safeParse({ inviteCode: 'short' }).success).toBe(false); // min 8
  });
});
