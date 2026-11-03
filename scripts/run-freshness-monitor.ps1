$ErrorActionPreference = "Stop"

Set-Location "C:\netsuite-backup"

$logDir = "C:\netsuite-backup\logs\freshness"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$logFile = Join-Path $logDir "freshness.log"

try {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    $output = & node `
        "C:\netsuite-backup\scripts\fast-delta-freshness-alert.mjs" 20 2>&1

    $code = $LASTEXITCODE

    "[$timestamp] Exit=$code" |
        Out-File $logFile -Append -Encoding utf8

    $output |
        Out-File $logFile -Append -Encoding utf8

    exit $code
}
catch {
    "[$(Get-Date -Format o)] ERROR: $($_.Exception.Message)" |
        Out-File $logFile -Append -Encoding utf8

    exit 1
}