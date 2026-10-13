/** Origin served by nginx in the default setup (matches NEXT_PUBLIC_APP_URL). */
export const DEFAULT_APP_ORIGIN = 'https://localhost:8443';

function normalize(origin: string): string | null {
  try {
    const { origin: normalized } = new URL(origin);
    return normalized === 'null' ? null : normalized;
  } catch {
    return null;
  }
}

/**
 * Parses `APP_ORIGIN`: one or more comma-separated origins
 * (e.g. `https://localhost:8443,http://localhost:3000`). Falls back to
 * `DEFAULT_APP_ORIGIN` when unset or empty.
 */
export function parseAllowedOrigins(value: string | undefined): ReadonlySet<string> {
  const origins = (value ?? '')
    .split(',')
    .map((entry) => normalize(entry.trim()))
    .filter((entry): entry is string => entry !== null);
  return new Set(origins.length > 0 ? origins : [DEFAULT_APP_ORIGIN]);
}

/**
 * Cross-site WebSocket hijacking defence. Browsers always send `Origin` on
 * WebSocket upgrades and cross-origin requests, so a present header must name
 * an allowed origin. An absent header comes from a same-origin polling
 * request or a non-browser client; both are accepted (a non-browser client
 * could forge the header anyway, so authentication stays the real gate).
 */
export function isOriginAllowed(origin: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (origin === undefined) return true;
  const normalized = normalize(origin);
  return normalized !== null && allowed.has(normalized);
}
