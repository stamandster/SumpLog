#Requires -Version 5.1
<#
.SYNOPSIS
Build and run SumpLog in the background with LAN access.
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1 -OpenBrowser
.EXAMPLE
# Stop a background instance that bootstrap.ps1 started on the default port.
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ }
.NOTES
Requires Bun. Uses this script's folder, preserves saved credentials, and never seeds
or resets the garage. Normal database migrations run at server startup.
An already-running instance is reused without rebuilding or interrupting sessions.
LAN access requires an owner password and a suitable Windows firewall rule.
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000,
    [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
$sumpRoot = $PSScriptRoot
$sumpLocalUrl = "http://127.0.0.1:$Port"

function Test-SumpLog {
    param([string]$Url)
    try {
        $health = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 2
        return ($health.ok -eq $true -and $health.service -eq 'sumplog')
    } catch { return $false }
}

function Show-SumpLogLinks {
    Write-Host "Local: $sumpLocalUrl/"
    $lanUrls = @()
    $addresses = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } |
        ForEach-Object { $_.IPv4Address } | Select-Object -ExpandProperty IPAddress -Unique)
    foreach ($address in $addresses) {
        $url = "http://${address}:$Port"
        if (Test-SumpLog $url) {
            Write-Host "LAN (verified on this PC): $url/" -ForegroundColor Green
            $lanUrls += "$url/"
        } else {
            Write-Warning "LAN check failed for $url. Check the owner password, network connection, and firewall."
        }
    }
    if ($lanUrls.Count -eq 0) {
        Write-Warning 'No working LAN address found. The local address is still available. Without an owner password, SumpLog intentionally stays local-only.'
    } else {
        Write-Host 'Other devices must be on the same network. Their access also depends on the Windows firewall.'
    }
    if ($OpenBrowser) {
        $openUrl = if ($lanUrls.Count) { $lanUrls[0] } else { "$sumpLocalUrl/" }
        Start-Process -FilePath $openUrl
    }
}

function Test-SumpLogOwnerPassword {
    param([string]$DatabasePath, [string]$BunPath)
    if (-not (Test-Path -LiteralPath $DatabasePath -PathType Leaf)) { return $false }
    # Query only whether a credential exists; the password hash is never printed or read into PowerShell.
    $sumpCredentialExists = & $BunPath -e 'import { Database } from "bun:sqlite"; const database = new Database(Bun.argv[1], { readonly: true }); try { process.stdout.write(database.query("SELECT 1 AS present FROM owner_credentials WHERE id = 1").get() ? "yes" : "no"); } finally { database.close(); }' $DatabasePath 2>$null
    return $LASTEXITCODE -eq 0 -and ($sumpCredentialExists -join '').Trim() -eq 'yes'
}

function Read-SumpLogFirstPassword {
    Write-Host 'First-run setup: create the SumpLog owner password.' -ForegroundColor Yellow
    Write-Host 'Use at least 12 characters. It is stored as a password hash in your local garage database.'
    while ($true) {
        $first = Read-Host 'Owner password' -AsSecureString
        $confirm = Read-Host 'Confirm owner password' -AsSecureString
        $firstText = [System.Net.NetworkCredential]::new('', $first).Password
        $confirmText = [System.Net.NetworkCredential]::new('', $confirm).Password
        if ($firstText.Length -lt 12) { Write-Warning 'Use at least 12 characters.'; continue }
        if ($firstText -cne $confirmText) { Write-Warning 'The passwords do not match.'; continue }
        return $firstText
    }
}

if (Test-SumpLog $sumpLocalUrl) {
    Write-Host "SumpLog is already running on port $Port; reusing it."
    Show-SumpLogLinks
    return
}

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is occupied but is not responding as SumpLog. No process was stopped. Choose another port with -Port."
}

$sumpBunCommand = Get-Command bun -ErrorAction SilentlyContinue
if (-not $sumpBunCommand) {
    throw 'Bun is not installed or is missing from PATH. Install Bun, open a new PowerShell window, then run bootstrap.ps1 again.'
}
# Resolve the actual executable even when PATH points to an npm PowerShell shim.
$sumpBun = (& $sumpBunCommand.Source --print 'process.execPath' | Select-Object -Last 1).Trim()
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $sumpBun -PathType Leaf)) {
    throw 'Could not locate the Bun executable.'
}

$sumpPreviousHost = $env:HOST
$sumpPreviousPort = $env:PORT
$sumpPreviousPassword = $env:SUMPLOG_PASSWORD
Push-Location -LiteralPath $sumpRoot
try {
    $sumpConfiguredDatabase = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { Join-Path $sumpRoot 'data\sumplog.db' }
    if (-not [System.IO.Path]::IsPathRooted($sumpConfiguredDatabase)) { $sumpConfiguredDatabase = Join-Path $sumpRoot $sumpConfiguredDatabase }
    $sumpHasSavedPassword = Test-SumpLogOwnerPassword -DatabasePath $sumpConfiguredDatabase -BunPath $sumpBun
    if (-not $sumpHasSavedPassword -and [string]::IsNullOrWhiteSpace($env:SUMPLOG_PASSWORD)) {
        $env:SUMPLOG_PASSWORD = Read-SumpLogFirstPassword
    }
    if (-not $sumpHasSavedPassword -and $env:SUMPLOG_PASSWORD.Trim().Length -lt 12) {
        throw 'First-run owner passwords must contain at least 12 characters.'
    }
    Write-Host 'Checking dependencies...'
    & $sumpBun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Server was not started.' }
    Write-Host 'Building SumpLog...'
    & $sumpBun run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. Server was not started.' }

    $sumpLogDirectory = Join-Path $sumpRoot 'data\logs'
    New-Item -ItemType Directory -Path $sumpLogDirectory -Force | Out-Null
    $sumpRunId = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    $sumpOutputLog = Join-Path $sumpLogDirectory "server-$sumpRunId.log"
    $sumpErrorLog = Join-Path $sumpLogDirectory "server-$sumpRunId-error.log"
    $sumpEntry = Join-Path $sumpRoot 'server\index.ts'
    $env:HOST = '0.0.0.0'
    $env:PORT = [string]$Port
    $sumpServer = Start-Process -FilePath $sumpBun -ArgumentList ('"' + $sumpEntry + '"') `
        -WorkingDirectory $sumpRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $sumpOutputLog -RedirectStandardError $sumpErrorLog

    $sumpTimer = [Diagnostics.Stopwatch]::StartNew()
    $sumpReady = $false
    while ($sumpTimer.Elapsed.TotalSeconds -lt 30) {
        $sumpServer.Refresh()
        if ($sumpServer.HasExited) { break }
        if (Test-SumpLog $sumpLocalUrl) { $sumpReady = $true; break }
        Start-Sleep -Milliseconds 300
    }
    $sumpServer.Refresh()
    if (-not $sumpReady -or $sumpServer.HasExited) {
        throw "Startup failed or timed out (PID $($sumpServer.Id)). Check $sumpErrorLog and $sumpOutputLog before retrying."
    }
    Write-Host "SumpLog is running in the background (PID $($sumpServer.Id))." -ForegroundColor Green
    Write-Host "Logs: $sumpOutputLog"
    Write-Host "Errors: $sumpErrorLog"
    Write-Host "To stop this instance: Stop-Process -Id $($sumpServer.Id)"
    Show-SumpLogLinks
} finally {
    $env:HOST = $sumpPreviousHost
    $env:PORT = $sumpPreviousPort
    $env:SUMPLOG_PASSWORD = $sumpPreviousPassword
    Pop-Location
}
