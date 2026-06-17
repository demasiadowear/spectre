#!/usr/bin/env bash
# ============================================================
# SPECTRE worker — provisioning VPS (Ubuntu 24.04 LTS).
# Installa Node 20, le librerie di sistema per il Chromium di
# whatsapp-web.js, e pm2. NON tocca il codice: il worker va caricato
# in /opt/spectre/worker (vedi README-VPS.md).
#
#   sudo bash setup-vps.sh
# ============================================================
set -euo pipefail

echo "==> [1/4] Aggiornamento sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo "==> [2/4] Node.js 20 (NodeSource)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> [3/4] Librerie di sistema per Chromium headless (Puppeteer)"
# Set verificato per Ubuntu 24.04 (nomi pacchetti aggiornati: libasound2t64).
apt-get install -y \
  ca-certificates fonts-liberation fonts-noto-color-emoji \
  libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 \
  libdbus-1-3 libdrm2 libexpat1 libgbm1 libglib2.0-0 libgtk-3-0 \
  libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
  libxshmfence1 wget xdg-utils

echo "==> [4/4] pm2 (process manager 24/7)"
npm install -g pm2
pm2 -v

mkdir -p /opt/spectre
echo
echo "==> FATTO. Ora carica il worker in /opt/spectre/worker e segui README-VPS.md"
