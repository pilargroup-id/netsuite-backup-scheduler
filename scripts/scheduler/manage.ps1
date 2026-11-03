# Windows PowerShell 5.1. Only manages repetition intervals of 4 existing tasks.
# Does not stop, disable, start, reschedule start boundaries, or run any backup.
[CmdletBinding()]
param(
    [ValidateSet('Status','Preview','Apply')]
    [string]$Mode = 'Preview'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$configPath = Join-Path $root 'config\scheduler.json'
$names = [ordered]@{
    v3 = 'NetSuite Backup V3'
    fastDelta = 'NetSuite Backup Fast Delta'
    freshnessMonitor = 'NetSuite Backup Freshness Monitor'
    watchdog = 'NetSuite Backup Watchdog'
}
function Fail([string]$Reason) { throw "ABORT (no scheduler modification intended): $Reason" }
function Read-TaskData {
    param([string]$Key, [string]$TaskName, [int]$Desired)
    $task = Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
    if (@($task.Triggers).Count -ne 1) { Fail "Expected one trigger: $TaskName" }
    $trigger = @($task.Triggers)[0]
    if ($null -eq $trigger.Repetition) { Fail "No repetition: $TaskName" }
    $actual = [string]$trigger.Repetition.Interval
    if ($actual -notmatch '^PT([1-9][0-9]*)M$') { Fail "Unrecognized interval '$actual' in $TaskName" }
    $kind = [string]$trigger.CimClass.CimClassName
    $expectedKind = if ($Key -in @('v3','watchdog')) { 'MSFT_TaskDailyTrigger' } else { 'MSFT_TaskTimeTrigger' }
    if ($kind -ne $expectedKind) { Fail "Unexpected trigger type $kind in $TaskName" }
    if ($task.Settings.Enabled -ne $true -or $trigger.Enabled -ne $true) { Fail "Disabled task/trigger: $TaskName" }
    [PSCustomObject]@{
        Key = $Key; Name = $TaskName; State = [string]$task.State
        CurrentMinutes = [int]$Matches[1]; DesiredMinutes = $Desired
        TriggerType = $kind; StartBoundary = [string]$trigger.StartBoundary
        Task = $task
    }
}
try {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { Fail "Config missing: $configPath" }
    $cfg = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfg.timezone -ne 'Asia/Jakarta' -or $cfg.mode -ne 'production') { Fail 'Unexpected production mode / timezone' }
    if ($null -eq $cfg.windowsTasks) { Fail 'windowsTasks section missing' }
    $entries = @()
    foreach ($key in $names.Keys) {
        $property = $cfg.windowsTasks.PSObject.Properties[$key]
        if ($null -eq $property -or $null -eq $property.Value.intervalMinutes) { Fail "Missing windowsTasks.$key.intervalMinutes" }
        $desiredText = [string]$property.Value.intervalMinutes
        if ($desiredText -notmatch '^([1-9][0-9]*)$') { Fail "Invalid interval for $key" }
        $desired = [int]$desiredText
        if ($desired -notin @(5,10,15,20,30,60)) { Fail "Unsupported interval for ${key}: $desired" }
        if ($key -eq 'v3' -and $desired -ne 10) { Fail 'V3 Windows trigger must remain 10m (frozen internal slot semantics)' }
        $entries += Read-TaskData -Key $key -TaskName $names[$key] -Desired $desired
    }
    $entries | Select-Object Name,State,CurrentMinutes,DesiredMinutes,TriggerType,StartBoundary | Format-Table -AutoSize
    if ($Mode -eq 'Status' -or $Mode -eq 'Preview') {
        Write-Host 'READ ONLY: no Task Scheduler modifications.'
        exit 0
    }
    # Require ALL four tasks Ready before modifying even one, never stop tasks.
    foreach ($entry in $entries) {
        $latest = Get-ScheduledTask -TaskName $entry.Name -TaskPath '\' -ErrorAction Stop
        if ([string]$latest.State -ne 'Ready') { Fail "Task is not Ready: $($entry.Name) ($($latest.State))" }
    }
    $changes = @($entries | Where-Object { $_.CurrentMinutes -ne $_.DesiredMinutes })
    if ($changes.Count -eq 0) {
        Write-Host 'NO-OP: all intervals already match configuration. No task changed.'
        exit 0
    }
    # Snapshot ALL task definitions before any mutation, no automatic rollback.
    $backupDir = Join-Path $root ('scheduler-task-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -Path $backupDir -ItemType Directory -Force | Out-Null
    foreach ($entry in $entries) {
        $xml = Export-ScheduledTask -TaskName $entry.Name -TaskPath '\' -ErrorAction Stop
        $safe = $entry.Key + '.xml'
        [System.IO.File]::WriteAllText((Join-Path $backupDir $safe), $xml, (New-Object System.Text.UTF8Encoding($false)))
    }
    Write-Host "Task XML backups: $backupDir"
    # Repeat readiness gate IMMEDIATELY before first mutation.
    foreach ($entry in $entries) {
        if ([string](Get-ScheduledTask -TaskName $entry.Name -TaskPath '\').State -ne 'Ready') {
            Fail "Task changed state before apply: $($entry.Name)"
        }
    }
    foreach ($entry in $changes) {
        # Never intervene in a Running task, including if it started since first gate.
        $fresh = Get-ScheduledTask -TaskName $entry.Name -TaskPath '\' -ErrorAction Stop
        if ([string]$fresh.State -ne 'Ready') { Fail "Task started during apply: $($entry.Name); prior changes (if any) need review" }
        $triggers = @($fresh.Triggers)
        if ($triggers.Count -ne 1 -or [string]$triggers[0].Repetition.Interval -ne ('PT' + $entry.CurrentMinutes + 'M')) {
            Fail "Trigger changed since preview: $($entry.Name)"
        }
        # Preserve original trigger kind, start boundary, duration and other task attributes.
        $triggers[0].Repetition.Interval = 'PT' + $entry.DesiredMinutes + 'M'
        Set-ScheduledTask -TaskName $entry.Name -TaskPath '\' -Trigger $triggers -ErrorAction Stop | Out-Null
        $confirmed = Get-ScheduledTask -TaskName $entry.Name -TaskPath '\' -ErrorAction Stop
        if ([string]$confirmed.Triggers[0].Repetition.Interval -ne ('PT' + $entry.DesiredMinutes + 'M')) {
            Fail "Verification failed for $($entry.Name). Inspect XML backup: $backupDir"
        }
        Write-Host "APPLIED $($entry.Name): $($entry.CurrentMinutes)m -> $($entry.DesiredMinutes)m"
    }
    Write-Host 'APPLY COMPLETED. Verify task states and next-run times separately.'
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
