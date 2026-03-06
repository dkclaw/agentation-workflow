"use client";

import { useEffect, useState, useCallback, useRef } from "react";

/**
 * Agentation Status Indicator
 *
 * Shows a small floating badge near the Agentation toolbar that displays
 * the current processing status of annotations:
 *   - 🟡 "Queued (N pending)" — annotations waiting for batch window
 *   - 🔵 "Agent working..." — coding agent is making changes
 *   - 🟢 "Done! N fixed" — annotations resolved (auto-hides after 5s)
 *   - 🔴 "Error: ..." — agent failed (stays visible until dismissed)
 *
 * Usage:
 *   import { AgentationStatus, useAgentationStatus } from "./agentation-status";
 *
 *   function Page() {
 *     const { status, onSSEEvent } = useAgentationStatus();
 *     // Pass onSSEEvent to useCompletionListener or use AgentationStatus directly
 *     return <AgentationStatus sseUrl="http://localhost:4848/events" />;
 *   }
 */

const STORAGE_PREFIX = "feedback-annotations-";

interface StatusState {
  type: "idle" | "queued" | "processing" | "resolved" | "error";
  message: string;
  count: number;
  timestamp: number;
}

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
    return true;
  } catch {
    return false;
  }
}

export function useAgentationStatus(sseUrl: string, onResolved?: () => void) {
  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
    count: 0,
    timestamp: 0,
  });
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleEvent = useCallback(
    (data: any) => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);

      switch (data.type) {
        case "queued":
          setStatus({
            type: "queued",
            message: data.detail || "Annotation queued",
            count: (data.ids?.length || 0),
            timestamp: Date.now(),
          });
          break;

        case "processing":
          setStatus({
            type: "processing",
            message: data.detail || "Agent working...",
            count: data.ids?.length || 0,
            timestamp: Date.now(),
          });
          break;

        case "resolved":
          if (data.ids?.length) {
            const changed = removeFromStorage(data.ids);
            if (changed) onResolved?.();
          }
          setStatus({
            type: "resolved",
            message: `Done! ${data.ids?.length || 0} annotation(s) fixed`,
            count: data.ids?.length || 0,
            timestamp: Date.now(),
          });
          // Auto-hide after 5 seconds
          hideTimerRef.current = setTimeout(() => {
            setStatus((s) => (s.type === "resolved" ? { ...s, type: "idle" } : s));
          }, 5000);
          break;

        case "error":
          setStatus({
            type: "error",
            message: data.detail || "Agent error",
            count: 0,
            timestamp: Date.now(),
          });
          // Keep error visible for 15 seconds
          hideTimerRef.current = setTimeout(() => {
            setStatus((s) => (s.type === "error" ? { ...s, type: "idle" } : s));
          }, 15000);
          break;
      }
    },
    [onResolved]
  );

  useEffect(() => {
    const es = new EventSource(sseUrl);
    es.onmessage = (event) => {
      if (event.data === "connected") return;
      try {
        handleEvent(JSON.parse(event.data));
      } catch {}
    };
    es.onerror = () => {
      console.warn("[Agentation] SSE connection error, will retry...");
    };
    return () => {
      es.close();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [sseUrl, handleEvent]);

  return status;
}

const STATUS_STYLES: Record<StatusState["type"], { bg: string; border: string; icon: string }> = {
  idle: { bg: "transparent", border: "transparent", icon: "" },
  queued: { bg: "#FFF8E1", border: "#FFD54F", icon: "⏳" },
  processing: { bg: "#E3F2FD", border: "#42A5F5", icon: "⚙️" },
  resolved: { bg: "#E8F5E9", border: "#66BB6A", icon: "✅" },
  error: { bg: "#FFEBEE", border: "#EF5350", icon: "❌" },
};

/**
 * Drop-in status indicator component.
 * Renders a floating badge above the Agentation toolbar position.
 *
 * Props:
 *   sseUrl — SSE endpoint (default: http://localhost:4848/events)
 *   onResolved — callback when annotations are resolved (use to bump remount key)
 *   position — "bottom-right" (default) | "bottom-left"
 */
export function AgentationStatus({
  sseUrl = "http://localhost:4848/events",
  onResolved,
  position = "bottom-right",
}: {
  sseUrl?: string;
  onResolved?: () => void;
  position?: "bottom-right" | "bottom-left";
}) {
  const status = useAgentationStatus(sseUrl, onResolved);

  if (status.type === "idle") return null;

  const style = STATUS_STYLES[status.type];
  const posStyle = position === "bottom-right" ? { right: "20px" } : { left: "20px" };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "70px",
        ...posStyle,
        zIndex: 999998,
        padding: "8px 14px",
        borderRadius: "8px",
        backgroundColor: style.bg,
        border: `1px solid ${style.border}`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "13px",
        color: "#333",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        maxWidth: "320px",
        animation: "agentation-status-fade-in 0.2s ease-out",
      }}
    >
      <span style={{ fontSize: "16px" }}>{style.icon}</span>
      <span>{status.message}</span>
      {status.type === "processing" && (
        <span
          style={{
            display: "inline-block",
            width: "12px",
            height: "12px",
            border: "2px solid #42A5F5",
            borderTopColor: "transparent",
            borderRadius: "50%",
            animation: "agentation-spin 0.8s linear infinite",
          }}
        />
      )}
      <style>{`
        @keyframes agentation-spin { to { transform: rotate(360deg); } }
        @keyframes agentation-status-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
