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

  // rating_at_sale: baseline del RATING dagli snapshot (nessuna colonna
  // dedicata come reviews_at_sale). Regola: rating del primo snapshot
  // 'scan' oppure, in mancanza, del primo snapshot <= data prima vendita.
  // Gate sul cliente venduto (reviews_at_sale not null), come reviews_delta.
  const res = await turso.execute(`
    with ras as (
      select c.id as cid,
        case when c.reviews_at_sale is not null then coalesce(
          (select sn.rating from zone_review_snapshots sn
             where sn.client_id = c.id and sn.source = 'scan' and sn.rating > 0
             order by sn.taken_at asc, sn.id asc limit 1),
          (select sn.rating from zone_review_snapshots sn
             where sn.client_id = c.id and sn.rating > 0
               and sn.taken_at <= (select min(s.sold_at) from zone_sales s where s.client_id = c.id)
             order by sn.taken_at asc, sn.id asc limit 1)
        ) end as rating_at_sale
      from zone_clients c
    )
    select c.id, c.name, c.category, c.status, c.phone, c.address, c.cap, c.zone_label,
           c.rating, c.reviews, c.reviews_at_sale,
           case when c.reviews_at_sale is not null then c.reviews - c.reviews_at_sale end as reviews_delta,
           r.rating_at_sale,
           case when r.rating_at_sale is not null then round(c.rating - r.rating_at_sale, 1) end as rating_delta,
           c.referent, c.callback_at, c.notes, c.nfc_review_url,
           c.invoice_status, c.fatt_ragione_sociale, c.fatt_piva, c.fatt_cf,
           c.fatt_indirizzo, c.fatt_cap, c.fatt_citta, c.fatt_email, c.fatt_pec,
           c.fatt_sdi, c.fatt_telefono, c.created_at, c.updated_at
    from zone_clients c join ras r on r.cid = c.id
    order by c.updated_at desc`);
  const csv = toCsv(
    [
      "id", "name", "category", "status", "phone", "address", "cap", "zone_label",
      "rating", "reviews", "reviews_at_sale", "reviews_delta",
      "rating_at_sale", "rating_delta",
      "referent", "callback_at", "notes", "nfc_review_url",
      "invoice_status", "fatt_ragione_sociale", "fatt_piva", "fatt_cf",
      "fatt_indirizzo", "fatt_cap", "fatt_citta", "fatt_email", "fatt_pec",
      "fatt_sdi", "fatt_telefono", "created_at", "updated_at",
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
