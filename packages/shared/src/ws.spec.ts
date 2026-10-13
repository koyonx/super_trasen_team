import { describe, expect, it } from 'vitest';
import {
  ClientEvent,
  ServerEvent,
  WS_PROTOCOL_VERSION,
  clientEventSchemas,
  clientMoveSchema,
  createMatchSchema,
  handshakeAuthSchema,
  joinMatchSchema,
  matchRoom,
  moveRequestSchema,
  rejoinMatchSchema,
} from './index';

const MATCH_ID = '3f0c6c55-5d6e-4b8e-9a39-2a6f2f1f6a10';
const TOKEN = 'a'.repeat(43);

describe('ws event names', () => {
  it('uses the match: prefix and distinct names', () => {
    const names = [...Object.values(ClientEvent), ...Object.values(ServerEvent)];
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.startsWith('match:')).toBe(true);
  });

  it('has a payload schema for every client event', () => {
    expect(Object.keys(clientEventSchemas).sort()).toEqual(Object.values(ClientEvent).sort());
  });

  it('builds room names from match ids', () => {
    expect(matchRoom(MATCH_ID)).toBe(`match:${MATCH_ID}`);
  });
});

describe('handshake auth', () => {
  it('requires the current protocol version', () => {
    expect(handshakeAuthSchema.safeParse({ protocolVersion: WS_PROTOCOL_VERSION }).success).toBe(
      true,
    );
    expect(handshakeAuthSchema.safeParse({ protocolVersion: 0 }).success).toBe(false);
    expect(handshakeAuthSchema.safeParse({}).success).toBe(false);
    expect(handshakeAuthSchema.safeParse(undefined).success).toBe(false);
  });

  it('bounds the suggested display name', () => {
    const long = { protocolVersion: WS_PROTOCOL_VERSION, displayName: 'x'.repeat(201) };
    expect(handshakeAuthSchema.safeParse(long).success).toBe(false);
  });
});

describe('match:create', () => {
  it('defaults both choices to random, also without a payload', () => {
    expect(createMatchSchema.parse(undefined)).toEqual({ side: 'random', firstPlayer: 'random' });
    expect(createMatchSchema.parse({})).toEqual({ side: 'random', firstPlayer: 'random' });
  });

  it('accepts explicit sides and rejects unknown ones', () => {
    expect(createMatchSchema.parse({ side: 'white', firstPlayer: 'black' })).toEqual({
      side: 'white',
      firstPlayer: 'black',
    });
    expect(createMatchSchema.safeParse({ side: 'red' }).success).toBe(false);
    expect(createMatchSchema.safeParse('black').success).toBe(false);
  });
});

describe('match:join / match:rejoin', () => {
  it('requires a uuid match id', () => {
    expect(joinMatchSchema.safeParse({ matchId: MATCH_ID }).success).toBe(true);
    expect(joinMatchSchema.safeParse({ matchId: 'nope' }).success).toBe(false);
    expect(joinMatchSchema.safeParse(null).success).toBe(false);
  });

  it('requires a well-formed rejoin token', () => {
    expect(rejoinMatchSchema.safeParse({ matchId: MATCH_ID, rejoinToken: TOKEN }).success).toBe(
      true,
    );
    expect(rejoinMatchSchema.safeParse({ matchId: MATCH_ID, rejoinToken: 'short' }).success).toBe(
      false,
    );
    expect(
      rejoinMatchSchema.safeParse({ matchId: MATCH_ID, rejoinToken: `${'a'.repeat(42)}=` }).success,
    ).toBe(false);
  });
});

describe('match:move', () => {
  it('accepts every client move type', () => {
    const moves = [
      { type: 'place', kind: 'marshal', to: { file: 4, rank: 0 } },
      { type: 'finishPlacement' },
      { type: 'move', from: { file: 0, rank: 0 }, to: { file: 0, rank: 1 } },
      { type: 'capture', from: { file: 0, rank: 0 }, to: { file: 0, rank: 1 } },
      { type: 'stack', from: { file: 0, rank: 0 }, to: { file: 0, rank: 1 }, betray: true },
      { type: 'drop', player: 'white', kind: 'pawn', to: { file: 0, rank: 8 } },
      { type: 'resign' },
    ];
    for (const move of moves) expect(clientMoveSchema.safeParse(move).success).toBe(true);
  });

  it('rejects server-only terminal actions', () => {
    expect(clientMoveSchema.safeParse({ type: 'timeout', player: 'black' }).success).toBe(false);
    expect(clientMoveSchema.safeParse({ type: 'agreeDraw' }).success).toBe(false);
  });

  it('rejects malformed moves', () => {
    const bad = [
      null,
      'place',
      { type: 'teleport' },
      { type: 'place', kind: 'dragon', to: { file: 0, rank: 0 } },
      { type: 'place', kind: 'pawn', to: { file: 0.5, rank: 0 } },
      { type: 'place', kind: 'pawn' },
      { type: 'move', from: { file: 0, rank: 0 }, to: { file: 0, rank: 1 }, betray: 'yes' },
      { type: 'resign', player: 'red' },
    ];
    for (const move of bad) expect(clientMoveSchema.safeParse(move).success).toBe(false);
  });

  it('leaves board bounds to the engine and strips unknown keys', () => {
    const parsed = clientMoveSchema.parse({
      type: 'place',
      kind: 'pawn',
      to: { file: 99, rank: -1 },
      extra: true,
    });
    expect(parsed).toEqual({ type: 'place', kind: 'pawn', to: { file: 99, rank: -1 } });
  });

  it('validates the optional ply guard', () => {
    const move = { type: 'resign' };
    expect(moveRequestSchema.safeParse({ matchId: MATCH_ID, move, ply: 3 }).success).toBe(true);
    expect(moveRequestSchema.safeParse({ matchId: MATCH_ID, move, ply: -1 }).success).toBe(false);
    expect(moveRequestSchema.safeParse({ matchId: MATCH_ID, move }).success).toBe(true);
  });
});
