"use client";

/**
 * Example Next.js page with Agentation integration + status indicator.
 *
 * Shows the minimal wiring needed:
 *   1. Import Agentation + AgentationStatus
 *   2. Use a remountKey to force Agentation to re-read localStorage on resolution
 *   3. Render both components (dev-only)
 *
 * Replace localhost:4848 with your webhook receiver's host/port.
 */

import { useState, useCallback } from "react";
import { Agentation } from "agentation";
import { AgentationStatus } from "./agentation-status";

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

      {/* ---- Agentation toolbar + status (dev only) ---- */}
      {isDev && (
        <>
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
