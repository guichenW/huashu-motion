[CmdletBinding()]
param([switch]$Push)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
function Git-Checked {
    & git @args
    if ($LASTEXITCODE -ne 0) { throw "Git operation failed: $($args -join ' ')" }
}
Push-Location $repoRoot
try {
    Git-Checked config core.ignorestat false
    $branch = & git branch --show-current
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'codex/narration-sync') { throw 'Switch to codex/narration-sync first.' }
    $dirty = & git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit or preserve your local changes before merging upstream.' }
    Git-Checked fetch upstream --prune --tags
    Git-Checked merge --no-ff --no-edit upstream/main
    & (Join-Path $PSScriptRoot 'test-narration.ps1')
    if ($Push) { Git-Checked push origin HEAD:refs/heads/codex/narration-sync }
    Write-Output 'Upstream merged and validated.'
    if (-not $Push) { Write-Output 'Not pushed. Review the result, then git push origin codex/narration-sync.' }
} finally { Pop-Location }
