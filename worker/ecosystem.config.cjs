// ============================================================
// SPECTRE worker — config pm2 per il VPS (process manager 24/7).
// pm2 riavvia il worker su crash E quando il nostro health-probe WA
// fa uscire il processo (sessione zombie). + avvio automatico al boot
// via `pm2 startup` + `pm2 save`.
//
//   pm2 start ecosystem.config.cjs
//   pm2 logs spectre-worker      # leggi il QR al primo avvio
//   pm2 save && pm2 startup
// ============================================================
module.exports = {
  apps: [
    {
      name: "spectre-worker",
      script: "index.mjs",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 50,
      // Allineato al watchdog locale: pausa prima del riavvio, evita
      // loop stretti se WhatsApp è giù per un disservizio Meta.
      restart_delay: 15000,
      // Chromium headless può gonfiarsi: oltre 1.5G (su 4G di RAM) è
      // una perdita -> restart pulito. Lo zombie da frame staccato lo
      // gestisce invece il probe getState() dentro index.mjs.
      max_memory_restart: "1500M",
      env: {
        NODE_ENV: "production",
      },
      time: true,
    },
  ],
};
