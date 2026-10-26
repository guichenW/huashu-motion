[CmdletBinding()]
param([string]$CodexRoot = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }))
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceSkill = Join-Path $repoRoot 'skills\huashu-motion'
$codexPath = [IO.Path]::GetFullPath($CodexRoot)
$skillPath = Join-Path $codexPath 'skills\huashu-motion'
function Assert-Child([string]$Path, [string]$Parent) {
    $full = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Path outside intended directory: $full" }
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceSkill 'SKILL.md'))) { throw 'Run the installer from a complete fork checkout.' }
Assert-Child $skillPath (Join-Path $codexPath 'skills')
New-Item -ItemType Directory -Path (Split-Path -Parent $skillPath) -Force | Out-Null
if (Test-Path -LiteralPath $skillPath) {
    $existing = Get-Item -LiteralPath $skillPath -Force
    if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        $target = [IO.Path]::GetFullPath([string]@($existing.Target)[0])
        if ($target -eq [IO.Path]::GetFullPath($sourceSkill)) { Write-Output "Already linked: $skillPath"; exit 0 }
        throw "Skill points to a different checkout: $target"
    }
    $backupRoot = Join-Path $codexPath 'artifacts\huashu-motion-install-backups'
    $backup = Join-Path $backupRoot ('skill-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    Assert-Child $backup $backupRoot
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Move-Item -LiteralPath $skillPath -Destination $backup
    Write-Output "Previous skill saved: $backup"
}
New-Item -ItemType Junction -Path $skillPath -Target $sourceSkill | Out-Null
Write-Output "Codex skill linked: $skillPath -> $sourceSkill"
