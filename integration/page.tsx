"use client";

/**
 * Example Next.js page with Agentation integration.
 *
 * Includes:
 *   - Agentation toolbar (annotation tool)
 *   - AgentationStatus (processing indicator)
 *   - AgentSelect (choose Codex / Claude / OpenClaw)
 *   - All wrapped in dev-only guard
 */

import { useState, useCallback } from "react";
import { Agentation } from "agentation";
import { AgentationStatus } from "./agentation-status";
import { AgentSelect } from "./agentation-agent-select";

export default function Page() {
  const isDev = process.env.NODE_ENV !== "production";
  const [remountKey, setRemountKey] = useState(0);
  const handleResolved = useCallback(() => setRemountKey((k) => k + 1), []);

  return (
    <>
      {/* ---- Your page content goes here ---- */}
      <main>
        <h1>My App</h1>
        <p>This is your normal page content.</p>
      </main>

      {/* ---- Agentation toolbar + status + agent selector (dev only) ---- */}
      {isDev && (
        <>
          <AgentSelect />
          <AgentationStatus
            sseUrl="http://localhost:4848/events"
            onResolved={handleResolved}
          />
          <Agentation
            key={`agentation-${remountKey}`}
            webhookUrl="http://localhost:4848/webhook"
            autoSend={true}
          />
        </>
      )}
    </>
  );
}
