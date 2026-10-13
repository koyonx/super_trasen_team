import { describe, expect, it } from 'vitest';
import { WS_PROTOCOL_VERSION } from '@gungi/shared';
import { DISPLAY_NAME_MAX_LENGTH, GuestAuthAdapter, sanitizeDisplayName } from './ws-auth.adapter';

describe('sanitizeDisplayName', () => {
  it('keeps ordinary names', () => {
    expect(sanitizeDisplayName('Alice')).toBe('Alice');
    expect(sanitizeDisplayName('ゴン')).toBe('ゴン');
  });

  it('removes control and format characters and collapses whitespace', () => {
    expect(sanitizeDisplayName('  Al\u0000i​ce \n\t Bob  ')).toBe('Alice Bob');
    expect(sanitizeDisplayName('‮evil')).toBe('evil');
  });

  it('normalizes compatibility forms', () => {
    expect(sanitizeDisplayName('ＡＢＣ')).toBe('ABC');
  });

  it('truncates by code points', () => {
    const name = sanitizeDisplayName('🀄'.repeat(40));
    expect(Array.from(name ?? '')).toHaveLength(DISPLAY_NAME_MAX_LENGTH);
  });

  it('returns null for missing or empty names', () => {
    expect(sanitizeDisplayName(undefined)).toBeNull();
    expect(sanitizeDisplayName(' \u0007 ')).toBeNull();
  });
});

describe('GuestAuthAdapter', () => {
  it('issues a distinct guest identity per connection', async () => {
    const adapter = new GuestAuthAdapter();
    const auth = { protocolVersion: WS_PROTOCOL_VERSION, displayName: ' Gon ' } as const;
    const a = await adapter.authenticate({ headers: {}, auth });
    const b = await adapter.authenticate({ headers: {}, auth });

    expect(a.kind).toBe('guest');
    expect(a.displayName).toBe('Gon');
    expect(a.playerId).toMatch(/^guest_[0-9a-f-]{36}$/);
    expect(a.playerId).not.toBe(b.playerId);
  });
});
