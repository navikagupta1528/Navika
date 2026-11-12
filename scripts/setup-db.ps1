# Navika - one-time database setup
#
# Creates a dedicated PostgreSQL cluster at C:\navika-pg on port 5433 and writes
# .env for you. It does not touch any existing PostgreSQL service (for example
# the one on 5432 that belongs to another project), and it needs no administrator
# rights: the cluster is a plain process owned by your user.
#
# Run it through npm:
#
#   npm run setup:db
#
# PostgreSQL binaries are looked up in this order:
#   1. $env:PG_BIN
#   2. C:\navika-pg-bin\pgsql\bin   (portable zip extracted there)
#   3. C:\Program Files\PostgreSQL\18\bin
#   4. C:\Program Files\PostgreSQL\17\bin
#   5. %USERPROFILE%\pgsql\bin
#
# Re-running is safe: an existing cluster is left alone and only .env is checked.

$ErrorActionPreference = 'Stop'

$dataDir = 'C:\navika-pg'
$port = 5433
$envPath = Join-Path $PSScriptRoot '..\.env'

# Windows PowerShell 5.1 has no RandomNumberGenerator::Fill (that is .NET Core).
function New-RandomBytes([int]$Count) {
    $bytes = New-Object byte[] $Count
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ,$bytes
}

function Find-PgBin {
    $candidates = @()
    if ($env:PG_BIN) { $candidates += $env:PG_BIN }
    $candidates += 'C:\navika-pg-bin\pgsql\bin'
    $candidates += (Join-Path $env:ProgramFiles 'PostgreSQL\18\bin')
    $candidates += (Join-Path $env:ProgramFiles 'PostgreSQL\17\bin')
    $candidates += (Join-Path $env:USERPROFILE 'pgsql\bin')

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path (Join-Path $candidate 'initdb.exe'))) {
            return $candidate
        }
    }
    throw @"
PostgreSQL binaries were not found.

Install PostgreSQL 17/18, or download the portable Windows binaries and extract
them so that this exists:

  C:\navika-pg-bin\pgsql\bin\initdb.exe

  https://www.enterprisedb.com/download-postgresql-binaries

Or set PG_BIN to an existing bin directory and run this script again.
"@
}

$pgBin = Find-PgBin
Write-Host "Using PostgreSQL binaries: $pgBin" -ForegroundColor DarkGray

# ---------------------------------------------------------------- cluster
if (-not (Test-Path $dataDir)) {
    Write-Host "`n[1/3] Initialising cluster at $dataDir ..." -ForegroundColor Cyan

    $bytes = New-RandomBytes 24
    $appPassword = [Convert]::ToBase64String($bytes).Replace('+', 'a').Replace('/', 'b').Replace('=', '')

    $pwFile = Join-Path $env:TEMP "navika-pg-pw-$([guid]::NewGuid().ToString('N')).txt"
    Set-Content -Path $pwFile -Value $appPassword -NoNewline -Encoding ascii

    try {
        & (Join-Path $pgBin 'initdb.exe') `
            -D $dataDir `
            -U busguard `
            "--pwfile=$pwFile" `
            -E UTF8 `
            --locale=C `
            --auth-local=trust `
            --auth-host=scram-sha-256 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "initdb failed with exit code $LASTEXITCODE." }
    } finally {
        Remove-Item $pwFile -ErrorAction SilentlyContinue
    }

    # Keep this cluster off 5432. Appended rather than edited so a future
    # PostgreSQL release that changes the default file layout still works.
    Add-Content -Path (Join-Path $dataDir 'postgresql.conf') -Value "`n# Navika`nport = $port" -Encoding ascii

    Write-Host "  cluster created (port $port)" -ForegroundColor Green
} else {
    Write-Host "`n[1/3] Cluster already exists at $dataDir - leaving it alone." -ForegroundColor Yellow

    if (Test-Path $envPath) {
        Write-Host "  .env already exists too. Nothing to do." -ForegroundColor Green
        Write-Host "  Start it with: npm run db:start" -ForegroundColor White
        exit 0
    }

    throw @"
The cluster exists but .env does not, so its password is unknown.

Either restore the .env that belongs to this cluster, or remove the cluster and
run this script again:

  Remove-Item -Recurse -Force '$dataDir'
"@
}

# ---------------------------------------------------------------- start
Write-Host "`n[2/3] Starting the cluster ..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'start-db.ps1') -Port $port -PgBin $pgBin

# ---------------------------------------------------------------- database
Write-Host "`n[3/3] Creating database 'busguard' and writing .env ..." -ForegroundColor Cyan

$env:NAVIKA_ADMIN_DATABASE_URL = "postgresql://busguard:$appPassword@127.0.0.1:$port/postgres"
$env:NAVIKA_DATABASE_NAME = 'busguard'
try {
    Push-Location (Join-Path $PSScriptRoot '..')
    node (Join-Path $PSScriptRoot 'create-database.mjs')
    if ($LASTEXITCODE -ne 0) { throw "Could not create the 'busguard' database." }
} finally {
    Pop-Location
    Remove-Item Env:\NAVIKA_ADMIN_DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\NAVIKA_DATABASE_NAME -ErrorAction SilentlyContinue
}

$secretBytes = New-RandomBytes 32
$authSecret = [Convert]::ToBase64String($secretBytes)
$escaped = $appPassword.Replace('\', '\\').Replace('"', '\"')

$envContent = @"
# Navika - local development
# Generated by scripts/setup-db.ps1
DATABASE_URL="postgresql://busguard:$escaped@127.0.0.1:$port/busguard?schema=public"

# 32+ byte random string. Generated for you; keep it out of version control.
AUTH_SECRET="$authSecret"

# ZyniVerse already uses 3000, so Navika runs on 3010.
PORT=3010
NEXT_PUBLIC_APP_URL="http://localhost:3010"

# OSRM public demo server for road-accurate ETA. No API key required.
OSRM_URL="https://router.project-osrm.org"
"@
Set-Content -Path $envPath -Value $envContent -Encoding ascii
Write-Host "  .env written" -ForegroundColor Green

Write-Host "`nDone. Next steps:" -ForegroundColor Cyan
Write-Host "  1. npm run db:migrate" -ForegroundColor White
Write-Host "  2. npm run db:seed" -ForegroundColor White
Write-Host "  3. npm run dev" -ForegroundColor White
Write-Host ""
