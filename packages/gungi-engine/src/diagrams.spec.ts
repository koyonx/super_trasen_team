import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEmptyBoard, setStack } from './board';
import {
  MARK,
  REGENERATE_COMMAND,
  TIERS,
  pieceDiagram,
  renderDiagram,
  renderPiecesDoc,
} from './diagrams';
import { reachableSquares } from './movement';
import type { Piece } from './types';
import { PIECE_KINDS } from './types';

const DOC = new URL('../../../docs/GUNGI_PIECES.md', import.meta.url);

describe('§5 movement diagrams (docs/GUNGI_PIECES.md)', () => {
  it('the committed document is the one generated from the engine', () => {
    const generated = renderPiecesDoc();
    if (process.env.UPDATE_PIECE_DIAGRAMS === '1') writeFileSync(DOC, generated);
    const committed = readFileSync(DOC, 'utf8');
    expect(committed, `docs/GUNGI_PIECES.md is stale; run: ${REGENERATE_COMMAND}`).toBe(generated);
  });

  for (const kind of PIECE_KINDS) {
    it(`${kind}: the marked squares are exactly the engine's reachable squares`, () => {
      const diagram = pieceDiagram(kind);
      TIERS.forEach((tier, i) => {
        const below: Piece[] = Array.from({ length: tier - 1 }, () => ({
          kind: 'pawn',
          owner: 'black',
        }));
        const board = setStack(createEmptyBoard(), diagram.origin, [
          ...below,
          { kind, owner: 'black' },
        ]);
        const reached = reachableSquares(board, diagram.origin, { kind, owner: 'black' }, tier)
          .map((sq) => `${sq.file - diagram.origin.file},${sq.rank - diagram.origin.rank}`)
          .sort();
        const marked = [...(diagram.tiers[i] ?? new Map<string, string>())]
          .filter(([, mark]) => mark !== MARK.passed)
          .map(([offset]) => offset)
          .sort();
        expect(marked).toEqual(reached);
      });
    });
  }

  it('§5.3.12 the archer fans out like the official figure', () => {
    expect(renderDiagram(pieceDiagram('archer'))).toBe(
      [
        '１段　　　　　　　２段　　　　　　　３段',
        '・・・・・・・　　・・・・・・・　　○・・○・・○  +4',
        '・・・・・・・　　・○・○・○・　　・○・○・○・  +3',
        '・・○○○・・　　・・○○○・・　　・・○○○・・  +2',
        '・・×××・・　　・・×××・・　　・・×××・・  +1',
        '・・・弓・・・　　・・・弓・・・　　・・・弓・・・   0',
        '・・・●・・・　　・・・●・・・　　・・・●・・・  -1',
        '・・・・・・・　　・・・●・・・　　・・・●・・・  -2',
        '・・・・・・・　　・・・・・・・　　・・・●・・・  -3',
      ].join('\n'),
    );
  });

  it('slides are drawn with their direction up to the board edge', () => {
    const general = renderDiagram(pieceDiagram('general'));
    expect(general).toContain('－－－－大－－－－');
    expect(general.split('\n').filter((row) => row.includes('｜'))).toHaveLength(8);
  });
});
