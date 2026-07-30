import { describe, it, expect } from 'vitest';
import { isSafeRedirectTarget } from '../src/lib/security/safeRedirect.js';

describe('isSafeRedirectTarget', () => {
  const allowedOrigins = ['https://stellarlend.com', 'https://stellarlend.com'];

  it('debe permitir rutas relativas locales del mismo origen', () => {
    expect(isSafeRedirectTarget('/dashboard', allowedOrigins)).toBe(true);
    expect(isSafeRedirectTarget('/profile/settings?user=1', allowedOrigins)).toBe(true);
  });

  it('debe permitir URLs absolutas contenidas en la lista blanca', () => {
    expect(isSafeRedirectTarget('https://stellarlend.com', allowedOrigins)).toBe(true);
    expect(isSafeRedirectTarget('https://stellarlend.com/wallet', allowedOrigins)).toBe(true);
  });

  it('debe rechazar URLs absolutas hacia dominios externos o atacantes', () => {
    expect(isSafeRedirectTarget('https://evil.com', allowedOrigins)).toBe(false);
    expect(isSafeRedirectTarget('https://google.com', allowedOrigins)).toBe(false);
  });

  it('debe bloquear intentos de bypass por protocolo relativo (//evil.com)', () => {
    expect(isSafeRedirectTarget('//evil.com', allowedOrigins)).toBe(false);
    expect(isSafeRedirectTarget('//://evil.com', allowedOrigins)).toBe(false);
  });

  it('debe bloquear esquemas peligrosos como javascript: o data:', () => {
    expect(isSafeRedirectTarget('javascript:alert(1)', allowedOrigins)).toBe(false);
    expect(isSafeRedirectTarget('data:text/html,<script>alert(1)</script>', allowedOrigins)).toBe(false);
  });

  it('debe retornar false ante valores vacíos o nulos', () => {
    expect(isSafeRedirectTarget('', allowedOrigins)).toBe(false);
  });
});
