"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Fingerprint, ShieldAlert, Loader2 } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import PulseRing from "@/components/ui/spectre/PulseRing";

const INPUT =
  "w-full rounded-sm border border-border bg-surface px-3 py-2.5 font-mono text-sm text-spectre-text placeholder:text-spectre-muted/50 outline-none transition focus:border-spectre-cyan/60 focus:shadow-neon-cyan";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/visor";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });
    setLoading(false);

    if (res?.ok) {
      router.push(from);
      router.refresh();
      return;
    }
    setError("Credenziali rifiutate. Identità non riconosciuta.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <GlassCard
        corners
        glow="magenta"
        className="w-full max-w-sm p-8 sm:p-10"
      >
        {/* Brand mark */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center border border-spectre-cyan/40 text-spectre-cyan shadow-neon-cyan">
            <span className="font-display text-2xl font-bold leading-none">
              S
            </span>
          </div>
          <h1 className="font-display text-xl font-bold tracking-[0.35em] text-spectre-text">
            AYRO SPECTRE
          </h1>
          <p className="mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-spectre-muted">
            <PulseRing tone="magenta" size={6} />
            Shadow Sales OS — accesso ristretto
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-spectre-muted">
              Operatore
            </span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="puccio"
              className={INPUT}
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-spectre-muted">
              Codice
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={INPUT}
              required
            />
          </label>

          {error && (
            <p className="flex items-center gap-2 font-mono text-[11px] text-spectre-magenta">
              <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.5} />
              {error}
            </p>
          )}

          <NeonButton
            type="submit"
            variant="cyan"
            size="lg"
            filled
            disabled={loading}
            className="mt-2 w-full"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                Autenticazione
              </>
            ) : (
              <>
                <Fingerprint className="h-4 w-4" strokeWidth={1.5} />
                Accedi
              </>
            )}
          </NeonButton>
        </form>

        <p className="mt-8 text-center font-mono text-[9px] uppercase tracking-[0.3em] text-spectre-muted/60">
          Solo-tenant · sessione cifrata JWT
        </p>
      </GlassCard>
    </div>
  );
}
