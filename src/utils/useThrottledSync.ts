import { useEffect, useRef } from 'react';
import { CandidateSession } from '../types';

/**
 * Coalesces rapid-fire syncs (e.g. every keystroke while typing) into at most
 * one server save per `delayMs`. Each queued partial carries a full local
 * snapshot, so the latest one always wins — nothing is lost, only delayed.
 * Any pending save is flushed on unmount (section finish / submit / exit).
 */
export function useThrottledSync(
  onSync: (partial: Partial<CandidateSession>) => void,
  delayMs = 10000
) {
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  const pendingRef = useRef<Partial<CandidateSession> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSync = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current) {
      const p = pendingRef.current;
      pendingRef.current = null;
      onSyncRef.current(p);
    }
  };
  const flushSyncRef = useRef(flushSync);
  flushSyncRef.current = flushSync;

  const queueSync = (partial: Partial<CandidateSession>) => {
    pendingRef.current = partial;
    if (!timerRef.current) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flushSyncRef.current();
      }, delayMs);
    }
  };

  // Take the pending partial WITHOUT sending it (used on section finish so
  // the finisher can merge the very latest keystrokes into its single final
  // save — this also disarms the unmount flush, which would otherwise push a
  // stale snapshot after the finish and revert the section change server-side).
  const consumePending = (): Partial<CandidateSession> | null => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const p = pendingRef.current;
    pendingRef.current = null;
    return p;
  };

  // Flush any trailing keystrokes when leaving the section.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (pendingRef.current) {
        const p = pendingRef.current;
        pendingRef.current = null;
        onSyncRef.current(p);
      }
    };
  }, []);

  return { queueSync, flushSync, consumePending };
}
