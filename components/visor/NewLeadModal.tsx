"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { LEAD_STATUS, PIPELINE_ORDER } from "@/lib/constants";
import type { ApiResponse, Lead, LeadSource, LeadStatus } from "@/types";

interface NewLeadModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (lead: Lead) => void;
}

const SOURCES: { value: LeadSource; label: string }[] = [
  { value: "maps", label: "Google Maps" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "referral", label: "Referral" },
  { value: "cold", label: "Cold" },
];

const CATEGORIES = [
  "ristorante",
  "barbiere",
  "estetista",
  "parrucchiere",
  "bar",
  "studio",
  "altro",
];

const PUGLIA_CITIES = [
  "Bari", "Lecce", "Modugno", "Bitritto", "Triggiano", "Capurso", "Valenzano",
  "Brindisi", "Taranto", "Foggia", "Andria", "Barletta", "Trani", "Bitonto",
  "Molfetta", "Monopoli", "Polignano", "Gallipoli", "Nardò", "Ostuni",
];

const inputClass =
  "w-full rounded-sm border border-spectre-cyan/20 bg-black/50 px-3 py-2 font-mono text-sm text-spectre-text placeholder:text-spectre-muted/40 focus:border-spectre-cyan/50 focus:outline-none focus:ring-1 focus:ring-spectre-cyan/40";
const labelClass =
  "mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-muted";

export default function NewLeadModal({
  open,
  onClose,
  onCreated,
}: NewLeadModalProps) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<LeadStatus>("todo");
  const [source, setSource] = useState<LeadSource>("cold");
  const [nextAction, setNextAction] = useState("");
  const [category, setCategory] = useState("ristorante");
  const [rating, setRating] = useState("");
  const [reviews, setReviews] = useState("");
  const [address, setAddress] = useState("");
  const [pasted, setPasted] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setCompany("");
    setEmail("");
    setPhone("");
    setValue("");
    setStatus("todo");
    setSource("maps");
    setNextAction("");
    setCategory("ristorante");
    setRating("");
    setReviews("");
    setAddress("");
    setPasted("");
    setError(null);
  };

  // Parse a Google Maps copy-paste: name, rating, reviews, phone, address.
  const parsePaste = (text: string) => {
    setPasted(text);
    if (!text.trim()) return;
    const ratingM = text.match(/([1-5][.,]\d)/);
    if (ratingM && !rating) setRating(ratingM[1].replace(",", "."));
    const revM = text.match(/\((\d+)\)/) || text.match(/(\d+)\s*recensioni/i);
    if (revM && !reviews) setReviews(revM[1]);
    const phoneM =
      text.match(/(?:\+39\s?)?(\d{3})\s?(\d{3})\s?(\d{3,4})/) ||
      text.match(/(?:\+39\s?)?(0\d{1,3})\s?(\d{6,8})/);
    if (phoneM && !phone) setPhone(phoneM.slice(1).join("").replace(/\s/g, ""));
    const addrM = text.match(
      /((?:Via|Viale|Corso|Piazza|Largo|Vicolo|Strada|Lungomare|Vle)\s+[^,\n]+,?\s*\d*[^\n,]*)/i,
    );
    if (addrM && !address) setAddress(addrM[1].trim());
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length && !name) {
      const first = lines[0].replace(/\s*\d+[.,]\d+\s*[★(].*$/, "").trim();
      if (first.length > 2 && first.length < 80) {
        setName(first);
        setCompany(first);
      }
    }
    const low = (name || text).toLowerCase();
    if (/barber|barbier/.test(low)) setCategory("barbiere");
    else if (/estetic|beauty|nail/.test(low)) setCategory("estetista");
    else if (/parrucchier|hair|salon/.test(low)) setCategory("parrucchiere");
    else if (/ristorant|trattoria|pizzeri|osteria/.test(low)) setCategory("ristorante");
  };

  const close = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !company.trim()) {
      setError("Nome e azienda sono obbligatori.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          company: company.trim(),
          email: email.trim(),
          phone: phone.trim(),
          value: Number(value) || 0,
          status,
          source,
          next_action: nextAction.trim(),
          probability: 30,
          tags: [category, "manuale"],
          meta: {
            category,
            rating: rating ? Number(rating) : undefined,
            reviews: reviews ? Number(reviews) : undefined,
            address: address.trim() || undefined,
          },
        }),
      });
      const json: ApiResponse<Lead> = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error ?? "Creazione fallita.");
      }
      onCreated(json.data);
      reset();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-sm border border-spectre-cyan/25 bg-spectre-panel/95 p-5 shadow-glass sm:p-6"
          >
            <button
              type="button"
              onClick={close}
              aria-label="Chiudi"
              className="absolute right-4 top-4 text-spectre-muted transition-colors hover:text-spectre-magenta"
            >
              <X className="h-4 w-4" />
            </button>

            <h2 className="mb-5 font-display text-lg font-bold text-spectre-text">
              Nuovo lead
            </h2>

            <form onSubmit={submit} className="flex flex-col gap-3">
              <div>
                <label className={labelClass} htmlFor="nl-paste">
                  Incolla da Google Maps (auto-compila)
                </label>
                <textarea
                  id="nl-paste"
                  rows={2}
                  className={inputClass}
                  value={pasted}
                  onChange={(e) => parsePaste(e.target.value)}
                  placeholder="Incolla nome, rating, recensioni, telefono, indirizzo…"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="nl-name">
                    Nome *
                  </label>
                  <input
                    id="nl-name"
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Mario Rossi"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="nl-company">
                    Azienda *
                  </label>
                  <input
                    id="nl-company"
                    className={inputClass}
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Studio Rossi"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="nl-email">
                    Email
                  </label>
                  <input
                    id="nl-email"
                    type="email"
                    className={inputClass}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="mario@studio.it"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="nl-phone">
                    Telefono
                  </label>
                  <input
                    id="nl-phone"
                    className={inputClass}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+39 ..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="nl-value">
                    Valore (€)
                  </label>
                  <input
                    id="nl-value"
                    inputMode="numeric"
                    className={inputClass}
                    value={value}
                    onChange={(e) =>
                      setValue(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="5000"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="nl-source">
                    Fonte
                  </label>
                  <select
                    id="nl-source"
                    className={inputClass}
                    value={source}
                    onChange={(e) => setSource(e.target.value as LeadSource)}
                  >
                    {SOURCES.map((s) => (
                      <option key={s.value} value={s.value} className="bg-spectre-panel">
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClass} htmlFor="nl-cat">
                    Categoria
                  </label>
                  <select
                    id="nl-cat"
                    className={inputClass}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c} className="bg-spectre-panel">
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="nl-rating">
                    Rating
                  </label>
                  <input
                    id="nl-rating"
                    inputMode="decimal"
                    className={inputClass}
                    value={rating}
                    onChange={(e) => setRating(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="4.7"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="nl-reviews">
                    Recensioni
                  </label>
                  <input
                    id="nl-reviews"
                    inputMode="numeric"
                    className={inputClass}
                    value={reviews}
                    onChange={(e) => setReviews(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="312"
                  />
                </div>
              </div>

              <div>
                <label className={labelClass} htmlFor="nl-address">
                  Indirizzo
                </label>
                <input
                  id="nl-address"
                  className={inputClass}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Via Roma 1, Bari"
                  list="nl-cities"
                />
                <datalist id="nl-cities">
                  {PUGLIA_CITIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className={labelClass} htmlFor="nl-status">
                  Stato pipeline
                </label>
                <select
                  id="nl-status"
                  className={inputClass}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as LeadStatus)}
                >
                  {PIPELINE_ORDER.map((s) => (
                    <option key={s} value={s} className="bg-spectre-panel">
                      {LEAD_STATUS[s].label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass} htmlFor="nl-action">
                  Prossima azione
                </label>
                <input
                  id="nl-action"
                  className={inputClass}
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                  placeholder="Chiamata di follow-up"
                />
              </div>

              {error && (
                <p className="font-mono text-[11px] text-spectre-magenta">
                  {error}
                </p>
              )}

              <div className="mt-2 flex justify-end gap-2">
                <NeonButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={close}
                  disabled={submitting}
                >
                  Annulla
                </NeonButton>
                <NeonButton
                  type="submit"
                  variant="cyan"
                  filled
                  size="sm"
                  disabled={submitting}
                >
                  {submitting ? "Creazione…" : "Crea lead"}
                </NeonButton>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
