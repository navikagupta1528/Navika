# Starts the dedicated Navika PostgreSQL cluster.
#
#   npm run db:start
#
# Why this exists: the cluster lives at C:\navika-pg on port 5433, separate from
# the PostgreSQL 17 Windows service on 5432 that belongs to ZyniVerse. It is a
# plain process rather than a service, so after a reboot you must start it once
# before the app will connect.
#
# Run it as Administrator to register it as a Windows service and skip this
# entirely (one time only):
#
#   & "$env:ProgramFiles\PostgreSQL\17\bin\pg_ctl.exe" register -N "NavikaPG" `
#       -D "C:\navika-pg" -S auto
param(
    [int]$Port = 5433
)

$ErrorActionPreference = 'Stop'

$pgBin = Join-Path $env:ProgramFiles 'PostgreSQL\17\bin'
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$dataDir = 'C:\navika-pg'
$logFile = Join-Path $dataDir 'server.log'

if (-not (Test-Path $pgCtl)) {
    throw "pg_ctl.exe not found at $pgCtl. Is PostgreSQL 17 installed?"
}
if (-not (Test-Path $dataDir)) {
    throw "Data directory $dataDir does not exist. Run scripts/setup-db.ps1 first."
}

# Already up? Check with a real connection rather than the PID file, because a
# stale postmaster.pid survives an unclean shutdown and would be misleading.
$isUp = $false
try {
    $conn = [System.Net.Sockets.TcpClient]::new()
    $task = $conn.ConnectAsync('127.0.0.1', $Port)
    if ($task.Wait(1500) -and $conn.Connected) { $isUp = $true }
    $conn.Dispose()
} catch {
    $isUp = $false
}

if ($isUp) {
    Write-Host "Navika database already listening on port $Port." -ForegroundColor Green
    exit 0
}

Write-Host "Starting Navika database on port $Port…"
& $pgCtl -D $dataDir -l $logFile -w -t 30 start | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "Server failed to start. Last 20 log lines:" -ForegroundColor Red
    if (Test-Path $logFile) { Get-Content $logFile -Tail 20 }
    exit 1
}

Write-Host "Navika database is up on port $Port." -ForegroundColor Green
Write-Host "  data dir : $dataDir"
Write-Host "  log file : $logFile"
