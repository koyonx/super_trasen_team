/**
 * Movement diagrams of every piece at tier 1..3 (docs/GUNGI_PIECES.md).
 *
 * The diagrams are drawn from the engine's own movement definition: each
 * piece is put on an empty board and every rule's squares are taken from
 * `ruleSquares`, so the document cannot drift from the implementation
 * (`diagrams.spec.ts` compares the committed file with `renderPiecesDoc`).
 */

import { createEmptyBoard, setStack } from './board';
import type { Direction, MoveRule } from './movement';
import { MOVE_RULES, jumpSquares, ruleSquares } from './movement';
import { PIECE_GLYPHS } from './pieces';
import type { Board, Piece, PieceKind, Square } from './types';
import { PIECE_KINDS } from './types';

export const TIERS = [1, 2, 3] as const;

export const MARK = {
  empty: '・',
  step: '●',
  jump: '○',
  passed: '×',
} as const;

/** §5.1 slide marks by direction (`df,dr`, black's view, forward = up). */
const SLIDE_MARK: Readonly<Record<string, string>> = {
  '0,1': '｜',
  '0,-1': '｜',
  '1,0': '－',
  '-1,0': '－',
  '1,1': '／',
  '-1,-1': '／',
  '-1,1': '＼',
  '1,-1': '＼',
};

const key = (df: number, dr: number): string => `${df},${dr}`;

/** Marks keyed by `df,dr` relative to the piece (black, forward = +dr). */
export type Marks = ReadonlyMap<string, string>;

export interface PieceDiagram {
  readonly kind: PieceKind;
  /** Square of the (black) piece on the empty board the marks were taken from. */
  readonly origin: Square;
  /** Marks at tier 1, 2, 3. */
  readonly tiers: readonly Marks[];
}

function boardWith(kind: PieceKind, origin: Square, tier: number): Board {
  const below: Piece[] = Array.from({ length: tier - 1 }, () => ({ kind: 'pawn', owner: 'black' }));
  return setStack(createEmptyBoard(), origin, [...below, { kind, owner: 'black' }]);
}

function markOf(rule: MoveRule): string {
  if (rule.kind === 'jump') return MARK.jump;
  if (rule.kind === 'step') return MARK.step;
  return SLIDE_MARK[key(...rule.dir)] ?? MARK.step;
}

function marksAt(kind: PieceKind, origin: Square, tier: number): Map<string, string> {
  const board = boardWith(kind, origin, tier);
  const piece: Piece = { kind, owner: 'black' };
  const marks = new Map<string, string>();
  const rel = (sq: Square): string => key(sq.file - origin.file, sq.rank - origin.rank);
  for (const rule of MOVE_RULES[kind]) {
    if (rule.kind === 'jump') {
      for (const { over } of jumpSquares(rule, tier)) {
        for (const [df, dr] of over) marks.set(key(df, dr), MARK.passed);
      }
    }
  }
  for (const rule of MOVE_RULES[kind]) {
    for (const sq of ruleSquares(board, origin, piece, rule, tier))
      marks.set(rel(sq), markOf(rule));
  }
  return marks;
}

/** Squares reached by the tier-3 piece, ignoring slides (which always reach an edge). */
function boundedReach(kind: PieceKind, origin: Square): number {
  const board = boardWith(kind, origin, 3);
  const piece: Piece = { kind, owner: 'black' };
  return MOVE_RULES[kind]
    .filter((rule) => rule.kind !== 'slide')
    .reduce((n, rule) => n + ruleSquares(board, origin, piece, rule, 3).length, 0);
}

/**
 * The origin on file 4 from which the tier-3 range fits the board best
 * (the centre when it fits there).
 */
const CENTER_RANK = 4;

function originOf(kind: PieceKind): Square {
  let best: Square = { file: 4, rank: CENTER_RANK };
  let bestReach = boundedReach(kind, best);
  for (const rank of [3, 5, 2, 6, 1, 7, 0, 8]) {
    const origin = { file: 4, rank };
    const n = boundedReach(kind, origin);
    if (n > bestReach) [best, bestReach] = [origin, n];
  }
  return best;
}

export function pieceDiagram(kind: PieceKind): PieceDiagram {
  const origin = originOf(kind);
  return { kind, origin, tiers: TIERS.map((tier) => marksAt(kind, origin, tier)) };
}

const parse = (k: string): Direction => k.split(',').map(Number) as unknown as Direction;
const FULL_DIGITS = '０１２３';
const SPACE = '　';

/** The three tiers side by side, rows labelled with `dr` on the right. */
export function renderDiagram(diagram: PieceDiagram): string {
  const offsets = diagram.tiers.flatMap((marks) => [...marks.keys()].map(parse));
  const width = Math.max(1, ...offsets.map(([df]) => Math.abs(df)));
  const top = Math.max(1, ...offsets.map(([, dr]) => dr));
  const bottom = Math.min(-1, ...offsets.map(([, dr]) => dr));
  const cols = 2 * width + 1;
  const glyph = PIECE_GLYPHS[diagram.kind];
  const gap = SPACE.repeat(2);

  const header = TIERS.map((t) => `${FULL_DIGITS[t]}段`.padEnd(cols, SPACE)).join(gap);
  const lines = [header.trimEnd()];
  for (let dr = top; dr >= bottom; dr--) {
    const row = diagram.tiers.map((marks) => {
      let cells = '';
      for (let df = -width; df <= width; df++) {
        cells += df === 0 && dr === 0 ? glyph : (marks.get(key(df, dr)) ?? MARK.empty);
      }
      return cells;
    });
    const label = dr > 0 ? `+${dr}` : `${dr}`;
    lines.push(`${row.join(gap)}  ${label.padStart(2)}`);
  }
  return lines.join('\n');
}

const SECTION: Readonly<Record<PieceKind, string>> = {
  marshal: '§5.3.1',
  general: '§5.3.2',
  lieutenant: '§5.3.3',
  major: '§5.3.4',
  samurai: '§5.3.5',
  lancer: '§5.3.6',
  knight: '§5.3.7',
  shinobi: '§5.3.8',
  fortress: '§5.3.9',
  pawn: '§5.3.10',
  cannon: '§5.3.11',
  archer: '§5.3.12',
  musket: '§5.3.13',
  tactician: '§5.3.14',
};

/** Command that rewrites docs/GUNGI_PIECES.md from the engine. */
export const REGENERATE_COMMAND =
  'UPDATE_PIECE_DIAGRAMS=1 npx vitest run packages/gungi-engine/src/diagrams.spec.ts';

/** The full content of docs/GUNGI_PIECES.md. */
export function renderPiecesDoc(): string {
  const intro = [
    '# 軍儀 (Gungi) 駒の動き図 — エンジン生成',
    '',
    '<!-- GENERATED FILE: do not edit by hand. -->',
    '',
    '**このファイルはエンジンから自動生成している。手で編集しないこと。**',
    '`packages/gungi-engine/src/diagrams.ts` が各駒を空の盤に置き、エンジンの移動定義（`MOVE_RULES` / `ruleSquares`）から',
    'そのまま描く。図とエンジンが食い違うと `diagrams.spec.ts` が失敗する。ルール本文は [GUNGI_RULES.md](GUNGI_RULES.md) §5。',
    '',
    '再生成（リポジトリのルートで実行）:',
    '',
    '```sh',
    REGENERATE_COMMAND,
    '```',
    '',
    '## 読み方',
    '',
    '- 黒から見た図。上が前方、右が自分から見て右（`df` が増える方向）。白は盤上で 180° 回転して適用する（§2.2）。',
    '- 1 段目・2 段目・3 段目の図を左から並べる。段の範囲は累積で、各図はその段で動ける全範囲を示す（§5.2）。',
    '- 右端の数字は前方への段列数 `dr`（+ が前、− が後）。',
    '- 空の盤上での範囲。実際の対局では途中の駒による遮断（§5.1）と飛び越えの高さ制限（§5.4）がかかる。',
    '- 大・中の走は盤端まで続く。図は駒を盤の中央に置いたときに盤内に収まる範囲まで描く。',
    '- 弓の段別の範囲は公式の段別図と照合済み。それ以外の駒の 2・3 段目は §5.2 の拡張規則による（⚠ R-1、GUNGI_RULES.md §13）。',
    '',
    '| 記号 | 意味 |',
    '|---|---|',
    `| 駒の字 | 駒の位置 |`,
    `| \`${MARK.step}\` | 歩（1 マスずつ進む。途中に駒があればその先へは進めない） |`,
    `| \`${SLIDE_MARK['0,1']}\` \`${SLIDE_MARK['1,0']}\` \`${SLIDE_MARK['1,1']}\` \`${SLIDE_MARK['-1,1']}\` | 走（その向きに盤端まで。途中の駒で止まる） |`,
    `| \`${MARK.jump}\` | 跳の着地点 |`,
    `| \`${MARK.passed}\` | 跳で飛び越えるだけのマス（着地はできない。駒の段より高いスタックがあるとその先の着地点へは跳べない） |`,
    `| \`${MARK.empty}\` | 動けないマス |`,
    '',
    '跳では手前の着地点（`○`）も、それより先の着地点に対して飛び越えるマスになる（§5.4）。',
    '',
  ];
  const sections = PIECE_KINDS.flatMap((kind) => {
    const diagram = pieceDiagram(kind);
    const shift = CENTER_RANK - diagram.origin.rank;
    const note =
      shift === 0
        ? []
        : [
            `3 段目の範囲を盤に収めるため、駒を盤の中央より ${Math.abs(shift)} 段列${shift > 0 ? '手前' : '奥'}に置いて描いた。`,
            '',
          ];
    return [
      `## ${SECTION[kind]} ${PIECE_GLYPHS[kind]} (\`${kind}\`)`,
      '',
      ...note,
      '```',
      renderDiagram(diagram),
      '```',
      '',
    ];
  });
  return [...intro, ...sections].join('\n');
}
