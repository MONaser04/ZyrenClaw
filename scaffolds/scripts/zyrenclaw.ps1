#!/usr/bin/env pwsh
<#
.SYNOPSIS
  ŽyrenClaw Native PowerShell CLI & Gateway Wrapper.
.DESCRIPTION
  Provides native PowerShell entry points for ŽyrenClaw, seamlessly delegating
  gateway health checks and argument forwarding to the OpenClaw runtime.
#>

$basedir = Split-Path $MyInvocation.MyCommand.Definition -Parent
$openclawHome = if ($env:OPENCLAW_HOME) { $env:OPENCLAW_HOME } else { Join-Path $HOME ".openclaw" }

$nodeExe = "node.exe"
if (Test-Path "$basedir/node.exe") {
  $nodeExe = "$basedir/node.exe"
}

if ($args.Count -eq 1 -and $args[0] -ieq "gateway") {
  $ensureScript = Join-Path $openclawHome "ensure-gateway.js"
  if (Test-Path $ensureScript) {
    & $nodeExe $ensureScript
  } else {
    & $nodeExe "$basedir/node_modules/openclaw/openclaw.mjs" gateway
  }
  exit $LASTEXITCODE
}

if ($MyInvocation.ExpectingInput) {
  $input | & $nodeExe "$basedir/node_modules/openclaw/openclaw.mjs" $args
} else {
  & $nodeExe "$basedir/node_modules/openclaw/openclaw.mjs" $args
}
exit $LASTEXITCODE
