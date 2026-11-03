/**
 * @file apps/web/src/brand.js
 * Single source of truth for brand tokens in the BorrowLoop user app.
 * Configures colors, typography, shapes, and exposes CSS variables.
 */

export const BRAND = Object.freeze({
  appName: 'BorrowLoop',
  tagline: 'Community Borrowing Platform',
  logo: {
    svg: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="3"/><path d="M11 16a5 5 0 0 1 10 0 5 5 0 0 1-10 0Z" stroke="currentColor" stroke-width="2.5"/></svg>`,
  },
  colors: {
    primary: '#0d9488', // calm teal accent
    primaryDark: '#0f766e',
    primaryLight: '#ccfbf1',
    background: '#f8fafc',
    surface: '#ffffff',
    text: '#0f172a',
    textMuted: '#64748b',
    success: '#16a34a',
    warning: '#d97706',
    danger: '#dc2626',
  },
  fonts: {
    heading: 'Inter, system-ui, -apple-system, sans-serif',
    body: 'Inter, system-ui, -apple-system, sans-serif',
  },
  radii: {
    brand: '0.5rem', // subtle rounded edges (8px)
  },
});

/**
 * Injects brand tokens into document root as CSS variables.
 */
export function applyBrandTokens(brand = BRAND) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  root.style.setProperty('--color-primary', brand.colors.primary);
  root.style.setProperty('--color-primary-dark', brand.colors.primaryDark);
  root.style.setProperty('--color-primary-light', brand.colors.primaryLight);
  root.style.setProperty('--color-background', brand.colors.background);
  root.style.setProperty('--color-surface', brand.colors.surface);
  root.style.setProperty('--color-text', brand.colors.text);
  root.style.setProperty('--color-text-muted', brand.colors.textMuted);
  root.style.setProperty('--color-success', brand.colors.success);
  root.style.setProperty('--color-warning', brand.colors.warning);
  root.style.setProperty('--color-danger', brand.colors.danger);

  root.style.setProperty('--font-heading', brand.fonts.heading);
  root.style.setProperty('--font-body', brand.fonts.body);
  root.style.setProperty('--radius-brand', brand.radii.brand);
}

export default BRAND;
