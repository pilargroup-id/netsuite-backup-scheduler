# NETSUITE BACKUP -> BIGQUERY — HANDOVER LENGKAP LIMA MODUL

**Dokumentasi lanjutan / Handover ke chat baru**  
**Tanggal cut-off:** 21 Oktober 2026 (Asia/Jakarta)  
**Baseline arsitektur:** Foundation V5.2 / Single Controller Clean yang diperluas secara terkontrol menjadi **5 modul**; istilah “5-module baseline” dalam dokumen ini adalah label handover, **bukan** klaim bahwa ada release resmi bernama V6.  
**Production state terakhir yang dilaporkan:** Recovery V3 slot **12:30 WIB**, 21 Oktober 2026, `FINAL_PASS`, `exitCode=0`, `timedOut=false`.  
**Project Windows:** `C:\netsuite-backup`  
**Prinsip wajib:** pertahankan kontrak yang sudah terbukti; modul berikutnya mengikuti pola existing, tidak membuat arsitektur sendiri.

> **BACA SEBELUM MENGUBAH APAPUN:** Dokumen ini menggabungkan fakta dari tiga handover historis dalam ZIP `netsuite-backup(6).zip`, berkas README patch Purchase Order yang pernah dibuat, kode/potongan kode yang dikirim pengguna, dan output produksi yang tampil dalam percakapan sampai 21 Oktober 2026. **Tidak ada akses langsung ke live folder Windows / sistem NetSuite / BigQuery dalam pembuatan dokumen ini.** Struktur “aktual” berikut adalah rekonstruksi terakhir yang didukung ZIP baseline + perubahan yang dikonfirmasi pengguna, bukan hasil live `tree` komputer. Bila ada konflik, baca kode aktif dan log terbaru; JANGAN mengarang. File rahasia sengaja tidak dilampirkan.

---

## 0. URUTAN PRIORITAS DAN ATURAN UNTUK ASISTEN/DEVELOPER BARU

1. **Fokus proyek**: backup/incremental mirror transaksi NetSuite ke BigQuery. Ini bukan proyek migrasi data dari BigQuery kembali ke NetSuite dan bukan penulisan transaksi ke NetSuite.
2. **Metode program sudah mapan.** Pakai `common/netsuite-client.mjs`, `common/bigquery-client.mjs`, `modules/<module>/`, Fast Delta tunggal, Recovery Controller tunggal, shared lock tunggal, scheduler V3 yang sama, dan data-checkpoint yang sudah ada.
3. **Freeze baseline kode empat modul awal:** Sales Invoice (SI), Item Fulfillment (IF), Sales Order (SO), Item Receipt (IR), kecuali bug nyata dibuktikan dan perubahan diisolasi. PO adalah modul kelima yang sudah operational. Jangan refactor empat modul untuk membuat modul keenam.
4. **Freeze bukan menghentikan data:** NetSuite terus berubah, Fast Delta/Recovery tetap berjalan, dan checkpoint bergerak saat commit sukses.
5. **Jangan bikin** `common/recovery-controller-v2.mjs`, `scripts/fast-delta-vN.mjs`, auth/OAuth client per-modul, scheduler baru, task baru per-modul, schema imitasi tanpa probe, atau banyak file versi sejenis.
6. **Jangan mengubah status audit menjadi PASS dengan cara mematikan check.** `FINAL_PASS` memerlukan semua bukti. `NEEDS_REVIEW` adalah sinyal keselamatan, bukan alasan bypass.
7. **PowerShell Windows** adalah shell target. Beri perubahan yang siap salin-tempel, buat backup file tepat sebelum patch, targetkan file spesifik, cek `node --check`, dan batasi uji writer agar tidak tabrakan dengan task otomatis.
8. **Hindari troubleshoot berulang tanpa bukti.** Mulai dari log/kode dan status; cari akar masalah, gunakan perintah paling sedikit yang memberi informasi cukup. Jangan menyuruh user melakukan pengecekan read-only berkali-kali sebagai pekerjaan rutin jika user meminta solusi otomatis.
9. **Jangan pernah minta/menuliskan** private key, OAuth client secret, JWT, Google service account private JSON, Telegram token atau kredensial lain dalam handover atau contoh perintah.
10. **Penting untuk chat baru:** UI warning `CHECK PASS`, `SYNC_OK`, `FINAL_PASS`, `AUDIT_CLEAN` punya semantik berbeda. Fast Delta PASS hanya membuktikan delta sync; full recovery `FINAL_PASS` adalah pemeriksaan menyeluruh pada titik waktu itu, bukan snapshot permanen tanpa perubahan.

## 1. TUJUAN BISNIS, CAKUPAN DAN KPI

- KPI Okt–Des 2026: rekonsiliasi transaksi **Sales Order, Item Fulfillment, Sales Invoice, Sales Return, Sales Payment, Purchase Order, Item Receipt, Purchase Invoice, Purchase Return, Bill**; tenggat yang tercatat **10 Desember 2026**.
- **Sudah integrated production lima modul:** Sales Invoice, Item Fulfillment, Sales Order, Item Receipt, Purchase Order.
- Modul lanjutan masih harus ditentukan menurut roadmap/business definition: Purchase Invoice/Vendor Bill serta transaksi retur/pembayaran yang belum diimplementasikan. **Jangan menyamakan “Purchase Invoice” dan “Bill” tanpa konfirmasi semantik NetSuite dan kebutuhan KPI**, walaupun Vendor Bill sering berkaitan dengan pembelian.
- Akuntansi NetSuite harus didasarkan pada bukti `Transaction`, `TransactionLine`, `TransactionAccountingLine` yang benar. Jangan menganggap header `total` sama dengan foreign totals, atau inventory accounting sama dengan amount transaksi lain.

## 2. SETUP AWAL NETSUITE — IDENTITAS, ROLE, HAK AKSES (WAJIB PERTAHANKAN)

### 2.1 Identitas tepat

| Item | Nilai/baseline |
|---|---|
| NetSuite account ID (historis) | `6930902` |
| Nama role tepat | **`PNM NetSuite Backup Integration`** |
| Role internal ID historis | **`customrole1042`** |
| Authentication | **OAuth 2.0 Machine-to-Machine (M2M), Client Credentials JWT PS256** |
| Sertifikat | certificate mapping NetSuite + RSA private/public key; histori setup memakai RSA 4096-bit |
| REST account base | `https://6930902.suitetalk.api.netsuite.com` |
| OAuth token endpoint | `/services/rest/auth/oauth2/v1/token` |
| Akses query | SuiteTalk REST Query / SuiteQL menggunakan OAuth role integrasi |
| Lokasi cek role | Setup -> Users/Roles -> Manage Roles -> cari role -> Edit -> Permissions |
| Konfigurasi source code | `credentials/netsuite-secrets.mjs` dibaca `common/netsuite-client.mjs` |

**Jangan salah:** `PNM NetSuite Backup Integration` adalah **nama ROLE**. `NetSuite Backup OAuth M2M` merupakan sebutan metode/konsep autentikasi, **bukan** nama role. Administrator UI juga tidak otomatis setara dengan role integrasi.

### 2.2 Permission yang pernah tercatat

| NetSuite tab | Permission | Level tercatat | Sifat bukti |
|---|---|---|---|
| Transactions | `Find Transaction` | `View` | Setup/handover historis |
| Transactions | `Invoice` | `View` | SI |
| Transactions | `Item Fulfillment` | `View` | IF |
| Transactions | `Sales Order` | `View` | SO |
| Setup | `REST Web Services` | `Full` | Query API |
| Setup | `Log in using OAuth 2.0 Access Tokens` | `Full` | OAuth M2M |
| Setup | `Deleted Records` | `View` | Audit `deletedrecord` |
| Reports | `SuiteAnalytics Workbook` | `Edit` | Dokumen awal 8 Oktober; cek lagi jika diperlukan |
| Lists | `Perform Search` | `View` | Dokumen awal; sempat relevan saat Transaction query gagal |

**Penting:** Ini bukan export role terkini / bukan seluruh daftar izin. Item Receipt dan Purchase Order telah dibuktikan **secara fungsional** dapat diprobe/sync, namun level izin masing-masing belum terbukti melalui export izin role secara utuh di materi yang tersedia. Bila modul berikutnya memerlukan `Purchase Order`, `Vendor Bill`, `Item Receipt`, `Vendor`, `Currency`, `Item`, `Location`, `Subsidiary`, `Accounting Period`, dsb.: cek izin READ yang diperlukan, jangan otomatis berikan `Full`. Percobaan SuiteQL gagal tidak selalu berarti data hilang; bisa masalah izin atau field unsupported.

### 2.3 Pengaturan NetSuite yang jangan disentuh

- **`Setup -> Import/Export -> CSV Import Preferences -> Run Server SuiteScript and Trigger Workflows = OFF`**. Wajib tetap OFF. Project ini polling REST/SuiteQL, tidak bergantung pada CSV-trigger workflow dan tidak boleh menyalakan ini untuk “membetulkan sync”.
- Jangan rotasi/ganti client ID, certificate mapping, integration record, role, atau private key bila OAuth sudah sehat tanpa prosedur keamanan terpisah.
- Jangan pakai ketidakhadiran record dari SuiteQL sebagai bukti deletion. Soft-delete hanya bila didukung bukti independen melalui `deletedrecord` sesuai aturan existing.
- NetSuite Audit Trail untuk audit transaksi dapat dilihat melalui **Transactions -> Management -> View Audit Trail**; jangan salah dengan Login Audit Trail.
- `transactionhistory` pernah terbukti tidak dapat dipakai untuk deletion audit pada setup ini.

### 2.4 Sertifikat/key lokal

- Pernah terjadi failure `ENOENT C:\netsuite-backup-cert\private.pem` ketika folder sertifikat sebelumnya dipindahkan; Fast Delta dan Recovery gagal.
- Path aktif yang diperbaiki dalam baseline historis: `C:\netsuite-backup\credentials\private.pem`, `PRIVATE_KEY_PATH` relatif via `fileURLToPath(new URL('./private.pem', import.meta.url))` pada file secrets. `public.pem` opsional tergantung keperluan salinan.
- `credentials/` dan `*.pem` wajib tidak disebarluaskan; periksa `.gitignore`. Jangan menyertakan file ini ketika berbagi ZIP project. Telegram DPAPI `.clixml` terikat konteks user/machine Windows.

## 3. PLATFORM DAN KONFIGURASI INFRA

| Aspek | Baseline |
|---|---|
| Mesin yang menjalankan job | Laptop/workstation **Windows**, bukan cloud VM always-on |
| Shell | Windows PowerShell |
| Project root | `C:\netsuite-backup` |
| Node | Node.js 20 baseline; task pernah menunjuk `C:\nvm4w\nodejs\node.exe` |
| Module format | JavaScript ESM `.mjs` |
| GCP project | `even-gearbox-255203` |
| BigQuery dataset | `netsuite_backup` |
| BigQuery region | `asia-southeast1` |
| Package historis | `@google-cloud/bigquery` ^8.3.1; `jsonwebtoken` ^9.0.3 (cek package aktif) |
| Checkpoint table | `sync_checkpoints` |
| Checkpoint fields | `record_type STRING`, `last_successful_modified_at DATETIME`, `last_successful_sync_at TIMESTAMP`, `updated_at TIMESTAMP` |
| Incremental strategy | `lastmodifieddate`, 5-minute overlap; validasi pasangan header/lines |
| Scheduler timezone | `Asia/Jakarta` |

### 3.1 Scheduler config historical baseline

`config/scheduler.json`: `mode=production`; workflow `common/recovery-controller.mjs`; production `intervalMinutes=30`, jam 08:00–22:00, hari 0–6, `maxRunMinutes=120`, `maxLogDays=30`. Testing mode dalam sejarah punya interval 10 menit/window 00:00–23:59; **jangan memindahkan production ke test untuk mempercepat percobaan**.

`config/self-healing.json` pada ZIP baseline: `enabled=true`, `catchUpSync=true`, `maxRecoveryPerModulePerRun=3`, `verifiedDeletionEnabled=true`, `verifiedIFDeletionEnabled=true`. Angka ini **berbeda dari batas IF accounting bounded repair** (8 per batch × 4 batch) dan dari cap verified deletion (3) di controller: jangan campur.

### 3.2 BigQuery dan kontrak transaksi

- Staging/temporary table -> data/source validation -> atomic `MERGE` header + replace lines terkait + update checkpoint **dalam transaksi** -> verify duplicate/orphan/amount/line totals. Jika gagal, checkpoint **tidak** bergerak.
- `--dry-run` benar-benar no-write; `--sync` melakukan penulisan yang diminta secara eksplisit.
- Existing pair checkpoint header/lines harus konsisten. Jangan melakukan reset checkpoint demi menghilangkan status `NEEDS_REVIEW`.
- Pencatatan source `lastmodifieddate` bisa bergerak saat proses penuh audit berjalan. Controller membedakan source movement vs mismatch yang stabil, memakai bounded retry dan tidak menandai `FINAL_PASS` ketika masih ambigu.
- Jangan mengubah transaksi NetSuite via project ini.

## 4. STRUKTUR FOLDER AKTIF TERAKHIR (REKONSTRUKSI DARI ZIP + PATCH)

```text
C:\netsuite-backup\
|-- .docs\
|   |-- 1_NETSUITE_BIGQUERY_PROGRESS_HANDOVER_2026-10-08.md
|   |-- 2_NETSUITE_BACKUP_HANDOVER_FOUNDATION_V5_2_2026-10-14.md
|   |-- 3_NETSUITE_BACKUP_HANDOVER_BASELINE_4_MODULE_2026-10-20.md
|   `-- 4_NETSUITE_BACKUP_HANDOVER_5_MODULE_2026-10-21.md  <-- SALIN FILE INI KE SINI
|-- .gitignore
|-- package.json
|-- package-lock.json
|-- credentials\                     [RUNTIME SECRET; JANGAN SHARE]
|   |-- netsuite-secrets.mjs
|   |-- private.pem
|   `-- public.pem                 [jika ada]
|-- common\
|   |-- netsuite-client.mjs
|   |-- bigquery-client.mjs
|   |-- child-runner.mjs
|   |-- shared-lock.mjs
|   |-- recovery-controller.mjs   [5 modul, opt-in PO, IF bounded recovery]
|   |-- source-movement.mjs
|   |-- presence-reconcile.mjs
|   |-- sync-utils.mjs
|   |-- targeted-recovery.mjs
|   `-- so-mismatch-candidates.mjs
|-- config\
|   |-- scheduler.json
|   |-- self-healing.json
|   |-- verified-deletion-example.json
|   |-- telegram-chat-id.txt
|   `-- telegram-credential.clixml
|-- modules\
|   |-- sales-invoice\
|   |   |-- mapping.mjs
|   |   |-- sync.mjs
|   |   |-- presence.mjs
|   |   |-- check.mjs
|   |   `-- recover.mjs
|   |-- item-fulfillment\
|   |   |-- mapping.mjs
|   |   |-- sync.mjs
|   |   |-- presence.mjs
|   |   |-- check.mjs
|   |   |-- reconcile-accounting.mjs
|   |   |-- repair-accounting-bounded.mjs   [PATCH 21 Okt: 8 x 4]
|   |   `-- recover.mjs
|   |-- sales-order\
|   |   |-- mapping.mjs
|   |   |-- sync.mjs
|   |   |-- presence.mjs
|   |   |-- check.mjs
|   |   |-- repair-active.mjs
|   |   `-- recover.mjs
|   |-- item-receipt\
|   |   |-- probe.mjs
|   |   |-- mapping.mjs
|   |   |-- sync.mjs
|   |   |-- presence.mjs
|   |   |-- check.mjs
|   |   |-- check-financial.mjs
|   |   `-- recover.mjs
|   `-- purchase-order\
|       |-- probe.mjs
|       |-- diagnostic.mjs
|       |-- reconcile-probe.mjs
|       |-- mapping.mjs
|       |-- sync.mjs          [checkpoint concurrency retry hotfix]
|       |-- presence.mjs
|       |-- check.mjs         [exact decimal hotfix]
|       `-- recover.mjs       [targeted recover intentionally disabled]
|-- scripts\
|   |-- fast-delta.mjs       [5 modules if NETSUITE_PO_ENABLED=1]
|   |-- run-fast-delta.ps1   [sets NETSUITE_PO_ENABLED=1]
|   |-- run-fast-delta-hidden.vbs
|   |-- scheduler-runner.mjs [parser 5 modules; child env enables PO]
|   |-- scheduler-watchdog.mjs
|   |-- fast-delta-freshness.mjs
|   |-- fast-delta-freshness-alert.mjs
|   |-- freshness-incident-core.mjs
|   |-- run-freshness-monitor.ps1
|   |-- monitor-alert.mjs
|   |-- monitor-notify.ps1
|   |-- shared-lock-inspect.mjs
|   |-- diagnose-transaction.mjs
|   `-- verified-deletion.mjs
|-- tests\
|   |-- foundation-test.mjs
|   |-- child-runner-test.mjs
|   |-- fast-delta-integration-test.mjs
|   `-- source-movement-test.mjs
|-- logs\                        [RUNTIME; FILE BERUBAH]
|   |-- scheduler\
|   |   |-- latest.json
|   |   |-- history.jsonl
|   |   |-- skips.jsonl
|   |   |-- run-*.log
|   |   `-- .running.lock\owner.json   [HANYA KETIKA LOCK AKTIF]
|   `-- fast-delta\
|       |-- health-v2.json
|       `-- run-*.log
|-- backups\                     [LOCAL BACKUPS]
|-- node_modules\                [LOCAL DEPENDENCIES]
`-- [other local operational files; verify live tree]
```

**Catatan struktur:** Urutan `mapping.mjs`, `sync.mjs`, dst. pada diagram adalah pengelompokan fungsi, bukan penetapan file loading order. `.docs/4_...` baru hadir di Windows **jika user menyalin file yang diunduh ini**. Folder ZIP `netsuite-backup(6).zip` di materi referensi dibuat sebelum modul PO dan patch terbaru; jangan gunakan ZIP itu mentah-mentah untuk overwrite folder aktif tanpa merge konservatif. File backup bertimestamp juga dapat berada di samping script (`*.bak-...`) yang tidak ditampilkan semua di tree.

### 4.1 Backup penting yang dilaporkan pengguna

- `scripts/scheduler-runner.mjs.bak-20261020-165335` — sebelum perbaikan parser 5 modul.
- `modules/item-fulfillment/repair-accounting-bounded.mjs.bak-20261021-111826` — sebelum patch multi-batch accounting.
- `scripts/run-fast-delta.ps1.bak-20261020-153517` — sebelum mengaktifkan PO Fast Delta.
- Backup `common/recovery-controller.mjs.bak-<timestamp>` seharusnya dihasilkan oleh patch IF catch-up (timestamp **tidak dikonfirmasi user**).
- Backup historis pada `backups/code-before-ir-integration-20261020-114747`, `backups/code-before-reliability-fix-20261020-090831`, `backups/code-before-source-movement-fix-20261020-111429` dari ZIP sebelumnya.

## 5. KOMPONEN, ALUR DAN BATASAN KESUKSESAN

### 5.1 NetSuite read path

`common/netsuite-client.mjs` mengurus token JWT/OAuth, `fetchAll` SuiteQL pagination/batching; hindari query hardcoded login/per-modul. Validasi sumber dilakukan sebelum write. Data pembelian dapat multicurrency, gunakan raw `foreigntotal`/`total` masing-masing dengan benar. Suatu field NetSuite bisa tidak queryable di `Transaction`, jangan berasumsi tersedia.

### 5.2 Fast Delta

- `scripts/fast-delta.mjs`, via Windows `NetSuite Backup Fast Delta`, mengeksekusi sync modular incremental. PO terdaftar opt-in melalui `NETSUITE_PO_ENABLED === '1'`.
- Aktivasi production dilakukan di `scripts/run-fast-delta.ps1`, dengan `$env:NETSUITE_PO_ENABLED = "1"` **sebelum** pemanggilan `& node "C:\netsuite-backup\scripts\fast-delta.mjs" --sync ...`.
- Hidden launcher: `wscript.exe "C:\netsuite-backup\scripts\run-fast-delta-hidden.vbs"`, VBS menjalankan PowerShell script hidden dan menunggu exit.
- Fast Delta 5 modul pernah dieksekusi lewat schedule dan menghasilkan seluruh modul `SYNC_OK`, `FAST DELTA SYNC PASS; FULL RECONCILIATION NOT PERFORMED`, exit code 0. **Ini bukan pengganti Recovery check.**
- Konsistensi built-in markers, no-change markers, `child-runner.mjs`, timeout dan exit code tetap dijaga; jangan tanda sehat dari output parsial saja.

### 5.3 Recovery V3 (setiap 30 menit dalam window)

- `NetSuite Backup V3` menjalankan `C:\nvm4w\nodejs\node.exe "C:\netsuite-backup\scripts\scheduler-runner.mjs"`.
- Runner melihat slot `config/scheduler.json`. Windows trigger bisa setiap 10 menit, tetapi recovery nyata hanya di `:00` dan `:30` (dalam window). `NOT_INTERVAL_SLOT` adalah normal. `latest.json` hanya mencerminkan run terakhir yang **selesai**, jadi bisa terlihat lama ketika task masih `Running`.
- Runner membuat child `common/recovery-controller.mjs --all --sync`, memakai shared lock dan child environment set `NETSUITE_PO_ENABLED:'1'` untuk memasukkan PO di lima modul. Existing `NETSUITE_VERIFIED_DELETE_CONFIRM:'I_CONFIRM_VERIFIED_SOFT_DELETE'` dipertahankan.
- Single `common/recovery-controller.mjs` mengurutkan `sales-invoice`, `item-fulfillment`, `sales-order`, `item-receipt`, lalu `purchase-order` bila flag `1`.
- Alur controller: core sync -> presence -> accounting khusus IF -> check; bounded retry jika belum PASS; klasifikasi source movement; bounded targeted repairs sesuai guard; full validation ulang. Tidak mencampur audit-only dengan production writer.
- `scripts/scheduler-runner.mjs` **telah dipatch 20 Oktober sekitar 16:53** untuk `expected` kelima modul dan regex kelima modul. Sebelumnya hanya mengenali SI, IF, SO sehingga bisa berisiko false-green jika IR tidak dievaluasi dengan benar. Parser kini menuntut **lima** status `FINAL_PASS` untuk siklus yang mengaktifkan PO. Patch langsung production dengan expected five; **jangan menonaktifkan PO di runner tanpa menyesuaikan expectation secara aman**.
- Recovery V3 slot 17:00 WIB 20 Oktober pasca-patch: lima module `FINAL_PASS` dan runner `FINAL_PASS` exit0.
- Recovery V3 21 Oktober slot 12:30 WIB: `FINAL_PASS` exit0, timeout false. Karena user tidak menampilkan detail Recovery Summary untuk slot 12:30, konfirmasi lima modul secara individual terakhir yang ditampilkan penuh adalah slot 17:00 20 Oktober, dengan log-log 21 Oktober menunjukkan empat modul selain IF `FINAL_PASS`.

### 5.4 Shared lock / penjadwalan dan safety

- `common/shared-lock.mjs`: lock writer bersama Fast Delta dan Recovery. Path `logs/scheduler/.running.lock/owner.json` berisi metadata seperti PID/host/token/startedAt/worker.
- **DILARANG** menghapus lock yang sedang dimiliki proses hidup, meng-kill proses acak, atau menjalankan `node ... --sync` paralel scheduled task.
- Fast Delta manual ketika Recovery memegang lock bisa `SKIPPED_LOCKED`; itu perilaku safety, **bukan** sync gagal.
- Windows task `0x41301` / `267009` menunjukkan masih berjalan. `LastTaskResult=0` bisa berarti task launcher selesai normal walau internal runner skip suatu slot; audit `latest.json` dan `run-*.log` untuk hasil recovery sebenarnya.
- Operasional berjalan di laptop: jika komputer offline/sleep/logged out (Interactive task), sinkronisasi tidak berjalan pada periode itu dan perlu catch-up setelah mesin aktif. Jangan mengklaim availability 24/7.

### 5.5 Monitoring tambahan

- `scheduler-watchdog.mjs` mengawasi scheduler.
- Freshness monitor/Telegram/health-v2 memiliki batas versi; **materi terakhir secara eksplisit mengingatkan** bahwa freshness sebelumnya hanya terbukti menampilkan SI, IF, SO walaupun IR dan PO sudah sync. Status monitor untuk IR/PO **jangan diklaim lengkap tanpa bukti**. Integrasi observability terpisah dari data correctness.

## 6. STATUS DAN KARAKTER MODUL SATU PER SATU

### 6.1 Sales Invoice (SI)

- Root `modules/sales-invoice` dengan mapping/sync/presence/check/recover.
- Oct 2026 historical sample final: 329 invoices; total amount **11,024,326,946.66** pada salah satu snapshot awal. Nilai bisa berubah dengan transaksi baru/soft deletion.
- Pernah ditemukan 8 BQ-only invoices (internal ID `3147029..3147036`) tidak lagi visible NetSuite. `deletedrecord` audit membuktikan deletion 14 Okt, dan 8 dokumen di-soft-delete secara terverifikasi. Tidak boleh soft-delete semata dari SuiteQL absence.
- Verifikasi presence, totals, duplicate/orphan, field check. Legacy role `Invoice=View`. SI `FINAL_PASS` pada Recovery multi-modul yang ditampilkan.

### 6.2 Item Fulfillment (IF)

- Tabel BigQuery: `item_fulfillment_headers`, `item_fulfillment_lines`.
- Akuntansi/COGS dihitung melalui `TransactionAccountingLine` (berdasarkan `buildData` dalam `mapping.mjs`); `reconcile-accounting.mjs` membaca seluruh Oktober (untuk snapshot ini): `2026-10-01` inclusive sampai `2026-11-01` exclusive.
- `reconcile-accounting.mjs` secara default **READ ONLY**, `--apply` hanya diizinkan jika `--id <positive integer>`; bulk write langsung **dilarang**.
- BQ header `total_cogs_amount`; BQ lines `cogs_amount`, `line_unique_key`, `quantity_shipped`; header juga memiliki `netsuite_last_modified_at` dan soft-delete guard.
- Targeted accounting repair menuntut line keys/count, quantity, header timestamp sama, nilai COGS numeric valid; BQ transaction update header+lines, assert line sum = header COGS, commit atau rollback; **checkpoint tidak berubah karena accounting-only repair**.
- Caveat: pemeriksaan quantity dilakukan di luar transaksi, line count/key divalidasi ulang di SQL transaksi; source read tidak immutable di NetSuite, sehingga race condition lintas sistem tidak bisa dibilang mustahil.
- `modules/item-fulfillment/recover.mjs` adalah **targeted per-ID general recovery** (`--id` dengan `--dry-run` / `--apply`), **bukan** automatic accounting batch controller. Auto accounting via `reconcile-accounting.mjs`, `repair-accounting-bounded.mjs` dan cabang khusus `common/recovery-controller.mjs`.
- Accounting mismatch **bukan** diperbaiki dengan delta-sync biasa bila biaya berubah tanpa `lastmodifieddate` yang terdeteksi; itu salah satu hipotesis teknis, **belum dibuktikan** sebagai akar sumber 15 transaksi.

### 6.3 Sales Order (SO)

- `modules/sales-order/{sync,mapping,presence,check,repair-active,recover}.mjs`.
- Multi line class/discount/tax/other item, tanda signed source khas SO, field-by-field, quantity, checkpoint.
- SO `repair-active.mjs` punya guarded per-ID dry-run dan apply, dipanggil controller hanya setelah parser `common/so-mismatch-candidates.mjs`, presence bersih, daftar kandidat lengkap dan terbatas (`<=8` pada blok controller), validasi dan exit marker.
- Pada log 21 Okt sempat ada `sales-order/check.mjs exited 1`, controller melakukan source-moving retry, namun final Recovery Summary yang ditampilkan tetap `sales-order: FINAL_PASS`.

### 6.4 Item Receipt (IR)

- `modules/item-receipt/{probe,mapping,sync,presence,check,check-financial,recover}.mjs`.
- Tabel `item_receipt_headers` dan `item_receipt_lines`; checkpoints `item_receipt_headers`, `item_receipt_lines`.
- Validasi financial IR memperhatikan source receipt termasuk non-item GL; historis ada 6 receipts tanpa item lines. `header.total_amount` null pada historis 93 IR adalah perilaku pemodelan yang sah, bukan null error.
- Source historis: initial 93 headers, 244 lines, kemudian 95/249. Nilai historis net 3,035,920,320.41, qty 325,152; bukan KPI live.
- Sync strict `--dry-run` vs `--sync`, staging/atomic, pair checkpoint, no-change marker `ITEM RECEIPT NO CHANGES: SUCCESS`, success changed `ITEM RECEIPT SYNC SUCCESS`.
- Targeted recovery per-ID perlu guard; jangan memaksa `recover.mjs` menjadi automatic write bila implementasi sekarang sengaja tidak diaktifkan.

### 6.5 Purchase Order (PO) — Modul kelima ditambahkan 20 Okt 2026

**Struktur yang dikirim patch:** `modules/purchase-order/{probe,diagnostic,reconcile-probe,mapping,sync,presence,check,recover}.mjs`.

**NetSuite semantics yang ditemukan:**

- `Transaction.type='PurchOrd'`.
- Snapshot probe awal Okt 2026: **125** headers, **633** raw `TransactionLine`, dari jumlah itu 125 mainline dan **508** non-mainline; klasifikasi detail tercatat 338 ASSET, 6 EXPENSE, 39 OTHER, 125 TAX.
- `SUM(TransactionLine.foreignamount)` termasuk mainline balance 0 per PO pada diagnosis awal; **jangan simpan mainline sebagai detail**.
- `foreigntotal` dan `total` berbeda konsep/sign/mata uang; PO multicurrency; simpan semantics field yang diprobe dan jangan anggap qty × rate = raw foreign amount.
- `Transaction.subsidiary` dan `Transaction.createdfrom` **tidak tersedia** pada SuiteQL `Transaction` yang diuji; sengaja tidak dipaksa.
- Numeric currency `NUMERIC` enam digit decimal untuk raw finance field sesuai PO module. Exact decimal parsing/mapping: scientific notation seperti `-5.950000044E7` harus tetap presisi, diperbaiki dengan BigInt; larang implicit JS float untuk perbandingan exact.

**Kode/flow:**

- `probe.mjs`, `diagnostic.mjs`, `reconcile-probe.mjs` untuk diagnosis sumber read-only, bukan sync write.
- `mapping.mjs` membentuk rows konsisten, decimal validation; PO `cents()` mapping diperbaiki scientific-notation.
- `sync.mjs` memerlukan tepat salah satu `--dry-run` / `--sync`, staging BQ, atomic header merge + detail replacement + paired PO checkpoints. Presence/check dan konsistensi key/integrity setelahnya. Tidak melakukan deletion inference.
- `check.mjs` sempat false mismatch ketika angka BigQuery dan NetSuite berbeda format string; hotfix membandingkan canonical exact decimal termasuk trailing zeros/scientific notation.
- `presence.mjs` read-only, tidak men-soft-delete absent documents.
- `recover.mjs` dari foundation patch sengaja disabled untuk targeted recovery; jangan mengaktifkan per-ID repair tanpa bukti.
- PO check output pernah mengatakan `scheduler/recovery NOT enabled`: itu string statis historis, **bukan** dynamic detector env flag; lihat controller/runner logs untuk status efektif.
- Data final PO October setelah sync: **132 headers**, **529 lines**, 0 mismatches, duplicate 0, orphan 0; `PURCHASE ORDER CHECK PASS`, `purchase-order/presence.mjs` PASS.
- PO checkpoint record types `purchase_order_headers`, `purchase_order_lines`.

**Checkpoint BigQuery concurrent transaction failure dan hotfix:**

- Pertama kali `--sync` PO sering gagal dengan conflict/concurrent modification pada shared `sync_checkpoints`. Investigasi `INFORMATION_SCHEMA.JOBS_BY_PROJECT` membuktikan overlap writer checkpoint antara SI, IF, SO, IR, PO di jadwal berdekatan.
- Hotfix **hanya** `modules/purchase-order/sync.mjs`: retry keseluruhan transaction yang guarded (maksimal 3 kali) dengan backoff kira-kira **1.5s, 3.5s, 7s**; harus menghindari checkpoint maju sebelum commit sukses. PO kembali berhasil, tanpa mengubah shared checkpoint table atau empat modul lama. Jangan menambah retry ke semua modul tanpa bukti kebutuhan.
- PO standalone Recovery Controller dengan `$env:NETSUITE_PO_ENABLED='1'`, `node .\common\recovery-controller.mjs purchase-order --sync` sukses `purchase-order: FINAL_PASS`.
- Fast Delta dan V3 Recovery PO kemudian aktif dan terbukti otomatis.

## 7. RIWAYAT PERUBAHAN PRODUKSI PENTING DI CHAT INI — KRONOLOGIS

### 7.1 20 Oktober — foundation awal empat modul

Sebelum PO, SI/IF/SO/IR telah beroperasi. Foundation V5.2, shared lock, Windows Task Scheduler, source movement detection, verified deletion guard, staging/checkpoint transaction dan IR sync sudah terbentuk. Ini titik acuan kompatibilitas.

### 7.2 20 Oktober — PO probe dan diagnosis

Query read-only NetSuite untuk PO menunjukkan PurchOrd multicurrency, 125/633 raw/508 detail snapshot, serta field SuiteQL unavailable. Dibuat modul PO foundation tersendiri. Tidak memperkenalkan service client, scheduler, atau data source baru.

### 7.3 20 Oktober — PO numeric dan checker hotfix

- Mapping scientific notation `cents()` BigInt/exact; sebelumnya parsing JavaScript tidak akurat pada notasi eksponen.
- `check.mjs` diperbaiki agar membandingkan nilai decimal secara exact, bukan string formatting / floating-point. Hanya patch PO; empat modul lain tidak disentuh.

### 7.4 PO production write, retry checkpoint dan operational integration

- First production sync PO menemui concurrent modification BigQuery `sync_checkpoints` saat bertabrakan dengan beberapa transaksi checkpoint writer. Audit `INFORMATION_SCHEMA.JOBS_BY_PROJECT` membuktikan overlap.
- Bounded retry PO sync (maksimal 3, backoff historis 1.5/3.5/7 detik) memperbaiki konflik tanpa reset checkpoint.
- PO berhasil sampai **132 headers, 529 detail lines**, mismatches 0, duplicate/orphan 0, `PURCHASE ORDER CHECK PASS` dan presence PASS.
- `scripts/fast-delta.mjs` dan `common/recovery-controller.mjs` ditambahkan dukungan PO **conditional** berdasarkan `NETSUITE_PO_ENABLED === '1'`; PO core menggunakan sync, presence, check yang sama.
- `scripts/run-fast-delta.ps1` menjalankan `NETSUITE_PO_ENABLED = '1'` sebelum Fast Delta; VBS launcher tetap sama. Backup `.bak-20261020-153517`.
- Standalone guarded PO recovery telah `FINAL_PASS`. Scheduled Fast Delta kemudian lima modul `SYNC_OK`, `FAST DELTA SYNC PASS; FULL RECONCILIATION NOT PERFORMED`, exit0.

### 7.5 20 Oktober — BUG Scheduler V3 hanya menilai 3 modul

Di `scripts/scheduler-runner.mjs` fungsi `resultStatus()` sebelum patch memiliki `expected` hanya `sales-invoice`, `item-fulfillment`, `sales-order` dan regex status hanya 3 nama tersebut. Artinya Item Receipt dan Purchase Order diabaikan saat validasi jumlah modul, berisiko *false green*. User meminta fix kelima modul.

Patch yang **dilaporkan sukses dipasang pengguna** pada 20 Okt sekitar 16:53:

```javascript
const expected = [
  'sales-invoice',
  'item-fulfillment',
  'sales-order',
  'item-receipt',
  'purchase-order'
];
```

- Regex `^(sales-invoice|item-fulfillment|sales-order|item-receipt|purchase-order): ...`.
- Child process env di V3 ditambah `NETSUITE_PO_ENABLED:'1'`, mempertahankan `NETSUITE_VERIFIED_DELETE_CONFIRM:'I_CONFIRM_VERIFIED_SOFT_DELETE'`.
- `node --check` lulus; backup `C:\netsuite-backup\scripts\scheduler-runner.mjs.bak-20261020-165335`.
- Recovery 16:30 sebelum patch tidak dihitung sebagai bukti patch. Windows triggers 16:40/16:50 menghasilkan `NOT_INTERVAL_SLOT` (normal).
- **Recovery slot 17:00 (20 Okt):** log `run-2026-10-20T10-00-01.795Z.log`, recovery summary lima modul **semua `FINAL_PASS`**, scheduler FINAL_PASS, exit0, timedOut false.

### 7.6 21 Oktober — IF accounting mismatch 12 transaksi

Recovery V3 slot **10:30 WIB** (`run-2026-10-21T03-30-01.808Z.log`) status `NEEDS_REVIEW` exit3, disebabkan **Item Fulfillment**. Empat modul lainnya `FINAL_PASS`.

- IF Delta Sync: `ATOMIC MERGE + CHECKPOINT: SUCCESS`, BigQuery delta check PASS.
- Presence: `NetSuite=861 BQ active=861`, onlyNS=onlyBQ=0.
- IF Accounting audit: 861 headers, 2432 lines, qty 293651, source total COGS 8541415103.90, SOURCE VALIDATION PASS, namun **12** transaksi berbeda COGS.
- Controller sudah menjalankan source-moving retry, tetapi accounting mismatch tetap ada.

Rincian 12 mismatch historis:

| Internal ID | Fulfillment number | Source COGS | BQ COGS | Diff |
|---|---|---:|---:|---:|
|3154214|DO261010307|5664482.86|5664681.49|-198.63|
|3154879|DO261010344|7048651.31|7050142.26|-1490.95|
|3155181|DO261010357|4372060.97|4351442.54|20618.43|
|3155371|DO261010376|1937097.41|1937213.27|-115.86|
|3155400|DO261010383|857215.11|857330.97|-115.86|
|3155572|DO261010393|11165105.08|11165105.09|-0.01|
|3155576|DO261010395|17212122.64|17212549.92|-427.28|
|3155601|DO261010398|35356030.21|35304484.12|51546.09|
|3155713|DO261010404|42860755.53|42866548.51|-5792.98|
|3155742|DO261010408|5979180.08|5953407.03|25773.05|
|3155773|DO261010415|1714607.53|1714655.01|-47.48|
|3157109|DO261010496|13355287.50|12985058.17|370229.33|

**Penyebab NetSuite COGS berubah tanpa update timestamp adalah dugaan, BUKAN confirmed root cause.** Bukti hanya menyatakan COGS source vs BQ berbeda.

### 7.7 Audit kode IF accounting dan batas lama MAX=8

`modules/item-fulfillment/reconcile-accounting.mjs` read-only by default. `--apply` mewajibkan `--id` numeric, tidak ada bulk write. Source Transaction / TransactionLine / TransactionAccountingLine dimapping menggunakan `buildData()`. Before per-ID apply, line-key/count, quantity, timestamp harus match; header+line COGS di-update atomic dengan post-write sum assertion, rollback jika gagal; checkpoint tidak berubah karena accounting repair.

`modules/item-fulfillment/repair-accounting-bounded.mjs` *versi lama* memiliki `const MAX=8` lalu bila `ids.length>MAX` segera exit3. Akibat 12 mismatch, **dry-run auto repair diblokir sebelum satu pun candidate diproses**. User menegaskan max8 per run tidak scalable.

### 7.8 21 Oktober — IF automatic accounting multi-batch patch

Patch **berhasil dipasang** pengguna pukul 11:18:26, backup `C:\netsuite-backup\modules\item-fulfillment\repair-accounting-bounded.mjs.bak-20261021-111826`.

```javascript
const MAX_PER_BATCH = 8;
const MAX_BATCHES = 4;
const MAX_PER_RUN = MAX_PER_BATCH * MAX_BATCHES; // 32
```

Perilaku implementasi:

1. Initial full read-only audit dengan parser kandidat yang menuntut count dan ID konsisten, no duplicate.
2. Dry-run selalu read-only, menampilkan `ACCOUNTING DRY RUN PASS: no changes` bahkan bila backlog >8; mencatat planned budget max32.
3. `--apply`: setiap batch audit ulang backlog, ambil maksimal 8, setiap ID pre-audit terpisah, lalu `reconcile-accounting.mjs --id ID --apply`, validasi `ACCOUNTING REPAIRED: ID`.
4. Setelah batch, full audit ulang. Max4 batch atau 32 repair. Bila ada pending tetap exit3 `BOUNDED REVIEW`; bila final 0 => `IF ACCOUNTING AUTO RECOVERY PASS repaired=N batches=B postAudit=0`.
5. Perubahan NetSuite selama operasi dapat menyebabkan source inventory mismatch dan fail-closed; tidak ada forced PASS, tidak ada modifikasi checkpoint accounting-only.

Recovery V3 11:00 **sebelum** patch, jadi masih NEEDS_REVIEW dan tidak membuktikan patch gagal.

### 7.9 21 Oktober — Perbaikan 15 transaksi otomatis terobservasi

Slot **11:30 WIB** (`run-2026-10-21T04-30-01.794Z.log`) menggunakan patch terbaru dan log `LIMITS: batch=8 batches=4 maxPerRun=32`. Initial source & BQ = **870/870**.

- Batch 1: 8 sukses: `3154214`, `3154879`, `3155181`, `3155371`, `3155400`, `3155601`, `3155713`, `3155742`; `ACCOUNTING BATCH COMPLETE 1 repairedTotal=8 remaining=7`.
- Batch 2: 7 sukses: `3157109`, `3157641`, `3157646`, `3157652`, `3157660`, `3157663`, `3157672`.
- Total **15 explicit `ACCOUNTING REPAIRED`** markers. Masing-masing per-ID atomic; sudah ditulis walau final audit batch kemudian gagal.
- Setelah repair 15 tersebut, final full accounting audit melempar `Document inventory mismatch; run normal sync/presence first`, diikuti `Accounting command failed:`. V3 mengeluarkan IF `NEEDS_REVIEW`. Penyebab persis inventori bergerak selama audit belum ditelusuri sampai ID dokumen, tetapi inventory source vs BQ tidak sama pada snapshot akhir.
- SO sempat error `sales-order/check.mjs exited 1` dan retry, tapi summary akhir SO masih `FINAL_PASS`.

### 7.10 21 Oktober — Auditor read-only bersih setelah source catch-up

User sempat menjalankan dua perintah read-only manual **untuk troubleshooting sekali**, bukan sebagai workflow rutin yang diterima:

```text
MODULE: item-fulfillment | NetSuite=875 BQ active=875
ONLY BIGQUERY: 0 | ONLY NETSUITE: 0
SOURCE VALIDATION: PASS
Headers: 875
Lines: 2492
Quantity: 300812.000000
COGS: 8643762734.07
ACCOUNTING RECONCILIATION COMPLETE; differences=0; mode=READ ONLY
```

Makna: ketika di-audit ulang, inventory dan accounting bersih. User menegaskan **yang diinginkan FULL AUTOMATIC**; tidak boleh menjadikan manual presence/accounting checker syarat operasi harian.

### 7.11 21 Oktober — Usulan patch automatic IF inventory catch-up pasca-repair

User diberikan patch PowerShell untuk `common/recovery-controller.mjs` yang **mendeteksi** output `Document inventory mismatch` setelah sejumlah `ACCOUNTING REPAIRED: ID` berhasil, lalu menjalankan **satu** `run(base,['--core','item-fulfillment','--sync'])` tambahan dan memeriksa summary core. Bila fresh core `FINAL_PASS`, status IF baru PASS; bila belum clean, tetap `NEEDS_REVIEW` dan defer sampai scheduler berikutnya.

**Status bukti penting:** Perintah patch memang diberikan, tetapi hasil spesifik `PATCH SUCCESS` untuk patch controller **tidak terlihat** di percakapan. V3 FINAL_PASS 12:30 juga **tidak menjamin** jalur baru pernah terpanggil. Jadi bila relevan, inspeksi live `common/recovery-controller.mjs` untuk log marker `IF ACCOUNTING INVENTORY MOVED` / `IF ACCOUNTING CATCH-UP`; jangan mengasumsikan patch sudah installed atau teruji dengan forced source movement.

Contoh target branch yang dikirim:

```javascript
const applied=run(path,['--apply']);
if(applied.exit===0 && applied.out.includes('IF ACCOUNTING AUTO RECOVERY PASS')) {
  result=run(base,['--core',mod,'--sync']);
  current=verifySummary(result,mod);
} else {
  current='NEEDS_REVIEW';
  const inventoryMoved =
    applied.out.includes('Document inventory mismatch') ||
    applied.err.includes('Document inventory mismatch');
  const repairCommitted = /ACCOUNTING REPAIRED: [1-9][0-9]*/.test(applied.out);
  if(inventoryMoved && repairCommitted) {
    console.log('IF ACCOUNTING INVENTORY MOVED: automatic bounded catch-up');
    const catchup=run(base,['--core',mod,'--sync']);
    const catchupStatus=verifySummary(catchup,mod);
    if(catchupStatus==='FINAL_PASS') {
      result=catchup;
      current='FINAL_PASS';
      console.log('IF ACCOUNTING CATCH-UP: FINAL_PASS');
    } else {
      current='NEEDS_REVIEW';
      console.log('IF ACCOUNTING CATCH-UP: NEEDS_REVIEW; defer to next scheduled cycle');
    }
  }
}
```

Jika cabang ini ada, ia **tidak bypass** core accounting validation, cuma mengulang bounded catch-up sekali. Jangan memaksa FINAL_PASS ketika source tidak stabil.

### 7.12 21 Oktober — LAST KNOWN PRODUCTION STATUS

User mengirim `latest.json`:

```json
{
  "startedAt": "2026-10-21T05:30:01.746Z",
  "finishedAt": "2026-10-21T05:33:44.164Z",
  "mode": "production",
  "slot": "12:30",
  "status": "FINAL_PASS",
  "exitCode": 0,
  "timedOut": false,
  "log": "run-2026-10-21T05-30-01.746Z.log"
}
```

Artinya Recovery V3 12:30 setelah perbaikan lima-modul kembali **FINAL_PASS**, exit0, tidak timeout. Snapshot ini tidak menjamin tidak ada NetSuite transaction baru setelah 12:33:44.

## 8. KONTRAK KODE IF ACCOUNTING — SUPAYA TIDAK MENYIMPANG

### `reconcile-accounting.mjs`

- Import `token`, `fetchAll` dari `../../common/netsuite-client.mjs`, `query`, `T` dari `../../common/bigquery-client.mjs`, `buildData` dari `./mapping.mjs`.
- Snapshot saat ini hard-coded Oktober 2026: `FROM='2026-10-01'`, `TO='2026-11-01'`. Jika generalisasi bulan, perlu desain yang konsisten semua modul, bukan edit cepat satu file.
- `--apply` **WAJIB** disertai `--id <positive integer>`; bulk write secara langsung tidak ada.
- NetSuite source headers `Transaction` dengan `type='ItemShip'`. Baca tanggal/status/period/lastmodified. Details dibaca per batch maksimum 25 IDs dari `TransactionLine` dan `TransactionAccountingLine`.
- BigQuery active headers `item_fulfillment_headers`; lines `item_fulfillment_lines`; soft-deleted header dikecualikan dari audit aktif.
- Sebelum melakukan update header+lines, script membandingkan line unique keys/count, quantity shipped, dan header modified timestamp. Account COGS values divalidasi NUMERIC.
- SQL BigQuery transaction update `total_cogs_amount` pada header dan `cogs_amount` pada lines; `ASSERT SUM(line COGS) = header COGS`; rollback pada error. Accounting repair **tidak** mengubah `sync_checkpoints`.
- Perhatian: pemeriksaan quantity dilakukan sebelum transaksi BigQuery dan source NetSuite tidak immutable selama audit. Jadi tidak benar jika mengklaim race condition 100% mustahil.
- Markers: `ACCOUNTING RECONCILIATION COMPLETE; differences=N; mode=READ ONLY`, `ACCOUNTING REPAIRED: ID (header + N lines; checkpoints unchanged)`.

### `repair-accounting-bounded.mjs`

- Parsing kandidiat dari baris audit source/BQ + summary `differences=N`; reject mismatch inventory yang ambigu/duplicate.
- `MAX_PER_BATCH=8`, `MAX_BATCHES=4`, budget 32/run.
- Read-only default/no args. `--apply` adalah production writer dan hanya controller yang sebaiknya memanggil pada scheduled workflow.
- Per candidate: revalidate ID -> apply via targeted reconciler -> require exact `ACCOUNTING REPAIRED: ID`.
- Audit ulang setelah batch dan audit akhir; bila >32 ongoing atau source changed, **tidak** mengklaim PASS.

### `common/recovery-controller.mjs`

- Outer selected includes 4 baseline + PO via env flag; loop melanjutkan modul lain jika sebuah modul bermasalah.
- Core `--sync` performs normal sync/presence/accounting/check according to module requirements.
- Initial `NEEDS_REVIEW`: bounded source moving re-sync, parse movement; stable IF accounting mismatch -> guarded bounded repair dry-run, apply, verify core.
- SO mismatch repair terpisah, tidak memakai kode accounting IF.
- `verifySummary()` memeriksa per-module status marker dan bertentangan tidaknya exit code.
- Optional inventory movement catch-up patch (7.11) harus diinspeksi dalam live source jika dipakai.

## 9. TABEL BIGQUERY DAN CHECKPOINT — YANG SUDAH DIKETAHUI

| Modul | Header table | Line table | Checkpoint pair |
|---|---|---|---|
| SI | Lihat `modules/sales-invoice/sync.mjs` aktif | Lihat file aktif | Lihat record_type aktual |
| IF | `item_fulfillment_headers` | `item_fulfillment_lines` | Ikuti source sync.mjs aktif |
| SO | Lihat `modules/sales-order/sync.mjs` aktif | Lihat file aktif | Lihat record_type aktual |
| IR | `item_receipt_headers` | `item_receipt_lines` | `item_receipt_headers`, `item_receipt_lines` |
| PO | `purchase_order_headers` | `purchase_order_lines` | `purchase_order_headers`, `purchase_order_lines` |

Shared table: `sync_checkpoints`; fields `record_type`, `last_successful_modified_at DATETIME`, `last_successful_sync_at TIMESTAMP`, `updated_at TIMESTAMP`. Per-module transaction selalu commit bersama updated checkpoint. Jangan mengarang SI/SO/IF checkpoint names yang tidak dibuktikan oleh source saat ini; cek file asli sebelum modul baru.

Kriteria reconciliation setiap modul:

1. Source validity dan status/tanggal/period scope.
2. Presence NetSuite vs BQ active (missing counts dan exact IDs).
3. Field-by-field header/line comparisons dengan exact money precision.
4. Line keys unik, no orphan, no duplicate, expected detail/quantity dan amount.
5. Finance GL/COGS test jika transaksi accounting memerlukannya.
6. Verified deletion pakai `deletedrecord`, bukan absence.
7. Source movement ditangani bounded retry, tidak memaksa PASS.
8. Sync checkpoint advanced **hanya** setelah successful atomic commit.

## 10. OPERATOR COMMANDS — WINDOWS POWERSHELL

Perintah ini untuk inspeksi/diagnosis, bukan pekerjaan manual rutin tiap hari:

```powershell
cd C:\netsuite-backup

# Task status
Get-ScheduledTask -TaskName 'NetSuite Backup V3' | Select-Object TaskName,State
Get-ScheduledTaskInfo -TaskName 'NetSuite Backup V3' | Select-Object LastRunTime,NextRunTime,LastTaskResult

# Completed run terakhir, bukan live Running-status
Get-Content .\logs\scheduler\latest.json

# Baca summary sesuai file latest run (bukan glob semua log)
$latest = Get-Content .\logs\scheduler\latest.json -Raw | ConvertFrom-Json
$log = Join-Path 'C:\netsuite-backup\logs\scheduler' $latest.log
Select-String -Path $log -Pattern '^========== RECOVERY SUMMARY ==========$' -Context 0,7

# Jika ada incident IF accounting, baca event batch/catch-up dari log terbaru
Select-String -Path $log -Pattern 'ACCOUNTING BATCH COMPLETE|ACCOUNTING FINAL AUDIT|IF ACCOUNTING AUTO RECOVERY PASS|IF ACCOUNTING INVENTORY MOVED|IF ACCOUNTING CATCH-UP|BOUNDED REVIEW|ACCOUNTING RECONCILIATION ERROR' -Context 0,2

# Skip-slot normal
Get-Content .\logs\scheduler\skips.jsonl -Tail 10

# Apakah Node worker masih hidup?
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'netsuite-backup' } | Select-Object ProcessId,CommandLine

# Syntax checks setelah patch; tidak menulis database
node --check .\scripts\scheduler-runner.mjs
node --check .\common\recovery-controller.mjs
node --check .\modules\item-fulfillment\repair-accounting-bounded.mjs
node --check .\modules\purchase-order\sync.mjs

# Contract/unit tests sebagai bukti tambahan, BUKAN pengganti production reconciliation
npm test
node .\tests\source-movement-test.mjs
```

**Tidak boleh sembarangan menjalankan** `Start-ScheduledTask` ketika V3 masih Running, `sync.mjs --sync` paralel Fast Delta, `repair-*.mjs --apply` ketika worker sedang sync, reset `sync_checkpoints`, manual update/delete BigQuery, atau hapus `.running.lock` jika owner masih hidup. `SKIPPED_LOCKED` adalah guard, bukan error logic. Ketika Task Scheduler 0x41301/267009 menunjukkan Running, tunggu hasil completion tanpa memulai writer baru.

## 11. SCHEDULED TASK DAN OBSERVABILITY

- Known tasks `NetSuite Backup V3`, `NetSuite Backup Fast Delta`, `NetSuite Backup Watchdog`; handover sebelumnya juga menyebut task freshness/monitor (exact task name perlu `Get-ScheduledTask`, jangan mengarang).
- `NetSuite Backup V3` -> `C:\nvm4w\nodejs\node.exe "C:\netsuite-backup\scripts\scheduler-runner.mjs"`; runner sendiri menyeleksi slot.
- `NetSuite Backup Fast Delta` -> `wscript.exe "C:\netsuite-backup\scripts\run-fast-delta-hidden.vbs"` -> hidden PowerShell launcher -> Fast Delta.
- Fast Delta Task Windows sebelumnya `Queued` dengan `LogonType=Password`, dan `Set-ScheduledTask` gagal 0x8007052e. Diubah agar `Run only when user is logged on` / Interactive dan VBS menyembunyikan terminal. Task lain tidak dirombak sembarangan.
- Recovery interval 30 menit dalam window production. Windows task dapat dipanggil tiap 10 menit -> `NOT_INTERVAL_SLOT` untuk 10/20/40/50 menit normal. `latest.json` baru update setelah run finished.
- Watchdog Telegram, freshness dan health ada; **cakupan freshness/Telegram untuk IR/PO belum didukung bukti penuh**. Fast Delta PASS dan Recovery PASS tidak otomatis berarti setiap alert sudah mengawasi PO/IR.
- Mesin adalah Windows laptop. Ketika PC mati/tidur/logout, sync tidak jalan seperti sistem cloud always-on. Catch-up terjadi ketika task aktif lagi.

## 12. SUMBER PATCH DAN HANDOVER SEBELUMNYA

Referensi artefak yang disediakan pada sesi ini:

- `netsuite-backup(6).zip`: snapshot empat modul dan `.docs` sebelumnya. **Jangan overwrite production dengan ZIP lama.**
- `purchase-order-probe-patch.zip` — read-only PO probe.
- `purchase-order-diagnostic-patch.zip` — source diagnostic.
- `purchase-order-reconcile-probe-patch.zip` — source balancing probe.
- `purchase-order-foundation-patch.zip` — folder modul PO.
- `purchase-order-numeric-hotfix.zip` — exact scientific decimal parser fix.
- `purchase-order-check-hotfix.zip` — exact `check.mjs` money comparison fix.
- `purchase-order-checkpoint-retry-hotfix.zip` — transaction checkpoint retry PO.
- `purchase-order-operational-integration-guarded.zip` — gated PO Fast Delta dan Recovery Controller.
- Patch manual PowerShell selanjutnya: `scheduler-runner.mjs` 5-module, `repair-accounting-bounded.mjs` multi-batch dan proposed `recovery-controller.mjs` IF inventory catch-up.

Handover lama yang harus tetap tersedia di `.docs`:

1. `1_NETSUITE_BIGQUERY_PROGRESS_HANDOVER_2026-10-08.md` — setup awal role/OAuth/dataset/SI.
2. `2_NETSUITE_BACKUP_HANDOVER_FOUNDATION_V5_2_2026-10-14.md` — SI/IF/SO Foundation V5.2, audited deletion, scheduler evolution.
3. `3_NETSUITE_BACKUP_HANDOVER_BASELINE_4_MODULE_2026-10-20.md` — empat modul, IR, reliability, Windows tasks, shared lock.
4. **File ini** — PO + production 5 modules + IF batch/catch-up sampai 21 Okt.

## 13. STANDAR MODUL SELANJUTNYA — JANGAN NGIDE SENDIRI

### 13.1 Sebelum implementasi

1. Tetapkan tepat record NetSuite/`Transaction.type`, scope tanggal KPI, relasi bisnis dan sign financial. **Jangan otomatis menganggap “Purchase Invoice” sama dengan “Bill/Vendor Bill”**; perlu definisi dan probe dahulu.
2. Pastikan hak baca pada role **`PNM NetSuite Backup Integration`**; permissions di section 2 adalah historis, jangan mengarang permission baru, jangan berikan Full otomatis, dan jangan ubah global script/workflow setting OFF.
3. Probe SuiteQL **read-only** untuk field `Transaction`, `TransactionLine`, `TransactionAccountingLine` sesuai record. Cek mainline/taxline, source IDs/unique keys, duplicate, currency, `total` vs `foreigntotal`, posting/nonposting, class, item lines, GL accounting, negative sign, `lastmodifieddate`, void/delete. Periksa field availability dahulu; contoh PO `subsidiary` dan `createdfrom` tidak tersedia di Transaction.
4. Pilih modul rujukan paling dekat **berdasar transaksi**, tetapi **arsitektur** tetap sama. SI/SO bukan template financial PO tanpa diagnosis; IR/IF GL berbeda.

### 13.2 Folder file minimal dan pola implementation

`modules/<slug>/`:

- `probe.mjs` read-only field/types/samples.
- `mapping.mjs` deterministic transform, key, quantity/amount, decimal normalization.
- `sync.mjs` explicit `--dry-run` dan `--sync` (no implicit writes), checkpoint overlap+staging+atomic merge header/replace relevant lines+checkpoint.
- `presence.mjs` read-only onlyNS/onlyBQ (jangan auto-deletion tanpa proof).
- `check.mjs` full NetSuite-vs-BQ field-by-field, duplicates/orphans/amount integrity, distinct success marker.
- `recover.mjs` hanya bila targeted recovery benar-benar aman; bila tidak, sengaja disabled.
- `diagnostic.mjs`, `reconcile-probe.mjs`, `check-financial.mjs` bila diperlukan dan sesuai pola PO/IR.

Semua memakai `common/netsuite-client.mjs` dan `common/bigquery-client.mjs`. Tidak membuat OAuth/client baru di modul. BigQuery dataset dan region konsisten. Jika type numerik memakai `NUMERIC`, gunakan exact decimal, tidak JS floating-point yang mengubah jumlah rupiah/FX. Jangan tulis kode berdasarkan asumsi unsupported field.

### 13.3 Rollout tahap aman

1. Read-only probe + diagnosa metadata field dan klasifikasi accounting.
2. Mapping/test/dry-run no-write, validasi SQL dan source count.
3. Tabel/checkpoints modul baru dibuat dengan schema dan nilai yang sudah dibuktikan; tidak `DROP`/`TRUNCATE` tabel modul lain.
4. Controlled production sync hanya ketika task writer tidak sedang memegang lock; check/presence + financial validation.
5. Conditional activation di `scripts/fast-delta.mjs` serta `common/recovery-controller.mjs`, tidak mengubah urutan lima modul lama. Boleh gunakan feature flag, tetap konsisten activation pada Windows Fast Delta launcher dan V3 child env.
6. **WAJIB sinkronkan `scheduler-runner.mjs` `expected` + status regex** terhadap seluruh modul aktif. Jangan mengulang bug tiga modul. Jika flag module conditional, parser expected juga harus cocok. Fail-closed pada missing/duplicate status, tidak membiarkan overall FINAL_PASS palsu.
7. Preserve shared lock, scheduler interval, bounded source-moving retry, stdout markers dan exit codes, watchdog behavior. Jangan memperbanyak daemon/task per-modul.
8. Static `node --check`, `npm test`, source movement tests, read-only audits, production single controlled flow. Setelah aktivasi, buktikan **scheduled** Fast Delta `SYNC_OK` dan **scheduled** Recovery summary semua modul `FINAL_PASS` pada slot **sesudah patch**, bukan memakai latest pre-patch.
9. Observability/alert coverage untuk modul baru diverifikasi terpisah. Tidak otomatis lengkap hanya karena sync dan check PASS.

### 13.4 Larangan keras

- Jangan menurunkan accounting validations / memaksa status hijau.
- Jangan menjalankan manual accounting repair atau reset checkpoint sebagai solusi jangka panjang. Target user adalah **FULL AUTOMATIC**.
- Jangan menyimpulkan deleted berdasar NetSuite invisibility saja.
- Jangan menghapus lock saat writer hidup atau menjalankan writer paralel.
- Jangan mengaktifkan `Run Server SuiteScript and Trigger Workflows`.
- Jangan mengubah 5 modul existing/arsitektur scheduler/role global hanya untuk menambah modul ke-6.
- Jangan memperbanyak `-v2/-v3/-final-new` script/folder controller.

## 14. STATUS YANG TIDAK BOLEH DIBERI LABEL VERIFIED TANPA BUKTI

1. **Permission individual Purchase Order dan Item Receipt** di role saat ini: successful query/read confirmed, UI permission-level export belum ada.
2. **Catch-up branch IF yang baru di controller**: code patch disarankan, tetapi tidak ada output pengguna `PATCH SUCCESS` spesifik atau log bahwa cabang tersebut triggered. Verifikasi live jika penting, bukan asumsi.
3. **Freshness/Telegram untuk IR/PO**: belum terverifikasi full coverage, meski sync/recovery keduanya sudah jalan.
4. **Nama pasti semua tabel/checkpoint SI/SO dan IF checkpoint key**: ambil dari file `sync.mjs` aktif jika dibutuhkan; jangan karang untuk dokumentasi.
5. **Terbaru setelah 21 Okt 12:30**: `latest.json` slot 12:30 adalah snapshot terakhir di percakapan. Tidak menjamin keadaan setelah jam tersebut.
6. **Sumber utama perubahan COGS**: belum disimpulkan pasti, yang diketahui accounting mismatch hadir dan per-ID repair telah berhasil.
7. **PO total count** 132/529 dan **IF count** 875 adalah angka snapshot; transaksi baru bisa bertambah.

## 15. COPY-PASTE PESAN KE CHAT BARU

> Saya melanjutkan project `C:\netsuite-backup` di Windows PowerShell. Baca **seluruh file** `4_NETSUITE_BACKUP_HANDOVER_5_MODULE_2026-10-21.md` ini dan, bila perlu, tiga handover `.docs/1`, `.docs/2`, `.docs/3`. Production sudah memiliki lima modul **Sales Invoice, Item Fulfillment, Sales Order, Item Receipt, Purchase Order**, dengan latest Recovery V3 **21 Oktober 2026 slot 12:30 WIB `FINAL_PASS` exit0 timedOut false**. Setup NetSuite JANGAN BERUBAH: role tepat **`PNM NetSuite Backup Integration`** (ID historis `customrole1042`), OAuth2 M2M JWT PS256, `Run Server SuiteScript and Trigger Workflows = OFF`. GCP `even-gearbox-255203`, dataset `netsuite_backup`, region `asia-southeast1`. Semua modul menggunakan common NetSuite/BQ clients, single Fast Delta, single Recovery Controller V3, shared lock, 5-minute overlap, paired checkpoint atomic, presence/check/field integrity dan guarded source movement. PO `PurchOrd` sudah memiliki multicurrency mapping, scientific exact numeric parser, bounded retry checkpoint, Fast Delta dan Recovery conditional PO-enabled. Runner `scheduler-runner.mjs` parser harus **memastikan kelima modul** (bug lama hanya 3 sudah diperbaiki). IF accounting bounded recovery 8 per batch × 4 batch (maks32 per eksekusi), 15 per-ID repairs pernah sukses; IF audit terakhir 875 NetSuite = 875 BQ, differences0. Proposed IF post-repair inventory catch-up branch pada controller perlu dicek live bila relevan karena application/branch testing tidak eksplisit terbukti. Mulai modul berikutnya dari **SuiteQL probe read-only + role permission check**; jangan tebak record/schema, jangan membuat architecture/task/controller/OAuth baru, dan jangan merombak 5 modul existing. Saya tidak ingin workflow daily manual; sistem harus otomatis. Bikin patch PowerShell dengan backup dan safety, jangan mengubah checkpoint sembarangan.

## 16. RINGKASAN AKHIR (21 OKTOBER 2026)

| Komponen | Status didukung bukti |
|---|---|
| NetSuite M2M OAuth + SuiteQL | Berfungsi pada sync/reconciliation production |
| BigQuery/checkpoint | Berfungsi dalam atomic sync |
| SI | FINAL_PASS di 5-module recovery 20 Okt 17:00 dan 21 Okt 11:30 |
| IF | 15 per-ID accounting repair committed; setelahnya audit 875/875, differences0; V3 12:30 overall FINAL_PASS |
| SO | FINAL_PASS pada summary 20 Okt 17:00 dan 21 Okt 11:30 meski sempat retry |
| IR | FINAL_PASS pada summary 20 Okt 17:00 dan 21 Okt 11:30 |
| PO | 132 headers / 529 detail lines check PASS; FINAL_PASS di scheduled V3 |
| Fast Delta 5 modul | Scheduled `SYNC_OK` untuk semua 5 |
| Recovery V3 | **21 Okt 12:30 FINAL_PASS, exit0, timedOut=false** |
| IF bounded batch patch | Berjalan di production, batch 8+7 terbukti |
| IF post-repair catch-up branch | Usulan patch; pemakaian aktual belum terverifikasi khusus |
| Monitor/freshness PO/IR | Perlu verifikasi terpisah jika dibutuhkan |
| Baseline | Freeze arsitektur/behaviour stabil, **bukan** live data/jobs |

**END OF HANDOVER — gunakan dokumen ini sebagai acuan baseline 5 modul, bukan alasan untuk overwrite kode runtime dengan snapshot lama.**
