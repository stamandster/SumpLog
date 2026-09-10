# Run once after cloning: powershell -File .\scripts\install-git-hooks.ps1
# Hooks reject private artifacts even when added with git add --force.
# They supplement manual review; they cannot identify every possible secret.
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
try {
    $existing = git config --local --get core.hooksPath
    if ($existing -and $existing -ne '.githooks') {
        throw "Existing hooks path '$existing' was not changed. Integrate the privacy checks with those hooks manually."
    }
    git config --local core.hooksPath .githooks
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure Git privacy hooks.' }
    Write-Host 'Privacy checks enabled for commits and pushes. Bun must be available on PATH.'
} finally { Pop-Location }
