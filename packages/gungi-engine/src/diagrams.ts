/**
 * Movement diagrams of every piece (docs/GUNGI_PIECES.md + docs/pieces/*.svg).
 *
 * The diagrams are drawn from the engine's own movement definition: each
 * piece is put on an empty board at tier 1..3 and every rule's squares are
 * taken from `ruleSquares`, so the documents cannot drift from the
 * implementation (`diagrams.spec.ts` compares the committed files with the
 * output of this module).
 *
 * One cumulative board per piece: a square is coloured by the lowest tier from
 * which the piece reaches it, slides are drawn as red cells with an arrow to
 * the board edge, jump landings carry a ring and squares a jump only passes
 * over carry a grey cross.
 */

import { BOARD_SIZE } from '@gungi/shared';
import { createEmptyBoard, isOnBoard, setStack } from './board';
import type { Direction, MoveRule } from './movement';
import { MOVE_RULES, jumpSquares, ruleSquares } from './movement';
import { PIECE_GLYPHS, ROSTER } from './pieces';
import type { Board, Piece, PieceKind, Square } from './types';
import { PIECE_KINDS } from './types';

export const TIERS = [1, 2, 3] as const;
export type Tier = (typeof TIERS)[number];

/** What the diagram shows on one square. */
export interface Cell {
  /** Lowest tier from which a step or jump lands here. */
  readonly tier?: Tier;
  /** Reached by a jump (drawn with a ring). */
  readonly jump?: true;
  /** Reached by a slide, at every tier. */
  readonly slide?: true;
  /** Only passed over by a jump, never landed on. */
  readonly passed?: true;
}

export interface PieceDiagram {
  readonly kind: PieceKind;
  /** Square of the (black) piece on the empty board the cells were taken from. */
  readonly origin: Square;
  /** Marked squares keyed by `squareKey`. */
  readonly cells: ReadonlyMap<string, Cell>;
  /** Slide directions (black's view), each drawn as an arrow to the board edge. */
  readonly slides: readonly Direction[];
}

export const squareKey = (sq: Square): string => `${sq.file},${sq.rank}`;

function boardWith(kind: PieceKind, origin: Square, tier: number): Board {
  const below: Piece[] = Array.from({ length: tier - 1 }, () => ({ kind: 'pawn', owner: 'black' }));
  return setStack(createEmptyBoard(), origin, [...below, { kind, owner: 'black' }]);
}

const onBoard = (sq: Square): boolean => isOnBoard(sq.file, sq.rank);

function cellsOf(kind: PieceKind, origin: Square): Map<string, Cell> {
  const piece: Piece = { kind, owner: 'black' };
  const cells = new Map<string, Cell>();
  const merge = (sq: Square, cell: Cell): void => {
    const k = squareKey(sq);
    cells.set(k, { ...cells.get(k), ...cell });
  };
  for (const tier of TIERS) {
    const board = boardWith(kind, origin, tier);
    for (const rule of MOVE_RULES[kind]) {
      for (const sq of ruleSquares(board, origin, piece, rule, tier)) {
        if (rule.kind === 'slide') merge(sq, { slide: true });
        else if (cells.get(squareKey(sq))?.tier === undefined) {
          merge(sq, rule.kind === 'jump' ? { tier, jump: true } : { tier });
        }
      }
    }
  }
  for (const rule of MOVE_RULES[kind]) {
    if (rule.kind !== 'jump') continue;
    for (const { over } of jumpSquares(rule, TIERS.length)) {
      for (const [df, dr] of over) {
        const sq = { file: origin.file + df, rank: origin.rank + dr };
        if (onBoard(sq) && !cells.has(squareKey(sq))) cells.set(squareKey(sq), { passed: true });
      }
    }
  }
  return cells;
}

/** Squares reached by the tier-3 piece, ignoring slides (which always reach an edge). */
function boundedReach(kind: PieceKind, origin: Square): number {
  const board = boardWith(kind, origin, 3);
  const piece: Piece = { kind, owner: 'black' };
  return MOVE_RULES[kind]
    .filter((rule) => rule.kind !== 'slide')
    .reduce((n, rule) => n + ruleSquares(board, origin, piece, rule, 3).length, 0);
}

/** Centre of the board; pieces are drawn here unless their range does not fit. */
export const CENTER: Square = { file: 4, rank: 4 };

/** The origin on the centre file from which the tier-3 range fits the board best. */
function originOf(kind: PieceKind): Square {
  let best: Square = CENTER;
  let bestReach = boundedReach(kind, best);
  for (const rank of [3, 5, 2, 6, 1, 7, 0, 8]) {
    const origin = { file: CENTER.file, rank };
    const n = boundedReach(kind, origin);
    if (n > bestReach) [best, bestReach] = [origin, n];
  }
  return best;
}

export function pieceDiagram(kind: PieceKind): PieceDiagram {
  const origin = originOf(kind);
  const slides = MOVE_RULES[kind].flatMap((rule) => (rule.kind === 'slide' ? [rule.dir] : []));
  return { kind, origin, cells: cellsOf(kind, origin), slides };
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

/** Palette of the official figures. */
export const COLORS = {
  board: '#f2d8a7',
  grid: '#5c4630',
  tier: { 1: '#a6d8e8', 2: '#2b6cb0', 3: '#6cb33f' } as Readonly<Record<Tier, string>>,
  slide: '#f4b6b0',
  arrow: '#d62828',
  passed: '#6b6b6b',
  ring: '#1a202c',
  piece: '#1f1f1f',
  glyph: '#ffffff',
  text: '#1a202c',
} as const;

const CELL = 40;
const PAD = 12;
const PIECE_R = 16;
const FONT = "'Hiragino Mincho ProN','Yu Mincho','Noto Serif CJK JP','Noto Serif JP',serif";
const LABEL_FONT =
  "'Hiragino Sans','Yu Gothic','Noto Sans CJK JP','Noto Sans JP',system-ui,sans-serif";

/** Number formatting that is stable across platforms (at most one decimal). */
const n = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
};

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Point = readonly [x: number, y: number];

/** Top-left corner of a square; black's view, forward (rank +) is up. */
const cornerOf = (sq: Square): Point => [
  PAD + sq.file * CELL,
  PAD + (BOARD_SIZE - 1 - sq.rank) * CELL,
];
const centerOf = (sq: Square): Point => {
  const [x, y] = cornerOf(sq);
  return [x + CELL / 2, y + CELL / 2];
};

const rect = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"/>`;

const cross = ([cx, cy]: Point): string => {
  const d = 7;
  return (
    `<path d="M${n(cx - d)} ${n(cy - d)}L${n(cx + d)} ${n(cy + d)}M${n(cx + d)} ${n(cy - d)}L${n(cx - d)} ${n(cy + d)}" ` +
    `stroke="${COLORS.passed}" stroke-width="2.5" stroke-linecap="round"/>`
  );
};

const ring = ([cx, cy]: Point): string =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="6" fill="#ffffff" stroke="${COLORS.ring}" stroke-width="1.5"/>`;

const pieceDisc = ([cx, cy]: Point, glyph: string): string =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${PIECE_R}" fill="${COLORS.piece}"/>` +
  `<text x="${n(cx)}" y="${n(cy)}" fill="${COLORS.glyph}" font-family="${FONT}" font-size="20" ` +
  `font-weight="bold" text-anchor="middle" dominant-baseline="central">${escapeXml(glyph)}</text>`;

/** A red arrow from `from` to `to` (tip at `to`). */
function arrow(from: Point, to: Point): string {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const ux = (to[0] - from[0]) / len;
  const uy = (to[1] - from[1]) / len;
  const head = 11;
  const half = 6;
  const bx = to[0] - ux * head;
  const by = to[1] - uy * head;
  return (
    `<path d="M${n(from[0])} ${n(from[1])}L${n(bx)} ${n(by)}" stroke="${COLORS.arrow}" stroke-width="3"/>` +
    `<path d="M${n(to[0])} ${n(to[1])}L${n(bx - uy * half)} ${n(by + ux * half)}L${n(bx + uy * half)} ${n(by - ux * half)}Z" fill="${COLORS.arrow}"/>`
  );
}

/** Arrow of a slide from the piece to the last square on the board. */
function slideArrow(origin: Square, [df, dr]: Direction): string {
  let k = 0;
  while (onBoard({ file: origin.file + df * (k + 1), rank: origin.rank + dr * (k + 1) })) k++;
  const [cx, cy] = centerOf(origin);
  const len = Math.hypot(df, dr);
  const start: Point = [cx + (df / len) * (PIECE_R + 3), cy - (dr / len) * (PIECE_R + 3)];
  const [ex, ey] = centerOf({ file: origin.file + df * k, rank: origin.rank + dr * k });
  const reach = CELL / 2 - 5;
  return arrow(start, [ex + df * reach, ey - dr * reach]);
}

function svgDocument(width: number, height: number, title: string, body: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
    `<title>${escapeXml(title)}</title>`,
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

const boardSquares = (): Square[] =>
  Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => ({
    file: i % BOARD_SIZE,
    rank: BOARD_SIZE - 1 - Math.floor(i / BOARD_SIZE),
  }));

function cellFill(cell: Cell): string | undefined {
  if (cell.tier !== undefined) return COLORS.tier[cell.tier];
  if (cell.slide) return COLORS.slide;
  return undefined;
}

/** The SVG image of one piece (docs/pieces/<kind>.svg). */
export function renderPieceSvg(diagram: PieceDiagram): string {
  const size = 2 * PAD + BOARD_SIZE * CELL;
  const fills: string[] = [];
  const marks: string[] = [];
  for (const sq of boardSquares()) {
    const cell = diagram.cells.get(squareKey(sq));
    if (!cell) continue;
    const fill = cellFill(cell);
    const [x, y] = cornerOf(sq);
    if (fill) fills.push(rect(x, y, CELL, CELL, fill));
    if (cell.jump) marks.push(ring(centerOf(sq)));
    if (cell.passed) marks.push(cross(centerOf(sq)));
  }
  const lines: string[] = [];
  for (let i = 1; i < BOARD_SIZE; i++) {
    const p = PAD + i * CELL;
    lines.push(
      `M${p} ${PAD}V${PAD + BOARD_SIZE * CELL}`,
      `M${PAD} ${p}H${PAD + BOARD_SIZE * CELL}`,
    );
  }
  const glyph = PIECE_GLYPHS[diagram.kind];
  return svgDocument(size, size, `${glyph} (${diagram.kind})`, [
    rect(PAD, PAD, BOARD_SIZE * CELL, BOARD_SIZE * CELL, COLORS.board),
    ...fills,
    `<path d="${lines.join('')}" stroke="${COLORS.grid}" stroke-width="1" fill="none"/>`,
    `<rect x="${PAD}" y="${PAD}" width="${BOARD_SIZE * CELL}" height="${BOARD_SIZE * CELL}" fill="none" stroke="${COLORS.grid}" stroke-width="2"/>`,
    ...marks,
    ...diagram.slides.map((dir) => slideArrow(diagram.origin, dir)),
    pieceDisc(centerOf(diagram.origin), glyph),
  ]);
}

/** Legend entries, top to bottom: the swatch and its label. */
export const LEGEND: readonly { readonly swatch: Cell | 'piece'; readonly label: string }[] = [
  { swatch: 'piece', label: '駒の位置（黒から見た図。上が前方）' },
  { swatch: { tier: 1 }, label: '1 段目から動ける（2・3 段目でも動ける）' },
  { swatch: { tier: 2 }, label: '2 段目から動ける（3 段目でも動ける）' },
  { swatch: { tier: 3 }, label: '3 段目でだけ動ける' },
  { swatch: { slide: true }, label: '走: 段に関係なく盤端まで（途中の駒で止まる）' },
  { swatch: { tier: 1, jump: true }, label: '○ 付き: 跳の着地点（色は段）' },
  { swatch: { passed: true }, label: '×: 跳で飛び越えるだけのマス' },
];

/** The shared legend image (docs/pieces/legend.svg). */
export function renderLegendSvg(): string {
  const row = CELL + 8;
  const width = 440;
  const height = 2 * PAD + LEGEND.length * row - 8;
  const body: string[] = [];
  LEGEND.forEach(({ swatch, label }, i) => {
    const x = PAD;
    const y = PAD + i * row;
    const c: Point = [x + CELL / 2, y + CELL / 2];
    const fill = swatch === 'piece' ? COLORS.board : (cellFill(swatch) ?? COLORS.board);
    body.push(
      rect(x, y, CELL, CELL, fill),
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="none" stroke="${COLORS.grid}" stroke-width="1"/>`,
    );
    if (swatch === 'piece') body.push(pieceDisc(c, '駒'));
    else {
      if (swatch.slide) body.push(arrow([x + 6, c[1]], [x + CELL - 4, c[1]]));
      if (swatch.jump) body.push(ring(c));
      if (swatch.passed) body.push(cross(c));
    }
    body.push(
      `<text x="${x + CELL + 12}" y="${n(c[1])}" fill="${COLORS.text}" font-family="${LABEL_FONT}" font-size="14" dominant-baseline="central">${escapeXml(label)}</text>`,
    );
  });
  return svgDocument(width, height, '凡例', body);
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

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

const DIRECTION_NAME: Readonly<Record<string, string>> = {
  '0,1': '前',
  '0,-1': '後',
  '-1,0': '左',
  '1,0': '右',
  '-1,1': '左前',
  '1,1': '右前',
  '-1,-1': '左後',
  '1,-1': '右後',
};

const signed = (v: number): string => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
const offset = ([df, dr]: Direction): string => `(${signed(df)},${signed(dr)})`;

const ruleGroup = (rule: MoveRule): string =>
  rule.kind === 'step' ? `歩${rule.range}` : rule.kind === 'slide' ? '走' : '跳';
const ruleTarget = (rule: MoveRule): string =>
  rule.kind === 'jump' ? offset(rule.land) : (DIRECTION_NAME[rule.dir.join(',')] ?? '?');

/** One-line tier-1 summary generated from `MOVE_RULES` (e.g. `走 前・後・左・右 / 歩1 左前・…`). */
export function moveSummary(kind: PieceKind): string {
  const groups: { name: string; targets: string[] }[] = [];
  for (const rule of MOVE_RULES[kind]) {
    const name = ruleGroup(rule);
    const last = groups.at(-1);
    if (last?.name === name) last.targets.push(ruleTarget(rule));
    else groups.push({ name, targets: [ruleTarget(rule)] });
  }
  return groups.map(({ name, targets }) => `${name} ${targets.join('・')}`).join(' / ');
}

/** Path of each image, relative to docs/. */
export const piecesImagePath = (kind: PieceKind): string => `pieces/${kind}.svg`;
export const LEGEND_IMAGE_PATH = 'pieces/legend.svg';

/** Command that rewrites docs/GUNGI_PIECES.md and docs/pieces/*.svg from the engine. */
export const REGENERATE_COMMAND =
  'UPDATE_PIECE_DIAGRAMS=1 npx vitest run packages/gungi-engine/src/diagrams.spec.ts';

/** The full content of docs/GUNGI_PIECES.md. */
export function renderPiecesDoc(): string {
  const intro = [
    '# 軍儀 (Gungi) 駒の動き図 — エンジン生成',
    '',
    '<!-- GENERATED FILE: do not edit by hand. -->',
    '',
    '**このファイルと `pieces/*.svg` はエンジンから自動生成している。手で編集しないこと。**',
    '`packages/gungi-engine/src/diagrams.ts` が各駒を空の盤に 1〜3 段目で置き、エンジンの移動定義（`MOVE_RULES` / `ruleSquares`）から',
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
    `![凡例](${LEGEND_IMAGE_PATH})`,
    '',
    '- 9×9 の盤全体に、黒の駒を 1 つだけ置いた図。上が前方、右が自分から見て右。白は盤上で 180° 回転して適用する（§2.2）。',
    '- 1 枚の図に 1〜3 段目をまとめて描く。マスの色は、そのマスへ動けるようになる最も低い段（段の範囲は累積。§5.2）。',
    '  - 水色 = 1 段目から、青 = 2 段目から、緑 = 3 段目でだけ。',
    '  - 赤いマスと赤い矢印 = 走（大・中）。段に関係なく盤端まで。',
    '  - 白い ○ 付きのマス = 跳の着地点。灰色の × = 跳で飛び越えるだけのマス（着地はできない）。',
    '- 空の盤上での範囲。実際の対局では途中の駒による遮断（§5.1）と飛び越えの高さ制限（§5.4）がかかる。',
    '  跳では手前の着地点も、それより先の着地点に対して飛び越えるマスになる。',
    '- 弓の段別の範囲は公式の段別図と照合済み。それ以外の駒の 2・3 段目は §5.2 の拡張規則による（⚠ R-1、GUNGI_RULES.md §13）。',
    '- 各駒の「動き」の行は 1 段目の動き（エンジンの移動表から生成）。2 段目で歩の範囲 +1・跳の着地点がレイの先へ 1 マス、3 段目でさらに +1。',
    '',
  ];
  const sections = PIECE_KINDS.flatMap((kind) => {
    const diagram = pieceDiagram(kind);
    const shift = CENTER.rank - diagram.origin.rank;
    const note =
      shift === 0
        ? []
        : [
            `3 段目の範囲を盤に収めるため、駒を盤の中央より ${Math.abs(shift)} 段列${shift > 0 ? '手前' : '奥'}に置いて描いた。`,
            '',
          ];
    const glyph = PIECE_GLYPHS[kind];
    return [
      `## ${SECTION[kind]} ${glyph} (\`${kind}\`)`,
      '',
      `${ROSTER[kind]} 枚。動き: ${moveSummary(kind)}`,
      '',
      ...note,
      `![${glyph} (${kind}) の動き](${piecesImagePath(kind)})`,
      '',
    ];
  });
  return [...intro, ...sections].join('\n');
}

/** Every generated file, keyed by its path relative to docs/. */
export function renderPiecesFiles(): ReadonlyMap<string, string> {
  const files = new Map<string, string>([['GUNGI_PIECES.md', renderPiecesDoc()]]);
  files.set(LEGEND_IMAGE_PATH, renderLegendSvg());
  for (const kind of PIECE_KINDS)
    files.set(piecesImagePath(kind), renderPieceSvg(pieceDiagram(kind)));
  return files;
}
