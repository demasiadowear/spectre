"use client";

import { useEffect } from "react";

// ============================================================
// Ping "demo aperta". Un solo POST, nessun cookie, nessun
// fingerprinting, nessun ID utente: si registra soltanto che la demo
// è stata aperta e su che tipo di schermo. Serve a sapere se vale la
// pena richiamare, non a profilare il titolare.
// ============================================================

export default function DemoViewPing({ slug }: { slug: string }) {
  useEffect(() => {
    // Una volta per sessione del browser: niente doppio conteggio se
    // la pagina viene rimontata (o riaperta dalla stessa tab).
    const key = `spectre-demo-seen-${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage negato (privata): si pinga comunque, una volta sola */
    }
    const device = window.matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop";
    void fetch("/api/factory/demo-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, device }),
      keepalive: true,
    }).catch(() => {
      /* il tracking non deve mai rompere la demo */
    });
  }, [slug]);

  return null;
}
