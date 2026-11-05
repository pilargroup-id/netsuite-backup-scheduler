# Windows PowerShell 5.1. Register four task definitions on a NEW device only.
# No start, enable, stop, or changes to existing task registrations.
[CmdletBinding()]
param(
  [ValidateSet('PreviewRegister','Register')][string]$Mode='PreviewRegister',
  [string]$ProjectRoot='',
  [string]$NodeExe='',
  [Parameter(Mandatory=$true)][string]$Account,
  [switch]$TargetDeviceConfirmed
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Fail([string]$Why) { throw "ABORT: $Why" }
$nsUri='http://schemas.microsoft.com/windows/2004/02/mit/task'
function XmlNode([xml]$Document,[string]$XPath) {
  $manager=New-Object System.Xml.XmlNamespaceManager($Document.NameTable)
  $manager.AddNamespace('t',$nsUri)
  $node=$Document.SelectSingleNode($XPath,$manager)
  if ($null -eq $node) { Fail "XML element missing: $XPath" }
  return $node
}
function SetXml([xml]$Document,[string]$XPath,[string]$Value) {
  (XmlNode $Document $XPath).InnerText=$Value
}
function AddDisabledSetting([xml]$Document) {
  $settings=XmlNode $Document '/t:Task/t:Settings'
  $manager=New-Object System.Xml.XmlNamespaceManager($Document.NameTable)
  $manager.AddNamespace('t',$nsUri)
  $enabled=$settings.SelectSingleNode('t:Enabled',$manager)
  if ($null -eq $enabled) {
    $enabled=$Document.CreateElement('Enabled',$nsUri)
    [void]$settings.AppendChild($enabled)
  }
  $enabled.InnerText='false'
}
try {
  if (-not $ProjectRoot) { $ProjectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
  if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) { Fail 'ProjectRoot does not exist' }
  $ProjectRoot=(Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd('\')
  if (-not $NodeExe) { $NodeExe=(Join-Path $env:ProgramFiles 'nodejs\node.exe') }
  if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { Fail "Node.exe not found: $NodeExe" }
  $NodeExe=(Resolve-Path -LiteralPath $NodeExe).Path
  if ($Account -notmatch '^[^\\]+\\[^\\]+$' -and $Account -notmatch '^[^@\s]+@[^@\s]+$') { Fail 'Account must be DOMAIN\User, COMPUTER\User, or user@domain' }
  $cfgPath=Join-Path $ProjectRoot 'config\scheduler.json'
  if (-not (Test-Path -LiteralPath $cfgPath -PathType Leaf)) { Fail 'Missing config\scheduler.json' }
  $cfg=Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($cfg.mode -ne 'production' -or $cfg.timezone -ne 'Asia/Jakarta' -or $null -eq $cfg.windowsTasks) { Fail 'Unexpected scheduler configuration' }
  $specs=@(
    [pscustomobject]@{Key='v3';Name='NetSuite Backup V3';File='v3.xml';Script='scheduler-runner.mjs';Kind='CalendarTrigger';Login='Password'},
    [pscustomobject]@{Key='fastDelta';Name='NetSuite Backup Fast Delta';File='fastDelta.xml';Script='run-fast-delta-hidden.vbs';Kind='TimeTrigger';Login='InteractiveToken'},
    [pscustomobject]@{Key='freshnessMonitor';Name='NetSuite Backup Freshness Monitor';File='freshnessMonitor.xml';Script='run-freshness-monitor.ps1';Kind='TimeTrigger';Login='Password'},
    [pscustomobject]@{Key='watchdog';Name='NetSuite Backup Watchdog';File='watchdog.xml';Script='scheduler-watchdog.mjs';Kind='CalendarTrigger';Login='Password'}
  )
  $generated=@()
  foreach($s in $specs) {
    if ($null -eq $cfg.windowsTasks.PSObject.Properties[$s.Key]) { Fail "Missing config for $($s.Key)" }
    $value=$cfg.windowsTasks.($s.Key).intervalMinutes
    if ([string]$value -notmatch '^(5|10|15|20|30|60)$') { Fail "Unsupported interval for $($s.Key)" }
    $minutes=[int]$value
    if ($s.Key -eq 'v3' -and $minutes -ne 10) { Fail 'V3 trigger must remain 10 minutes' }
    $template=Join-Path $PSScriptRoot ('templates\'+$s.File)
    if (-not (Test-Path -LiteralPath $template -PathType Leaf)) { Fail "Template missing: $($s.File)" }
    [xml]$doc=Get-Content -LiteralPath $template -Raw -Encoding UTF8
    $originalName=(XmlNode $doc '/t:Task/t:RegistrationInfo/t:URI').InnerText
    if ($originalName -ne ('\'+$s.Name)) { Fail "Task name mismatch for $($s.Key)" }
    $trigger=XmlNode $doc ('/t:Task/t:Triggers/t:'+$s.Kind)
    $allTriggers=XmlNode $doc '/t:Task/t:Triggers'
    if ($allTriggers.ChildNodes.Count -ne 1) { Fail "Unexpected number of triggers: $($s.Key)" }
    $login=(XmlNode $doc '/t:Task/t:Principals/t:Principal/t:LogonType').InnerText
    if ($login -ne $s.Login) { Fail "Logon type mismatch: $($s.Key)" }
    $exec=XmlNode $doc '/t:Task/t:Actions/t:Exec'
    $command=XmlNode $doc '/t:Task/t:Actions/t:Exec/t:Command'
    $args=XmlNode $doc '/t:Task/t:Actions/t:Exec/t:Arguments'
    $wd=XmlNode $doc '/t:Task/t:Actions/t:Exec/t:WorkingDirectory'
    if ($wd.InnerText -ne 'C:\netsuite-backup') { Fail "Template root unexpectedly changed: $($s.Key)" }
    $expected=Join-Path $ProjectRoot ('scripts\'+$s.Script)
    if (-not (Test-Path -LiteralPath $expected -PathType Leaf)) { Fail "Missing target script: $expected" }
    $oldPath='C:\netsuite-backup\scripts\'+$s.Script
    if (-not $args.InnerText.Contains($oldPath)) { Fail "Unexpected arguments in $($s.Key)" }
    $args.InnerText=$args.InnerText.Replace($oldPath,$expected)
    $wd.InnerText=$ProjectRoot
    if ($s.Key -in @('v3','watchdog')) {
      if ($command.InnerText -ne 'C:\nvm4w\nodejs\node.exe') { Fail "Unexpected node.exe in $($s.Key)" }
      $command.InnerText=$NodeExe
    } elseif ($s.Key -eq 'fastDelta') {
      if ($command.InnerText -ne 'wscript.exe') { Fail 'Unexpected Fast Delta command' }
    } else {
      if ($command.InnerText -ne 'powershell.exe') { Fail 'Unexpected Freshness command' }
    }
    # Device-specific registration: interactive account, no Windows password required.
    # Preserve original template LogonType validation above; override only in-memory XML.
    SetXml $doc '/t:Task/t:Principals/t:Principal/t:LogonType' 'InteractiveToken'
    SetXml $doc '/t:Task/t:Principals/t:Principal/t:UserId' $Account
    SetXml $doc '/t:Task/t:RegistrationInfo/t:Author' $Account
    SetXml $doc ('/t:Task/t:Triggers/t:'+$s.Kind+'/t:Repetition/t:Interval') ('PT'+$minutes+'M')
    AddDisabledSetting $doc
    # Keeping the original StartBoundary, trigger kind, duration and settings.
    $xmlText=$doc.OuterXml
    $generated+= [pscustomobject]@{Key=$s.Key;Name=$s.Name;Interval=$minutes;LogonType='InteractiveToken';Xml=$xmlText;Path=$expected}
  }
  # Fail closed if any named task already exists; do not overwrite or touch production.
  foreach($s in $specs) {
    $existing=Get-ScheduledTask -TaskPath '\' -TaskName $s.Name -ErrorAction SilentlyContinue
    if ($null -ne $existing) { Fail "Existing task found: $($s.Name). Never overwrite." }
  }
  $generated | Select-Object Name,Interval,LogonType,@{Name='InitialState';Expression={'Disabled'}},Path | Format-Table -AutoSize
  if ($Mode -eq 'PreviewRegister') { Write-Host 'PREVIEW ONLY: nothing registered, enabled, or started.';exit 0 }
  if (-not $TargetDeviceConfirmed) { Fail 'Register requires -TargetDeviceConfirmed. Verify this is the NEW device, not current production.' }
  $admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { Fail 'Run in an elevated Windows PowerShell session using the same target account' }
  # Account must match the logged-in user. InteractiveToken cannot run without a session.
  $loggedIn=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  if ($loggedIn -ine $Account) { Fail "InteractiveToken requires running as the target user. Current: $loggedIn; target: $Account" }
  foreach($task in $generated) {
    if ($null -ne (Get-ScheduledTask -TaskPath '\' -TaskName $task.Name -ErrorAction SilentlyContinue)) { Fail "Existing task appeared: $($task.Name)" }
    # XML contains InteractiveToken and Disabled; no password supplied.
    Register-ScheduledTask -TaskName $task.Name -TaskPath '\' -Xml $task.Xml -ErrorAction Stop | Out-Null
    $registered=Get-ScheduledTask -TaskPath '\' -TaskName $task.Name -ErrorAction Stop
    if ($registered.Settings.Enabled -ne $false -or
        [string]$registered.State -ne 'Disabled' -or
        ([string]$registered.Principal.LogonType -notin @('Interactive','InteractiveToken')) -or
        [string]$registered.Triggers[0].Repetition.Interval -ne ('PT'+$task.Interval+'M')) {
      Fail "Post-registration verification failed: $($task.Name). DO NOT enable; inspect manually."
    }
    Write-Host "REGISTERED DISABLED: $($task.Name)"
  }
  Write-Host 'REGISTER COMPLETED: all tasks DISABLED, none started. Activation/migration requires separate approval.'
} catch {
  Write-Error $_.Exception.Message
  Write-Host 'If registration was partial, leave registered tasks disabled and inspect manually; do not rerun blindly.'
  exit 1
}
