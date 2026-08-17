/**
 * Timing-safe string comparison for machine-route shared secrets.
 *
 * Workers has no `crypto.timingSafeEqual`, so this is the manual form: compare
 * every byte regardless of where the first difference falls, and fold the
 * length check into the same result rather than short-circuiting on it. A
 * `===` on a secret leaks its length and, over enough requests, its content.
 *
 * ⚠️ The one implementation. Lived inside `routes/ingest.ts` until the donor
 * route needed the same comparison (2026-08-16); extracted rather than copied,
 * per the repo rule that anything making a decision exists exactly once. Every
 * token-gated machine route (`/api/ingest`, `/api/machine/audiobook-mapping`,
 * `/api/donor`) should compare through this.
 */
export function secretEquals(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
