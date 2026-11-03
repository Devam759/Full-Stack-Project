import { describe, it, expect } from 'vitest';
import { BRAND } from '../src/brand.js';

describe('apps/web brand tokens and configuration', () => {
  it('exposes defined brand tokens with required colors and typography', () => {
    expect(BRAND.appName).toBe('BorrowLoop');
    expect(BRAND.colors).toHaveProperty('primary');
    expect(BRAND.colors).toHaveProperty('background');
    expect(BRAND.colors).toHaveProperty('surface');
    expect(BRAND.colors).toHaveProperty('text');
    expect(BRAND.fonts).toHaveProperty('heading');
    expect(BRAND.fonts).toHaveProperty('body');
  });
});
