# ============================================================
# SPECTRE worker watchdog — avvia il worker WA e lo RIAVVIA da solo
# se crasha o viene chiuso. Fix del bug "approvati fermi in coda":
# il worker era morto da giorni e nessuno se n'era accorto.
#
#   .\start-worker.ps1            # foreground con auto-restart
#
# Per l'avvio automatico al boot (consigliato), una volta sola:
#   schtasks /Create /TN "SPECTRE Worker" /SC ONLOGON /RL LIMITED `
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File '$PSScriptRoot\start-worker.ps1'"
# ============================================================
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

$restartDelaySec = 15
$logFile = Join-Path $PSScriptRoot "worker-run.log"

while ($true) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $logFile -Value "[$stamp] [watchdog] avvio worker..." -Encoding utf8
    Write-Host "[$stamp] [watchdog] avvio worker..."

    # npm start in foreground: il watchdog riprende il controllo solo
    # quando il processo muore (crash, kill, riavvio sessione WA).
    & npm start 2>&1 | Tee-Object -FilePath $logFile -Append

    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $logFile -Value "[$stamp] [watchdog] worker terminato (exit $LASTEXITCODE). Riavvio tra $restartDelaySec s." -Encoding utf8
    Write-Host "[$stamp] [watchdog] worker terminato (exit $LASTEXITCODE). Riavvio tra $restartDelaySec s." -ForegroundColor Yellow
    Start-Sleep -Seconds $restartDelaySec
}
