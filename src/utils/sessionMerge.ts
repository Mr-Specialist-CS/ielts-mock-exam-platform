import { CandidateSession } from '../types';

// Section order for forward-progress comparison (review/completed are
// terminal — nothing legitimately moves a candidate backward).
export function sectionRank(s: string): number {
  const order = ['listening', 'reading', 'writing', 'completed', 'review'];
  const i = order.indexOf(s);
  return i === -1 ? 0 : i;
}

// Merge a freshly fetched server session over local state WITHOUT ever
// dragging a live candidate backward: the furthest section reached wins.
// Server-side safety + scoring fields (lock, status, grading) always apply,
// so proctor locks, resets and regrades still take effect immediately.
// Used by every server-to-client session write except the ordered save
// responses (which carry their own sequence guard).
export function mergeSessionPreferringProgress(
  prev: CandidateSession | null,
  fresh: CandidateSession | null
): CandidateSession | null {
  if (!fresh) return prev;
  if (!prev) return fresh;
  if (sectionRank(fresh.currentSection) >= sectionRank(prev.currentSection)) return fresh;
  return {
    ...prev,
    lockStatus: fresh.lockStatus,
    status: fresh.status === 'hard_locked' || prev.status === 'hard_locked' ? 'hard_locked' : prev.status,
    grading: fresh.grading
  };
}
