# NETSUITE BACKUP — MASTER HANDOVER MODULE 8 (PURCHASE RETURN) → MODULE 9 (SALES PAYMENT)

**Tanggal handover:** 26 Oktober 2026 (Asia/Jakarta)  
**Status:** Module 8 `INTEGRATED — NO_SOURCE / SCHEMA_ONLY`; V3 production workflow `FINAL_PASS` untuk run yang diverifikasi; **bukan** Purchase Return transaction-level `FINAL_PASS`.  
**Next:** Module 9 **Sales Payment / Customer Payment**, kandidat NetSuite type `CustPymt` **harus dipastikan lewat SuiteQL discovery**, sebelum tabel/mapping dibuat.  
**Deadline dari atasan:** **10 Desember 2026**.  
**Periode KPI:** Oktober, November, Desember **2026**.

> **WAJIB BACA SEBELUM CODING:** Dokumen ini menggabungkan bukti dari percakapan dan log pengguna, inspeksi baseline ZIP `netsuite-backup(20261026-014305).zip` (snapshot awal sebelum patch Module 8), dan ZIP incremental Phase A–G Module 8. Ini bukan dump repository live setelah semua patch. Untuk coding Module 9 **minta/cek ZIP source project paling mutakhir**, bukan memakai snapshot 01:43 sebagai final. Status yang dinyatakan PASS mengacu pada pengujian yang tertera, bukan klaim pengujian lain.

---

## 0. EXECUTIVE SUMMARY / KEPUTUSAN YANG TIDAK BOLEH BERUBAH

- **Tujuan proyek bukan membuat modul sebanyak mungkin**. Tujuan atasan: **jumlah transaksi DAN total amount NetSuite harus sama dengan BigQuery** untuk seluruh transaksi yang dicantumkan dalam scope, pada **Oktober–Desember 2026**, deadline **10 Desember 2026**.
- **Tidak ada data dummy**, transaksi buatan, fake checkpoint, laporan PASS palsu, force reimport hanya agar kelihatan cocok, atau perbaikan finansial otomatis tanpa evidence.
- Ada **10 baris istilah transaksi** dalam instruksi atasan, tetapi **Purchase Invoice / Vendor Bill / Bills** menunjuk ke satu NetSuite transaction type `VendBill` bila "Bill" yang dimaksud memang Vendor Bill. Dengan asumsi itu cakupan teknisnya **9 tipe unik**. Konfirmasi semantik "Bill" dengan atasan; **jangan buat modul duplikat**.
- **Delapan modul** telah dibuat sampai Purchase Return; **Sales Payment** merupakan next scope wajib, modul ke-9 dalam implementasi. Rencana modul ke-10 sampai ke-13 yang sempat diusulkan (Vendor Payment, Inventory Transfer, Inventory Adjustment, Journal Entry) **bukan permintaan atasan** dan **tidak boleh menggeser prioritas**. Tambahan hanya jika user memutuskan project terpisah di masa depan.
- **Purchase Return**: 15 historical `VendAuth` visible (2021–2026); **nol `VendAuth` untuk Oktober–Desember 2026** pada saat probe. 80 `VendCred` Oktober **bukan** otomatis Purchase Return karena sumber link-nya Vendor Bill. Maka 5 tabel PR dibuat kosong (`SCHEMA_ONLY`), checkpoint nol, dan scheduler memproses `NO_SOURCE` tanpa write dan tanpa `FINAL_PASS` palsu.
- Setelah patch Phase G, **Fast Delta**, **Recovery Controller**, dan **V3** mengenali Module 8. V3 production completed run **26-10-2026 10:40 WIB slot** `FINAL_PASS`, exit 0, log membuktikan `purchase-return: NO_SOURCE` dan tujuh modul sebelumnya `FINAL_PASS`. Ini bukti integration, **bukan** bukti PR actual sync atau live positive deletion.
- Testing **bertahap** berdasarkan output user per langkah; ZIP untuk setiap file JavaScript yang dibagikan; **jangan** menambahkan perintah membuat `.txt`/capture output, dan **jangan** memberi `Expand-Archive` ke user. User extract/replace manual. Seluruh output testing langsung di PowerShell.

---

## 1. PERINTAH ATASAN — SOURCE OF TRUTH SCOPE

Kutipan user secara substansi:

> "Jumlah transaksi dan total amount sudah sama dengan Netsuite: 1. Sales Order, 2. Item Fulfilment, 3. Invoice Penjualan, 4. Retur Penjualan, 5. Payment (Sales Payment), 6. Purchase Order, 7. Item Receipt, 8. Invoice Pembelian, 9. Retur Pembelian, 10. Bill; bulan Oktober, November, Desember 2026. Due Date: 10 Desember 2026."

| # permintaan | Nama atasan | Modul teknis | NetSuite `Transaction.type` | Kondisi akhir chat |
|---|---|---|---|---|
| 1 | Sales Order | `sales-order` | `SalesOrd` | V3 latest completed run `FINAL_PASS` |
| 2 | Item Fulfilment | `item-fulfillment` | `ItemShip` | V3 latest completed run `FINAL_PASS` |
| 3 | Invoice Penjualan | `sales-invoice` | `CustInvc` | V3 latest completed run `FINAL_PASS` |
| 4 | Retur Penjualan | `sales-return` | `RtnAuth` dan related physical/credit, sesuai mapping SR | V3 latest completed run `FINAL_PASS` |
| 5 | Payment (Sales Payment) | **`sales-payment` — NEXT** | Kandidat `CustPymt` — **probe dulu** | **BELUM dibuat** |
| 6 | Purchase Order | `purchase-order` | `PurchOrd` | V3 latest completed run `FINAL_PASS` |
| 7 | Item Receipt | `item-receipt` | `ItemRcpt` | V3 latest completed run `FINAL_PASS` |
| 8 | Invoice Pembelian | `purchase-invoice` | `VendBill` | V3 latest completed run `FINAL_PASS` |
| 9 | Retur Pembelian | `purchase-return` | `VendAuth` + downstream relations | `SCHEMA_ONLY` / `NO_SOURCE` |
| 10 | Bill | **`purchase-invoice` (jika Vendor Bill)** | `VendBill` | Sudah ditangani, **konfirmasi definisi bisnis** |

**PENTING:** status `FINAL_PASS` tujuh modul di atas berdasarkan satu V3 completed run yang terekam; tidak berarti setiap bulan November–Desember 2026 sudah lengkap per tanggal 26 Oktober, karena bulan tersebut masih akan datang. Reconciliation rolling dan akhir periode tetap wajib. Jangan hitung jumlah modul dengan cara menganggap dua nama untuk `VendBill` sebagai dua dataflow berbeda.

---

## 2. SETUP NETSUITE — IDENTITAS & PERMISSION WAJIB DIPERTAHANKAN

### 2.1 Nama tepat dan authentication

| Item | Setting baseline |
|---|---|
| **Role** | **`PNM NetSuite Backup Integration`** |
| Role internal ID historis | `customrole1042` (cek live bila diperlukan; jangan asumsi ID tak bisa berubah) |
| **Integration record** | **`PNM NetSuite Backup`** |
| Auth | **OAuth 2.0 Machine-to-Machine (client credentials with JWT assertion)** |
| JWT signature | **`PS256`**, private key dan certificate existing |
| API | REST Web Services SuiteQL |
| `Run Server SuiteScript and Trigger Workflows` | **OFF**, jangan dinyalakan |
| Kebutuhan permission bisnis | Minimal **View**, bukan Edit/Full tanpa alasan |
| Endpoint / auth code | Gunakan **`common/netsuite-client.mjs`**; jangan membuat implementasi OAuth lain |

Fitur akun SuiteCloud yang dicatat pada baseline sebelumnya pernah tersedia/aktif: Server SuiteScript, REST Web Services, OAuth 2.0, SOAP Web Services dan Token-Based Authentication. **Ini informasi konfigurasi historis, bukan perintah mengaktifkan ulang**. Credential, JWT private key, certificate, client ID/secret, token, project identity rahasia **jangan dimasukkan ke dokumentasi, output console, ZIP, atau chat**.

### 2.2 Permission persis menurut 4 screenshot Role NetSuite yang user kirim dalam chat ini

**Transactions — semuanya Level `View`:**

- `Bills`
- `Credit Memo`
- `Credit Returns`
- `Enter Vendor Credits`
- `Find Transaction`
- `Fulfill Orders`
- `Invoice`
- `Item Fulfillment`
- `Item Receipt`
- `Purchase Order`
- `Return Authorization`
- `Sales Order`
- `Vendor Return Authorization`
- `Vendor Returns`

**Reports:** `SuiteAnalytics Workbook` = **Edit**.

**Lists — semuanya Level `View`:** `Accounts`, `Currency`, `Items`, `Locations`, `Perform Search`, `Vendors`.

**Setup:** `Deleted Records` = **View**; `Log in using OAuth 2.0 Access Tokens` = **Full**; `REST Web Services` = **Full**.

### 2.3 Permission untuk Module 9 — jangan menebak lalu langsung mengubah role

Dari screenshot **belum terlihat** permission transaksi **Customer Payment** dan list **Customers**. Untuk Sales Payment, **tes SuiteQL read-only dahulu** menggunakan role existing, kemudian jika memang error permission, tambahkan **permission UI yang benar** dengan akses **View** minimum (nama label bisa bergantung UI account); verifikasi akses ulang. `Customers` View bisa dibutuhkan bila join/referensi customer tidak bisa dibaca, tetapi jangan mengubah tanpa bukti kegagalan. **Jangan mengubah permission lain yang sudah terbukti**, atau role/integration/certificate/OAuth mapping.

Beda nama UI permission dan SuiteQL transaction type: misalnya `Bills` di UI = `VendBill` dalam transaksi; ini tidak berarti harus ada permission berlabel "Purchase Invoice". Untuk Module 9 identifikasi berdasarkan probe nyata, bukan asumsi.

---

## 3. ENVIRONMENT & STRUKTUR FOLDER

### 3.1 Lingkungan

- Windows 11, PowerShell, repo **`C:\netsuite-backup`**.
- Node.js dari nvm4w; process production yang terlihat: `C:\nvm4w\nodejs\node.exe`.
- GCP project historically **`even-gearbox-255203`**; BigQuery dataset **`netsuite_backup`**, location **`asia-southeast1`**.
- Waktu aplikasi dan Windows Scheduler **Asia/Jakarta** (WIB, UTC+7). JSON `startedAt`/`finishedAt` dengan suffix `Z` = UTC; konversi ketika membaca jam.
- Tugas Windows yang dikonfirmasi dari baseline: `NetSuite Backup V3`, `NetSuite Backup Fast Delta`, `NetSuite Backup Freshness Monitor`, `NetSuite Backup Watchdog`. **Jangan membuat task Windows baru untuk setiap modul**.
- Konfigurasi V3 saat dicek `node .\scripts\scheduler-runner.mjs --show-config`: `mode=production`; timezone `Asia/Jakarta`; interval **20 menit**, hari `0..6`, jam **08:00–22:00**, workflow `C:\netsuite-backup\common\recovery-controller.mjs`.

### 3.2 Pohon project — gabungan verified baseline ZIP + file Phase A–G yang diserahkan

**Pohon ini merekonstruksi file relevan dari snapshot ZIP dan ZIP patch yang telah dipasang/diuji user; bukan hasil `tree` aktual dari C:\ setelah seluruh perubahan. Untuk perubahan lanjutan cek source live ZIP terbaru.**

```text
C:\netsuite-backup\
├── .docs\
│   ├── 1_NETSUITE_BIGQUERY_PROGRESS_HANDOVER_2026-10-08.md
│   ├── 2_NETSUITE_BACKUP_HANDOVER_FOUNDATION_V5_2_2026-10-14.md
│   ├── 3_NETSUITE_BACKUP_HANDOVER_BASELINE_4_MODULE_2026-10-20.md
│   ├── 4_NETSUITE_BACKUP_HANDOVER_5_MODULE_2026-10-21.md
│   ├── 5_NETSUITE_BACKUP_HANDOVER_6_MODUL_2026-10-22.md
│   ├── 6_NETSUITE_BACKUP_HANDOVER_FINAL_BASELINE_2026-10-22.md
│   └── 7_NETSUITE_BACKUP_HANDOVER_MODULE_2026-10-23.md
├── config\
│   ├── scheduler.json
│   └── self-healing.json
├── common\
│   ├── netsuite-client.mjs
│   ├── bigquery-client.mjs
│   ├── decimal-precision.mjs
│   ├── sync-utils.mjs
│   ├── child-runner.mjs
│   ├── shared-lock.mjs
│   ├── presence-reconcile.mjs
│   ├── targeted-recovery.mjs
│   ├── source-movement.mjs
│   ├── so-mismatch-candidates.mjs
│   ├── verified-deletion-batch.mjs        # PATCH Phase D Module 8
│   ├── recovery-controller.mjs           # PATCH Phase G Module 8
│   └── v3-status-contract.mjs            # NEW Phase G Module 8
├── modules\
│   ├── sales-invoice\
│   │   ├── mapping.mjs
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   ├── check.mjs
│   │   └── recover.mjs
│   ├── item-fulfillment\
│   │   ├── mapping.mjs
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   ├── check.mjs
│   │   ├── recover.mjs
│   │   ├── reconcile-accounting.mjs
│   │   └── repair-accounting-bounded.mjs
│   ├── sales-order\
│   │   ├── mapping.mjs
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   ├── check.mjs
│   │   ├── recover.mjs
│   │   └── repair-active.mjs
│   ├── item-receipt\
│   │   ├── probe.mjs
│   │   ├── mapping.mjs
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   ├── check.mjs
│   │   ├── check-financial.mjs
│   │   └── recover.mjs
│   ├── purchase-order\
│   │   ├── probe.mjs
│   │   ├── mapping.mjs
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   ├── check.mjs
│   │   └── recover.mjs
│   ├── purchase-invoice\
│   │   ├── probe.mjs
│   │   ├── mapping.mjs
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   └── check.mjs
│   ├── sales-return\
│   │   ├── probe.mjs
│   │   ├── mapping.mjs
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   ├── check.mjs
│   │   └── check-financial.mjs
│   └── purchase-return\                # MODULE 8 ADDED in THIS chat
│       ├── probe.mjs / probe-2.mjs / probe-3.mjs / probe-4.mjs / probe-5.mjs
│       ├── mapping.mjs
│       ├── test-mapping.mjs
│       ├── sync.mjs
│       ├── audit-common.mjs
│       ├── presence.mjs
│       ├── check.mjs
│       ├── check-financial.mjs
│       ├── initialize-schema.mjs
│       ├── deletion-inventory.mjs
│       ├── probe-deletion-identity.mjs
│       ├── test-deletion-proof.mjs
│       ├── test-deletion-registry.mjs
│       ├── test-deletion-batch-contract.mjs
│       ├── test-zero-source-sync-guard.mjs
│       ├── test-production-readiness.mjs
│       ├── scheduler-gate.mjs
│       ├── test-scheduler-contract.mjs
│       └── test-v3-status-contract.mjs
├── scripts\
│   ├── verified-deletion.mjs             # PATCH Phase D Module 8
│   ├── fast-delta.mjs                    # PATCH Phase G Module 8
│   ├── scheduler-runner.mjs              # PATCH Phase G V3
│   ├── scheduler-watchdog.mjs
│   ├── fast-delta-freshness.mjs
│   ├── fast-delta-freshness-alert.mjs
│   ├── run-fast-delta.ps1
│   ├── run-freshness-monitor.ps1
│   ├── shared-lock-inspect.mjs
│   ├── monitor-alert.mjs
│   ├── monitor-notify.ps1
│   └── ... (baseline scripts lain)
├── logs\
│   └── scheduler\
│       ├── latest.json                   # PATH LIVE VERIFIED, not .\state\
│       ├── history.jsonl
│       └── run-<UTC timestamp>.log
├── tests\
│   ├── foundation-test.mjs
│   ├── child-runner-test.mjs
│   ├── fast-delta-integration-test.mjs
│   └── source-movement-test.mjs
├── package.json
└── package-lock.json
```

**PENTING versi file:** `presence.mjs` dan `audit-common.mjs` Module 8 beberapa kali REPLACE. File final `presence.mjs` adalah dari ZIP **Phase E Zero Source Guard / REUPLOAD**. `audit-common.mjs`, `check.mjs`, `check-financial.mjs` final berasal dari **Phase E Schema Only Init**. `common/verified-deletion-batch.mjs` final dari Phase D Batch Inventory Adapter; `scripts/verified-deletion.mjs` dari Phase D Single Record Registry; `common/recovery-controller.mjs` dan `scripts/fast-delta.mjs` dari Phase G Scheduler Compatibility; `scripts/scheduler-runner.mjs` dan `common/v3-status-contract.mjs` dari Phase G V3 Compatibility. **Jangan overwrite dengan paket fase lebih tua secara acak**.

### 3.3 Lokasi status/log V3 — bottleneck resolved

User sempat mendapat `Cannot find path 'C:\netsuite-backup\state'` akibat asumsi salah dari assistant. **Path benar** dibuktikan dari source `scheduler-runner.mjs`:

```javascript
const stateDir = path.join(root, 'logs', 'scheduler');
const statusPath = path.join(stateDir, 'latest.json');
const historyPath = path.join(stateDir, 'history.jsonl');
```

Baca read-only:

```powershell
cd C:\netsuite-backup
Get-Content .\logs\scheduler\latest.json -Raw
Get-Content .\logs\scheduler\history.jsonl -Tail 3
$latest = Get-Content .\logs\scheduler\latest.json -Raw | ConvertFrom-Json
Get-Content (Join-Path '.\logs\scheduler' $latest.log) -Tail 60
```

**Jangan menciptakan direktori `state`**. Status `LastTaskResult=267009` (`0x41301`) berarti Task Scheduler masih running, bukan sync failure; periksa `Get-ScheduledTask` dan proses terkait sebelum intervensi.

---

## 4. BASELINE ARSITEKTUR KODE — SEMUA MODULE BARU WAJIB KONSISTEN

### 4.1 Dataflow canonical

1. `.mjs` dijalankan dengan Node dari `C:\netsuite-backup`; environment credential existing, bukan hard-coded.
2. Reuse `common/netsuite-client.mjs` (`token()`, `suiteql()`, `fetchAll()`), OAuth2 PS256, SuiteQL read/paginate.
3. **Phase A probe dulu**: transaction type NetSuite nyata; sumber transaksi, hubungan `PreviousTransactionLineLink`/`NextTransactionLineLink` (atau tabel lain hanya setelah dibuktikan), accounting lines, posting flag, total, date, modified, duplicates, precision. Jangan otomatis mengambil GL atau fisik shipment hanya karena ada type tertentu.
4. `mapping.mjs` strict + typed record outputs; reliable join keys / dedup; validation dan field-specific numeric policy.
5. `sync.mjs` explicit `--dry-run` vs `--sync`; dry-run hanya fetch/map/validate **tidak melakukan DDL, DML, checkpoint**.
6. **Automatic `ensureTables()`**/create-if-not-exists by Node script run from PowerShell. Pembuatan table bukan lewat manual UI; tidak mewajibkan SQL terpisah. Pada Module 8 schema-only case `initialize-schema.mjs --apply-schema` khusus karena tidak ada source real. **Jangan menjadikan schema-only workaround sebagai default modul yang memiliki data real.**
7. Stage changes → BigQuery MERGE/upsert header → scoped replacement/upsert detail/GL/links → checkpoint dalam **atomic BigQuery transaction** ketika memungkinkan sesuai existing module. Data dan checkpoint harus konsisten; replay idempotent dan scoped, tidak truncate global.
8. Incremental checkpoint field `lastmodifieddate` (per source yang valid), **5-minute overlap** sesuai baseline; max modified dari source sukses; checkpoint **tidak maju** karena dry run, zero source, delete proof, failure atau arbitrary current clock. Jangan mengasumsikan semua table memakai watermark identik tanpa inspect mapping/module.
9. `presence.mjs`, `check.mjs`, `check-financial.mjs` audit read-only terhadap source vs BigQuery. Header count+transaction ID+duplicate+field mismatch+lines+GL+link+orphan, jumlah finansial & quantity exact sesuai sifat module. Jangan menyebut `SYNC_OK` atau `NO_SOURCE` sebagai bukti reconciliation finansial.
10. **Verified deletion wajib**; shared single-record + bounded batch; independent proof dan no false positives. Lock, controller, Fast Delta, V3 integration dilakukan **setelah** mapping/sync/audit/guard lulus.
11. Shared lock pada top-level orchestration. **Jangan menjalankan manual `--sync` saat Windows Scheduler V3/Fast Delta sedang running**. Tidak menambah scheduled task Windows per modul.
12. Pertahankan behaviour tujuh/delapan modul existing; patch minimal additive dengan regression tests.

### 4.2 BigQuery decimal exactness — non-negotiable

- `NUMERIC` BigQuery alias DECIMAL mendukung **scale maksimal 9**; validasi dengan `common/decimal-precision.mjs` (`canonical`, `validateNumeric`, `validateNumericRows`), jangan JavaScript float rounding finansial diam-diam.
- `normalizeNumericRate` hanya dipakai untuk field yang memang **secara eksplisit diizinkan** dari baseline source/modul; **bukan** semua field, bukan blanket rounding.
- `rate_raw` PR disimpan `STRING` exact karena real source bisa punya >9 digit pecahan, mis. `16864.86486111`, `202597.81333333332`, notasi scientific `3.970450444E7`. `rate_raw` bukan cara menghindari pengujian amount/quantity, field tersebut wajib tervalidasi.
- Debit/credit GL dan `total_amount` wajib mengikuti data source / policy field sendiri. Jangan mengasumsikan `VendAuth` posting GL hanya karena `TransactionAccountingLine` ada; historical sample `posting='F'`.
- **Untuk Sales Payment** accounting amounts, payment totals, applied allocations, unapplied balance dan FX harus diprobe lalu tentukan numeric policy yang konsisten, tidak dipaksakan meniru PR `rate_raw` tanpa bukti.

### 4.3 Verified deletion universal

Single-record `scripts/verified-deletion.mjs` + shared `common/verified-deletion-batch.mjs`:

1. Candidate `onlyBigQuery` **bukan bukti delete**; audit-only/preview dulu.
2. **Independent `deletedrecord` proof** dengan recordid, `recordtypeid`, `type` **exact** (di PR ditemukan collision recordid dengan tipe lain!).
3. Source `Transaction` untuk type yang diharapkan harus **NOT_VISIBLE**; apabila masih ada = block.
4. Dry-run, kemudian **re-proof tepat sebelum `--apply`**.
5. Batch maksimal **3** candidates/run; tidak menghapus semua discrepancies massal.
6. Soft delete **hanya header**: `is_deleted=true`, `deleted_at=CURRENT_TIMESTAMP()`; preserve historical lines, GL, links, checkpoint.
7. JSONL audit trail untuk aksi deletion (kebutuhan live logs/audit existing); tidak membuat file `.txt` sebagai test output.
8. Missing recordtype identity, permission error, source visibility, timeout, more candidates atau ambiguous case = fail-closed.
9. Tidak menjalankan `--apply` hanya karena negative test PASS. Positive production apply butuh real candidate dan independent proof.

**PR exact identity yang sudah dibuktikan:**

```text
Transaction.type            = VendAuth
deletedrecord.recordtypeid   = vendorreturnauthorization
deletedrecord.type           = VENDORRETURNAUTHORIZATION
positive deleted auth IDs   = 2915366, 2936706
negative collision recordid = 341268
collision type              = itemlocationconfiguration / ITEMLOCATIONCONFIGURATION
```

Jadi ID saja tidak cukup; `341268` ada sebagai **VendAuth yang masih visible**, tetapi juga ada deletion record **tipe lain**. Negative guard test lulus. Untuk **Sales Payment**, temukan exact `deletedrecord` identity secara empiris; **jangan copy** PR vendorreturnauthorization ke payment.

### 4.4 Output status yang harus jujur

- `SYNC_OK`: sync atau dry-run path command berhasil (jangan otomatis tafsir sebagai reconciled).
- `AUDIT_CLEAN`: audit-only checks sesuai ketentuan module; belum tentu actual sync test.
- `FINAL_PASS`: completed final reconciliation sesuai kontrak.
- `NOT_INITIALIZED`: source zero, belum ada tabel/checkpoint.
- `SCHEMA_ONLY`: lima tabel PR ada, data dan checkpoint tetap zero.
- `NO_SOURCE`: gate PR source zero saat `SCHEMA_ONLY`, scheduler skip tanpa write; **bukan** `FINAL_PASS` PR.
- `SOURCE_PENDING_INITIAL_SYNC` / `NEEDS_REVIEW`: transaksi nyata pertama muncul, harus review/validasi initial sync, bukan langsung menulis.
- `READY`: jalur incremental normal setelah initial sync nyata tervalidasi.
- Legacy modul selain PR **tidak boleh menerima `NO_SOURCE`** dalam V3 contract.

---

## 5. MODULE 8: PHASE A — READ-ONLY SOURCE DISCOVERY

### 5.1 Probe 1 sampai 5 (semua no BigQuery, DDL, checkpoint, delete)

1. Probe 1: distribusi type Oktober; temuan transaction return customer (`RtnAuth`) **bukan** Vendor Return; jangan salah pakai. Probe awal type list tidak mencakup seluruh `VendCred`; probe lanjutan yang mengikat type secara tepat menemukan 80 Oktober.
2. Probe 2: semua visible historical `VendAuth` **15**, historis `VendCred` 8704; October `RtnAuth` adalah customer flow. Aggregrated join virtual transaction links dapat HTTP 400 invalid/unsupported; pendekatan **query per link ID / bounded list + dedup client-side** berhasil.
3. Probe 3: `VendAuth` 2026 terakhir 15 Juli; contoh `VRA2600006` ID `3077625` source PO `2688297`, downstream physical `ItemShip` ID `3077629`, downstream `VendCred` ID `3081632`; `ShipRcpt` dan `OrdBill` edges. `VendAuth` historical GL `posting='F'` (authorization **non-posting**).
4. Probe 4: October `VendCred` **80** diklasifikasikan: 58 dengan `VendBill:Payment|VendBill:PurchRet`, 22 `VendBill:Payment`. Semuanya dari Vendor Bill chain; **tidak boleh semua dianggap physical Purchase Return**. Tidak ada October linked physical `ItemShip`/`VendCred` dari `VendAuth`.
5. Probe 5 verified year and downstream: `VendAuth` 2021=1; 2022=1; 2023=1; 2024=2; 2025=5; 2026=5; total **15 visible**; October `VendAuth`=0; October `VendCred`=80; October all `ItemShip`=1051 (mixed type). Historical downstream links dedup by `(authId,targetId,linktype)`, row-level links 46 pre-dedup. **0 October** linked PR ItemShip IDs, **0 October** linked PR VendCred IDs. Failure count 0, exit 0.

**Period distinction:** tests Phase C used `2026-10-01 to 2027-01-01` (October–December inclusive by exclusive end). Jangan menyebut 15 total sebagai total seluruh deleted + existing: itu **15 visible**; dua deleted `VendAuth` ditemukan terpisah melalui deletion proof. 80 Vendor Credits Oktober adalah kategori lain.

### 5.2 Transaksi historical ilustrasi

- `VRA2600006` authorization id `3077625` date `2026-07-15`.
- Related physical shipment `DO260706522` (`ItemShip`, id `3077629`).
- Related vendor credit `VRA2600006` (`VendCred`, id `3081632`).
- `VendAuth` tidak posting GL pada sample, sedangkan vendor credit memiliki accounting implications. Detail relation source link harus dipertahankan.

### 5.3 Batasan discovery

- Jangan samakan `VendCred` yang berasal dari `VendBill` dengan return physical `VendAuth`.
- Jangan gabung semua `ItemShip` sebagai purchase return (1051 Oktober mixed type).
- Jangan mengasumsikan absence of accessible source = verified deletion; delete hanya dengan exact `deletedrecord` independent proof.
- November–Desember masih periode masa depan relatif tanggal handover, sehingga auditor harus terus mengecek saat periode berjalan.

---

## 6. MODULE 8: PHASE B — MAPPING, DRY RUN, DATABASE SCHEMA

### 6.1 Mapping historical test real data

Dijalankan read-only, hasil:

```text
PURCHASE RETURN PHASE B - READ ONLY MAPPING TEST
Historical header count: 5
Mapped: {"headers":5,"transactionLines":6,"accountingLines":16,"sourceLinks":5,"downstreamLinks":10}
Posting GL rows: 0
Source PurchOrd links: 5
Downstream ItemShip: 5
Downstream VendCred: 5
PHASE B MAPPING TEST PASS
Test ExitCode: 0
```

**5 tabel BQ:**

1. `purchase_return_headers`
2. `purchase_return_lines`
3. `purchase_return_accounting_lines`
4. `purchase_return_source_links`
5. `purchase_return_downstream_links`

Mapping menjaga `rate_raw` exact `STRING`; amount, quantity, GL decimal dicek. Real historical samples hanya untuk read-only mapping, **tidak di-backfill sebagai transaksi Oktober palsu**.

### 6.2 Sync implementation dan source kosong

`modules/purchase-return/sync.mjs` dibuat mengikuti Sales Return existing. Source Oct–Dec zero:

```text
PURCHASE RETURN | DRY RUN | netsuite_backup | asia-southeast1
Source mapped: {"purchase_return_headers":0,"purchase_return_lines":0,
"purchase_return_accounting_lines":0,"purchase_return_source_links":0,
"purchase_return_downstream_links":0}
Checkpoint=INITIAL; overlap from=FULL OCTOBER
DRY RUN PASS ... no BigQuery writes/checkpoint changes
Dry Run ExitCode: 0
```

`--sync` initial zero-source **harus block sebelum `ensureTables`/staging/commit**; zero-source production guard tested offline/live read-only: `ZERO-SOURCE GUARD PASS`, `NO --sync EXECUTED`. Guard test membuktikan posisi code guard dan snapshot saat testing, **bukan** live production sync dengan source baru. No false checkpoint.

### 6.3 Kenapa schema dibuat terpisah?

Karena source October zero, first production `--sync` sengaja ditolak; untuk tetap menyiapkan BQ structure ada additive script khusus `modules/purchase-return/initialize-schema.mjs`:

```powershell
cd C:\netsuite-backup
node .\modules\purchase-return\initialize-schema.mjs --dry-run
# hanya setelah dry-run PASS dan review:
node .\modules\purchase-return\initialize-schema.mjs --apply-schema
```

User menjalankan kedua command, output:

```text
SCHEMA DRY RUN PASS: no DDL, no checkpoint writes
SCHEMA_ONLY PASS: five empty tables, zero Purchase Return checkpoint rows; NOT FINAL_PASS
Schema Init ExitCode: 0
```

**Ini adalah pengecualian real no-source yang sudah terbukti, bukan alasan Module 9 memakai schema-only kalau source real tersedia.** Module baru dengan data real menggunakan automatic `ensureTables()` normal, script Node dari PowerShell, no manual UI DDL.

---

## 7. MODULE 8: PHASE C/E — AUDIT STATE MACHINE

### 7.1 Sebelum create schema

`presence`, `check`, `check-financial` semuanya:

```text
STATE: NOT_INITIALIZED
5 table exists=false; checkpointRows=0; watermark=null
ExitCode=0; NOT FINAL_PASS
```

### 7.2 Sesudah schema-only initialization

`presence`, `check`, `check-financial` semuanya:

```text
STATE: SCHEMA_ONLY
5 table exists=true; checkpointRows=0; watermark=null
ExitCode=0; NOT FINAL_PASS
```

`presence.mjs --deletion-inventory` intentionally:

```text
BLOCKED: Purchase Return is SCHEMA_ONLY; deletion inventory unavailable until INITIALIZED
Inventory ExitCode: 1
```

Awalnya pesan block masih `NOT_INITIALIZED` ketika state sudah `SCHEMA_ONLY`. **Diperbaiki dalam Phase E Zero Source Guard**. Exit 1 adalah **expected guard PASS**, bukan software crash/error yang harus diakali.

### 7.3 Financial audit nuance

PR `VendAuth` non-posting historical, `postingGL=0`; audit tidak mengarang GL posting. Audit PR no-source hanya membuktikan state valid; tidak membuktikan financial invariants produksi transaksi PR baru. Semua audit module lain memakai mapping financial spesifik berdasarkan source.

---

## 8. MODULE 8: PHASE D — DELETION IDENTITY + BATCH SAFETY

### 8.1 Native identity evidence

Probe `deletedrecord` bounded returned 20 relevant rows including deleted Vendor Credits and:

```text
Vendor Return Authorization #VRA2500008
recordid=2915366
recordtypeid=vendorreturnauthorization
type=VENDORRETURNAUTHORIZATION

Vendor Return Authorization #VRA2600002
recordid=2936706
recordtypeid=vendorreturnauthorization
type=VENDORRETURNAUTHORIZATION
```

Collision discovered `recordid=341268` existed in `deletedrecord` for **Item Location Configuration** (`ITEMLOCATIONCONFIGURATION`) while historical actual `VendAuth` record id=341268 remained visible. Thus **recordid alone dangerously creates false positive**.

### 8.2 Negative test real NetSuite

```text
PASS deleted VendAuth 2025 id=2915366 proof=true sourceRows=0
PASS deleted VendAuth 2026 id=2936706 proof=true sourceRows=0
PASS recordid collision id=341268 proof=false sourceRows=1
DELETION PROOF NEGATIVE TEST PASS | READ ONLY
ExitCode=0
```

### 8.3 Code registration

- Phase D Single Record ZIP modified `scripts/verified-deletion.mjs` registry:

```javascript
'purchase-return': {
  recordtypeid: 'vendorreturnauthorization',
  type: 'VENDORRETURNAUTHORIZATION',
  table: 'purchase_return_headers'
}
```

- Contract test PASS; **ini static/offline registry test, bukan live positive soft-delete**.
- Phase D Batch ZIP modified `common/verified-deletion-batch.mjs`, added `modules/purchase-return/deletion-inventory.mjs`, replaced `presence.mjs` to support `--deletion-inventory` mode and output expected batch shape `netSuite`, `bigQuery`, `onlyNetSuite`, `onlyBigQuery`.
- Offline batch contract test PASS; Phase D and Phase E `--deletion-inventory` **fail-closed** when schema/initial checkpoint not initialized. **Jangan bypass guard**. Shared max 3 candidates remains.
- Saat first real PR data muncul, real inventory mode, initial sync, presence/reconcile, and deletion end-to-end tetap perlu review/testing. Jangan apply deletion sekarang.

---

## 9. MODULE 8: PHASE F/G — RECOVERY, FAST DELTA, V3 INTEGRATION

### 9.1 Static production readiness

Phase F `test-production-readiness.mjs` pass **8/8**, confirmed:

- sync explicit `--dry-run`/`--sync`
- zero-source initial sync rejects before BigQuery writes
- checkpoint update inside atomic transaction code
- field-specific numeric checks
- PR deletion inventory blocks uninitialized state
- exact `VendAuth` deletion identity
- shared batch registered with bound
- at Phase F time scheduler PR not yet registered

Static pass **tidak** mengklaim actual transaction sync.

### 9.2 Phase G Fast Delta + Recovery compatibility

New `modules/purchase-return/scheduler-gate.mjs`, `test-scheduler-contract.mjs`; replacements `scripts/fast-delta.mjs`, `common/recovery-controller.mjs`.

Gate state transitions:

| State | Meaning/action |
|---|---|
| `NO_SOURCE` | `SCHEMA_ONLY`, 0 source headers, 0 checkpoint; safe skip, no `SYNC_OK` PR |
| `SOURCE_PENDING_INITIAL_SYNC` / `NEEDS_REVIEW` | real first source appears with initial checkpoint; **block auto write** until real initial sync verified |
| `READY` | incremental flow only **after verified initial sync** |
| mismatch/error | fail closed, don't fabricate `FINAL_PASS` |

Static contract **10/10 PASS**; live gate:

```text
PURCHASE RETURN SCHEDULER PRECHECK: state=SCHEMA_ONLY; sourceHeaders=0; checkpoints=0
PURCHASE RETURN GATE: NO_SOURCE
Gate ExitCode: 0
```

Recovery test:

```powershell
node .\common\recovery-controller.mjs purchase-return --audit-only
node .\common\recovery-controller.mjs --all --audit-only
```

Observed `purchase-return: NO_SOURCE`, exit 0 standalone. The all-module audit at that moment returned Exit 3 due to Sales Invoice 21 NS-only & 1 BQ-only; Item Fulfillment 1+1; Sales Order 1 BQ-only. **User explicitly directed: don't recheck these `NEEDS_REVIEW`, they were catching up in background.** Later V3 production completed `FINAL_PASS`; do not resurrect earlier transient mismatches as permanent blockers.

Fast Delta combined dry-run observed **8 modules** with PR `NO_SOURCE` and 7 existing modules `SYNC_OK` (for dry-run only), exit 0. Never interpret `SYNC_OK` dry-run as full financial reconciliation PASS.

### 9.3 Phase G V3 compatibility

Patch `scripts/scheduler-runner.mjs` and NEW `common/v3-status-contract.mjs`, `modules/purchase-return/test-v3-status-contract.mjs`. Prior V3 parser only covered **six** old modules (missed Sales Return/PR); new expected 8.

V3 status contract **11/11 PASS**:

```text
PASS 7 FINAL_PASS + PR NO_SOURCE accepted
PASS 8 FINAL_PASS accepted
PASS 7 FINAL_PASS + PR READY but no audit NOT accepted
PASS other module NO_SOURCE rejected
PASS missing module rejected
PASS duplicate module rejected
PASS real NEEDS_REVIEW exit remains review
PASS nonfinal legacy module remains review
PASS error fails
PASS timeout fails
PASS missing summary rejected
```

`node .\scripts\scheduler-runner.mjs --show-config` returned production, Asia/Jakarta, interval 20, 08–22 every day, recovery-controller workflow.

### 9.4 **FINAL PRODUCTION EVIDENCE** — 26 October 2026

Windows Task Scheduler `NetSuite Backup V3` was running and production process tree included:

```text
scripts\scheduler-runner.mjs
  common\recovery-controller.mjs --all --sync
    common\recovery-controller.mjs --core item-fulfillment --sync
      modules\item-fulfillment\sync.mjs
```

V3 status file **`logs\scheduler\latest.json`** (confirmed user output):

```json
{
  "startedAt": "2026-10-26T03:41:34.275Z",
  "finishedAt": "2026-10-26T03:49:45.121Z",
  "mode": "production",
  "slot": "10:40",
  "status": "FINAL_PASS",
  "exitCode": 0,
  "timedOut": false,
  "log": "run-2026-10-26T03-41-34.275Z.log"
}
```

History last three completed slots: **10:00**, **10:20**, **10:40**, all status `FINAL_PASS`, exit=0. User looked into latest run log and proved:

```text
PURCHASE RETURN SCHEDULER PRECHECK: state=SCHEMA_ONLY; sourceHeaders=0; checkpoints=0
PURCHASE RETURN GATE: NO_SOURCE
CORE SUMMARY: purchase-return: NO_SOURCE
RECOVERY SUMMARY:
  sales-invoice: FINAL_PASS
  item-fulfillment: FINAL_PASS
  sales-order: FINAL_PASS
  [four other old modules also FINAL_PASS]
  sales-return: FINAL_PASS
  purchase-return: NO_SOURCE
Scheduler status=FINAL_PASS exitCode=0 timedOut=false
```

**Conclusion unambiguous:** V3 **overall** completed `FINAL_PASS` (seven established modules passed), Module 8 **explicitly remained `NO_SOURCE`**. Do not write `purchase-return FINAL_PASS` to documents. No fake data/checkpoint; automatic restart/first-source transitions have guards, but **actual real PR sync and deletion apply remain untested**.

---

## 10. ALL FILE PATCH/ZIP ORDER FROM THIS CHAT — DO NOT REVERT FINAL VERSIONS

ZIP packages were used because user **requires JS deliverables packaged as ZIP** (not bare `.mjs` download). Their historical filenames:

| Phase | ZIP | Files / effect |
|---|---|---|
| A | `purchase-return-phase-a-probe.zip`, `Purchase_Return_Probe_2_READY.zip`, `Purchase_Return_Probe_3.zip`, `Purchase_Return_Probe_4.zip`, `Purchase_Return_Probe_5.zip` | Read-only discovery scripts |
| B1 | `Purchase_Return_Phase_B_Mapping_Test.zip` | `mapping.mjs`, `test-mapping.mjs` |
| B2 | `Purchase_Return_Phase_B_Sync_DryRun.zip` | `sync.mjs` |
| C | `Purchase_Return_Phase_C_ReadOnly_Audit.zip` | first `audit-common.mjs`, `presence.mjs`, `check.mjs`, `check-financial.mjs` |
| D1 | `Purchase_Return_Phase_D_Deletion_Identity_Probe.zip` | `probe-deletion-identity.mjs` |
| D2 | `Purchase_Return_Phase_D_Deletion_Proof_Negative_Test.zip` | `test-deletion-proof.mjs` |
| D3 | `Purchase_Return_Phase_D_Single_Record_Registry.zip` | **REPLACE** `scripts/verified-deletion.mjs`; new registry test |
| D4 | `Purchase_Return_Phase_D_Batch_Inventory_Adapter.zip` | **REPLACE** `common/verified-deletion-batch.mjs`, first `presence.mjs`; new `deletion-inventory.mjs` and batch test |
| E1 | `Purchase_Return_Phase_E_Schema_Only_Init.zip` | `initialize-schema.mjs`, **REPLACE** `audit-common.mjs`, `check.mjs`, `check-financial.mjs`, `presence.mjs` |
| E2 | `Purchase_Return_Phase_E_Zero_Source_Guard.zip` / `Purchase_Return_Zero_Source_Guard_REUPLOAD.zip` | **FINAL REPLACE** `presence.mjs`; `test-zero-source-sync-guard.mjs` |
| F | `Purchase_Return_Phase_F_Production_Contract_Audit.zip` | `test-production-readiness.mjs` |
| G1 | `Purchase_Return_Phase_G_Scheduler_Compatibility.zip` | **REPLACE** `scripts/fast-delta.mjs`, `common/recovery-controller.mjs`; add gate/test |
| G2 | `Purchase_Return_Phase_G_V3_Compatibility.zip` | **REPLACE** `scripts/scheduler-runner.mjs`; new `common/v3-status-contract.mjs` + test |

**Important:** Model future should NOT rebuild project from these ZIPs blindly; use ZIP of currently deployed code from user, verify checksum/content and compare. The original baseline ZIP `netsuite-backup(20261026-014305).zip` predates most Module 8 patches and is **not current final source**. The documents `.docs/7_...` describes Module 7 baseline, while **this handover describes Module 8 additions**.

---

## 11. USER-ADDED RULES IN THIS CHAT (MUST ENFORCE IN NEW CHAT)

1. **Jangan ngide sendiri**: use exact folder naming, module naming, helper signatures, code sequence, scheduler integration and tests from already-running modules; inspect actual repository before coding.
2. **Tahap demi tahap**, one test group at a time; analyze user output before writing next patch. Each diagnostic accompanied by concrete next executable PowerShell/SuiteQL commands. No giant untested one-shot migration.
3. **All JavaScript downloadable files MUST be delivered inside ZIP** with proper repository-relative folder names. Link ZIP (not bare .js/.mjs). Verify ZIP integrity and `node --check` for source before delivery. Documentation `.md` may be delivered directly as requested.
4. User handles ZIP extraction/copy/replace **manually**. **NEVER supply `Expand-Archive` commands** or ask them to rerun extraction process. Can tell them which relative files to copy and backup prior source when production file changes.
5. **Testing output only in PowerShell terminal**. **NEVER** add `Tee-Object`, `Out-File`, `> something.txt`, redirection to text files, or instructions to export test output to file. Users can paste console output in chat. Existing application logs created internally by scheduler/deletion are part of baseline and not prohibited; prohibition targets unnecessary test-output captures.
6. **No dummy data anywhere**: not in NS, BQ, live tables, fake transaction IDs, checkpoint, or forced success state. Historical NS records are acceptable for **read-only probe/mapping**. Offline in-memory contract fixtures for parsers are acceptable only when clearly identified as contract tests **not inserted** into production; user prioritizes reality.
7. Real KPI **jumlah transaksi AND total amount** for Oct/Nov/Dec 2026, deadline Dec 10 2026. Structural counts are not enough; financial reconciliation mandatory. Periods in future cannot be prematurely called complete.
8. `--sync` is **real incremental write**, NOT automatic force full sync; don't ask manual sync while scheduled process is running. `--dry-run` no writes/DDL/checkpoints.
9. `verified deletion` mandatory all modules including Module 9; exact independent proof + no source visibility + dry-run + re-proof + batch ≤3 + audit trail + header-only soft delete + no line/checkpoint changes.
10. **Not all `ONLY_BIGQUERY` are deleted**; changing source visibility alone is no proof. Collision ID with wrong type must never cause deletion.
11. `NUMERIC` BigQuery scale 9, no silent rounding, field-specific precision, preserve rate exact string where required. Reuse `common/decimal-precision.mjs`.
12. Auto-create BigQuery tables via scripts launched in PowerShell; **no manual BigQuery UI steps**, no raw ad hoc DDL replacing standard `ensureTables` unless evidence requires explicit special path.
13. Preserve existing OAuth and NetSuite role name, permission types and levels. `Run Server SuiteScript and Trigger Workflows` must remain OFF; no credential exposure.
14. No additional scheduled task; add module to existing Fast Delta, recovery controller, V3 **only after source, mapping, real sync/audit where possible, deletion guard, offline regression**. Ensure old modules unaffected.
15. Do not perform repeated expensive full checks or misdiagnose catch-up `NEEDS_REVIEW` SI/IF/SO; user explicitly said to **skip** these while catch-up in progress. Later V3 run successful. Don't lose focus.
16. No false status: `NO_SOURCE` ≠ module `FINAL_PASS`; `SYNC_OK` dry-run ≠ full reconciliation. V3 overall `FINAL_PASS` can coexist with PR `NO_SOURCE` only under proven contract.
17. User wants **detailed copy-paste ready documentation/handover**, not short summary, and continuity across new chat. Include role, folder structure, bottlenecks resolved, exact next module and next executable step.
18. Avoid unnecessary suggestions of expanded modules beyond boss scope. Vendor Payment, Inventory Transfer, Inventory Adjustment, Journal were discussed **only as optional future expansion** after main goal; don't automatically add.
19. **No silent security changes**: existing scheduled tasks, scripts and permissions must retain baseline. Guard and review before production apply.
20. Avoid ambiguous claims about build/reconciled when only static tests exist; mark evidence category explicitly (`LIVE READ-ONLY`, `OFFLINE CONTRACT`, `LIVE SCHEDULER`, `LIVE WRITE`).

---

## 12. BOTTLENECKS FOUND, ROOT CAUSE, FIX AND RESIDUAL RISK

| Problem | Root cause / evidence | Resolution | Residual |
|---|---|---|---|
| Purchase Return type ambiguity | October 80 `VendCred`, but 0 `VendAuth`; links to bills | Phase A probes proved source flows and excluded credits with only VendBill chains | Future source flows must be rechecked when new transactions appear |
| Aggregated virtual link SuiteQL HTTP 400 | NetSuite unsupported aggregate/join on virtual link tables | Bounded link queries + client-side dedup | Avoid same aggregate approach in Sales Payment without probing |
| Historical financial rates > NUMERIC scale 9 | e.g. `16864.86486111` | `rate_raw` exact STRING and field validation | Future field precision must be assessed individually |
| PR authorization accounting rows misleading | Historical accounting lines exist with `posting='F'` | Distinguish non-posting `VendAuth` vs posting downstream credit | Actual financial audit of new PR not yet possible |
| Empty source initial sync safety | 0 PR source; normal sync should not write checkpoint | Fail-closed zero source initial guard; dry-run verified | Real initial sync remains untested |
| Missing BigQuery tables for PR | No real source and guard rejects `--sync` | Special schema-only DDL script produced five empty tables; checkpoint remains zero | Does not imply transaction audit PASS |
| Audits failed/misreported uninitialized | Target absent vs tables empty are different cases | `NOT_INITIALIZED` / `SCHEMA_ONLY` explicit states | Ensure next module has correct state model |
| Deletion collision | `deletedrecord.recordid=341268` belongs to other type | Both exact recordtypeid/type + id mandatory; positive 2 and negative 1 live proof | Positive live apply PR not performed |
| Batch adapter incompatible | Existing batch helper expects `onlyNetSuite`/`onlyBigQuery` JSON | `--deletion-inventory` adapter and bounded batch contract | When PR ever initialized, test actual inventory |
| Wrong message SCHEMA_ONLY | Inventory rejection still said NOT_INITIALIZED | Final `presence.mjs` patch changed message | None in latest shown output |
| Controller/Fast Delta didn't accept no-source | Existing status marker `SYNC_OK`/audit clean required | Separate gate `NO_SOURCE`; review first-source; no fake success | First source activation requires manual review |
| V3 parser initially six modules | Missed Sales Return and Purchase Return | V3 status contract now 8; accepted seven `FINAL_PASS`+PR `NO_SOURCE` | Regression with future real PR still needed |
| `state` folder not found | Assistant guessed output directory incorrectly | Source proved `logs/scheduler/latest.json` and `history.jsonl` | Use source-derived paths only |
| Task result `267009` appeared | Task actively running (`0x41301`) | Inspect scheduler/process tree; do not kill/duplicate sync | Current work may overlap with scheduled run |
| SI/IF/SO audit temporary `NEEDS_REVIEW` | Source moving and catch-up ongoing | User said skip these; later V3 complete run `FINAL_PASS` | Don't re-run expensive forensic work unless user requests |
| Download link occasionally failed | Prior ZIP link returned UI 'This action couldn't be completed' | Re-upload with new filename; user executed tests afterwards | Verify actual file link in new chats |
| Scope creep suggestion to 13 modules | Assistant suggested unrelated future transactional modules | User restated exact boss instruction, we constrained next to Sales Payment | Never turn optional expansion into project requirement |
| Bill vs Purchase Invoice ambiguity | Boss listed both terms | `VendBill` handled already via `purchase-invoice` | Clarify boss reporting semantics, do not duplicate NetSuite data |

---

## 13. TESTING STANDARDS — EXACT ORDER FOR NEXT MODULE, NO IMPROVISATION

### Step 0 — Snapshot and baseline comparison

- Obtain current source ZIP **after Module 8 V3 patch** (not October 26 early ZIP alone).
- Inspect `modules/sales-invoice`, `modules/purchase-invoice`, `modules/sales-return`, `modules/purchase-return`; `common/netsuite-client.mjs`, `bigquery-client.mjs`, `decimal-precision.mjs`, `recovery-controller.mjs`, `verified-deletion-batch.mjs`, `v3-status-contract.mjs`; `scripts/fast-delta.mjs`, `scheduler-runner.mjs`, `verified-deletion.mjs`; `.docs` relevant.
- Confirm syntax/helper exports, BigQuery checkpoint schema/field naming, audit exit codes, deletion config, scheduler lock and package scripts. Do not edit existing 8 modules without concrete reason.

### Step A — Source discovery (read-only ONLY)

- Check exact UI role permissions based on actual `CustPymt` query result; least privilege, no blanket Full.
- ZIP deliver `modules/sales-payment/probe.mjs` and follow-on numbered probe scripts **only if evidence still missing**.
- Gather monthly counts and **total amount** for Oct/Nov/Dec 2026, and historical sample; Source txn type, transaction header, lines, accounting, posting, customer, currency, exact total, applied/unapplied, applied invoice links incl partial/multi-invoice, date/lastmodified.
- Determine correct SuiteQL availability/fields via bounded queries. NetSuite customer payments can be unapplied, partial, multiple invoice, multi-currency; **prove how this account represents them** before mapping. Never assume `TransactionLine` has payment allocations without link proof.
- No DDL, BQ write, checkpoint, deletion, scheduler modifications in Phase A.

### Step B — Mapping test and sync dry-run

- Build mapping using existing common decimal and client. Use **real historical NS samples** for read-only mapping tests. No fake NetSuite/BQ records.
- ZIP files with exact paths. Test syntax `node --check` then `node .../test-mapping.mjs`; user sends output; only then proceed.
- Implement module `sync.mjs --dry-run` first; validates before writes. User runs and sends output.
- If source real present: after review, `--sync` should create table automatically (`ensureTables()` inside Node) and stage + commit atomically + checkpoint, same as seven existing modules. **Do not require manual BQ UI DDL**.
- If source zero: follow proven zero-source guard, identify whether schema-only is appropriate **without fabricating data/checkpoint**. Not every empty period implies entire module no-source forever.

### Step C — Reconciliation audits

- Implement `presence.mjs`, `check.mjs`, `check-financial.mjs` as meaningful module-specific audits; presence JSON contract for shared deletion batch; use separate flag if raw output shape differs.
- Compare counts, onlySource/onlyBQ, duplicates, header field-by-field, details, GL, link completeness/orphans, exact amount (currency/FX appropriate). Reconcile each monthly slice Oct, Nov, Dec and rolling period.
- Explicit exit codes and statuses; financial check cannot be skipped if count matches. Audit read-only by default.

### Step D — Mandatory deletion

- Probe `deletedrecord` independently to identify exact native type ID & uppercase `type`. If no real deletion exists, block activation of live deletion registration pending trustworthy evidence; never invent type identity.
- Prove historical positive where available and negative collision/wrong type; source invisible and re-proof. Batch max3; separate no-op dry-run.
- Update `scripts/verified-deletion.mjs` registry and `common/verified-deletion-batch.mjs` only after tests; preserve existing modules.

### Step E/F/G — Controlled scheduler integration LAST

- Offline contract tests and regression first; shared lock, `--show-config`, gate if source absent, status semantics.
- Add to `common/recovery-controller.mjs`, `scripts/fast-delta.mjs`, `scripts/scheduler-runner.mjs`/`common/v3-status-contract.mjs` **only after readiness**.
- Observe scheduled run output via existing `logs/scheduler/latest.json` and actual run log. Do not start sync manually while task already Running.
- Validate existing 8 modules unchanged; new module status honest (`FINAL_PASS` only after financial reconciliation, `NO_SOURCE` when demonstrated). Do not create additional scheduled task.

### Canonical PowerShell testing format

```powershell
cd C:\netsuite-backup
node --check .\modules\sales-payment\probe.mjs
node .\modules\sales-payment\probe.mjs
Write-Host "Probe ExitCode: $LASTEXITCODE"
```

Subsequent phases use same pattern, explicit exit after **each** command rather than report only final `LastExitCode` for whole group. **No `Tee-Object`/Out-File/.txt creation.** User manually extracts and replaces ZIP.

### V3 post-release read-only verification

```powershell
cd C:\netsuite-backup
node .\scripts\scheduler-runner.mjs --show-config
Get-ScheduledTask -TaskName "NetSuite Backup V3" | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName "NetSuite Backup V3" |
    Select-Object LastRunTime,LastTaskResult,NextRunTime
$latest = Get-Content .\logs\scheduler\latest.json -Raw | ConvertFrom-Json
$latest | Select-Object status,exitCode,timedOut,startedAt,finishedAt
Select-String -Path (Join-Path '.\logs\scheduler' $latest.log) -Pattern 'RECOVERY SUMMARY|sales-payment:|purchase-return:|Scheduler status=' -Context 1,2
```

`LastTaskResult=0` reflects task process success; **V3 detailed module status must be checked in run log**. `267009` while Running not sync failure.

---

## 14. CURRENT STATUS / REMAINING WORK / NO FALSE CONFIDENCE

### Verified

- 15 accessible historical `VendAuth`, 0 Oct–Dec; 80 October `VendCred` distinct flow; 5 PR BQ tables exist empty, checkpoint=0.
- Module 8 mapping test 5 headers, 6 txn lines, 16 accounting lines, 5 PO links, 10 downstream links, posting GL=0.
- PR sync dry-run PASS, PR financial/read-only audit `SCHEMA_ONLY`, source zero guard PASS, deletion exact identity positive/negative guard PASS, batch contract PASS.
- PR scheduler gate NO_SOURCE via real SuiteQL/BQ precheck, recovery standalone NO_SOURCE, Fast Delta 8-module dry-run exit0, V3 static status 11/11 PASS.
- V3 production completed latest observed slot 10:40 WIB on October 26 and seven existing modules FINAL_PASS, PR NO_SOURCE, scheduler FINAL_PASS exit0 timeout false.

### Not yet verified / deferred by reality

- **PR first real October–December transaction**, production initial sync with true data, financial reconciliation after sync, and live positive soft deletion are not tested because no source/candidate.
- PR must remain gated before first real source; when it appears, initial sync and verification required, then gate transitions READY.
- V3 end-to-end success is snapshot, not guarantee forever; future scheduled runs/November/December require normal ongoing audits.
- Boss may mean "Bill" in a different reporting sense; ask for definition if mismatch arises; do not duplicate `VendBill` automatically.
- `CustPymt` exact source type/link/accounting and role permissions for Sales Payment must be probed.
- Offline/static guard tests are not proofs of live commit or positive deletion.

---

## 15. IMMEDIATE NEXT MODULE — MODULE 9 SALES PAYMENT (CUSTOMER PAYMENT)

**Next business goal:** Finish the only uncovered transaction from boss scope: customer payment (Sales Payment), initial NetSuite transaction-type candidate `CustPymt` (confirm with live SuiteQL). This expands the Sales Invoice flow to real customer cash receipt and invoice application. Do not assume a 1:1 payment to invoice; discover partial, split, unapplied and currencies exactly.

### Exact next action for new chat

1. User supplies ZIP of **latest C:\netsuite-backup** (after Module 8 patches) so new assistant can read current code and correct baseline. If not available, use existing snapshot as *reference only*, do not patch production runner against old source.
2. Inspect role screenshot permissions: `Customer Payment` and `Customers` not visible; **perform read-only query first** and only suggest minimal additions if access actually denied.
3. Generate **one ZIP** `modules/sales-payment/probe.mjs` (or numbered probes if genuinely required) using shared `token()`/`fetchAll()`/`suiteql()` in the same style as prior modules, no credentials included.
4. Execute probe via PowerShell terminal; user sends output; confirm actual October count, total amount, source type and accounting/link model before proposing schema.
5. Continue mapping → auto create table + incremental sync → read-only reconciliation financial → verified deletion → controller/fast delta/V3 registration → production evidence, phased and guarded.
6. Build month-specific KPI report for October, November and December **amount and count**; update as months occur until deadline. Never claim future months reconciled early.

**Initial command format (after actual probe ZIP is supplied):**

```powershell
cd C:\netsuite-backup
node --check .\modules\sales-payment\probe.mjs
node .\modules\sales-payment\probe.mjs
Write-Host "Probe ExitCode: $LASTEXITCODE"
```

### Optional beyond-scope (DO NOT START)

The user asked hypothetically about `VendPymt` (Vendor Payment), `InvTrnfr` (Inventory Transfer), `InvAdjst` (Inventory Adjustment), and `Journal` (Journal Entry). These are real NetSuite transaction concepts but **outside boss instruction**, do not label them Module 10–13 in active plan or request permissions now. Only after all original KPI scope has been completed and user explicitly approves expansion.

---

## 16. IMPORTANT SOURCE-OF-TRUTH / SECURITY CAVEATS

1. Historical baseline source was supplied as `netsuite-backup(20261026-014305).zip`; after this ZIP, Module 8 source files and production runner/controller files were delivered incrementally via ZIPs. This document's combined tree reflects those changes and user outputs, **not an independent `git diff` of user's workstation**.
2. Role/screenshots were user-supplied and exact labels transcribed above; never claim `Customer Payment` currently granted based solely on the screenshot. 
3. Credentials/certificates are deliberately omitted. Do not print config secrets as part of debugging.
4. Historical data counts were taken from specific query outputs at particular times. October inventory can change due to ongoing business edits; source fetch must always be current for synchronization decisions.
5. **One contradiction to avoid:** V3 **overall** `FINAL_PASS` and Module 8 **`NO_SOURCE`** are compatible by explicit 11/11 tested contract. It is incorrect to say “all 8 modules transaction-level FINAL_PASS”.
6. Role `Run Server SuiteScript and Trigger Workflows` remains OFF; never change as workaround.
7. Project success ultimately means matching counts **and total amounts**, not just code tests/scheduler state.

---

## 17. SUGGESTED FIRST PROMPT FOR NEXT CHAT (COPY/PASTE)

> Lanjut proyek NetSuite Backup berdasarkan dokumen `NETSUITE_BACKUP_HANDOVER_MODULE_8_TO_9_2026-10-26.md`. Baca semuanya. Tujuan atasan: count & total amount 10 label transaksi NetSuite cocok BigQuery pada Oktober/November/Desember 2026, due 10 Desember. Delapan modul sudah dibangun; Purchase Return 15 historical VendAuth, zero October–December, 5 BigQuery tables schema-only, V3 production NO_SOURCE dan workflow FINAL_PASS. **Next Module 9: Sales Payment.** Jangan tambah modul lain. **Harus** inspeksi ZIP source live terbaru sebelum coding, pakai helper/mapping/SQL patterns baseline existing; OAuth role `PNM NetSuite Backup Integration`, integration `PNM NetSuite Backup`, PS256, SuiteQL, read-only View permission, Run Server SuiteScript OFF. Probe nyata dahulu; no dummy, no checkpoint palsu, no manual table UI, auto-create via Node script. Mandatory exact verified deletion independent proof, batch max3; no silent decimal rounding. Beri JS selalu sebagai ZIP dengan path, user extract manual, testing hanya terminal PowerShell, jangan `Expand-Archive`/Tee-Object/Out-File. Kerjakan berurutan berdasarkan output tiap test; integrasi Fast Delta/V3/recovery paling akhir. Jangan cek ulang temporary NEEDS_REVIEW SI/IF/SO tanpa alasan, user catch-up. Mulai Phase A read-only Sales Payment dengan syntax test yang konkret.

**END OF HANDOVER — 26 OCTOBER 2026**
