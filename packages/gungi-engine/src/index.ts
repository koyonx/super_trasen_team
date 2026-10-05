/**
 * Gungi rule engine (server-authoritative).
 *
 * All board state, legal-move generation and win/loss judgment are implemented
 * here as pure functions, and consumed by:
 *  - server: authoritative move validation
 *  - client: pre-validation and UI hints
 *  - AI: search over legal moves
 *
 * Implementation lands in Phase 1 (see docs/TASKS.md).
 */

import { BOARD_SIZE, MAX_STACK_HEIGHT } from '@gungi/shared';

export { BOARD_SIZE, MAX_STACK_HEIGHT };
