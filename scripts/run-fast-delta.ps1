$ErrorActionPreference = "Stop"

Set-Location "C:\netsuite-backup"

$logDir = "C:\netsuite-backup\logs\fast-delta"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logFile = Join-Path $logDir "run-$timestamp.log"

try {
    "FAST DELTA START: $(Get-Date -Format o)" |
        Out-File $logFile -Encoding utf8

    $env:NETSUITE_PO_ENABLED = "1"
    $env:NETSUITE_PI_ENABLED = "1"
    & node "C:\netsuite-backup\scripts\fast-delta.mjs" --sync 2>&1 |
        Out-File $logFile -Append -Encoding utf8

    $code = $LASTEXITCODE

    "FAST DELTA EXIT CODE: $code" |
        Out-File $logFile -Append -Encoding utf8

    exit $code
}
catch {
    "FAST DELTA ERROR: $($_.Exception.Message)" |
        Out-File $logFile -Append -Encoding utf8

    exit 1
}
