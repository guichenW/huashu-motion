[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    & node --import ./test/setup.mjs --test --test-concurrency=2 'test/*.test.js'
    if ($LASTEXITCODE -ne 0) { throw 'Upstream test suite failed.' }
    & node skills/huashu-motion/scripts/narration.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Narration integration test failed.' }
} finally { Pop-Location }
