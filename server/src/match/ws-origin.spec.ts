import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_ORIGIN, isOriginAllowed, parseAllowedOrigins } from './ws-origin';

describe('parseAllowedOrigins', () => {
  it('defaults to the nginx origin', () => {
    expect([...parseAllowedOrigins(undefined)]).toEqual([DEFAULT_APP_ORIGIN]);
    expect([...parseAllowedOrigins(' , ')]).toEqual([DEFAULT_APP_ORIGIN]);
  });

  it('parses and normalizes a comma-separated list', () => {
    const allowed = parseAllowedOrigins('https://example.com/, http://localhost:3000 ,bogus');
    expect([...allowed]).toEqual(['https://example.com', 'http://localhost:3000']);
  });
});

describe('isOriginAllowed', () => {
  const allowed = parseAllowedOrigins('https://localhost:8443');

  it('accepts the configured origin', () => {
    expect(isOriginAllowed('https://localhost:8443', allowed)).toBe(true);
  });

  it('rejects other origins, schemes and ports', () => {
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed('http://localhost:8443', allowed)).toBe(false);
    expect(isOriginAllowed('https://localhost:9443', allowed)).toBe(false);
    expect(isOriginAllowed('null', allowed)).toBe(false);
    expect(isOriginAllowed('', allowed)).toBe(false);
  });

  it('accepts requests without an Origin header', () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });
});
