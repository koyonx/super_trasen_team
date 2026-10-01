import { BOARD_SIZE, MAX_STACK_HEIGHT } from '@gungi/shared';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold tracking-tight">軍儀 — Gungi Online</h1>
      <p className="text-zinc-400">
        {BOARD_SIZE}×{BOARD_SIZE} board, stacks up to {MAX_STACK_HEIGHT} tiers.
      </p>
      <p className="text-sm text-zinc-500">Scaffold is up. Let the war council begin.</p>
    </main>
  );
}
