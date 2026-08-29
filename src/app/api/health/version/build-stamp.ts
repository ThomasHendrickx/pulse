// The "unstamped" marker (M3-P17), split out of route.ts rather than
// exported from it. A Next.js App Router route module may only export the
// handler functions and the segment config fields (GET, runtime, dynamic,
// and so on); any other named export fails the build's route-type check
// ("<name>" is not a valid Route export field), which tsc --noEmit does not
// catch because it never runs against the generated route types. Fix round
// 1 (findings CR-M3P17-01 / HZ-M3P17-01): `export const UNSTAMPED` inside
// route.ts made `npm run build` exit 1, so `npm run test:e2e` could never
// pass in any environment, since the slow gate's production project builds
// before it serves. Kept beside the route (still inside this phase's
// declared files-to-touch, src/app/api/health/) rather than moved further,
// so the one source of truth for the marker stays local to the instrument
// that defines it.
//
// THE MARKER IS FIXED BY THE PLAN, not chosen here: M3-P16 decides a
// terminal state by comparing against it. It is lowercase, one word, and
// carries characters that are not hexadecimal digits (u, n, s, t, m, p), so
// no reader and no test can take it for a commit sha.
export const UNSTAMPED = "unstamped";
