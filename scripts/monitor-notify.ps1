param([Parameter(Mandatory=$true)][string]$Message)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$secret = Join-Path $root 'config\telegram-credential.clixml'
$dest = Join-Path $root 'config\telegram-chat-id.txt'
if (!(Test-Path $secret) -or !(Test-Path $dest)) { throw 'Telegram is not configured for this Windows user. Run configure-telegram.ps1 as the scheduled-task account.' }
$credential = Import-Clixml $secret
$chat = ([System.IO.File]::ReadAllText($dest)).Trim()
if (!$chat) { throw 'Telegram chat ID is empty' }
$token = $credential.GetNetworkCredential().Password
if (!$token) { throw 'Telegram token is empty' }
$body = @{ chat_id = $chat; text = $Message; disable_web_page_preview = 'true' }
$reply = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/sendMessage" -Body $body -TimeoutSec 20 -ErrorAction Stop
if (!$reply.ok) { throw 'Telegram API did not confirm success' }
Write-Host 'TELEGRAM SENT'
