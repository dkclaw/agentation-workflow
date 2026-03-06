"use client";

import { useEffect, useCallback } from "react";

/**
 * Agentation localStorage storage prefix.
 * Annotations are stored at: `feedback-annotations-{pathname}`
 * Sessions are stored at:    `agentation-session-{pathname}`
 */
const STORAGE_PREFIX = "feedback-annotations-";

/**
 * SSE endpoint on the webhook receiver.
 * Update this to match your webhook receiver's host and port.
 */
const SSE_URL = "http://localhost:4848/events";

/**
 * Remove resolved annotation IDs from Agentation's localStorage store.
 *
 * Agentation stores annotations as a JSON array in localStorage with key
 * `feedback-annotations-{pathname}`. Each annotation has a numeric `id` field
 * (timestamp-based). This function filters out the resolved IDs and writes
 * the remaining annotations back.
 *
 * @returns true if any annotations were removed
 */
function removeFromStorage(ids: string[]): boolean {
  const pathname = window.location.pathname;
  const key = `${STORAGE_PREFIX}${pathname}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const annotations: any[] = JSON.parse(raw);
    const idSet = new Set(ids.map(String));
    const filtered = annotations.filter((a: any) => !idSet.has(String(a.id)));
    if (filtered.length === annotations.length) return false;
    if (filtered.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(filtered));
    }
    console.log(
      `[Agentation] Removed ${annotations.length - filtered.length} resolved annotation(s) from storage`
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * React hook that listens for annotation resolution events from the webhook
 * receiver via Server-Sent Events.
 *
 * When resolved IDs arrive:
 * 1. Removes them from Agentation's localStorage
 * 2. Calls `onResolved()` — use this to bump a React key on the
 *    <Agentation> component, forcing it to remount and re-read localStorage.
 *
 * Usage:
 * ```tsx
 * const [remountKey, setRemountKey] = useState(0);
 * const handleResolved = useCallback(() => setRemountKey(k => k + 1), []);
 * useCompletionListener(handleResolved);
 *
 * <Agentation key={`agentation-${remountKey}`} ... />
 * ```
 */
export function useCompletionListener(onResolved: () => void, sseUrl?: string) {
  const stableOnResolved = useCallback(onResolved, [onResolved]);

  useEffect(() => {
    const url = sseUrl || SSE_URL;
    const es = new EventSource(url);

    es.onmessage = (event) => {
      if (event.data === "connected") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "resolved" && data.ids?.length) {
          console.log("[Agentation] Resolved IDs received:", data.ids);
          const changed = removeFromStorage(data.ids);
          if (changed) {
            stableOnResolved();
          }
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    es.onerror = () => {
      console.warn("[Agentation] SSE connection error, will retry...");
    };

    return () => es.close();
  }, [stableOnResolved, sseUrl]);
}
