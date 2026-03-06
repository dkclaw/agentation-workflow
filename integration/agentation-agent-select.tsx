"use client";

import { useEffect, useState } from "react";

/**
 * Agent selector dropdown for Agentation workflow.
 *
 * Renders a small floating dropdown that lets users choose which coding agent
 * (Codex, Claude, OpenClaw) handles their annotations.
 *
 * The selection is:
 *   1. Persisted to localStorage
 *   2. Synced to the webhook receiver via POST /agent
 *   3. Updated from the server via SSE agent-changed events
 *
 * Usage:
 *   <AgentSelect apiUrl="http://localhost:4848/agent" sseUrl="http://localhost:4848/events" />
 */

const AGENTS = [
  { value: "codex", label: "⚡ Codex" },
  { value: "claude", label: "🟣 Claude" },
  { value: "openclaw", label: "🐾 OpenClaw" },
];

const STORAGE_KEY = "agentation-selected-agent";

export function AgentSelect({
  apiUrl = "http://localhost:4848/agent",
  sseUrl = "http://localhost:4848/events",
  position = "bottom-left" as "bottom-left" | "bottom-right",
}) {
  const [agent, setAgent] = useState(() => {
    if (typeof window === "undefined") return "codex";
    return localStorage.getItem(STORAGE_KEY) || "codex";
  });

  // Fetch current server setting on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      fetch(apiUrl)
        .then((r) => r.json())
        .then((data) => {
          if (data.current) setAgent(data.current);
        })
        .catch(() => {});
    }
  }, [apiUrl]);

  // Listen for server-side agent changes via SSE
  useEffect(() => {
    const es = new EventSource(sseUrl);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "agent-changed" && data.agent) {
          setAgent(data.agent);
          localStorage.setItem(STORAGE_KEY, data.agent);
        }
      } catch {}
    };
    return () => es.close();
  }, [sseUrl]);

  const handleChange = async (newAgent: string) => {
    setAgent(newAgent);
    localStorage.setItem(STORAGE_KEY, newAgent);
    try {
      await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: newAgent }),
      });
    } catch (err) {
      console.warn("[Agentation] Failed to update agent on server:", err);
    }
  };

  const posStyle = position === "bottom-left" ? { left: "20px" } : { right: "20px" };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "70px",
        ...posStyle,
        zIndex: 999998,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "12px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "white",
        padding: "6px 10px",
        borderRadius: "8px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        border: "1px solid #e0e0e0",
      }}
    >
      <span style={{ color: "#666", fontWeight: 500 }}>Agent:</span>
      <select
        value={agent}
        onChange={(e) => handleChange(e.target.value)}
        style={{
          border: "1px solid #d0d0d0",
          borderRadius: "4px",
          padding: "3px 6px",
          fontSize: "12px",
          background: "white",
          cursor: "pointer",
          outline: "none",
          color: "#333",
        }}
      >
        {AGENTS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
