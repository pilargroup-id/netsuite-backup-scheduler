# NETSUITE BACKUP → BIGQUERY — MASTER HANDOVER / BASELINE 4 MODUL

**Tanggal baseline:** 20 Oktober 2026 (Asia/Jakarta)  
**Status produksi terakhir yang terverifikasi:** Recovery slot 13:00 WIB berakhir **13:03:02 WIB**, `FINAL_PASS`, exit `0`, untuk **Sales Invoice (SI), Item Fulfillment (IF), Sales Order (SO), Item Receipt (IR)**.  
**Tujuan dokumen:** sumber pegangan utama chat berikutnya. Baca seluruh dokumen ini sebelum mengubah kode atau membuat modul baru.  
**Sumber:** percakapan proyek, log PowerShell yang dikirim pengguna, handover historis 8 dan 14 Oktober, `netsuite-backup(4).zip` (source sebelum patch IR), dan paket `netsuite-item-receipt-integration.zip` yang kemudian dipasang. **Source produksi Windows paling baru tetap menjadi sumber kebenaran tertinggi.**

> **ATURAN UTAMA — JANGAN NGIDE SENDIRI:** Modul baru WAJIB mengikuti mekanisme aktif SI/IF/SO/IR yang sudah terbukti. Jangan buat arsitektur/controller/folder auth baru, jangan buat berkas bernama `*-vN`, jangan mengubah shared lock, jadwal, role, checkpoint, atau modul lama tanpa alasan dan pengujian spesifik. Jangan menilai `npm test` saja sebagai bukti kesuksesan production. Jangan meminta ulang data/file yang sudah tersedia jika masih relevan.

---

## 1. Tujuan bisnis, ruang lingkup, timeline

Proyek: **backup transaksi Oracle NetSuite ke Google BigQuery** untuk kebutuhan reporting, audit, dan reconciliation KPI Oktober–Desember 2026. Sasaran penyelesaian historis KPI: **10 Desember 2026**. Jenis transaksi pada lingkup proyek awal: Sales Order, Item Fulfillment, Sales Invoice, Sales Return, Sales Payment, Purchase Order, Item Receipt, Purchase Invoice, Purchase Return, Bill. Urutan teknis mengikuti progres nyata, bukan urutan daftar. **Jangan mulai Purchase Order sebelum status Item Receipt dan baseline empat modul didokumentasikan; pada akhir chat ini IR sudah selesai sesuai lingkup validasinya.**

Tujuan sistem: menjaga replika transaksi dengan sinkronisasi incremental berkala, koreksi terbatas berbasis bukti, dan rekonsiliasi yang tegas. Ini **bukan** backup point-in-time terisolasi atau mekanisme transaksi live 100% serempak. Snapshot full check terhadap NetSuite yang terus berubah dapat melihat kondisi berbeda dari BigQuery; sistem harus mengidentifikasi kemungkinan *moving source* tanpa menganggap mismatch nyata sebagai sukses.

Operasional di **laptop Windows pengguna**, bukan VM 24/7. Ketika laptop mati/di luar jam, sync tidak berjalan; setelah login, aplikasi harus mengejar checkpoint yang tertinggal saat task aktif kembali. Jangan mengharapkan proses berjalan saat laptop mati atau user belum login jika task memakai mode Interactive.

## 2. IDENTITAS NETSUITE, ROLE, DAN HAK AKSES — WAJIB

### 2.1 Role yang benar

- **Nama role yang benar/persis:** `PNM NetSuite Backup Integration`.
- **Internal role ID tercatat:** `customrole1042`.
- Jangan mengganti namanya menjadi `NetSuite Backup OAuth M2M`; itu **nama metode autentikasi**, bukan nama role.
- Role integrasi bukan otomatis sama dengan role Administrator yang digunakan membuka UI.
- Lokasi cek: **Setup → Users/Roles → Manage Roles → Search** → cari `PNM NetSuite Backup Integration` → edit → tab **Permissions**.
- Akun NetSuite tercatat sebagai `6930902`; SuiteTalk REST basis `https://6930902.suitetalk.api.netsuite.com`; token OAuth endpoint `/services/rest/auth/oauth2/v1/token` pada basis tersebut.
- Autentikasi aktif: **OAuth 2.0 M2M / Client Credentials** memakai **JWT PS256**, sertifikat RSA yang pada konfigurasi historis dibuat 4096 bit, certificate mapping di NetSuite. Kode mengandalkan `CLIENT_ID`, `CERTIFICATE_ID`, `PRIVATE_KEY_PATH` dari `credentials/netsuite-secrets.mjs` melalui `common/netsuite-client.mjs`.

### 2.2 Permission tercatat (bedakan bukti historis dari verifikasi role penuh)

| Kategori NetSuite | Permission | Level historis/terobservasi | Catatan |
|---|---|---|---|
| Transactions | `Find Transaction` | `View` | Diperlukan untuk query/read transaction |
| Transactions | `Invoice` | `View` | Sales Invoice |
| Transactions | `Item Fulfillment` | `View` | IF |
| Transactions | `Sales Order` | `View` | SO |
| Setup | `REST Web Services` | `Full` | API REST SuiteQL |
| Setup | `Log in using OAuth 2.0 Access Tokens` | `Full` | M2M OAuth |
| Setup | `Deleted Records` | `View` | Ditambahkan pada fase audit penghapusan; memungkinkan `deletedrecord` |
| Reports | `SuiteAnalytics Workbook` | `Edit` | Tercatat di handover setup awal 8 Okt; **konfirmasi kembali di role UI jika menjadi prasyarat modul baru** |
| Lists | `Perform Search` | `View` | Tercatat di handover awal; diperlukan ketika akses Transaction sempat gagal |

**Penting:** tabel ini adalah gabungan permission yang tercatat di dokumen setup awal dan subset yang pernah dikonfirmasi lewat screenshot; **BUKAN** export lengkap role hari ini. Hak baca `Item Receipt` sudah terbukti secara fungsional karena probe/sync/reconcile IR pernah berhasil, tetapi **level permission individual Item Receipt belum terverifikasi dari export role**. Untuk PO nanti cek permission `Purchase Order = View` dan kebutuhan record terkait (vendor/item/location/currency) secara read-only. Jangan otomatis memberikan `Full` atau menambah permission secara membabi buta. Untuk `Vendor Bill`, `Item Receipt`, dll. konfirmasi sesuai kebutuhan modul.

### 2.3 Hal yang DILARANG di NetSuite

- Setting **Setup → Import/Export → CSV Import Preferences → `Run Server SuiteScript and Trigger Workflows`**: **OFF, tetap OFF**. Legacy scripts/workflows dan integrasi lama berisiko terpicu bila dinyalakan secara global. Backup memakai REST/SuiteQL polling, **bukan** bergantung pada User Event CSV.
- Jangan ganti certificate mapping/client ID/role/integration record jika OAuth masih berjalan.
- Jangan menyimpulkan dokumen NetSuite `tidak ada di SuiteQL` berarti dihapus. Izin/filter/kondisi API bisa menyebabkan false negative.
- Jangan memakai `transactionhistory` sebagai sumber delete audit: pengalaman sebelumnya record ini tidak queryable. `deletedrecord` terbukti dapat digunakan dengan `Deleted Records: View`; pembuktian deletion harus spesifik internal ID. UI audit yang berguna: **Transactions → Management → View Audit Trail** (bukan `View Login Audit Trail`).
- Jangan mengubah `Run Server SuiteScript and Trigger Workflows` ke ON untuk menambal perubahan CSV.

### 2.4 Credential & sertifikat — kondisi baseline

Folder sertifikat awal `C:\netsuite-backup-cert\` pernah dipindah ke drive D:, menimbulkan `ENOENT: ... C:\netsuite-backup-cert\private.pem` dan menghentikan Fast Delta + Recovery. Perbaikan yang terbukti: `private.pem` (dan jika perlu `public.pem`) disalin ke **`C:\netsuite-backup\credentials\`**; `PRIVATE_KEY_PATH` di `netsuite-secrets.mjs` disesuaikan menjadi path relatif via `fileURLToPath(new URL('./private.pem', import.meta.url))`. `Certificate found: true`, `FOUNDATION CONTRACT TESTS PASS`, dan OAuth production berhasil setelahnya.

**Jangan masukkan private key, client ID, certificate ID, Google service-account JSON, Telegram token ke dokumen atau chat baru.** Folder `credentials/` di `.gitignore`, termasuk `*.pem`. ZIP yang pernah dikirim berisi secrets; batasi akses dan jangan sebarkan. Jika pindah mesin, pastikan izin file dan principal Windows, serta DPAPI Telegram sesuai user/machine.

## 3. INFRA & konfigurasi aktif

- Project root: **`C:\netsuite-backup`**.
- Shell: **Windows PowerShell**. Node 20 (task path historis `C:\nvm4w\nodejs\node.exe`); package menggunakan ESM `.mjs`.
- GCP project: **`even-gearbox-255203`**.
- BigQuery dataset: **`netsuite_backup`**; region **`asia-southeast1`**.
- Dependensi utama: `@google-cloud/bigquery` `^8.3.1`, `jsonwebtoken` `^9.0.3` (lihat `package.json` aktual bila package berubah).
- Shared checkpoint table: `sync_checkpoints`; field `record_type`, `last_successful_modified_at DATETIME`, `last_successful_sync_at TIMESTAMP`, `updated_at TIMESTAMP`.
- Sync delta umumnya menggunakan `lastmodifieddate` + **5 menit overlap**. Checkpoint header/lines disimpan dengan kontrol konsistensi. Temp/stage rows divalidasi; transaksi BigQuery atomic merge/line replacement/checkpoint; temp stage dibersihkan. Jangan advance checkpoint sebelum commit sukses, jangan hapus history/BQ untuk menyelesaikan status merah.
- `config/scheduler.json` baseline: `mode=production`, timezone `Asia/Jakarta`; `workflow=common/recovery-controller.mjs`; production `intervalMinutes=30`, window **08:00–22:00**, days **0–6**, `maxRunMinutes=120`, `maxLogDays=30`; mode test interval 10 menit window 00:00–23:59. Jangan ganti mode ke test di production hanya supaya tes lebih cepat.
- `config/self-healing.json` pada ZIP baseline: `enabled=true`, `catchUpSync=true`, `maxRecoveryPerModulePerRun=3`, `verifiedDeletionEnabled=true`, `verifiedIFDeletionEnabled=true`. Ini bukan lisensi untuk auto-repair tanpa bukti; baca guard kode masing-masing modul.

## 4. STRUKTUR FOLDER — BASELINE EMPAT MODUL

Di bawah adalah **gabungan struktur yang diverifikasi dari `netsuite-backup(4).zip` dan tiga berkas patch IR yang terpasang**. Folder runtime `credentials/logs/backups/node_modules` di mesin mungkin berisi lebih banyak subfolder; ZIP tidak merepresentasikan seluruh runtime.

```text
C:\netsuite-backup\
├── .gitignore
├── package.json
├── package-lock.json
├── credentials\                         # LOKAL/RUNTIME; jangan share
│   ├── netsuite-secrets.mjs             # CLIENT_ID, CERTIFICATE_ID, PRIVATE_KEY_PATH
│   ├── private.pem                      # private key rahasia, di-project pada baseline baru
│   └── public.pem                       # opsional, sesuai salinan user
├── common\
│   ├── bigquery-client.mjs
│   ├── netsuite-client.mjs
│   ├── child-runner.mjs
│   ├── shared-lock.mjs
│   ├── recovery-controller.mjs          # SATU active recovery controller 4 modul
│   ├── source-movement.mjs
│   ├── presence-reconcile.mjs
│   ├── sync-utils.mjs
│   ├── targeted-recovery.mjs
│   └── so-mismatch-candidates.mjs
├── config\
│   ├── scheduler.json
│   ├── self-healing.json
│   ├── verified-deletion-example.json
│   ├── telegram-chat-id.txt             # sensitif/operasional
│   └── telegram-credential.clixml       # DPAPI terikat konteks Windows
├── modules\
│   ├── sales-invoice\
│   │   ├── sync.mjs
│   │   ├── mapping.mjs
│   │   ├── presence.mjs
│   │   ├── check.mjs
│   │   └── recover.mjs
│   ├── item-fulfillment\
│   │   ├── sync.mjs
│   │   ├── mapping.mjs
│   │   ├── presence.mjs
│   │   ├── check.mjs
│   │   ├── reconcile-accounting.mjs
│   │   ├── repair-accounting-bounded.mjs
│   │   └── recover.mjs
│   ├── sales-order\
│   │   ├── sync.mjs
│   │   ├── mapping.mjs
│   │   ├── presence.mjs
│   │   ├── check.mjs
│   │   ├── repair-active.mjs
│   │   └── recover.mjs
│   └── item-receipt\
│       ├── sync.mjs
│       ├── mapping.mjs
│       ├── probe.mjs
│       ├── presence.mjs
│       ├── check.mjs
│       ├── check-financial.mjs
│       └── recover.mjs                 # deliberate: targeted repair belum aman/aktif
├── scripts\
│   ├── fast-delta.mjs                  # SATU active Fast Delta controller, 4 modul
│   ├── run-fast-delta.ps1
│   ├── run-fast-delta-hidden.vbs        # GUI hidden launcher, Interactive task
│   ├── scheduler-runner.mjs
│   ├── scheduler-watchdog.mjs
│   ├── run-freshness-monitor.ps1
│   ├── fast-delta-freshness.mjs
│   ├── fast-delta-freshness-alert.mjs
│   ├── freshness-incident-core.mjs
│   ├── monitor-alert.mjs
│   ├── monitor-notify.ps1
│   ├── shared-lock-inspect.mjs
│   ├── diagnose-transaction.mjs
│   └── verified-deletion.mjs
├── tests\
│   ├── foundation-test.mjs
│   ├── child-runner-test.mjs
│   ├── fast-delta-integration-test.mjs
│   └── source-movement-test.mjs
├── logs\                              # lokal; runtime
│   ├── scheduler\
│   │   ├── latest.json
│   │   ├── history.jsonl
│   │   ├── skips.jsonl
│   │   ├── run-*.log
│   │   └── .running.lock\owner.json   # hanya saat writer memegang lock
│   └── fast-delta\
│       ├── health-v2.json
│       └── run-*.log
├── backups\                           # lokal; code snapshots/rollback
└── node_modules\                      # lokal; npm
```

**Jangan membuat `centralDb`, alternate workflow `*-v52`, `fast-delta-vN`, atau controller pengganti.** Semua modul baru di `modules/<slug>/`, memakai utility shared di `common/`, digabung ke daftar empat modul aktif secara terkontrol. `.gitignore` baseline ZIP: `node_modules/`, `credentials/`, `logs/`, `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.zip`.

## 5. Scheduler Windows: 4 tugas, action dan problem nyata

| Task Name PERSIS | Fungsi | Action yang diverifikasi (sebelum launcher hidden) | Status baseline |
|---|---|---|---|
| `NetSuite Backup Fast Delta` | delta writer berkala (sekitar setiap 5 menit saat window aktif) | `powershell.exe ... -File "C:\netsuite-backup\scripts\run-fast-delta.ps1"` | **Interactive**, switched to launcher `wscript.exe` + `run-fast-delta-hidden.vbs`; execution production PASS |
| `NetSuite Backup Freshness Monitor` | monitor status/missed freshness | `powershell.exe ... -File "C:\netsuite-backup\scripts\run-freshness-monitor.ps1"` | `Password`, Ready pada pemeriksaan terakhir |
| `NetSuite Backup V3` | scheduler controller tiap slot | `C:\nvm4w\nodejs\node.exe "C:\netsuite-backup\scripts\scheduler-runner.mjs"` | `Password`, Ready, Recovery four modules PASS |
| `NetSuite Backup Watchdog` | pengawas scheduler | `C:\nvm4w\nodejs\node.exe "C:\netsuite-backup\scripts\scheduler-watchdog.mjs"` | `Password`, Ready |

Penting: Fast Delta awal berstatus **Queued** walau action benar, lock `FREE`, last log tertinggal dan missed runs bertambah. Task menggunakan `LogonType=Password`; `Set-ScheduledTask` gagal `0x8007052e` karena kredensial Windows saat registrasi ulang. Screenshot tab Settings/Conditions ternyata wajar; mengutak-atik battery setting tidak menyelesaikan masalah. Mengubah General menjadi **`Run only when user is logged on`** mengubah principal ke **Interactive** dan task langsung `Running`, serta production sync berhasil. Konsekuensi: jendela terminal terlihat. Maka dibuat `scripts/run-fast-delta-hidden.vbs` (WScript Shell `Run(..., 0, True)` dengan `WScript.Quit result`) dan action Fast Delta diganti menjadi:

```text
Program/script: C:\Windows\System32\wscript.exe
Arguments:      "C:\netsuite-backup\scripts\run-fast-delta-hidden.vbs"
Start in:       C:\netsuite-backup
```

Launcher menjalankan `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\netsuite-backup\scripts\run-fast-delta.ps1"` tersembunyi. **Jangan ubah lagi principal Fast Delta kembali ke `Password` tanpa kebutuhan.** Karena Interactive, user wajib login agar task dieksekusi. Tiga task lain tetap Password dan Recovery terbukti berjalan; jangan paksa migrasi semuanya ke Interactive. `LastTaskResult=0` dapat berarti task wrapper berhasil, **bukan** bukti rekonsiliasi; sumber bukti tetap log dan JSON status.

Task runner memfilter slot setiap 30 menit (`:00`, `:30`) walau trigger Windows bisa tiap 10 menit. `NOT_INTERVAL_SLOT` pada `logs/scheduler/skips.jsonl` adalah NORMAL. **`267009` / `0x41301` artinya task sedang running**, tidak otomatis failure. `latest.json` tidak selalu berubah sampai workflow selesai. Jangan menghapus `.running.lock` milik proses yang masih hidup. JANGAN mengulang `Start-ScheduledTask` ketika `Running`/`Queued`.

### Shared lock

`common/shared-lock.mjs` dipakai Fast Delta dan Recovery agar perubahan BigQuery tidak tumpang tindih; folder: `logs/scheduler/.running.lock/owner.json` dengan `pid,host,token,startedAt,worker`. Bila lock aktif, inspect PID/proses lebih dulu; stale lock removal hanya jika dipastikan owner mati dan mengikuti guard kode. Tidak boleh menjalankan manual production writer paralel. Opsional baca `scripts/shared-lock-inspect.mjs`, jangan hard delete.

## 6. Empat modul — STATUS & batasan per transaksi

### 6.1 Sales Invoice (SI)

- Folder `modules/sales-invoice/`: `mapping.mjs`, `sync.mjs`, `check.mjs`, `presence.mjs`, `recover.mjs`.
- Tipe NetSuite: `CustInvc`; data BigQuery tabel header/lines. Identitas dan perhitungan mengikuti kode production; NetSuite signed line `foreignamount` dibalik tanda pada checker untuk membandingkan jumlah BQ.
- Header count/total, line count/total, invoice-with-lines, duplicate line key, orphan, header tanpa lines merupakan checkpoint audit; `check.mjs` dulu mengeluarkan `Run sync scripts again` bila tidak match, meski sync berhasil.
- Sumber data bergerak selama jam kerja: contoh 20 Okt saat checker NetSuite headers `1128` sama BQ, tetapi header total NS `36085382366.11` vs BQ `.03`; line NS `50564` vs BQ `50562`. Pada retry NS total berubah `.09`, lines `50565`; mismatch karena pemeriksaan sequential di waktu berlainan sangat mungkin. Pemeriksaan lain NS headers `1130` vs BQ `1129`, lines `50571` vs BQ `50569`, net selisih bisa sementara. **Tidak berarti otomatis data rusak; bukan berarti otomatis PASS.**
- Penghapusan SI historis: 8 transaksi `3147029..3147036` ditemukan BQ-only dan diverifikasi di audit (user deleted `3330`, delete date 14 Okt); soft-delete dilakukan **hanya setelah bukti independen**; jangan mengubah engine jadi auto-delete atas hasil kosong.
- Baseline 20 Okt 13:00: **`FINAL_PASS`**.

### 6.2 Item Fulfillment (IF)

- File: `mapping`, `sync`, `presence`, `check`, `reconcile-accounting`, `repair-accounting-bounded`, `recover`.
- Menjaga kuantitas dan COGS header/line; accounting audit seluruh Oktober read-only; `reconcile-accounting.mjs` mencari selisih per transaksi dan memastikan daftar dokumen NS vs BQ sama sebelum repair.
- Kegagalan Fast Delta terakhir 19 Okt 16:31: child exit `0`, tidak ada success marker setelah `STAGING VALIDATION: PASS`; proses ditandai FAILED dan SO tidak diproses. Reliability fix mengubah controller memakai `common/child-runner.mjs` async/streaming, timeout per modul **30 menit**, exit/marker validasi, dan tetap mencoba modul berikutnya dengan outcome per modul.
- Contoh mismatch 20 Okt (nilai sumber vs BQ):
  - `3155572` (`DO261010393`): `11165105.09` vs `11165105.08`, diff `+0.01`.
  - `3155781` (`DO261010422`): `49909541.07` vs `49980386.69`, diff `-70845.62`.
  - `3155793` (`DO261010424`): `499095.41` vs `499803.87`, diff `-708.46`.
  - `3155896` (`DO261010427`): `2530771.03` vs `2521252.93`, diff `+9518.10`.
- `Document inventory mismatch`: pada satu run NS `803`, BQ `802`, BQ missing ID `3156409`; kemudian NS `812`, BQ `811`, ID `3156442`. Data bergerak selama check; bounded accounting repair awal ditolak sesuai guard. Setelah sync mengejar, standalone `node modules/item-fulfillment/reconcile-accounting.mjs` menghasilkan NS/BQ **819/819**, lines **2363**, quantity **289258**, COGS **8059793361.18**, `differences=0`.
- Pada Recovery slot 10:30 ada bukti **`IF ACCOUNTING AUTO RECOVERY PASS repaired=4 postAudit=0`**, mencakup tiap transaction targeted repair dengan checkpoint tidak berubah; lalu `item-fulfillment: FINAL_PASS`. Jangan otomatis mengaktifkan bulk COGS repair atau bypass inventory proof.
- Baseline 20 Okt 13:00: **`FINAL_PASS`**.

### 6.3 Sales Order (SO)

- File: `mapping`, `sync`, `presence`, `check`, `recover`, `repair-active`.
- Berbasis header/line dan klasifikasi `PRODUCT_INCOME`, `TAX`, `OTHER_ITEM`, `DISCOUNT`; line accounting signed vs order total memiliki karakteristik NetSuite. Rounding discount dapat menghasilkan selisih sum detail `foreignamount` dari `foreigntotal` < 0.50 per order; kode menjaga nilai NetSuite, **tidak** memaksa penyesuaian.
- Sampel full 20 Okt: NetSuite dan BQ sama-sama **809 headers, 3848 lines**, total **13,241,998,988.22**, field-by-field header/line PASS, duplicate/orphan PASS.
- Guard SO active field repair tertentu ada, tetapi jangan memperluas auto-repair tanpa bukti detail, dry-run, scope dan post-audit.
- Baseline 20 Okt 13:00: **`FINAL_PASS`**.

### 6.4 Item Receipt (IR) — modul yang dituntaskan paling akhir di chat ini

- Folder `modules/item-receipt/`: `mapping.mjs`, `probe.mjs`, `sync.mjs`, `presence.mjs`, `check.mjs`, `check-financial.mjs`, `recover.mjs`.
- Header table **`item_receipt_headers`** dan line table **`item_receipt_lines`**. Checkpoint bersama 2 record types **`item_receipt_headers`, `item_receipt_lines`**; bila header/line checkpoint berbeda/missing sebelah, sync menolak.
- Header fields dari source IR: `internal_id, receipt_number, transaction_date, last_modified, created_from_id, status, total_amount` + `synced_at, is_deleted, deleted_at`. Lines: `receipt_internal_id, line_unique_key, line_id, line_number, item_id, quantity, rate, foreign_amount, net_amount, location_id, units_id, accounting_line_type` + `synced_at`.
- `sync.mjs` membutuhkan tepat **satu** `--sync` atau `--dry-run`; dedupe/staging, data validation, atomic merge header + replace lines + checkpoint transaction, orphan assertion; source mismatch/checkpoint guard. `NO CHANGES` tidak memindahkan modified checkpoint; patch IR mengeluarkan **`ITEM RECEIPT NO CHANGES: SUCCESS`** yang dipahami Fast Delta. Changed sync marker **`ITEM RECEIPT SYNC SUCCESS`**. **Tidak** melakukan delete inference otomatis.
- `check.mjs` hanya counts, presence, integrity — output `ITEM RECEIPT CHECK: PASS (counts/presence/integrity ONLY)` dan `AMOUNT KPI NOT CERTIFIED; NOT FINAL_PASS` bila dijalankan berdiri sendiri.
- `check-financial.mjs` membandingkan detail/header ID, per-line key dan nilai, quantity, rates, net & foreign per receipt — marker **`ITEM RECEIPT FINANCIAL DETAIL CHECK: PASS`**. Pemeriksaan ini **belum mengesahkan native header `total_amount` dan GL accounting book**; banyak header total null berasal dari source semantics.
- `recover.mjs` IR **tidak mengaktifkan targeted repair** (sengaja guard/exit 3); Recovery bersama hanya boleh bounded re-sync yang ada dan full read-only audit, tidak otomatis mengubah finance GL/COGS IR.
- Patch IR mengintegrasikan modul **ke posisi ke-4** daftar `scripts/fast-delta.mjs` dan `common/recovery-controller.mjs`, tidak menyentuh logic SI/IF/SO. IR full `FINAL_PASS` dalam controller **hanya ketika** mode sync, `check.mjs` dan `check-financial.mjs` keduanya marker PASS. Di mode audit-only/dry-run tidak mengklaim FINANCIAL FINAL_PASS.
- **Run live awal IR financial:** NetSuite/BQ **139 headers**, **348 lines**, zero missing, zero duplicates/orphans, zero field/receipt differences; net amount NS/BQ **3,934,393,249.89**; foreign amount sama; quantity NS/BQ **403141.000000**; `headerAmountsNull=92`; marker financial PASS. Output mengingatkan GL/header amount **not certified**.
- **Run live otomatis:** Fast Delta log `run-2026-10-20_11-49-57.log` dan `run-2026-10-20_11-51-34.log`: `IRStarted=True`, `IRSuccess=True`, `Completed=True`. Ini membuktikan eksekusi IR di production, bukan hanya tes offline.
- **Recovery empat modul 13:00 WIB** `run-2026-10-20T06-00-01.715Z.log`, selesai 13:03:02 WIB, `FINAL_PASS`, `exitCode=0`, `item-receipt: FINAL_PASS` dengan `ITEM RECEIPT FINANCIAL DETAIL CHECK: PASS`.
- **BATASAN SCOPE TEGAS:** IR `FINAL_PASS` = **presence/count/line financial detail**, **bukan GL accounting book, native header total_amount**. Jangan ubah label klaim ke full GL certification tanpa tambahan query/independent validation.

## 7. Fast Delta production & health monitor

- Aktif: **satu** `scripts/fast-delta.mjs`; modul aktif dalam urutan tetap **`['sales-invoice','item-fulfillment','sales-order','item-receipt']`**.
- Child runner `common/child-runner.mjs` streaming, asynchronous; output marker dan child exit status diverifikasi. Per-module timeout **30 menit**; timeout/failure **bukan** sukses, checkpoint tidak diubah bila transaction tidak commit. Controller meneruskan ke modul berikutnya bila satu gagal dan mencatat hasil tiap modul. Lock mencegah writer konkurensi.
- Wrapper task `scripts/run-fast-delta.ps1` menulis `logs/fast-delta/run-YYYY-MM-DD_HH-mm-ss.log` dengan timestamp, stdout/stderr dan exit code. Hidden launcher untuk menghindari terminal muncul setiap 5 menit saat task Interactive. Jangan memicu manual task berulang ketika berjalan.
- Health state `logs/fast-delta/health-v2.json` (per-module `lastAttemptAt`, `lastResult`, `lastSuccessAt`, `lastError`). `scripts/fast-delta-freshness.mjs 20` menunjukkan `FRESH/STALE` berdasarkan umur keberhasilan terakhir dan threshold 20 menit. **FRESH ≠ FULL RECONCILIATION PASS**; artinya delta sync sukses baru-baru ini.
- **Caveat penting**: pada output health 20 Oktober setelah IR diintegrasikan, script freshness masih menampilkan **hanya SI, IF, SO**; IR `SYNC_OK` dibuktikan lewat log Fast Delta dan Recovery. **Jangan menganggap health IR sudah terintegrasi** hanya karena sync IR sudah jalan; bila menambah IR ke freshness/Telegram, lakukan patch terpisah yang mempertahankan behavior lama dan uji, bukan mengubah data atau checkpoint. Ini pekerjaan observability opsional yang belum terbukti tuntas dalam percakapan.
- Marker Fast Delta: SI `SALES INVOICE DELTA SYNC SUCCESS` atau `NO CHANGES: SUCCESS`; IF `ITEM FULFILLMENT DELTA SYNC SUCCESS` atau `NO CHANGES. DELTA SYNC SUCCESS`; SO `SALES ORDER SYNC SUCCESS`; IR `ITEM RECEIPT SYNC SUCCESS` atau `ITEM RECEIPT NO CHANGES: SUCCESS`. Kontrak harus sinkron antara log sync dan markerMap, khususnya `NO CHANGES`.

## 8. Recovery, source movement, safety

- Satu active `common/recovery-controller.mjs`; `scheduler-runner.mjs` dipandu `config/scheduler.json` dan menjalankan `--all --sync` dalam bounded window. Jangan menggantinya dengan controller historis `unified-workflow-vN`.
- Recovery menjalankan sync/presence/check, bounded source-moving retry dan targeted recovery sesuai guard. Status: `FINAL_PASS` untuk check yang sudah benar; `NEEDS_REVIEW` untuk mismatch yang belum diselesaikan atau `SOURCE_MOVING_DETECTED`; `FAILED` untuk error nyata. Jangan mengubah mismatch menjadi PASS hanya supaya tampak hijau.
- **Reconciliation Preventive Fix** (dipasang `PATCH INSTALLED: PASS` pada 20 Okt; backup `backups/code-before-source-movement-fix-20261020-111429`) menambah `common/source-movement.mjs`, tests `source-movement-test.mjs`, serta klasifikasi bukti perubahan NS antara dua pemeriksaan menjadi `NEEDS_REVIEW` reason `SOURCE_MOVING_DETECTED`; **tidak membangun snapshot NetSuite yang konsisten secara transaksional**. Pending changes dapat membuat full check FAIL; jangan menjanjikan nol transient review saat user aktif.
- Source movement evidence yang diimplementasikan pada ZIP: SI KPI NS headers/header total/lines/line total; SO count/total/raw line; IF count/inventory/COGS. Aturan source-moving harus hanya mengklasifikasikan jika **bukti NetSuite berubah**, bukan sekadar BQ tidak sama. Modul IR mengikuti pola konservatif; patch IR tidak mengklaim GL certification atau full source-snapshot capability.
- Deletion: pernah dipakai `scripts/verified-deletion.mjs` dengan NetSuite `deletedrecord` audit independen. Hanya verified, bounded per ID, step dry-run sebelum apply, explicit env confirmation (`NETSUITE_VERIFIED_DELETE_CONFIRM`). Jangan gunakan absence SuiteQL saja atau bulk delete.
- Item Fulfillment accounting bounded recovery mengharuskan document inventory cocok dan bukti independen sebelum modifikasi; bukti 20 Okt targeted 4 transaksi repaired, postAudit 0, tanpa checkpoint movement.
- IR targeted recovery sengaja nonaktif, karena `recover.mjs` tidak memiliki source-validated safe repair. Jangan mengaktifkannya hanya agar mencapai `FINAL_PASS` lebih mudah.
- Lock/scheduler safety lebih penting daripada mengurangi jadwal check beberapa menit.

## 9. Kronologi perubahan & problem yang harus DIINGAT

1. **Sep–awal Okt:** OAuth M2M role read-only, SI pertama, IF/SO/IR bertahap; dataset BigQuery; checkpoint, reconciliation, staging. Full October KPI SI/IF/IR pertama sukses; role izin diperluas secukupnya.
2. **8–14 Okt:** historical handover, verified deletion/audit trail, V5.x workflow; `Deleted Records: View` dan `deletedrecord`; jangan gunakan `transactionhistory`.
3. **15–16 Okt:** shared lock/health/scheduler reliability; masalah pop-up PowerShell ditutup user sehingga Node run terputus, lock dan health RUNNING; false parsing status; integrasi checks/recovery diverifikasi. User meminta hentikan proliferasi file versi.
4. **18–19 Okt:** refactor jadi **Single Controller Clean**. `npm test` = `FOUNDATION CONTRACT TESTS PASS`. Path `common/recovery-controller.mjs`, `scripts/fast-delta.mjs`, `scripts/scheduler-runner.mjs`, tidak ada versioned legacy active. Windows scheduled tasks menunjuk folder lama yang sama.
5. **19 Okt 10:30:** Recovery FAILED karena `ENOENT C:\netsuite-backup-cert\private.pem`; Fast Delta juga gagal. Sertifikat dipindah ke `credentials/private.pem`, path disesuaikan. OAuth pulih; 3 modul `SYNC_OK`; Recovery 11:00–14:30 beberapa `FINAL_PASS`.
6. **19 Okt 16:31:** Fast Delta SI sukses, IF validasi source/stage sukses, tetapi tidak muncul commit success marker; child exit 0 dilaporkan FAILED, run terhenti sebelum SO. Diduga batas eksekusi (historis `spawnSync`, timeout 20 menit); tidak dibuktikan commit IF pada run itu. Jangan menganggap `exit=0` tanpa marker berarti sukses.
7. **20 Okt 09:08:** Reliability Fix dipasang (`FOUNDATION`, `CHILD RUNNER`, `FAST DELTA INTEGRATION` PASS). Installer memiliki BUG di pemulihan task (`Enable-ScheduledTask -TaskName null`); kode terpasang tetapi task perlu di-enable manual. Backup `backups/code-before-reliability-fix-20261020-090831`.
8. **20 Okt pagi:** Task Fast Delta `Queued`, no log baru, missed runs; `LogonType=Password`. `Set-ScheduledTask` gagal kredensial Windows `0x8007052e`. Mengubah task Fast Delta menjadi `Run only when user is logged on` (`Interactive`) berhasil `Running`; hidden `wscript.exe` VBS launcher mencegah muncul terminal. Tiga task lain dibiarkan `Password` karena Recovery berhasil.
9. **20 Okt 09:43–09:56:** Fast Delta SI/IF/SO sukses, state 3/3 FRESH; Recovery IF mendapat moving document/COGS differences, SI check mismatch saat NetSuite terus menerima update. Empat discrepancy IF ditelusuri, kemudian accounting zero differences serta targeted auto repair 4 receipt dengan postAudit 0 pada recovery.
10. **20 Okt 11:14:** Reconciliation Preventive Fix dipasang; `SOURCE MOVEMENT TESTS PASS`, `PATCH INSTALLED: PASS`. Recovery **slot 11:00** (ketika baseline 3 modul) `FINAL_PASS` 3/3; Fast Delta FRESH. Konsep klasifikasi source-moving, BUKAN snapshot immutable.
11. **20 Okt menjelang 11:46:** User menolak mulai PO karena IR belum selesai. Finalisasi dari `netsuite-backup(4).zip`. IR Integration Patch (`IR INTEGRATION PATCH: PASS`, semua tes offline PASS) mengganti **3 file**: `scripts/fast-delta.mjs`, `common/recovery-controller.mjs`, `modules/item-receipt/sync.mjs`, jangan menganggap file ke-4/5 ditimpa. File controller `LastWriteTime=11:46:35`, sehingga log Fast Delta `11:46:34` masih 3 modul (normal timing).
12. **20 Okt 11:49 & 11:51:** kedua Fast Delta run dengan 4 modul IR started/success/completed; IR check 139 headers, 348 lines, zero diffs; financial detail 3,934,393,249.89 net/foreign, qty 403141.
13. **20 Okt 12:00:** Recovery masih RUNNING (task result 267009), shared lock owned scheduler PID 13144; jangan hapus lock. Sebelum selesai `latest.json` masih 11:30 karena sifatnya snapshot run TERAKHIR SELESAI.
14. **20 Okt 13:00–13:03:** Recovery terbaru **slot 13:00 `FINAL_PASS`, exit 0, semua 4 modul SI/IF/SO/IR**. Ini bukti penutupan IR sesuai scope.
15. **End-of-chat:** `config/scheduler.json` workflow tetap `common/recovery-controller.mjs`, prod 30 menit 08–22, user tanya freeze; disepakati **freeze baseline kode/konfigurasi**, bukan data dan bukan job schedule. Modul berikutnya siap dimulai pada chat baru; PO belum punya berkas dan belum diprobe di percakapan ini.

## 10. Freeze — definisi yang tepat

**FREEZE = membekukan arsitektur + implementasi yang sudah teruji sebagai baseline**, **BUKAN** membekukan NetSuite data, BigQuery data, checkpoint, Fast Delta, atau scheduled tasks. Transaksi baru terus masuk. Fast Delta tetap jalan sekitar 5 menit sekali saat laptop aktif dan login. Recovery tetap slot 30 menit 08:00–22:00. Checkpoint terus berubah saat sync sukses. Modul baru boleh dikembangkan TERPISAH dengan pola yang sama.

- Jangan mengubah SI/IF/SO/IR stabil hanya untuk menambah modul lain.
- Semua modul baru harus punya probe read-only, mapping, sync, check/presence, financial checker bila relevan, recover aman/disabled dengan guard, test; baru registry 4→5 pada dua controller setelah live validation.
- Jangan mem-bypass `NEEDS_REVIEW` atau false mark `FINAL_PASS` untuk memperindah laporan.
- Setiap deploy: backup file yang diganti, pastikan tasks terkait `Ready`/tak menulis, tes JS syntax dan offline, install kecil/terkontrol, lalu **satu** verifikasi live delta dan recovery. Tidak boleh menulis ulang folder production/credential/log secara global.

## 11. PERATURAN WAJIB untuk modul berikutnya (mis. Purchase Order)

1. **Baca kode production empat modul terakhir dulu**, khususnya SI/IF/SO/IR dan utility `common`. Berkas user terkini adalah sumber kebenaran tertinggi, bukan handover historis.
2. **Jangan berasumsi skema PO = SO**. Probe SuiteQL read-only terlebih dahulu (type/fields, subsidiary/posting period/date, header vs lines, classification, currency/sign amount, tax/shipping/discount, qty, mod timestamp, status, linked receipt/bill). Validasi permission View pada role actual sebelum query.
3. Struktur wajib `modules/purchase-order/{probe,mapping,sync,presence,check,recover}.mjs`, tambah `check-financial.mjs` jika kebutuhan finansial. Nama source table sesuai penamaan modul existing; pastikan dataset dan region konsisten. Tidak ada `new-control-v1`, tidak bikin OAuth client sendiri.
4. Reuse `common/netsuite-client.mjs`, `common/bigquery-client.mjs`, child runner/shared-lock dan error conventions. Dilarang menyebarkan credential ke file modul.
5. Sync wajib explicit `--sync` vs `--dry-run` sesuai kontrak modul, no silent write in dry-run, sync changed headers + all detail lines, deterministic key, duplicate/orphan validation, 5m overlap, stage, atomic MERGE + LINE REPLACE + CHECKPOINT. Tidak menaikkan checkpoint jika gagal atau jika source kosong initial tanpa validasi.
6. Check/reconciliation harus memahami **cakupan dan keterbatasan finansial** source NetSuite. Jangan gunakan aggregate net/header total sebagai bukti line/GL bila tidak representatif; bedakan full certification vs financial detail saja seperti IR. Jangan menganggap line counts cukup untuk `FINAL_PASS` financial.
7. Full check read-only, presence, duplicate, orphan, header/line amount & business logic sesuai record type. Source movement boleh diklasifikasi `NEEDS_REVIEW` bila ada evidence; **tidak** membypass mismatch untuk membenarkan `FINAL_PASS`.
8. Recovery harus bounded, terbatas, source validated; belum ada repair aman → leave disabled sebagaimana IR `recover.mjs`. Soft-delete hanya dengan deletedrecord independent proof dan guard.
9. Tambah modul ke akhir dua array di `scripts/fast-delta.mjs` dan `common/recovery-controller.mjs` **hanya setelah kontrak sukses dan check PASS**. Pertahankan urutan empat modul. Update marker map untuk `NO CHANGES`, exit codes, health/monitor jika memang dikembangkan (IR freshness belum terbukti). Jangan mengubah nama task Windows / scheduler config tanpa kebutuhan nyata.
10. Test: `npm test` foundation/child runner/integration; `node tests/source-movement-test.mjs`; module test dry-run & read-only; production sync melalui jalur Windows task terkontrol, kemudian scheduled Recovery dengan pembacaan `latest.json`; pastikan status module dan scope jelas. Jangan terus meminta user menunggu lama dalam loop; **langsung next step jelas**.
11. KPI awal proyek Okt–Des 2026; implementasikan **Oktober 2026** konsisten dulu, baru kembangkan bulan lain sesuai arahan user. Jangan mengganti baseline tanggal sepihak.
12. **Keamanan**: proyek pernah dibagikan via ZIP dengan credential; jangan mencetak pem/secret/token. Jangan meminta user menempelkan secret. Rollback hanya kode, bukan reset database. Pertahankan .gitignore dan perizinan Windows.

## 12. Perintah operasional aman (PowerShell)

```powershell
cd C:\netsuite-backup

# Tes OFFLINE, tidak dianggap sebagai bukti live production
npm test
node .\tests\source-movement-test.mjs

# Status task (read-only)
Get-ScheduledTask | Where-Object { $_.TaskName -like 'NetSuite Backup*' } |
  Select-Object TaskName,State,@{N='LogonType';E={$_.Principal.LogonType}}

# Sync health (read-only). Perhatikan: output historis hanya 3 modul.
node .\scripts\fast-delta-freshness.mjs 20

# Fast Delta live terakhir, tanpa mulai task baru
Get-ChildItem .\logs\fast-delta -Filter 'run-*.log' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 |
  ForEach-Object { Get-Content $_.FullName -Tail 35 }

# Recovery run TERAKHIR SELESAI
$latest=Get-Content .\logs\scheduler\latest.json -Raw | ConvertFrom-Json
$latest | Format-List
Get-Content (Join-Path '.\logs\scheduler' $latest.log) -Tail 35

# Informasi slot scheduler
Get-ScheduledTaskInfo -TaskName 'NetSuite Backup V3' |
  Format-List LastRunTime,NextRunTime,LastTaskResult

# Lock read only
if (Test-Path .\logs\scheduler\.running.lock\owner.json) {
  Get-Content .\logs\scheduler\.running.lock\owner.json -Raw
} else { 'LOCK FREE' }

# IR financial detail read-only, jika butuh audit spesifik
node .\modules\item-receipt\check.mjs
node .\modules\item-receipt\check-financial.mjs
```

**Jangan jalankan ini sembarangan:** `Start-ScheduledTask` writer jika masih running/queued; `node sync.mjs --sync` bersamaan scheduled task; `repair-*.mjs --apply`; manual `DELETE/MERGE` BigQuery; reset `sync_checkpoints`; hapus `.running.lock` saat task masih hidup; install/rewrite di atas proses yang sedang menulis.

## 13. Output pembuktian BASELINE PRODUKSI AKHIR

```text
20 Oct 2026, Recovery 13:00 Asia/Jakarta
startedAt  : 2026-10-20T06:00:01.715Z
finishedAt : 2026-10-20T06:03:02.794Z
mode       : production
slot       : 13:00
status     : FINAL_PASS
exitCode   : 0
timedOut   : False
log        : run-2026-10-20T06-00-01.715Z.log

ITEM RECEIPT FINANCIAL DETAIL CHECK: PASS
NOTICE: Header total_amount and GL accounting book reconciliation are NOT certified by this check.
IR SCOPE: count/presence/line financial DETAIL verified; header GL accounting book NOT certified.

========== RECOVERY SUMMARY ==========
sales-invoice: FINAL_PASS
item-fulfillment: FINAL_PASS
sales-order: FINAL_PASS
item-receipt: FINAL_PASS

Scheduler status=FINAL_PASS exitCode=0 timedOut=false
```

Ini adalah **bukti lulus satu siklus full production empat modul**, bukan garansi tidak akan pernah ada moving-source review atau error di hari mendatang.

## 14. Pekerjaan setelah handover / jangan salah prioritas

**Posisi akhir chat:** baseline empat modul sudah terverifikasi, data tetap auto-sync, PO **belum diimplementasikan** (`Existing PO files` kosong). Lanjut berikutnya: **Purchase Order read-only probe**, tetapi hanya setelah membaca dokumentasi ini + kode aktual. Saat membangun PO ikuti pola existing, no refactor besar.

**Catatan teknis yang belum tuntas/di luar klaim baseline:**

- IR header native amount dan GL accounting book **belum disertifikasi**. Jangan menyebutnya full GL audit.
- IR belum terlihat pada output `fast-delta-freshness.mjs 20` di percakapan, meski IR sudah benar-benar dieksekusi di Fast Delta dan Recovery. Jangan menyatakan alert/freshness IR 100% terintegrasi tanpa verifikasi source runtime.
- Implementasi `SOURCE_MOVING_DETECTED` **bukan true consistent snapshot/cutoff isolation**. Transaksi yang diedit selama audit bisa membuat NEEDS_REVIEW; perlu desain multi-pass/window/snapshot terpisah jika KPI mengharuskan penghapusan false transient review sepenuhnya. Jangan menutupi mismatch nyata.
- Permission `Purchase Order`/fitur PO lainnya harus dicek di role NetSuite nyata. Tidak ada bukti PO source sudah diprobe/permission telah diberikan di chat ini.
- Folder credentials/Telegram/DPAPI di runtime tidak seluruhnya terwakili ZIP dan mungkin menyimpan secret lokal. Jangan merekonstruksi ID/token dari history.
- Bisa terjadi timestamp BigQuery berbeda karena source timezone; gunakan kode mapping yang konsisten dan verifikasi timezone dengan NetSuite. Jangan mengedit checkpoint hanya untuk mengejar waktu.

## 15. Prompt pembuka chat berikutnya (boleh copy-paste)

> Saya lanjut project `C:\netsuite-backup`. Baca dan taati file **NETSUITE_BACKUP_HANDOVER_BASELINE_4_MODULE_2026-10-20.md** ini seluruhnya. Baseline production empat modul **Sales Invoice, Item Fulfillment, Sales Order, Item Receipt** sudah `FINAL_PASS` 20 Okt 2026 13:03 WIB; jangan sentuh kode/freeze baseline tersebut tanpa alasan. Fast Delta incremental aktif, Recovery setiap 30 menit; data/checkpoint **tidak** dibekukan. Role NetSuite wajib persis `PNM NetSuite Backup Integration` (`customrole1042`), OAuth 2.0 M2M JWT PS256, setting `Run Server SuiteScript and Trigger Workflows` tetap OFF. Modul berikutnya **Purchase Order**, dimulai dari probe SuiteQL read-only. WAJIB reuse arsitektur, struktur, mapping/sync/presence/check/recovery, shared lock, checkpoint overlap+atomic, source movement guard, dan safety yang sama seperti empat modul. Jangan bikin file `-vN` atau arsitektur sendiri. Utamakan next step nyata dan satu paket revisi setelah cukup bukti, bukan troubleshooting repetitif. Hormati batasan IR header amount/GL dan pending IR freshness. Bila perlu file terbaru, minta hanya kode project tanpa secrets. Berikan perintah Windows PowerShell dan jelaskan setiap keputusan teknis yang beda dari existing code.

---

**Akhir handover — status final: 4-modul production baseline FROZEN (kode/konfigurasi), live data/sync tetap RUNNING; next development: Purchase Order.**
