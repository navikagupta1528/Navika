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
$errFile = Join-Path $dataDir 'pg_ctl.out'

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

Write-Host "Starting Navika database on port $Port ..."

# pg_ctl is launched detached, with its own output files, and not waited on.
#
# Two reasons, both learned the hard way:
#
#  1. The postmaster inherits pg_ctl's stdout and holds that handle open for
#     the life of the server. Piping it (`| Out-Null`) or using -Wait blocks
#     forever, because the pipe never sees EOF.
#
#  2. If this script's own shell is killed — a tool timeout, a closed terminal
#     — the postmaster dies with it. That leaves a half-started server whose
#     first backend fork fails with 0xC0000142, and it takes the whole cluster
#     down on every subsequent connection. Detaching means the postmaster
#     belongs to no shell and survives.
Start-Process -FilePath $pgCtl `
    -ArgumentList @('-D', $dataDir, '-l', $logFile, '-w', '-t', '30', 'start') `
    -NoNewWindow `
    -RedirectStandardOutput $errFile `
    -RedirectStandardError "$errFile.err"

# Poll the port rather than trusting the exit code, because we did not wait.
$deadline = (Get-Date).AddSeconds(35)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    try {
        $probe = [System.Net.Sockets.TcpClient]::new()
        $attempt = $probe.ConnectAsync('127.0.0.1', $Port)
        if ($attempt.Wait(1000) -and $probe.Connected) {
            $probe.Dispose()
            Write-Host "Navika database is up on port $Port." -ForegroundColor Green
            Write-Host "  data dir : $dataDir"
            Write-Host "  log file : $logFile"
            exit 0
        }
        $probe.Dispose()
    } catch {
        # not listening yet
    }
}

Write-Host "Server did not start listening on port $Port within 35s." -ForegroundColor Red
if (Test-Path "$errFile.err") { Get-Content "$errFile.err" }
if (Test-Path $logFile) {
    Write-Host "Last 20 server log lines:" -ForegroundColor Red
    Get-Content $logFile -Tail 20
}
exit 1
