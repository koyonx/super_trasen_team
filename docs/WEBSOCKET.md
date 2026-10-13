# WebSocket 対局基盤 — 実装ドキュメント

リアルタイム対局（Socket.IO）の **実装準拠** の説明書。対象読者は、この上に盤面 UI や今後の機能を載せる FE 担当と、
認証・DB を接続する BE 担当。記述はすべて以下のコードに対応している。挙動を変えたらこの文書も更新すること。

| ファイル | 役割 |
|---|---|
| `packages/shared/src/ws.ts` | プロトコル契約（イベント名・Zod スキーマ・ペイロード型・エラーコード）。**単一の正** |
| `server/src/match/match.gateway.ts` | Socket.IO の入口。ハンドシェイク検証・ペイロード検証・ack・配信 |
| `server/src/match/match.service.ts` | 対局のライフサイクル（席・状態遷移・エンジン呼び出し） |
| `server/src/match/match.repository.ts` | 保存の境界（現状はインメモリ。保存数の上限もここ） |
| `server/src/match/match.types.ts` | 保存形 `MatchRecord` / `SeatRecord`、`MatchError` |
| `server/src/match/ws-auth.adapter.ts` | 認証の境界（現状はゲスト） |
| `server/src/match/ws-origin.ts` | Origin 検証 |
| `server/src/match/keyed-mutex.ts` | キーごとの直列化ロック（対局ごと・接続ごと） |
| `server/src/match/match.module.ts` | DI 配線（差し替え口） |

---

## 1. 全体像

### 1.1 サーバー権威の流れ

盤面状態・合法手・勝敗はすべてサーバーが決める。クライアントは手を **要求** し、結果のスナップショットを受け取って表示するだけ。

```
client ──emit('match:move', {matchId, move, ply?}, ack)──►  MatchGateway
                                                              │ 1. Zod で検証（clientEventSchemas）
                                                              │    失敗 → INVALID_PAYLOAD
                                                              ▼
                                                           MatchService.applyMove
                                                              │ 2. 対局ごとのロック内で
                                                              │    席・player の色・状態・ply を検査
                                                              │ 3. @gungi/engine の applyMove
                                                              │    違反 → エンジンのコードをそのまま返す
                                                              ▼
                                                           MatchRepository.update
                                                              │
client ◄── ack {ok:true, data: snapshot} ─────────────────────┤
room   ◄── 'match:state' snapshot（対局ルームの全接続）──────────┘
```

- 失敗時は ack が `{ ok: false, code }` になり、加えて要求元の接続にだけ `match:error` が送られる（ack を使わないクライアントでもコードを受け取れる）。
- サーバーはユーザー向け文言を一切送らない。すべて **コード** で、クライアントが i18n で翻訳する。

### 1.2 経路

```
Browser ──HTTPS/WSS :8443──► nginx ── location /socket.io/ ──► server:4000
                                                                  └─ Socket.IO path "/socket.io"
                                                                       └─ namespace "/match"  (MatchGateway)
```

| 項目 | 値 | 定義 |
|---|---|---|
| namespace | `/match` | `WS_NAMESPACE` |
| HTTP path | `/socket.io` | `WS_PATH` |
| プロトコル版 | `1` | `WS_PROTOCOL_VERSION` |
| 対局ルーム名 | `match:<matchId>` | `matchRoom(matchId)` |
| 最大メッセージサイズ | 64 KiB | gateway の `maxHttpBufferSize` |
| クライアント配信 | しない | gateway の `serveClient: false` |

同一オリジン（nginx 経由）で提供するため CORS ヘッダーは出さず、代わりにハンドシェイクの `Origin` を検証する（§2.2）。

---

## 2. 接続（ハンドシェイク）

### 2.1 auth ペイロード

Socket.IO の `auth` オプションで送る（`handshakeAuthSchema`）。

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `protocolVersion` | `1`（リテラル） | 必須 | 欠落・不一致は `UNSUPPORTED_PROTOCOL` |
| `displayName` | `string`（最大 200 文字） | 任意 | ゲストの表示名の希望。サーバーで正規化される（§2.4）。201 文字以上や文字列以外は `INVALID_PAYLOAD` |

未知のキーは取り除かれる（`z.object` の既定動作）。

### 2.2 検証の順序

`MatchGateway.afterInit` が名前空間ミドルウェアを登録し、接続ごとに 1 回だけ次の順で検査する。最初に失敗したもので拒否する。

| 順 | 検査 | 失敗時のコード |
|---|---|---|
| 1 | `Origin` ヘッダー（`isOriginAllowed`） | `FORBIDDEN_ORIGIN` |
| 2 | `auth.protocolVersion === 1` | `UNSUPPORTED_PROTOCOL` |
| 3 | `handshakeAuthSchema` で auth 全体を検証 | `INVALID_PAYLOAD` |
| 4 | `WsAuthAdapter.authenticate` が identity を返すか（`null` なら拒否） | `UNAUTHENTICATED` |
| — | 上記以外の予期しない例外（サーバーログに出力） | `INTERNAL_ERROR` |

成功すると identity が `socket.data.identity` に保存され、以後のイベントはこの identity で処理される。

**Origin の扱い**（`ws-origin.ts`）

- 許可リストは環境変数 `APP_ORIGIN`（カンマ区切りで複数可）。各要素は `new URL(...).origin` で正規化して比較する。
  未設定・空・全要素が不正なら既定値 `https://localhost:8443` のみ。
- `Origin` が **ある** 場合: 正規化した値が許可リストにあれば通す。`null` オリジンや URL として解釈できない値は拒否。
- `Origin` が **ない** 場合: **通す**。理由: ブラウザは WebSocket のアップグレードとクロスオリジン要求では必ず `Origin` を送るので、
  欠落するのは同一オリジンのポーリング要求か、ブラウザ以外のクライアントだけ。後者はヘッダーをいくらでも偽造できるので、
  Origin 検証はクロスサイト WebSocket ハイジャック対策であって認証ではない（本当の関門は §2.4 / §8.1 の認証）。

### 2.3 拒否時にクライアントが受け取るもの

拒否は Socket.IO の `connect_error` で届く。エラーオブジェクトの `message` と `data.code` の両方にコードが入る。

```ts
socket.on('connect_error', (error) => {
  const code = (error as Error & { data?: { code?: string } }).data?.code; // 例: 'FORBIDDEN_ORIGIN'
});
```

### 2.4 GuestAuthAdapter（現在の認証）

`match.module.ts` で `WS_AUTH_ADAPTER` に `GuestAuthAdapter` が登録されている。全員をゲストとして受け入れる。

| 項目 | 挙動 |
|---|---|
| `kind` | `'guest'` |
| `playerId` | **接続ごとに新規** の `guest_<UUID>`。再接続すると別人になる（席は rejoinToken で取り戻す。§5.5） |
| `displayName` | `sanitizeDisplayName(auth.displayName)` の結果 |

`sanitizeDisplayName` の正規化規則（順に適用）:

1. `undefined` なら `null`
2. Unicode NFKC 正規化（全角英数字は半角になる）
3. `\p{C}`（制御文字・書式文字・私用領域など）を **削除**。タブや改行も空白にはならず削除される
4. 連続する空白を 1 つの半角スペースにまとめ、前後を trim
5. 先頭から **24 コードポイント**（`DISPLAY_NAME_MAX_LENGTH`）に切り詰めて再度 trim
6. 何も残らなければ `null`

結果は **データ** として扱う。クライアントは必ずテキストとして描画し、HTML として挿入しないこと。
`null` のときはクライアントが翻訳済みの既定ラベル（例:「ゲスト」）を表示する。

---

## 3. イベント契約リファレンス

### 3.1 共通規約

- C→S の全イベントは最後の引数に ack コールバックを取れる。ack には常に `WsAck<T>` が渡る:
  `{ ok: true, data: T }` または `{ ok: false, code: WsErrorCode }`。
- 失敗時は ack に加えて、**要求元の接続だけ** に `match:error` が送られる。
- ペイロードは `clientEventSchemas[event]` で検証され、失敗は `INVALID_PAYLOAD`。FE でも同じスキーマで事前検証できる。
- 1 つの接続が同時に参加できる **未終了** の対局は 1 つだけ（§5.6）。

### 3.2 C→S イベント（5 種）

| イベント | ペイロード | ack の `data` | 成功時に送られるもの |
|---|---|---|---|
| `match:create` | `{ side?, firstPlayer? }`（省略可。下表） | `SeatedPayload` | 本人に `match:created`（ack と同内容） |
| `match:join` | `{ matchId }` | `SeatedPayload` | ルーム全員（参加者本人を含む）に `match:state` |
| `match:rejoin` | `{ matchId, rejoinToken }` | `SeatedPayload` | 本人に `match:state`、本人以外のルームに `match:playerConnection`（`connected: true`）、席を奪われた旧接続に `match:error`（`SEAT_TAKEN_OVER`） |
| `match:move` | `{ matchId, move, ply? }` | `MatchSnapshot` | ルーム全員（送信者を含む）に `match:state` |
| `match:leave` | `{ matchId }` | `{ matchId }` | 対局が残っていれば、ルームの残りの接続に `match:playerConnection`（`connected: false`）。対局が削除された場合は何も送らない |

**フィールド詳細**

| イベント | フィールド | 型・制約 | 既定値 / 備考 |
|---|---|---|---|
| create | `side` | `'black' \| 'white' \| 'random'` | `'random'`。作成者の席。**友人対局専用**（下の注意） |
| create | `firstPlayer` | `'black' \| 'white' \| 'random'` | `'random'`。先手（§9.1）。**友人対局専用**（下の注意） |
| join / rejoin / move / leave | `matchId` | UUID 文字列 | — |
| rejoin | `rejoinToken` | `^[A-Za-z0-9_-]{43}$`（32 バイトの base64url、パディングなし） | 形式違反は `INVALID_PAYLOAD`、形式は正しいが一致しなければ `INVALID_REJOIN_TOKEN` |
| move | `move` | `clientMoveSchema`（下表） | — |
| move | `ply` | 0 以上の整数 | 任意。送るなら表示中の `state.ply`（§6.2） |

`match:create` はペイロードなし（`undefined`）でも `{}` でもよい。どちらも両方 `random` になる。

> **公平性の注意**: `side` / `firstPlayer` は **クライアントが決める入力** であり、受け入れてよいのは両者が合意のうえで遊ぶ
> 直接対局（友人対局）だけ。マッチメイキングやレート戦では、席と先手を **サーバー側** で決め（帥落としの儀式をサーバーの乱数で行う）、
> クライアントが送った値は無視しなければならない（§8.4）。

**`move`（`clientMoveSchema`）**: `type` で判別する union。未知のキーは取り除かれる。

| `type` | フィールド |
|---|---|
| `place` | `kind`（駒種）, `to`（マス） |
| `finishPlacement` | — |
| `move` / `capture` / `stack` | `from`, `to`, `betray?: boolean` |
| `drop` | `kind`, `to` |
| `resign` | — |

- すべての手に任意の `player`（`'black' | 'white'`）を付けられる。省略時はサーバーが席の色で補う。付けた場合は自分の席の色と一致しなければ `NOT_YOUR_SIDE`。
- `kind` は 14 駒種（`WS_PIECE_KINDS`。エンジンの `PIECE_KINDS` と一致することを `contract.spec.ts` が検査）。
- マス `{ file, rank }` は **整数であることだけ** を検査する。盤外の座標はエンジンが `INVALID_SQUARE` を返す。
- `resign` は手番に関係なく（配置フェーズ中も）送れる。
- サーバー専用の終局手 `timeout` / `agreeDraw` はクライアントからは送れない（スキーマにない）。

### 3.3 S→C イベント（4 種）

| イベント | ペイロード | いつ・誰に |
|---|---|---|
| `match:created` | `SeatedPayload` | `match:create` 成功時、作成者本人に |
| `match:state` | `MatchSnapshot` | `match:join` / `match:move` 成功時はルーム全員に。`match:rejoin` 成功時は rejoin した本人にだけ |
| `match:error` | `MatchErrorPayload` | 要求が失敗したとき要求元に。`SEAT_TAKEN_OVER` は席を奪われた旧接続に（要求への応答ではない） |
| `match:playerConnection` | `PlayerConnectionPayload` | 席の接続状態が変わったとき、ルーム内の **他の** 接続に（下表） |

`match:playerConnection` の送信契機:

| 契機 | `connected` | 受信者 |
|---|---|---|
| 席を持つ接続が切断（対局が残っている場合） | `false` | ルームの残りの接続 |
| `match:leave`（対局が残っている場合） | `false` | ルームの残りの接続 |
| `match:rejoin` | `true` | rejoin した接続以外のルーム |

> 注意: rejoin / leave / 切断でもサーバー側の `revision` は 1 増えるが、相手に送られるのは `match:playerConnection` だけで
> `match:state` は送られない。FE は `match:playerConnection` を受けたら手元のスナップショットの `seats[side]` を更新すること。
> 次に届く `match:state` の `revision` は手元より 2 以上進んでいることがある（連番を仮定しない）。

### 3.4 ペイロード型

```ts
interface MatchSnapshot<TState, TMove> {   // = MatchStatePayload
  matchId: string;
  status: 'waiting' | 'active' | 'finished';
  revision: number;                        // 変更ごとに +1。これより古いスナップショットは捨てる
  firstPlayer: 'black' | 'white';
  seats: { black: SeatView | null; white: SeatView | null };
  state: TState | null;                    // エンジンの GameState。waiting 中は null
  lastMove: TMove | null;                  // 最後に適用した手（player 補完済み）
}

interface SeatView { playerId: string; displayName: string | null; connected: boolean }

interface SeatedPayload<TState, TMove> {   // create / join / rejoin の ack、match:created
  match: MatchSnapshot<TState, TMove>;
  you: SeatCredentials;
}

interface SeatCredentials { playerId: string; side: 'black' | 'white'; rejoinToken: string }

interface MatchErrorPayload {
  code: WsErrorCode;
  event?: ClientEventName;   // 失敗した要求のイベント名（SEAT_TAKEN_OVER では付かない）
  matchId?: string;          // ペイロードの検証に成功し matchId を含んでいた場合のみ
}

interface PlayerConnectionPayload { matchId: string; side: 'black' | 'white'; playerId: string; connected: boolean }
```

`TState` / `TMove` は `@gungi/engine` の `GameState` / `Move`（`@gungi/shared` はエンジンに依存できないためジェネリクスになっている）。

**rejoinToken の秘匿**: `rejoinToken` は `SeatCredentials`（席の持ち主本人への ack と `match:created`）にしか含まれない。
`MatchSnapshot` / `SeatView` には **絶対に含まれない**（`toSeatView` が `playerId` / `displayName` / `connected` だけを写す）。
e2e テストで `match:state` の JSON にトークン文字列が現れないことを検査している。FE はトークンを他者に見せたりログに出したりしないこと。

---

## 4. エラーコード

`WsErrorCode = MatchErrorCode | EngineMoveErrorCode`。どちらも文字列コードで、FE は翻訳キーに対応付ける。

### 4.1 プロトコル系（`MatchErrorCode`、16 種）

| コード | 発生条件 |
|---|---|
| `INVALID_PAYLOAD` | イベントのペイロードがスキーマ違反。ハンドシェイクの auth がスキーマ違反（例: `displayName` が 201 文字以上） |
| `UNSUPPORTED_PROTOCOL` | ハンドシェイクの `protocolVersion` が欠落、または 1 以外 |
| `FORBIDDEN_ORIGIN` | ハンドシェイクの `Origin` ヘッダーが存在し、許可オリジンでない |
| `UNAUTHENTICATED` | 認証アダプタが `null` を返した（`GuestAuthAdapter` は返さない） |
| `MATCH_NOT_FOUND` | join / rejoin / move / leave の対象対局が存在しない（削除済み、上限による追い出し済み（§9.2）を含む） |
| `MATCH_FULL` | join したが対局が `active`（両席とも埋まっている）。観戦はない |
| `MATCH_NOT_ACTIVE` | move したが対局が `active` でない（`waiting` または `finished`）。join したが対局が `finished` |
| `ALREADY_SEATED` | join した接続がすでにその対局の席に結び付いている、または同じ `playerId` がすでに席を持っている。rejoin した接続がすでに **もう一方の** 席に結び付いている、または認証済みユーザーがもう一方の席を持っている（§5.5） |
| `ALREADY_IN_MATCH` | create / join / rejoin した接続が、**別の未終了の** 対局に参加中 |
| `NOT_SEATED` | move / leave した接続がその対局の席に結び付いていない（leave 後や `SEAT_TAKEN_OVER` 後を含む） |
| `INVALID_REJOIN_TOKEN` | rejoinToken がどちらの席とも一致しない。または一致した席が認証済みユーザーの席で、要求元が同じユーザーでない（§5.5） |
| `NOT_YOUR_SIDE` | move の `player` が自分の席の色と違う |
| `STALE_PLY` | move の `ply` が現在の `state.ply` と違う（§6.2） |
| `SEAT_TAKEN_OVER` | 自分の席が別の接続から rejoin された。旧接続に `match:error` で通知（ack ではない） |
| `MATCH_LIMIT` | create したが、サーバーが保存できる対局数の上限（全体または `waiting`）に達しており、追い出せる対局（どの席にも接続がない対局）でも空きを作れない（§9.2）。時間をおいて再試行する |
| `INTERNAL_ERROR` | 予期しない例外。詳細はサーバーログにだけ出る |

`match:move` の検査順: スキーマ → `MATCH_NOT_FOUND` → `NOT_SEATED` → `NOT_YOUR_SIDE` → `MATCH_NOT_ACTIVE` → `STALE_PLY` → エンジン。

`match:join` の検査順: スキーマ → `ALREADY_IN_MATCH`（§5.6）→ `MATCH_NOT_FOUND` → `ALREADY_SEATED` → `MATCH_NOT_ACTIVE`（`finished`）→ `MATCH_FULL`（`active`）。

`match:rejoin` の検査順: スキーマ → `ALREADY_IN_MATCH`（§5.6）→ `MATCH_NOT_FOUND` → `INVALID_REJOIN_TOKEN`（不一致、またはユーザーの席を別の identity が要求）→ `ALREADY_SEATED`（§5.5）。

### 4.2 ルール違反（エンジンの `MoveError`、22 種）

エンジンが返したコードを **そのまま** ack と `match:error` に載せる（`ENGINE_MOVE_ERROR_CODES`。エンジンの `MoveError` と一致することを
`contract.spec.ts` が検査）。意味の定義は [GUNGI_RULES.md](./GUNGI_RULES.md) §12.3。代表例:

| コード | 例 |
|---|---|
| `NOT_YOUR_TURN` | 相手の手番に指した |
| `WRONG_PHASE` | 配置フェーズに `drop` / `move` を送った、など |
| `MARSHAL_FIRST` | 帥を置く前に他の駒を置いた／済を宣言した |
| `OUTSIDE_TERRITORY` | 自陣の外に配置した |
| `INVALID_SQUARE` | 盤外の座標 |
| `UNREACHABLE` | その駒が届かないマスへの移動 |
| `SELF_CHECK` | 自分の帥が取られる状態になる手 |

全 22 種: `GAME_FINISHED`, `WRONG_PHASE`, `NOT_YOUR_TURN`, `INVALID_SQUARE`, `NOT_IN_HAND`, `MARSHAL_FIRST`, `OUTSIDE_TERRITORY`,
`OUTSIDE_DROP_ZONE`, `OCCUPIED_BY_ENEMY`, `STACK_FULL`, `CANNOT_STACK_ON_MARSHAL`, `NO_PIECE`, `NOT_YOUR_PIECE`, `UNREACHABLE`,
`TARGET_TOO_HIGH`, `TARGET_NOT_EMPTY`, `TARGET_EMPTY`, `CANNOT_CAPTURE_OWN`, `INVALID_BETRAYAL`, `BETRAYAL_HAND_SHORT`, `SELF_CHECK`, `INVALID_MOVE`。

終局後の move はエンジンに届く前に `MATCH_NOT_ACTIVE` になるため、WebSocket 経由で `GAME_FINISHED` が返ることは実際にはない。
翻訳キーは型の網羅性のため 22 種すべて用意しておくこと。

---

## 5. 対局ライフサイクル

### 5.1 状態遷移

```
            match:create
                 │  席 1 つ、state = null, revision = 1
                 ▼
            ┌─────────┐   作成者が match:leave   ┌──────────┐
            │ waiting │ ───────────────────────► │ （削除） │
            └────┬────┘                          └──────────┘
                 │ match:join（空席に着席）
                 │  state = createInitialState({ firstPlayer })  … phase は 'placement'
                 ▼
            ┌─────────┐
            │ active  │  match:move ごとに engine.applyMove
            └────┬────┘
                 │ 適用後の state.phase === 'finished'
                 │ （投了・詰み・ステイルメイト・千日手（4 回目）・帥取り）
                 ▼
            ┌──────────┐  席に結び付いた接続が 0 になった時点   ┌──────────┐
            │ finished │ ─────────────────────────────────────► │ （削除） │
            └──────────┘                                        └──────────┘
```

- `waiting` から直接 `finished` にはならない（`waiting` 中の move は `MATCH_NOT_ACTIVE`。投了もできない）。
- `revision` は create 時に 1、以後サーバー側で対局が変わるたび（join / rejoin / move / leave / 切断）に +1。

### 5.2 席とサイドの決定

- 作成者の席は `side`（`random` なら作成時にサーバーが乱数で決める）。
- 参加者は残った空席に座る。
- 先手 `firstPlayer` も作成時に決まり（`random` ならサーバーの乱数）、スナップショットの `firstPlayer` に入る。
  エンジン状態は参加時に `createInitialState({ firstPlayer })` で作られる。席の色と先手は独立している。

### 5.3 配置フェーズから直接 finished になるケース（即死筋）

エンジンは後手の済（またはその最後の配置）を適用した時点で終局を判定するため、`state.phase` が `placement` から **`play` を経ずに**
`finished` になることがある（[GUNGI_RULES.md](./GUNGI_RULES.md) §9.5 / §9.6。`reason` は `checkmate` または `stalemate`）。
配置中の `resign` も同様に `placement` → `finished`。サーバーはその `match:state` で `status: 'finished'` にする。
**FE は「対局開始（`play`）」の演出を必ず通ると仮定しないこと**。`status` と `state.phase` の遷移を見て分岐する。

### 5.4 leave（明示的な退出）

| 対局の状態 | 結果 |
|---|---|
| `waiting`（作成者が退出） | 対局を **削除**。通知なし。以後の join は `MATCH_NOT_FOUND` |
| `active` | 席は **保持**（`connected: false` になるだけ）。投了ではない。rejoinToken で戻れる |
| `finished` | 席の接続を外す。両席とも未接続になれば削除 |

退出した接続はルームから外れ、相手に `match:playerConnection`（`connected: false`）が届く（対局が残っている場合）。
対局を降りる（負けを認める）操作は `match:leave` ではなく `move: { type: 'resign' }`。

### 5.5 切断と rejoin

- **切断**: 席は保持され、その席の接続が外れる（`connected: false`）。ルームの残りに `match:playerConnection` が届く。
  `waiting` 対局でも削除しない（§10.2）。`finished` 対局で両席とも未接続になれば削除。
  どの席にも接続がない対局は、対局数の上限に達したときに追い出されうる（§9.2）。追い出された後の rejoin / join は `MATCH_NOT_FOUND`。
- **rejoin**: 新しい接続から `match:rejoin { matchId, rejoinToken }` を送る。トークンが席の所有の証明であり、
  ゲストの identity は接続ごとに変わるため、**ゲストが持つ席** の `playerId` は **新しい接続の identity に付け替えられる**（`displayName` は新しい値があればそれ、なければ元の値）。
  **認証済みユーザー（`kind: 'user'`）が持つ席** は、同じユーザー（同じ `playerId`）の接続にしか付け替えない。別のユーザーやゲストからは、
  トークンが正しくても `INVALID_REJOIN_TOKEN`（トークンが漏れても他のアカウントに席を渡さない）。席の identity の種別は `SeatRecord.kind` に保存される。
  rejoin は対局の状態（waiting / active / finished）を問わず、対局が存在する限り成功する（追い出し（§9.2）の後は `MATCH_NOT_FOUND`）。
- **1 接続・1 アカウントにつき 1 席**: すでに一方の席に結び付いている接続が、もう一方の席のトークンで rejoin すると `ALREADY_SEATED`
  （両方の席を持つと 1 人で両陣営を指せ、切断しても片方の席しか外れず `connected: true` の席が残ってしまうため）。
  認証済みユーザー（`kind: 'user'`）は、別の接続からでも、自分の `playerId` がもう一方の席にあれば（接続の有無を問わず）`ALREADY_SEATED`。
  自分がすでに持っている席への rejoin（同じ接続からの再送を含む）は従来どおり成功する。
- 成功すると本人に ack と `match:state`、相手に `match:playerConnection`（`connected: true`、新しい `playerId`）が届く。
- rejoinToken は対局中ずっと同じ値（rejoin しても再発行されない）。

### 5.6 席の乗っ取り（SEAT_TAKEN_OVER）

席にまだ接続が結び付いている状態で別の接続から rejoin すると:

1. 席は新しい接続に結び付く
2. 旧接続はルームから外され、`match:error { code: 'SEAT_TAKEN_OVER', matchId }` を受け取る
3. 以後、旧接続からの move / leave は `NOT_SEATED`

同じタブで画面を開き直した、別タブで開いた、などのケース。FE は `SEAT_TAKEN_OVER` を受けたらその画面での操作をやめ、案内を表示する。

**1 接続 1 対局**: create / join / rejoin の前に、接続が参加中の対局を確認する（`releaseCurrent`）。
参加中の対局が未終了なら `ALREADY_IN_MATCH`。終了済み（または消えている）なら自動的にそこから退出してから新しい対局に入る。
同じ対局への join / rejoin はこの確認を素通りし、`MatchService` の判定（`ALREADY_SEATED` など）に任せる。
この確認から着席（`socket.data.matchId` の設定）までは **接続ごとに直列化** されている（§6.1）。同じ接続から create / join を並行して
送っても、成功するのは 1 つだけで、残りは `ALREADY_IN_MATCH` になる。

### 5.7 finished 対局の削除条件

`MatchService.detach`（leave と切断で共通）の後で、次のどちらかなら削除する。

| 条件 | 契機 |
|---|---|
| `waiting` の対局を作成者が leave した | `match:leave` のみ（切断では消さない） |
| `finished` で、両席とも接続が結び付いていない | leave・切断・別の対局へ移る際の自動退出 |

つまり終局後も、どちらかの接続が残っている間は対局が残り、`match:rejoin` で最終状態を取り直せる。

---

## 6. 並行性と再送

### 6.1 対局ごとのロック

`MatchService` は `KeyedMutex` で **対局 ID ごと** に変更を 1 つずつ直列に実行する（join / rejoin / move / leave / 切断 / `finishByServer`）。
各処理はロックの中で「最新の対局を読む → 検査 → エンジン適用 → 保存」を行うため、同時に届いた 2 つの手が同じ状態に適用されることはない。

- 1 つの処理が失敗しても、後続の処理の列は壊れない。使われなくなったキーは自動で消える。
- ロックはプロセス内のみ。サーバーは 1 インスタンス前提（複数台にする場合は §8.2 の revision 楽観ロックが必要）。

### 6.1.1 接続ごとのロック

Socket.IO は同じ接続のイベントハンドラを直列に実行しない（`await` をまたいで並行に進む）。そのため `MatchGateway` は、
接続が持つ席を変える要求 **`match:create` / `match:join` / `match:rejoin` / `match:leave` と切断時の後始末** を、
もう 1 つの `KeyedMutex` で **接続 ID（`socket.id`）ごと** に 1 つずつ実行する。これにより「参加中の対局の確認（`releaseCurrent`）→
着席 → `socket.data.matchId` の設定」が同じ接続の別の要求と交錯せず、1 接続 1 未終了対局（§5.6）が保たれる。

- **ロックの順序**: 必ず接続のロックが外側、対局のロック（`MatchService` 内部）が内側。逆順に取る経路はないのでデッドロックしない。
- `match:move` は席の結び付きを変えないので接続ロックを取らない（対局ロックだけ）。
- **処理中の切断**: 切断時の後始末も同じ接続ロックに並ぶので、実行中の要求が終わってから走る。加えて、席を変える要求の終了時に
  接続がすでに切れていれば（`socket.connected === false`）、その場で後始末（ルームから外す + `MatchService.disconnect`）を行う。
  リポジトリが実際の I/O を伴うようになっても、切れた接続 ID に席が結び付いたまま残ることはない。

### 6.2 ply ガード（STALE_PLY）

`match:move` の `ply` は任意の冪等性ガード。「この手はどの局面を見て選んだか」を表す。

- 送った `ply` が現在の `state.ply` と違えば、適用せず `STALE_PLY`。
- エンジンの `ply` は配置・済・移動を含む **すべての手で +1** される（投了では増えない）。

**FE は送信時に、表示中のスナップショットの `state.ply` を必ず添えることを推奨する。** 効果:

- ack がタイムアウトして同じ手を再送しても、1 回目が適用済みなら 2 回目は `STALE_PLY` で弾かれ、二重適用されない。
- 古い盤面を見たまま指した手（相手の手の配信と行き違い）が、新しい局面に誤って適用されない。

`STALE_PLY` を受けたら、最新の `match:state` を待って（または rejoin で取り直して）盤面を更新し、ユーザーに選び直してもらう。

---

## 7. FE からの接続例

### 7.1 前提

- `client/package.json` に `socket.io-client` と `@gungi/engine` を追加する（現時点では未追加。エンジンは型と合法手ハイライト用）。
- Socket.IO は **ブラウザ側でのみ** 接続する（Client Component の `useEffect` 内など）。SSR 中に `io()` を呼ばない。
- URL は指定せず `io('/match', ...)` とすれば、ページと同じオリジン（nginx）に接続する。ブラウザが `Origin` を自動で付ける。

### 7.2 コード例

以下の `MatchClient` は、サーバーの e2e と同じ構成（Nest アプリ + socket.io-client）で動作を確認済み
（作成 → 参加 → 着手 → 違反手 → 切断からの自動再接続と rejoin → 着手）。`connectMatchSocket` はブラウザ前提の相対 URL を使う。

```ts
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { GameState, Move } from '@gungi/engine';
import {
  ClientEvent,
  MatchErrorCode,
  ServerEvent,
  WS_NAMESPACE,
  WS_PATH,
  WS_PROTOCOL_VERSION,
  createMatchSchema,
  moveRequestSchema,
} from '@gungi/shared';
import type {
  ClientEventAcks,
  ClientMove,
  CreateMatchInput,
  HandshakeAuth,
  JoinMatchRequest,
  LeaveMatchRequest,
  MatchSnapshot,
  MoveRequest,
  RejoinMatchRequest,
  SeatCredentials,
  ServerEventPayloads,
  WsAck,
  WsErrorCode,
} from '@gungi/shared';

type Snapshot = MatchSnapshot<GameState, Move>;
type Payloads = ServerEventPayloads<GameState, Move>;
type Acks = ClientEventAcks<GameState, Move>;
type Ack<E extends keyof Acks> = (response: WsAck<Acks[E]>) => void;

/** S→C イベント */
interface ServerToClientEvents {
  'match:created': (payload: Payloads['match:created']) => void;
  'match:state': (payload: Payloads['match:state']) => void;
  'match:error': (payload: Payloads['match:error']) => void;
  'match:playerConnection': (payload: Payloads['match:playerConnection']) => void;
}

/** C→S イベント（最後の引数が ack） */
interface ClientToServerEvents {
  'match:create': (payload: CreateMatchInput, ack: Ack<'match:create'>) => void;
  'match:join': (payload: JoinMatchRequest, ack: Ack<'match:join'>) => void;
  'match:rejoin': (payload: RejoinMatchRequest, ack: Ack<'match:rejoin'>) => void;
  'match:move': (payload: MoveRequest, ack: Ack<'match:move'>) => void;
  'match:leave': (payload: LeaveMatchRequest, ack: Ack<'match:leave'>) => void;
}

type MatchSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 5000;

/** 同一オリジン（nginx 経由）の `/match` 名前空間に接続する。ブラウザ側でのみ呼ぶ。 */
export function connectMatchSocket(displayName?: string): MatchSocket {
  const auth: HandshakeAuth = {
    protocolVersion: WS_PROTOCOL_VERSION,
    ...(displayName ? { displayName } : {}),
  };
  return io(WS_NAMESPACE, { path: WS_PATH, auth });
}

export class MatchClient {
  private latest: Snapshot | null = null;
  private seat: { matchId: string; you: SeatCredentials } | null = null;

  constructor(
    private readonly socket: MatchSocket,
    private readonly ui: {
      render(snapshot: Snapshot): void;
      showError(code: WsErrorCode): void;
    },
  ) {
    // ハンドシェイク拒否: message と data.code にエラーコードが入る
    socket.on('connect_error', (error) => {
      const code = (error as Error & { data?: { code?: WsErrorCode } }).data?.code;
      if (code) this.ui.showError(code);
    });
    // 再接続時は新しい接続 = 新しい guest。席は rejoinToken で取り戻す
    socket.on('connect', () => {
      if (this.seat) void this.rejoin(this.seat.matchId, this.seat.you.rejoinToken);
    });
    socket.on(ServerEvent.STATE, (snapshot) => this.accept(snapshot));
    socket.on(ServerEvent.PLAYER_CONNECTION, ({ matchId, side, playerId, connected }) => {
      const current = this.latest;
      if (!current || current.matchId !== matchId) return;
      const seat = current.seats[side];
      if (!seat) return;
      this.latest = {
        ...current,
        seats: { ...current.seats, [side]: { ...seat, playerId, connected } },
      };
      this.ui.render(this.latest);
    });
    socket.on(ServerEvent.ERROR, ({ code }) => {
      if (code === MatchErrorCode.SEAT_TAKEN_OVER) this.seat = null; // 別タブ等が席を取った
      this.ui.showError(code);
    });
  }

  async create(input: CreateMatchInput = {}): Promise<void> {
    if (!createMatchSchema.safeParse(input).success) return this.ui.showError('INVALID_PAYLOAD');
    const ack = await this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck(ClientEvent.CREATE, input);
    if (!ack.ok) return this.ui.showError(ack.code);
    this.seat = { matchId: ack.data.match.matchId, you: ack.data.you };
    this.accept(ack.data.match);
  }

  async join(matchId: string): Promise<void> {
    const ack = await this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck(ClientEvent.JOIN, { matchId });
    if (!ack.ok) return this.ui.showError(ack.code);
    this.seat = { matchId, you: ack.data.you };
    this.accept(ack.data.match);
  }

  async rejoin(matchId: string, rejoinToken: string): Promise<void> {
    const ack = await this.socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(ClientEvent.REJOIN, { matchId, rejoinToken });
    if (!ack.ok) {
      this.seat = null;
      return this.ui.showError(ack.code);
    }
    this.seat = { matchId, you: ack.data.you };
    this.accept(ack.data.match);
  }

  /** 表示中の state の ply を添えて送る（再送・二重送信は STALE_PLY で弾かれる）。 */
  async move(move: ClientMove): Promise<void> {
    const state = this.latest?.state;
    if (!this.seat || !state) return;
    const request = moveRequestSchema.safeParse({ matchId: this.seat.matchId, move, ply: state.ply });
    if (!request.success) return this.ui.showError('INVALID_PAYLOAD');
    const ack = await this.socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(ClientEvent.MOVE, request.data);
    if (!ack.ok) return this.ui.showError(ack.code);
    this.accept(ack.data);
  }

  async leave(): Promise<void> {
    if (!this.seat) return;
    const ack = await this.socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(ClientEvent.LEAVE, { matchId: this.seat.matchId });
    if (!ack.ok) return this.ui.showError(ack.code);
    this.seat = null;
    this.latest = null;
  }

  /** ack と match:state の両方で同じスナップショットが届くので revision で重複・逆順を捨てる。 */
  private accept(snapshot: Snapshot): void {
    const current = this.latest;
    if (current && current.matchId === snapshot.matchId && snapshot.revision <= current.revision) {
      return;
    }
    this.latest = snapshot;
    this.ui.render(snapshot);
  }
}
```

### 7.3 補足

- `emitWithAck` は `timeout()` を付けると、時間内に ack が来なければ reject する。上の例では呼び出し側で catch すること。
  再送するときも `ply` が同じなら二重適用されない（§6.2）。
- `showError` に渡るコードは §4 の全コード。翻訳キーは例えば `match.error.<CODE>` のように 1 対 1 で用意する。
- 例ではトークンをメモリにだけ保持している。リロード後にも戻れるようにするなら `sessionStorage` などタブ単位の保存先に置き、
  他人に見える場所（URL、ログ、共有リンク）には出さない。
- 合法手のハイライトは `@gungi/engine` の `legalMoves(state)` で表示用に計算してよいが、最終判定は常にサーバー。

---

## 8. 将来の接続点（認証・DB 担当向け）

差し替えは `match.module.ts` の 2 つの provider を入れ替えるだけで、gateway / service は変更不要な設計になっている。

| トークン | 現在 | 予定 |
|---|---|---|
| `WS_AUTH_ADAPTER` | `GuestAuthAdapter` | JWT（httpOnly セッション Cookie）アダプタ |
| `MATCH_REPOSITORY` | `InMemoryMatchRepository` | Prisma 実装 |

### 8.1 WsAuthAdapter（JWT Cookie 化）

```ts
interface WsAuthAdapter {
  authenticate(context: { headers: IncomingHttpHeaders; auth: HandshakeAuth }): Promise<WsIdentity | null>;
}
type WsIdentity = PlayerIdentity; // { kind: 'guest' | 'user'; playerId: string; displayName: string | null }
```

- 接続ごとに 1 回、どのイベントより先に呼ばれる。`null` を返すと `UNAUTHENTICATED` で接続を拒否する。
- `headers.cookie` からセッション Cookie を取り出して検証し、`kind: 'user'`、`playerId` = ユーザー ID（安定した値）を返す。
- **チーム決定: 対局の途中でセッションを失効させない。** 失効扱いにするのは「発行から 8 時間経過 **かつ** そのユーザーが進行中の対局の席にいない」ときだけ。
  そのためアダプタは「このユーザーが active な対局に着席中か」を対局層に問い合わせる手段（例: プレイヤー ID で引くリポジトリの検索）が必要になる。
  **現在の `MatchRepository` インターフェースにはこの検索はない**（追加が必要）。トークンの経過時間だけで拒否しないこと。
- 再接続のたびに `authenticate` を通る。席に戻るには引き続き rejoinToken が必要。
- 安定した `playerId` になると、`ALREADY_SEATED` の「同じ `playerId` がすでに席を持っている」判定が効き始める（同一ユーザーが両方の席に座れない）。
- **`kind: 'user'` は検証済みのアカウントにだけ** 付け、`playerId` にはアカウント ID を入れること。`MatchService.rejoin` はこれを前提に、
  ユーザーが持つ席を **同じユーザーにしか付け替えない**（別ユーザー・ゲストはトークンが正しくても `INVALID_REJOIN_TOKEN`。実装済み、§5.5）。
  トークンだけで別の identity に付け替えられるのはゲストが持つ席だけ。

### 8.2 MatchRepository（Prisma 化）

```ts
interface MatchRepository {
  insert(match: MatchRecord): Promise<void>;
  findById(id: string): Promise<MatchRecord | null>;
  update(match: MatchRecord): Promise<void>;
  delete(id: string): Promise<void>;
}
```

`MatchRecord` はエンジン状態を含めてプレーン JSON なので、行 + JSONB にそのまま保存できる。
予定テーブルは `matches` / `match_players` / `match_states` / `match_events`（`match.repository.ts` のコメント）。実装の契約:

| 契約 | 内容 |
|---|---|
| 上限 | `insert` は保存数が上限なら `MatchError(MATCH_LIMIT)` を投げてよい。空きを作るためにどの席にも接続がない対局を追い出してよく、そのため存在しない対局への `update` は `MatchError(MATCH_NOT_FOUND)` を投げる（インメモリ実装の上限と追い出しは §9.2）。DB 実装はこの上限の代わりに期限ベースの掃除（§8.3）で対局数を抑える |
| 値として扱う | 返したレコードを後から変更しない。渡されたレコードへの参照を保持しない（インメモリ実装は `structuredClone` で守っている） |
| 書き込みの直列化 | 1 インスタンスなら `MatchService` のロックで足りる。複数インスタンスにするなら `revision` による楽観ロック（保存済みの revision が `revision - 1` の行だけ更新）が必要 |
| 復元時の検証 | DB から読んだ `state` は返す前に必ずエンジンの `stateError` で検査する（[GUNGI_RULES.md](./GUNGI_RULES.md) §12.1）。壊れた状態を渡すとエンジンが例外を投げうる |
| タイマー非依存 | 正しさをプロセス内タイマーに依存させない。期限（持ち時間・放置・切断のタイムアウト）は対局と一緒に保存し、起動時に復元する。プロセス内タイマーは保存データから導いた「起こすきっかけ」にすぎない |

DB 化の際の注意（コードからの帰結）:

- 席の `connectionId` は Socket.IO の接続 ID でプロセス内でしか意味がない。再起動後に残っていると、その席は `connected: true` のまま誰も操作できない。
  起動時に全席の `connectionId` を `null` に戻す（または保存しない）必要がある。

### 8.3 waiting 対局の掃除（未実装）

現在、時間ベースの掃除は **ない**。作成者が leave せずに切断した `waiting` 対局は、上限による追い出し（§9.2）かプロセスの再起動まで残る（§10.2）。
インメモリ実装では保存数の上限と追い出し（§9.2）がメモリの無制限な増加だけを防いでいる。DB 化するとこれは再起動でも消えなくなるため、
上限の代わりに次の方針で対応する:

- 対局に期限（例: 最後の更新時刻からの放置期限）を保存し、起動時と定期的な見回りで期限切れの `waiting` 対局を削除する（§8.2 の「タイマー非依存」に従う）。
- 削除はロック（`MatchService` 経由）の中で行い、同時に来た join と競合させない。

### 8.4 先手・席の決定（マッチメイキング / レート戦）

現在の `match:create` は友人対局向けで、作成者が `side` / `firstPlayer` を指定できる（§3.2）。これは作成者が自分に有利な条件を選べることを意味する。

- マッチメイキングやレート戦を追加するときは、席と `firstPlayer` を **サーバーが決める**。帥落とし（§9.1）の儀式はサーバー側の乱数で行い、
  結果を `MatchService` に渡す。クライアントの `side` / `firstPlayer` は受け取っても **無視** する。
- そのような対局はクライアントの `match:create` からではなく、マッチング処理（サーバー内部）から作る想定。

---

## 9. 運用

### 9.1 APP_ORIGIN

- `.env` の `APP_ORIGIN` に、ブラウザがページを開くオリジンを書く（`.env.example` の既定は `https://localhost:8443`）。
- 複数可（カンマ区切り）。例: nginx を通さず Next.js の開発サーバーから接続するなら `APP_ORIGIN=https://localhost:8443,http://localhost:3000`。
- 未設定なら `https://localhost:8443` だけを許可する。ブラウザの URL（ホスト名・ポート）を変えたら必ず合わせる。合っていないと `FORBIDDEN_ORIGIN`。
- server コンテナは `docker-compose.yml` の `env_file: .env` で読み込む。

### 9.2 対局数の上限（MATCH_LIMIT_TOTAL / MATCH_LIMIT_WAITING）

ゲストは認証なしで対局を作れるため、インメモリ実装（`InMemoryMatchRepository`）は保存する対局数に上限を持つ。

| 環境変数 | 既定値 | 意味 |
|---|---|---|
| `MATCH_LIMIT_TOTAL` | `1000` | 保存する対局の総数（状態を問わない） |
| `MATCH_LIMIT_WAITING` | `100` | 保存する `waiting` 対局の数 |

- 新しい対局が上限を超える場合、`insert` はまず **どの席にも接続が結び付いていない対局**（以下「無人の対局」）を、`updatedAt` が古い順に追い出して空きを作る。
  - `waiting` の上限: 無人の `waiting` 対局を追い出す。
  - 全体の上限: 無人の対局を状態を問わず追い出す。順序は `finished` → `waiting` → `active`（同じ状態の中では古い順）。
  - どこかの席に接続がある対局は **追い出さない**。追い出しても空きが足りなければ何も追い出さず、`match:create` は `MATCH_LIMIT` で失敗する。
- 追い出された対局への rejoin / join は `MATCH_NOT_FOUND`。**両者とも切断した `active` 対局も追い出されうる**（rejoinToken で戻れなくなる）。
  上限に達したサーバーが再起動まで新規作成を受け付けなくなるよりはよい、という割り切り。追い出しと同時に進んでいた rejoin / join も `MATCH_NOT_FOUND` になる。
- 値は正の整数。未設定・不正な値（`0`、負数、小数、数字以外）は既定値になる。`match.module.ts` で `ConfigService` から読む。
- 件数の確認・追い出し・保存は `insert` の中で `await` を挟まずに行うので、同時に作成されても上限を超えない。
- 上限はメモリ保護のための暫定措置で、DB 化で期限ベースの掃除に置き換える（§8.3）。接続を開いたままにした対局は枠を占有し続ける（§10.2）。

### 9.3 nginx の `/socket.io/`

| 設定 | 意味 |
|---|---|
| `proxy_pass http://server_upstream` | `server:4000` に転送 |
| `proxy_http_version 1.1` | WebSocket のアップグレードに必要 |
| `Upgrade $http_upgrade` / `Connection $connection_upgrade` | アップグレード要求をそのまま中継（`map` で `Upgrade` があれば `upgrade`、なければ `close`） |
| `Host` / `X-Real-IP` / `X-Forwarded-Proto https` | 元の要求情報を伝える。`Origin` ヘッダーは nginx の既定で素通しされる |
| `proxy_read_timeout 3600s` | 長時間の WebSocket 接続を nginx が切らないように |

Socket.IO の path は全名前空間で共通なので、`/match` 以外の名前空間を追加しても nginx の変更は不要。
ポーリング（HTTP long-polling）もこの location で処理される。

### 9.4 ビルド

- `npm run build -w @gungi/server` → `nest build`。`nest-cli.json` で `webpack: true`、設定は `server/webpack.config.js`。
- 理由: ワークスペースパッケージ（`@gungi/engine` / `@gungi/shared`）は `main` が `src/index.ts`（TypeScript ソース）を指しているため、
  素の `tsc` 出力からは実行時に `require` できない。webpack で `dist/main.js` に **同梱** し、それ以外の依存は外部扱いにして
  リポジトリルートの `node_modules`（npm workspaces で巻き上げ）から解決する（`nodeExternals` の `allowlist: [/^@gungi\//]`）。

### 9.5 テスト

```bash
npm test -w @gungi/server        # server のみ（vitest run）
npm test                         # 全ワークスペース
```

- `server/vitest.config.mts` は `src/**/*.spec.ts` を対象に、変換を **SWC**（`unplugin-swc`）で行う。
  Nest の DI は `emitDecoratorMetadata` に依存し、Vite 既定の esbuild はこれを出力しないため。
- WebSocket 関連のテスト:

| ファイル | 内容 |
|---|---|
| `match.gateway.e2e.spec.ts` | 実際の Nest アプリを空きポートで起動し、socket.io-client で接続する e2e（ハンドシェイク拒否、不正ペイロード、1 接続 1 対局（同一接続からの並行 create / join を含む）、処理中の切断、作成→参加→着手→違反手→切断→rejoin→投了、席の乗っ取り） |
| `match.service.spec.ts` | ライフサイクル・席・削除条件・ロック下の直列化 |
| `contract.spec.ts` | 契約とエンジンの定義（エラーコード・駒種・手の型）が一致すること |
| `match.repository.spec.ts` | インメモリ実装の保存数上限と環境変数の解釈 |
| `ws-origin.spec.ts` / `ws-auth.adapter.spec.ts` / `keyed-mutex.spec.ts` | 各部品の単体テスト |

### 9.6 スモーク（手動確認）の再現手順

ローカルで server だけ起動して確認する場合:

```bash
npm run build -w @gungi/server
node server/dist/main.js          # SERVER_PORT 既定 4000。ルートの .env があれば読む
```

別のターミナルで、次のスクリプトをリポジトリ外（例: `/tmp/ws-smoke.cjs`）に保存して実行する。
`socket.io-client` は server の devDependency としてルートの `node_modules` に入っているので `NODE_PATH` で参照する。

```js
const { io } = require('socket.io-client');
const base = process.argv[2] ?? 'http://127.0.0.1:4000';
const tls = base.startsWith('https') ? { rejectUnauthorized: false } : {}; // 自己署名証明書用
const connect = (name, origin = 'https://localhost:8443') =>
  io(`${base}/match`, {
    path: '/socket.io',
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: { protocolVersion: 1, displayName: name },
    extraHeaders: { origin },
    ...tls,
  });
const ack = (s, event, payload) => s.timeout(3000).emitWithAck(event, payload);
const once = (s, event) => new Promise((resolve) => s.once(event, resolve));

(async () => {
  const a = connect('A');
  const b = connect('B');
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  const created = await ack(a, 'match:create', { side: 'black', firstPlayer: 'black' });
  console.log('create', created.ok, created.data.match.status, created.data.you.side);
  const matchId = created.data.match.matchId;
  const joined = await ack(b, 'match:join', { matchId });
  console.log('join', joined.ok, joined.data.match.status, joined.data.you.side);
  const placed = await ack(a, 'match:move', {
    matchId,
    move: { type: 'place', kind: 'marshal', to: { file: 4, rank: 0 } },
    ply: 0,
  });
  console.log('place', placed.ok, 'ply', placed.data.state.ply);
  const illegal = await ack(b, 'match:move', {
    matchId,
    move: { type: 'place', kind: 'pawn', to: { file: 0, rank: 8 } },
  });
  console.log('illegal', JSON.stringify(illegal)); // {"ok":false,"code":"MARSHAL_FIRST"}
  const resigned = await ack(a, 'match:move', { matchId, move: { type: 'resign' } });
  console.log('resign', resigned.data.status, JSON.stringify(resigned.data.state.result));
  const evil = connect('E', 'https://evil.example');
  console.log('evil origin', (await once(evil, 'connect_error')).message); // FORBIDDEN_ORIGIN
  for (const s of [a, b, evil]) s.close();
})().catch((error) => {
  console.error('SMOKE FAILED', error);
  process.exit(1);
});
```

```bash
NODE_PATH="$(pwd)/node_modules" node /tmp/ws-smoke.cjs                         # server 直結
NODE_PATH="$(pwd)/node_modules" node /tmp/ws-smoke.cjs https://localhost:8443  # docker compose（nginx 経由）
```

CI（`.github/workflows/ci.yml`）の compose スモークは現在 `/health` とトップページだけを確認しており、WebSocket は e2e テストで担保している。

---

## 10. 既知の制限

### 10.1 縮小スコープとの関係

- **リモートプレイヤー（再接続要件）は縮小で外した**（[PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) §3.5、[TASKS.md](./TASKS.md) Phase 1 の DoD）。
  本実装が持つのは、切断時の **席の保持** と rejoinToken による **復帰** だけ。持ち時間の停止・不在時の自動投了・再接続猶予などはない。
- **観戦なし**: ルームに入れるのは 2 つの席の接続だけ。3 人目の join は `MATCH_FULL`。
- **時計なし**: 持ち時間・切れ負けはない。`MatchService.finishByServer`（`timeout` / `agreeDraw`）は将来のための配管で、どこからも呼ばれていない。
- **対局の一覧・招待なし**: 参加には `matchId` を共有する必要がある（ロビー・招待は別機能）。
- **保存はインメモリ**: サーバー再起動で全対局が消える（§8.2）。
- **対局数の上限**: 既定で全体 1000 件・`waiting` 100 件まで。超えるときは無人の対局を追い出し、それでも足りなければ create は `MATCH_LIMIT`（§9.2）。
- **1 インスタンス前提**: ロック（対局ごと・接続ごと）とルームはプロセス内（§6.1）。

### 10.2 放置された対局と上限

作成者が `match:leave` せずに切断（タブを閉じる等）した `waiting` 対局は削除されず、上限による追い出し（§9.2）かプロセス再起動まで残る。
この対局には引き続き join でき、その場合は作成者が `connected: false` のまま `active` になる（作成者は rejoinToken で戻れる）。
滞留した対局は上限に達するまで枠を占有するが、上限に達すると無人の対局から古い順に追い出される（§9.2）。そのため「作成して切断」を
繰り返すだけでは新規作成を止められない。追い出しの代償として、切断したまま放置された対局（両者とも切断した `active` 対局を含む）は
上限が逼迫すると消え、rejoin は `MATCH_NOT_FOUND` になる。

**接続を開いたままにした対局は追い出されない**。多数の接続を張ったまま create（または create + join）すると、引き続き枠を占有して
新規作成を `MATCH_LIMIT` で止めうる（サーバーのメモリは守られる）。本番での対策は nginx の `limit_conn` による IP ごとの同時接続数の制限
（未対応。今後の課題）。

FE は画面を離れるときに可能なら `match:leave` を送ること。根本対応は §8.3。
