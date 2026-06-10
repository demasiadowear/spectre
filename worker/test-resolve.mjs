// One-off: test risoluzione destinatari (getNumberId, LID-aware).
// NESSUN invio: solo lookup. Usa la stessa sessione LocalAuth del
// worker (worker fermo prima di lanciarlo).
import "dotenv/config";
import pkg from "whatsapp-web.js";

const { Client, LocalAuth } = pkg;

const TESTS = [
  { label: "PUCCIO (noto, mobile)", digits: "393492301150" },
  { label: "Centro Degradé (consegnato stamattina)", digits: "393339587292" },
  { label: "Hairmony (mobile, in coda)", digits: "393280967379" },
  { label: "Rosa Lopedota (FISSO, atteso null)", digits: "390804116644" },
];

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: process.env.WA_SESSION_DIR ?? "./.wwebjs_auth",
  }),
  puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

client.on("qr", () => {
  console.error("ERRORE: sessione non valida, servirebbe il QR. Abort.");
  process.exit(1);
});

client.on("ready", async () => {
  console.log("sessione pronta, test getNumberId (zero invii):");
  for (const t of TESTS) {
    try {
      const id = await client.getNumberId(t.digits);
      console.log(`  ${t.label}: ${id?._serialized ?? "NULL (non su WhatsApp)"}`);
    } catch (err) {
      console.log(`  ${t.label}: ERRORE ${err.message}`);
    }
  }
  await client.destroy();
  process.exit(0);
});

client.initialize();
