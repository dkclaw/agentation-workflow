"use client";

import { useEffect, useState, useCallback } from "react";
import { Agentation } from "agentation";
import { BarChart3, Bot, Building2, type LucideIcon } from "lucide-react";

const STORAGE_PREFIX = "feedback-annotations-";
const SSE_URL = "http://100.89.253.104:4848/events";

/**
 * Remove resolved annotation IDs from Agentation's localStorage store,
 * then bump the remount key so the <Agentation> component re-reads storage.
 */
function removeFromStorage(ids: string[]) {
  const pathname = window.location.pathname; // typically "/"
  const key = `${STORAGE_PREFIX}${pathname}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const annotations: any[] = JSON.parse(raw);
    const idSet = new Set(ids.map(String));
    const filtered = annotations.filter((a: any) => !idSet.has(String(a.id)));
    if (filtered.length === annotations.length) return false; // nothing removed
    if (filtered.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(filtered));
    }
    console.log(`[Agentation] Removed ${annotations.length - filtered.length} resolved annotation(s) from storage`);
    return true;
  } catch {
    return false;
  }
}

function useCompletionListener(onResolved: () => void) {
  useEffect(() => {
    const es = new EventSource(SSE_URL);
    es.onmessage = (event) => {
      if (event.data === "connected") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "resolved" && data.ids?.length) {
          console.log("[Agentation] Resolved IDs received:", data.ids);
          const changed = removeFromStorage(data.ids);
          if (changed) {
            // Force Agentation to remount → re-reads localStorage
            onResolved();
          }
        }
      } catch {}
    };
    es.onerror = () => console.warn("[Agentation] SSE connection error, will retry...");
    return () => es.close();
  }, [onResolved]);
}

export default function Home() {
  // Changing this key forces <Agentation> to unmount/remount → re-read localStorage
  const [remountKey, setRemountKey] = useState(0);
  const handleResolved = useCallback(() => setRemountKey((k) => k + 1), []);
  useCompletionListener(handleResolved);
  return (
    <>
      <div className="min-h-screen bg-[url('/green-wave.svg')] bg-cover bg-center bg-no-repeat flex flex-col items-center justify-center font-[Poppins]">
        {/* Header */}
        <header className="text-center mb-8 bg-gray-200 p-12 rounded-xl shadow-[0_0_36px_rgba(107,114,128,0.45)] border border-gray-300 min-w-[420px]">
          <div className="flex items-center justify-center mb-4 gap-8">
            <img
              src="https://dakotastorage.com/favicon.ico"
              alt="Dakota Storage logo"
              className="h-16 w-16 rounded-md object-contain bg-white p-1 shadow-[0_8px_18px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.85)] ring-1 ring-black/10"
            />
            <div className="flex flex-col items-start">
              <h1 className="text-4xl font-semibold text-gray-900 m-0 leading-none">
                Dakota Storage
              </h1>
              <p className="text-gray-700 mt-2 font-light text-lg">
                AI-Powered Storage Solutions
              </p>
            </div>
          </div>
        </header>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl px-4">
          <FeatureCard
            icon={<ThreeDIcon Icon={Building2} />}
            title="Custom Buildings"
            description="Design your perfect storage building with AI-assisted planning and 3D visualization."
            cta="Start Designing"
          />
          <FeatureCard
            icon={<ThreeDIcon Icon={BarChart3} />}
            title="Inventory Management"
            description="Smart inventory tracking with predictive analytics and automated reordering."
            cta="View Dashboard"
          />
          <FeatureCard
            icon={<ThreeDIcon Icon={Bot} />}
            title="AI Assistant"
            description="Get instant answers about storage solutions, pricing, and availability."
            cta="Chat Now"
          />
        </div>

        {/* CTA Section */}
        <section className="mt-12 text-center bg-gradient-to-r from-[#F2A200] to-[#E07F00] p-8 rounded-xl max-w-3xl mx-4 shadow-lg">
          <h2 className="text-3xl font-semibold text-black mb-3">
            Ready to Get Started?
          </h2>
          <p className="text-black mb-6 text-lg">
            Schedule a free consultation with our team today.
          </p>
          <button className="demo-button bg-white text-black px-8 py-3 rounded-lg font-semibold text-lg hover:bg-gray-100 transition-colors shadow-md">
            Book a Demo
          </button>
        </section>

        {/* Footer */}
        <footer className="mt-12 mb-8 text-center text-gray-700 text-sm">
          <p>
            © 2026{" "}
            <a
              href="https://dakotastorage.com"
              target="_blank"
              rel="noreferrer"
              className="hover:text-gray-900 underline-offset-2 hover:underline"
            >
              Dakota Storage
            </a>
            . All rights reserved.
          </p>
          <div className="flex gap-4 justify-center mt-2">
            <a href="#" className="hover:text-gray-900">Privacy</a>
            <a href="#" className="hover:text-gray-900">Terms</a>
            <a href="mailto:contact@example.com" className="hover:text-gray-900">Contact</a>
          </div>
        </footer>
      </div>

      <style jsx>{`
        .demo-button:hover {
          box-shadow:
            0 0 18px rgba(230, 139, 0, 0.65),
            0 0 30px rgba(242, 162, 0, 0.45);
          animation: demo-shake 0.35s ease-in-out infinite;
        }

        @keyframes demo-shake {
          0%,
          100% {
            transform: translateX(0);
          }
          25% {
            transform: translateX(-2px) rotate(-0.8deg);
          }
          75% {
            transform: translateX(2px) rotate(0.8deg);
          }
        }
      `}</style>

      {/* Agentation toolbar — key changes on resolution to force remount + re-read localStorage */}
      <Agentation
        key={`agentation-${remountKey}`}
        webhookUrl="http://100.89.253.104:4848/webhook"
        mcpUrl="http://100.89.253.104:4747"
        autoSend={true}
        onAnnotationAdd={(annotation: any) => {
          console.log("Annotation added:", annotation);
        }}
        onAnnotationDelete={(annotation: any) => {
          console.log("Annotation deleted:", annotation?.id);
        }}
      />
    </>
  );
}

function ThreeDIcon({ Icon }: { Icon: LucideIcon }) {
  return (
    <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-b from-[#FFD26B] to-[#E6A600] shadow-[0_8px_18px_rgba(146,96,0,0.35),inset_0_2px_0_rgba(255,255,255,0.65)]">
      <Icon
        size={30}
        strokeWidth={2.4}
        className="text-[#2C2100] drop-shadow-[0_2px_1px_rgba(255,255,255,0.35)]"
      />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
}) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow">
      <div className="mb-4">{icon}</div>
      <h3 className="text-xl font-semibold text-gray-800 mb-2">{title}</h3>
      <p className="text-gray-600 mb-4 font-light">{description}</p>
      <button className="text-black font-semibold hover:text-black transition-colors">
        {cta} →
      </button>
    </div>
  );
}
