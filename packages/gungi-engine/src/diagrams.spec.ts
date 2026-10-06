import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEmptyBoard, getStack, setStack } from './board';
import type { PieceDiagram } from './diagrams';
import {
  ARCHER_BLOCK_SCENARIOS,
  COLORS,
  SCENARIO_COLORS,
  archerBlockDiagram,
  REGENERATE_COMMAND,
  TIERS,
  moveSummary,
  pieceDiagram,
  renderPieceSvg,
  renderPiecesFiles,
  renderScenarioSvg,
  squareKey,
} from './diagrams';
import { reachableSquares } from './movement';
import { PIECE_GLYPHS } from './pieces';
import type { Piece, Square } from './types';
import { PIECE_KINDS } from './types';

const DOCS = new URL('../../../docs/', import.meta.url);

/**
 * Text sketch of a diagram's model around the piece (rows from +top to
 * -bottom): `1`-`3` step tier, `a`-`c` jump landing tier, `R` slide,
 * `x` passed over, `・` nothing, the glyph at the piece.
 */
function sketch(diagram: PieceDiagram, width: number, top: number, bottom: number): string {
  const rows: string[] = [];
  for (let dr = top; dr >= bottom; dr--) {
    let row = '';
    for (let df = -width; df <= width; df++) {
      const sq = { file: diagram.origin.file + df, rank: diagram.origin.rank + dr };
      const cell = diagram.cells.get(squareKey(sq));
      if (df === 0 && dr === 0) row += PIECE_GLYPHS[diagram.kind];
      else if (cell?.tier) row += cell.jump ? 'abc'[cell.tier - 1] : String(cell.tier);
      else if (cell?.slide) row += 'R';
      else if (cell?.passed) row += 'x';
      else row += '・';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

describe('§5 movement diagrams (docs/GUNGI_PIECES.md, docs/pieces/*.svg)', () => {
  const files = renderPiecesFiles();

  it('the committed files are the ones generated from the engine', () => {
    if (process.env.UPDATE_PIECE_DIAGRAMS === '1') {
      for (const [path, content] of files) {
        const url = new URL(path, DOCS);
        mkdirSync(dirname(url.pathname), { recursive: true });
        writeFileSync(url, content);
      }
    }
    for (const [path, content] of files) {
      const committed = readFileSync(new URL(path, DOCS), 'utf8');
      expect(committed, `docs/${path} is stale; run: ${REGENERATE_COMMAND}`).toBe(content);
    }
  });

  it('docs/pieces/ holds no image that is not generated', () => {
    const committed = readdirSync(new URL('pieces/', DOCS)).map((f) => `pieces/${f}`);
    expect(committed.sort()).toEqual(
      [...files.keys()].filter((p) => p !== 'GUNGI_PIECES.md').sort(),
    );
  });

  for (const kind of PIECE_KINDS) {
    it(`${kind}: the cells up to each tier are exactly the engine's reachable squares`, () => {
      const diagram = pieceDiagram(kind);
      for (const tier of TIERS) {
        const below: Piece[] = Array.from({ length: tier - 1 }, () => ({
          kind: 'pawn',
          owner: 'black',
        }));
        const board = setStack(createEmptyBoard(), diagram.origin, [
          ...below,
          { kind, owner: 'black' },
        ]);
        const reached = reachableSquares(board, diagram.origin, { kind, owner: 'black' }, tier)
          .map(squareKey)
          .sort();
        const marked = [...diagram.cells]
          .filter(([, cell]) => cell.slide || (cell.tier !== undefined && cell.tier <= tier))
          .map(([k]) => k)
          .sort();
        expect(marked).toEqual(reached);
      }
    });

    it(`${kind}: the SVG colours one cell per marked square`, () => {
      const diagram = pieceDiagram(kind);
      const svg = renderPieceSvg(diagram);
      const count = (fill: string): number =>
        svg
          .split('\n')
          .filter((line) => line.startsWith('<rect') && line.includes(`fill="${fill}"`)).length;
      const cells = [...diagram.cells.values()];
      for (const tier of TIERS) {
        expect(count(COLORS.tier[tier])).toBe(cells.filter((c) => c.tier === tier).length);
      }
      expect(count(COLORS.slide)).toBe(cells.filter((c) => c.slide && !c.tier).length);
      expect(svg.match(/<circle [^>]*r="6"/g) ?? []).toHaveLength(
        cells.filter((c) => c.jump).length,
      );
      expect(svg).toContain(`>${PIECE_GLYPHS[kind]}</text>`);
    });
  }

  it('§5.3.12 the archer fans out like the official figure', () => {
    expect(sketch(pieceDiagram('archer'), 3, 4, -3)).toBe(
      [
        'c・・c・・c',
        '・b・b・b・',
        '・・aaa・・',
        '・・xxx・・',
        '・・・弓・・・',
        '・・・1・・・',
        '・・・2・・・',
        '・・・3・・・',
      ].join('\n'),
    );
    expect(moveSummary('archer')).toBe('跳 (−1,+2)・(0,+2)・(+1,+2) / 歩1 後');
  });

  it('cannon and musket extend their jump forward one square per tier', () => {
    expect(sketch(pieceDiagram('cannon'), 3, 5, -3)).toBe(
      [
        '・・・c・・・',
        '・・・b・・・',
        '・・・a・・・',
        '・・・x・・・',
        '・・・x・・・',
        '321砲123',
        '・・・1・・・',
        '・・・2・・・',
        '・・・3・・・',
      ].join('\n'),
    );
    expect(sketch(pieceDiagram('musket'), 3, 4, -3)).toBe(
      [
        '・・・c・・・',
        '・・・b・・・',
        '・・・a・・・',
        '・・・x・・・',
        '・・・筒・・・',
        '・・1・1・・',
        '・2・・・2・',
        '3・・・・・3',
      ].join('\n'),
    );
  });

  it('slides are drawn as red cells and one arrow per direction up to the board edge', () => {
    const general = pieceDiagram('general');
    expect(sketch(general, 4, 4, -4)).toBe(
      [
        '・・・・R・・・・',
        '・3・・R・・3・',
        '・・2・R・2・・',
        '・・・1R1・・・',
        'RRRR大RRRR',
        '・・・1R1・・・',
        '・・2・R・2・・',
        '・3・・R・・3・',
        '・・・・R・・・・',
      ].join('\n'),
    );
    const arrowheads = renderPieceSvg(general).match(new RegExp(`Z" fill="${COLORS.arrow}"`, 'g'));
    expect(arrowheads).toHaveLength(4);
    expect(moveSummary('general')).toBe('走 前・後・左・右 / 歩1 左前・右前・左後・右後');
  });

  describe('§5.4 archer blocking figures (docs/pieces/archer-block-*.svg)', () => {
    const parse = (k: string): [number, number] => {
      const [f = NaN, r = NaN] = k.split(',').map(Number);
      return [f, r];
    };
    const forward = (origin: Square, keys: Iterable<string>): string[] =>
      [...keys].filter((k) => parse(k)[1] > origin.rank).sort();
    const rel = (origin: Square, keys: Iterable<string>): string[] =>
      [...keys]
        .map((k) => {
          const [f, r] = parse(k);
          return `${f - origin.file},${r - origin.rank}`;
        })
        .sort();
    const split = (id: 1 | 2) => {
      const scenario = ARCHER_BLOCK_SCENARIOS.find((s) => s.id === id);
      if (!scenario) throw new Error(`no scenario ${id}`);
      const d = archerBlockDiagram(scenario);
      const ls = [...d.landings];
      return {
        d,
        open: ls.filter(([, l]) => !l.blocked).map(([k]) => k),
        blocked: ls.filter(([, l]) => l.blocked).map(([k]) => k),
      };
    };

    for (const scenario of ARCHER_BLOCK_SCENARIOS) {
      it(`figure ${scenario.id}: the open and blocked landings are the engine's`, () => {
        const { d, open, blocked } = split(scenario.id);
        const archer: Piece = { kind: 'archer', owner: 'black' };
        expect(getStack(d.board, d.blocker)).toHaveLength(scenario.height);
        expect(getStack(d.board, d.blocker).at(-1)?.owner).toBe('white');
        expect(getStack(d.board, d.origin)).toHaveLength(scenario.tier);
        expect(scenario.height).toBeGreaterThan(scenario.tier);
        const reached = reachableSquares(d.board, d.origin, archer, scenario.tier).map(squareKey);
        expect(open.sort()).toEqual(forward(d.origin, reached));
        const empty = setStack(createEmptyBoard(), d.origin, getStack(d.board, d.origin));
        const all = reachableSquares(empty, d.origin, archer, scenario.tier).map(squareKey);
        expect([...open, ...blocked].sort()).toEqual(forward(d.origin, all));
        expect(blocked.length).toBeGreaterThan(0);
      });

      it(`figure ${scenario.id}: the SVG strikes every blocked landing`, () => {
        const { d, open, blocked } = split(scenario.id);
        const svg = renderScenarioSvg(d);
        const strikes = svg.match(new RegExp(`stroke="${SCENARIO_COLORS.strike}"`, 'g')) ?? [];
        const onBlocker = d.landings.has(squareKey(d.blocker)) ? 1 : 0;
        expect(strikes).toHaveLength(blocked.length);
        expect(svg.match(/<circle [^>]*r="(5|6)"/g) ?? []).toHaveLength(
          open.length + blocked.length,
        );
        expect(svg.match(new RegExp(`fill="${SCENARIO_COLORS.blocked}"`, 'g')) ?? []).toHaveLength(
          blocked.length,
        );
        expect(svg.match(new RegExp(`fill="${SCENARIO_COLORS.blocker}"`, 'g')) ?? []).toHaveLength(
          1,
        );
        expect(onBlocker).toBe(scenario.id === 2 ? 1 : 0);
        expect(svg).toContain(`>${PIECE_GLYPHS.archer}</text>`);
      });
    }

    it('figure 1: (+1,+1) closes the whole right ray', () => {
      const { d, open, blocked } = split(1);
      expect(rel(d.origin, open)).toEqual(['-1,2', '-2,3', '0,2', '0,3']);
      expect(rel(d.origin, blocked)).toEqual(['1,2', '2,3']);
      expect(rel(d.origin, d.passed)).toEqual(['-1,1', '0,1']);
    });

    it('figure 2: (+1,+2) stays a landing but closes (+2,+3)', () => {
      const { d, open, blocked } = split(2);
      expect(rel(d.origin, open)).toEqual(['-1,2', '-2,3', '0,2', '0,3', '1,2']);
      expect(rel(d.origin, blocked)).toEqual(['2,3']);
      expect(rel(d.origin, d.passed)).toEqual(['-1,1', '0,1', '1,1']);
    });
  });
});
