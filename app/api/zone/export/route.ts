import { turso } from "@/lib/turso";
import { ensureZoneSchema } from "@/lib/zone/db";

// GET /api/zone/export?what=clients|sales — CSV per conti/backup
// (dietro JWT). Separatore ';' e BOM: si apre dritto in Excel IT.
export const dynamic = "force-dynamic";

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.join(";")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(";"));
  return "﻿" + lines.join("\n");
}

export async function GET(req: Request) {
  if (!turso) {
    return new Response("Turso non configurato.", { status: 500 });
  }
  await ensureZoneSchema();
  const what = new URL(req.url).searchParams.get("what") ?? "clients";

  if (what === "sales") {
    const res = await turso.execute(`
      select s.sold_at, c.name, s.product_name, s.qty, s.price, c.cap,
             c.zone_label, s.notes, s.client_id
      from zone_sales s join zone_clients c on c.id = s.client_id
      order by s.sold_at desc`);
    const csv = toCsv(
      ["sold_at", "name", "product_name", "qty", "price", "cap", "zone_label", "notes", "client_id"],
      res.rows as Record<string, unknown>[],
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": 'attachment; filename="zone-vendite.csv"',
      },
    });
  }

  const res = await turso.execute(`
    select id, name, category, status, phone, address, cap, zone_label,
           rating, reviews, referent, callback_at, notes, nfc_review_url,
           created_at, updated_at
    from zone_clients order by updated_at desc`);
  const csv = toCsv(
    [
      "id", "name", "category", "status", "phone", "address", "cap", "zone_label",
      "rating", "reviews", "referent", "callback_at", "notes", "nfc_review_url",
      "created_at", "updated_at",
    ],
    res.rows as Record<string, unknown>[],
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": 'attachment; filename="zone-clienti.csv"',
    },
  });
}
