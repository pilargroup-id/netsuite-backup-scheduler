# NetSuite Backup — Registrasi Scheduler di Device Windows Baru (STAGED)

**Scope:** menambah 4 Windows Task Scheduler di device baru, menggunakan XML production sebagai template. **Tidak mengubah scheduler existing maupun 15 module HARD FREEZE.**

## Sebelum mulai

- Jalankan **hanya di device baru**, bukan production lama. Pastikan seluruh file project + dependency/config/secret yang diperlukan sudah dipersiapkan dengan prosedur migrasi yang disetujui.
- Windows PowerShell 5.1, akses Administrator, Node.js, dan akun Windows target tersedia.
- Jangan menjalankan dua scheduler produksi pada dua device bersamaan. Register awal menciptakan task **Disabled**; tidak menjalankan backup atau mengaktifkannya.
- Fast Delta tetap membutuhkan login interaktif (`InteractiveToken`); V3, Freshness, Watchdog menggunakan logon `Password`.
- XML template menyimpan pola trigger dan beberapa setting yang berbeda antar task. SID lama diganti menjadi akun Windows tujuan.

## 1. Extract ZIP ke project root

Tambahkan `scripts/scheduler/register-device.ps1` dan folder `scripts/scheduler/templates/`. Tidak mengganti `manage.ps1` atau `config/scheduler.json`.

## 2. Preview pada device baru (READ-ONLY)

```powershell
cd C:
etsuite-backup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\scheduleregister-device.ps1 -Mode PreviewRegister -ProjectRoot 'C:
etsuite-backup' -NodeExe 'C:
vm4w
odejs
ode.exe' -Account 'COMPUTERNAME\IT PIAGAM'
```

Ubah `-Account`, `-ProjectRoot`, dan `-NodeExe` agar cocok dengan **device baru**. Preview akan ABORT jika salah satu task sudah terdaftar, script executable tidak ada, atau konfigurasi tidak valid.

## 3. Register DISABLED di device baru (hanya setelah preview PASS dan approval migrasi)

Jalankan PowerShell sebagai Administrator:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\scheduleregister-device.ps1 -Mode Register -ProjectRoot 'C:
etsuite-backup' -NodeExe 'C:
vm4w
odejs
ode.exe' -Account 'COMPUTERNAME\IT PIAGAM' -TargetDeviceConfirmed
```

Script meminta password akun target secara interaktif untuk tiga task Password. **Jangan tulis password di command, file, atau dokumentasi.** Registrasi tidak memanggil Start-ScheduledTask dan tidak mengaktifkan task.

## 4. Verifikasi read-only

```powershell
Get-ScheduledTask -TaskName 'NetSuite Backup*' | Select-Object TaskName,State,@{Name='Interval';Expression={$_.Triggers[0].Repetition.Interval}} | Format-Table -AutoSize
```

Target: keempat task muncul **Disabled** dengan interval **V3 10, Fast Delta 5, Freshness 5, Watchdog 10** menit (atau sesuai `windowsTasks` yang valid).

**PENTING:** Register bukan aktivasi/migrasi. Untuk failover atau perpindahan device production, perlu cutover tersendiri dan persetujuan eksplisit. Tidak ada scheduler production yang dihentikan/diubah oleh patch ini.

## Keterbatasan

- Patch dibuat dari XML export yang dikirim dan dicek secara statis; belum diuji pada Windows live.
- XML registrasi mungkin memiliki persyaratan kebijakan Windows/account pada device baru. Jika gagal, jangan aktifkan task yang terdaftar sebagian; kirim output error untuk penyesuaian minimal.
- XML export ini tidak memuat credential/secret dan tidak menggantikan persiapan environment project.
