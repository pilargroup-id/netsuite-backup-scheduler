# Panduan Ubah Interval Scheduler NetSuite Backup

**Scope:** hanya interval Windows Task Scheduler. **15 module tetap HARD FREEZE** — jangan stop/disable task, jalankan manual sync, atau ubah checkpoint/source module.

## 1. Edit satu file

Buka `C:\netsuite-backup\config\scheduler.json` dan ubah **hanya** `windowsTasks.*.intervalMinutes`:

```json
"windowsTasks": {
  "v3": { "intervalMinutes": 10 },
  "fastDelta": { "intervalMinutes": 5 },
  "freshnessMonitor": { "intervalMinutes": 5 },
  "watchdog": { "intervalMinutes": 10 }
}
```

Angka di atas adalah **baseline yang sudah diuji** (V3 10, Fast Delta 5, Freshness 5, Watchdog 10 menit). Nilai yang diterima script: **5, 10, 15, 20, 30, 60**; **V3 wajib 10**. Jangan mengganti properti JSON lain.

## 2. Preview (read-only)

```powershell
cd C:\netsuite-backup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\scheduler\manage.ps1 -Mode Preview
```

Periksa kolom `CurrentMinutes` dan `DesiredMinutes`. Jika ada error, **jangan Apply**.

## 3. Apply hanya saat SEMUA task Ready

```powershell
$names = @('NetSuite Backup V3','NetSuite Backup Fast Delta','NetSuite Backup Freshness Monitor','NetSuite Backup Watchdog')
$tasks = @(Get-ScheduledTask -TaskName $names -ErrorAction Stop)
$tasks | Select-Object TaskName, State | Format-Table -AutoSize
if (@($tasks | Where-Object { $_.State -ne 'Ready' }).Count -eq 0) {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\scheduler\manage.ps1 -Mode Apply
} else {
    Write-Host 'ABORT: ada task yang belum Ready.'
}
```

Script memeriksa ulang status dan membuat backup XML di `C:\netsuite-backup\scheduler-task-backups\<timestamp>` sebelum perubahan. Jika `ABORT` karena ada task `Running`, **jangan stop task**; coba lagi ketika semua `Ready`. Jika gagal setelah sebagian task berubah, **jangan Apply berulang tanpa pemeriksaan**.

## 4. Verifikasi setelah Apply

```powershell
Get-ScheduledTask -TaskName 'NetSuite Backup*' | ForEach-Object {
    [PSCustomObject]@{
        TaskName = $_.TaskName
        State = $_.State
        Interval = $_.Triggers[0].Repetition.Interval
        StartBoundary = $_.Triggers[0].StartBoundary
    }
} | Format-Table -AutoSize
```

Pastikan interval sesuai JSON dan `StartBoundary` tidak berubah. Jika ingin mengembalikan interval, edit JSON ke nilai baseline lalu ulangi **Preview → Apply saat semua Ready → Verifikasi**. Pemulihan via XML belum diuji; jangan impor XML sembarangan.

**Catatan:** perubahan trigger Windows tidak mengubah interval internal runner V3 (tetap 20 menit sesuai baseline existing).
