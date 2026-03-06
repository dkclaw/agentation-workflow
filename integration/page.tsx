"use client";

/**
 * Example Next.js page with Agentation integration.
 *
 * This shows the minimal wiring needed:
 *   1. Import Agentation + the completion hook
 *   2. Use a remountKey to force Agentation to re-read localStorage on resolution
 *   3. Render <Agentation> with webhookUrl and the key prop
 *
 * Replace YOUR_SERVER with your webhook receiver's host/port.
 */

import { useState, useCallback } from "react";
import { Agentation } from "agentation";
import { useCompletionListener } from "./agentation-hook";

export default function Page() {
  const [remountKey, setRemountKey] = useState(0);
  const handleResolved = useCallback(() => setRemountKey((k) => k + 1), []);
  useCompletionListener(handleResolved);

  return (
    <>
      {/* ---- Your page content goes here ---- */}
      <main>
        <h1>My App</h1>
        <p>This is your normal page content.</p>
      </main>

      {/* ---- Agentation toolbar ---- */}
      <Agentation
        key={`agentation-${remountKey}`}
        webhookUrl="http://localhost:4848/webhook"
        autoSend={true}
        // Optional: enable MCP server sync
        // mcpUrl="http://localhost:4747"
      />
    </>
  );
}
