# NETSUITE BACKUP — MASTER HANDOVER: MODULE 7 (SALES RETURN) → MODULE 8 (PURCHASE RETURN)

**Project:** `[Azi] Netsuite Backup`  
**Tanggal handover:** 23 Oktober 2026 (WIB / Asia/Jakarta)  
**Project root:** `C:\netsuite-backup` (Windows 11, PowerShell, Node.js ESM)  
**Google Cloud Project:** `even-gearbox-255203`  
**Dataset:** `netsuite_backup`  
**BigQuery location:** `asia-southeast1`  
**Cakupan bisnis:** Oktober, November, Desember 2026; milestone 10 Desember 2026  
**Modul berikutnya:** **Module 8 — Purchase Return** (`modules/purchase-return/`)  

> **WAJIB BACA sebelum menulis kode baru.** Dokumen ini merekam implementasi dan pengujian dalam chat lanjutan Module 7, termasuk integration patch, decimal, verified deletion, scheduler, dan troubleshooting. Informasi yang belum dapat dipastikan dari source file penuh ditandai **VERIFY LOCALLY**. Dilarang mengarang konfigurasi, permission, skema, atau kontrak output. **Tidak menggunakan FORCE SYNC**. Modul baru wajib mengikuti pola modul terdahulu dan diuji bertahap satu langkah per satu langkah.

---

## 1. Keadaan akhir yang telah dibuktikan

### 1.1 Tujuh modul production

| No. | Modul | Folder | Recovery V3 terakhir yang selesai | Fast Delta terakhir |
|---|---|---|---|---|
| 1 | Sales Invoice | `modules/sales-invoice/` | `FINAL_PASS` | `SYNC_OK` |
| 2 | Item Fulfillment | `modules/item-fulfillment/` | `FINAL_PASS` | `SYNC_OK` |
| 3 | Sales Order | `modules/sales-order/` | `FINAL_PASS` | `SYNC_OK` |
| 4 | Item Receipt | `modules/item-receipt/` | `FINAL_PASS` | `SYNC_OK` |
| 5 | Purchase Order | `modules/purchase-order/` | `FINAL_PASS` | `SYNC_OK` |
| 6 | Purchase Invoice / Vendor Bill | `modules/purchase-invoice/` | `FINAL_PASS` | `SYNC_OK` |
| 7 | Sales Return | `modules/sales-return/` | `FINAL_PASS` | `SYNC_OK` |

**Bukti terakhir yang pengguna kirim:**
- `logs/scheduler/latest.json`: `status=FINAL_PASS`, `exitCode=0`, `finishedAt=2026-10-23T08:10:43.142Z`, log `run-2026-10-23T08-01-34.309Z.log` (15:10:43 WIB).
- `RECOVERY SUMMARY` dari log tersebut berisi **ketujuh modul `FINAL_PASS`**.
- `logs/fast-delta/health-v2.json`: ketujuh modul `SYNC_OK`; `lastRunStatus=SYNC_OK`. Kesuksesan SR terakhir dalam tampilan itu `2026-10-23T08:19:51.891Z`.
- Pada pemeriksaan saat V3 *sedang running*, shared lock dimiliki `worker=scheduler`, PID hidup; bukan masalah dan bukan lock stale.
- Hasil tersebut adalah **snapshot run yang sudah selesai**, tidak menjamin setiap saat source NS dan BQ tetap identik ketika transaksi terus bergerak.

**Penting:** Pernah terjadi V3 `FAILED`/`NEEDS_REVIEW` karena source Sales Order berubah selama reconciliation, bukan alasan untuk force-sync. Run selesai terbaru kemudian `FINAL_PASS`. Lihat §10.

### 1.2 Status keamanan/kelengkapan yang *tidak boleh dilebih-lebihkan*

- Verified deletion **diimplementasikan/terdaftar pada ketujuh modul**, dengan 2 jalur controller: legacy untuk SI/SO/IF dan shared-batch untuk IR/PO/PI/SR.
- **Positive proof production benar-benar terlihat untuk Sales Invoice**, termasuk audit log + `is_deleted=true` di BQ. Modul lain lulus guard/negative testing tertentu, tetapi **positive real-world deletedrecord** untuk tiap modul lain **belum terbukti**.
- SR: negative proof dan limit batch terbukti; bukan berarti positive apply SR pernah dilakukan.
- BigQuery `NUMERIC` mendukung maksimum 9 digit fraksi. Helper validation/rounding ada; audit dataset menunjukkan kolom finansial bertipe NUMERIC, **bukan bukti semua nilai presisi NS identik**.
- Tidak ada kebutuhan membuat scheduler Windows tersendiri untuk modul 8.

---

## 2. Prinsip keras proyek — non-negotiable

1. **JANGAN FORCE SYNC.** Jangan memundurkan checkpoint, menghapus history, full reimport paksa, atau melakukan targeted repair untuk sekadar mengejar source yang aktif bergerak.
2. **Satu arsitektur:** OAuth2 M2M JWT → NetSuite SuiteQL → mapping strict → BigQuery staging → atomic transaction MERGE/replace detail/checkpoint → read-only reconciliation → controller/scheduler existing.
3. **Tidak menebak transaction type maupun link type.** Probe sumber dulu; konfirmasi tipe, hubungan, item quantities, GL, posting status, dan return flow sebelum membuat mapping/table.
4. **Create table otomatis dari script hasil copy-paste ke PowerShell**, mengikuti implementasi modul existing (`ensureTables()`/schema/DDL), bukan langkah manual klik BigQuery atau file SQL manual sebagai syarat utama. Buat script module `.mjs`/PowerShell paste block yang create-if-not-exists dan preserve data. Jangan drop/recreate tabel historis.
5. **Gunakan common client dan helpers yang sudah ada**, jangan buat jalur auth, BQ, lock, checkpoint, atau deletion baru sendiri.
6. **Incremental overlap 5 menit** dan checkpoint aman, atomic bersama data. Replay idempoten, detail batch diganti secara scoped, bukan dihapus global.
7. **Decimal exactness:** string decimal, validasi sebelum staging, no silent rounding financial amount; rate handling harus mengikuti policy modul existing yang relevan dan didokumentasikan secara eksplisit.
8. **Verified deletion WAJIB untuk semua modul**, hanya independent `deletedrecord` exact proof; source not-visible; dry-run; re-proof; maximum 3 candidates per batch; audit; update header saja; detail/history/checkpoint tidak tersentuh; fail-closed.
9. **Shared lock di top-level orchestration** (`scripts/fast-delta.mjs`, `scripts/scheduler-runner.mjs`), bukan masing-masing `sync.mjs`. Jangan memulai standalone sync saat scheduler aktif.
10. **No additional Scheduled Task**; standalone `.mjs` hanya untuk development/testing sebelum registrasi controller/fast delta.
11. **Keep existing six/seven modules stable**; perubahan additive, minimal, backed-up, with offline syntax+unit regression; controller/scheduler integration paling akhir sesudah module-specific validation.
12. **Setiap hasil error harus diikuti actionable command** untuk langkah berikut; tidak mengulang full check mahal terus-menerus di jam traffic Finance.
13. **Never expose credentials/private keys in handover, chat, or code**, gunakan existing `.env` / secure variables; user pernah meminta copy-paste script tetapi jangan embed secrets.
14. **Jangan mengklaim `SYNC_OK` = `FINAL_PASS`**. Status butuh full presence, data integrity, GL/financial, checkpoint consistency pada completed run.

---

## 3. Setup awal NetSuite — NAMA ROLE, INTEGRATION, PERMISSIONS

### 3.1 Identitas dan metode akses (verified from prior work)

| Setting | Nilai |
|---|---|
| NetSuite role | **`PNM NetSuite Backup Integration`** |
| Role internal ID historis | `customrole1042` |
| NetSuite integration record | **`PNM NetSuite Backup`** |
| Authentication | **OAuth 2.0 Machine-to-Machine / Client Credentials with certificate JWT assertion** |
| JWT signature algorithm | **`PS256`** |
| API data source | REST Web Services / SuiteQL |
| `Run Server SuiteScript and Trigger Workflows` | **OFF** — JANGAN DIUBAH |
| Role intent | Minimal read-only business transaction access; no Edit/Full untuk transaction yang hanya di-backup |

Fitur SuiteCloud yang pernah dinyalakan pada setup awal: **Server SuiteScript**, **REST Web Services**, **OAuth 2.0**, **SOAP Web Services**, dan **Token-Based Authentication**. Itu catatan status account feature; bukan instruksi untuk mengaktifkan semua ulang dan bukan berarti semua digunakan backup.

Alur OAuth: integration client → private key certificate-bound JWT (`PS256`) → OAuth access token → SuiteQL REST query. Key/certificate/secret **hanya ambil dari konfigurasi live existing**, jangan dicetak. Role/entity/application/certificate mapping yang sudah berjalan jangan di-reset.

### 3.2 Permission yang dicatat dalam riwayat, beserta tingkat kepastian

| Tab / Permission NetSuite | Level | Status informasi |
|---|---|---|
| **Reports → SuiteAnalytics Workbook** | **Edit** | Level pernah diverifikasi saat setup awal; pertahankan |
| **Setup → REST Web Services** | **Full** | Pernah diverifikasi |
| **Setup → Log in Using OAuth 2.0 Access Tokens** | **Full** | Pernah diverifikasi |
| **Transactions → Find Transaction** | **View** | Baseline handover sebelumnya |
| **Transactions → Invoice** | **View** | Setup awal / module SI |
| **Transactions → Sales Order** | **View** | Baseline existing |
| **Transactions → Item Fulfillment** | **View** | Baseline existing |
| **Transactions → Deleted Records** (tab penempatan bisa berbeda sesuai UI account) | **View** | Explicit user-approved; **Full tidak perlu** |
| **Transactions → Purchase Order** | **View** | Baseline PO; source probe read access berhasil |
| **Transactions → Bills** | **View** | **Wajib untuk Purchase Invoice/Vendor Bill**; jangan cari/beri permission bernama `Purchase Invoice` atau `Vendor Bill Approval` |
| **Lists → Vendors** | **View** | Pernah direkomendasikan untuk PI; cek UI live jika perlu |
| **Lists → Accounts** | **View** | Pernah direkomendasikan untuk PI; cek UI live |
| **Lists → Currency** | **View** | Pernah direkomendasikan untuk PI; cek UI live |
| **Item Receipt / Return Authorization / Vendor Return Authorization / Item Fulfillment auxiliary permissions** | **VERIFY LOCALLY** | Tidak ada bukti final seluruh exact labels/levels dalam chat ini; jangan mengarang |

**Untuk Module 8 Purchase Return:** sebelum menjalankan probe, periksa apakah role existing mampu membaca transaction types relevan via SuiteQL. Jika permission kurang, tambahkan *minimum View* pada exact UI permission yang dibutuhkan berdasarkan error probe, jangan beri Edit/Full hanya karena gagal membaca. UI naming bisa berbeda dari `Transaction.type`; jangan samakan label berdasarkan asumsi.

**Larangan khusus:** `Run Server SuiteScript and Trigger Workflows = OFF` terkait CSV import/scheduler; tetap OFF. Role transaction bersifat backup read-only. Jangan ubah role ID/integration name tanpa alasan terverifikasi.

---

## 4. Infrastruktur / project dan folder structure

### 4.1 Environment

- OS lokal: Windows 11; PowerShell.
- Node.js dari nvm4w, runtime yang tampak di log: `Node.js v20.19.0`.
- Repo lokal: `C:\netsuite-backup`.
- BigQuery project: `even-gearbox-255203`, dataset `netsuite_backup`, location `asia-southeast1`.
- Operational GCP CLI: `bq` dari gcloud; Windows Cloud SDK Python dikonfigurasi sementara (lihat §10).
- Waktu log JSON/ISO `Z` adalah UTC; pengguna Asia/Jakarta WIB (UTC+7). Jangan samakan timestamp modified tanpa memeriksa jenis `DATETIME`/`TIMESTAMP`.

### 4.2 Pohon folder — **observed / referenced**, bukan klaim hasil `tree` live lengkap

```text
C:\netsuite-backup\
├── package.json                         # npm test (3 regression suites)
├── config\
│   ├── scheduler.json                   # workflow common/recovery-controller.mjs; kadang UTF-8 BOM
│   └── self-healing.json                # config.enabled, catchUpSync, limits, deletion flags
├── common\
│   ├── netsuite-client.mjs              # token(), fetchAll(), shared auth/SuiteQL
│   ├── bigquery-client.mjs              # BigQuery shared client/helper; inspect before reuse
│   ├── decimal-precision.mjs            # canonical, validateNumeric, normalizeNumericRate, validateNumericRows
│   ├── recovery-controller.mjs          # --core engine; all 7 modules registered TWICE
│   ├── verified-deletion-batch.mjs      # shared batch IR/PO/PI/SR, limit 3
│   ├── shared-lock.mjs                  # shared scheduler/fast delta lock
│   └── so-mismatch-candidates.mjs       # SO bounded source-moving diagnosis
├── scripts\
│   ├── fast-delta.mjs                    # 7 module sync, markers, shared lock, health-v2
│   ├── scheduler-runner.mjs             # V3 orchestration, shared lock, run log, latest/history
│   ├── scheduler-watchdog.mjs           # watchdog
│   ├── shared-lock-inspect.mjs          # prints lock+guard status
│   ├── verified-deletion.mjs            # 7 record types, exact proof, one-header soft delete
│   ├── diagnose-bigquery-jobs.mjs       # read-only performance analysis (SR context)
│   └── [other existing scripts]         # VERIFY LOCALLY
├── modules\
│   ├── sales-invoice\
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   └── [check/other scripts — inspect exact tree]
│   ├── item-fulfillment\
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   └── [check/financial/other scripts]
│   ├── sales-order\
│   │   ├── mapping.mjs
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   ├── check.mjs
│   │   ├── recover.mjs
│   │   └── repair-active.mjs
│   ├── item-receipt\
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   └── check-financial.mjs (+ other existing)
│   ├── purchase-order\
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   ├── check.mjs
│   │   └── [mapping/probe/etc — inspect]
│   ├── purchase-invoice\
│   │   ├── mapping.mjs
│   │   ├── sync.mjs
│   │   ├── presence.mjs
│   │   ├── check.mjs
│   │   └── [financial/probe/etc — inspect]
│   └── sales-return\
│       ├── probe.mjs
│       ├── probe-workflow.mjs
│       ├── diagnose-return-source.mjs
│       ├── diagnose-itemship-receipt.mjs
│       ├── mapping.mjs
│       ├── sync.mjs                     # active production, optional --timing
│       ├── presence.mjs
│       ├── check.mjs
│       ├── check-financial.mjs
│       ├── test-deletion-batch-readonly.mjs
│       └── sync.before-perf.mjs         # historical copy, NOT production entrypoint
├── tests\
│   ├── foundation-test.mjs
│   ├── child-runner-test.mjs
│   └── fast-delta-integration-test.mjs
├── logs\
│   ├── scheduler\
│   │   ├── latest.json
│   │   ├── history.jsonl
│   │   ├── run-*.log
│   │   ├── shared-lock-audit.jsonl
│   │   ├── alerts.json
│   │   ├── alerts-attempts.jsonl
│   │   └── skips.jsonl
│   ├── fast-delta\
│   │   └── health-v2.json
│   └── verified-deletions\
│       └── audit.jsonl
├── backups\
│   └── before-sr-integration-20261023-140738\
├── apply-integration.ps1               # patch helper copied to root; after apply NOT used by scheduler
├── diagnose-so-3159848.mjs             # transient read-only diagnostic (optional cleanup later)
└── [other existing source/logs/env — VERIFY LOCALLY]
```

**Jangan otomatis menghapus file** yang belum dikenali. Struktur di atas merangkum yang muncul dalam chat, bukan output `tree` total. Untuk memperoleh tree tepat di chat baru:

```powershell
cd C:\netsuite-backup
Get-ChildItem .\common,.\scripts,.\tests -Recurse -File | Select-Object FullName
Get-ChildItem .\modules -Recurse -File | Select-Object FullName
```

### 4.3 Windows Scheduled Tasks (tepat empat)

```text
NetSuite Backup V3
NetSuite Backup Fast Delta
NetSuite Backup Freshness Monitor
NetSuite Backup Watchdog
```

Tidak boleh membuat task kelima per module. Task V3/fast delta mengelola shared lock dan checkpoint; modul melakukan sync hanya saat dipanggil orchestrator. Kondisi task `Ready` ≠ `FINAL_PASS`; baca `latest.json` dan `health-v2.json`.

---

## 5. Modul 7 — Sales Return: penemuan NetSuite dan business mapping

### 5.1 Fakta sumber: retur penjualan fisik adalah **Item Receipt**

**JANGAN asumsikan Sales Return = Return Authorization saja.** Discovery via `probe*.mjs` menemukan penerimaan barang retur yang benar sebagai:

- `Transaction.type = 'ItemRcpt'` di NetSuite untuk physical sales return.
- `PreviousTransactionLineLink.linktype = 'CostRtrn'` berasal dari `ItemShip` (original Item Fulfillment).
- `PreviousTransactionLineLink.linktype = 'ShipRcpt'` berasal dari `RtnAuth` (Return Authorization).
- **Kedua link disimpan** dalam backup (`sales_return_source_links`), bukan hanya fulfillment.
- Untuk verified deletion SR record type-nya **`recordtypeid='itemreceipt'`, `type='ITEMRECEIPT'`**, dengan tabel target khusus `sales_return_headers`; jangan membuat recordtypeid rekaan `salesreturn`.

Contoh sumber Oktober 2026:

| Entitas | NetSuite internal ID | Nomor dokumen / tanggal |
|---|---|---|
| Physical return receipt | `3158014` | `GR261003361`, 21 Oktober 2026 |
| Original fulfillment | `3142003` | `DO260909607`, 30 September 2026 |
| Return authorization | `3157671` | `CRA2600012`, 14 Oktober 2026 |

KPI contoh: physical returned qty `10`; GL debit `973148.41`, credit `973148.41`; inventory cost rate `97314.841`, sehingga quantity 10 × rate = `973148.410`, setara amount GL 2-digit `973148.41`. Tidak boleh memotong rate menjadi 2 digit di mapping.

### 5.2 BigQuery tables SR — create automatically by module script

Empat tabel production di dataset `netsuite_backup`:

```text
sales_return_headers
sales_return_lines
sales_return_accounting_lines
sales_return_source_links
```

Satu contoh snapshot Oktober 2026 yang sudah divalidasi:

| Tabel | Count NS | Count BQ | Check |
|---|---:|---:|---|
| `sales_return_headers` | 1 | 1 | PASS |
| `sales_return_lines` | 3 | 3 | PASS |
| `sales_return_accounting_lines` | 2 | 2 | PASS |
| `sales_return_source_links` | 2 | 2 | PASS |

No duplicates, no orphan, no field mismatch; source links `CostRtrn` + `ShipRcpt`; amount debit/credit exactly match.

**DDL detail (exact field names/types)** harus direferensikan dari `modules/sales-return/sync.mjs` bagian schema/`ensureTables()`, bukan dibuat ulang dari ringkasan ini. Module 8 harus meniru mekanisme otomatis table creation tersebut agar bisa dibuat dari paste script PowerShell.

### 5.3 Mapping SR

`modules/sales-return/mapping.mjs`: strict source mapping, validation, link reconciliation, exact decimal strings. Awalnya mapping hanya fulfillment-specific; direvisi menyimpan **keduanya** via generic:

```text
source_internal_id
source_type
source_number
source_date
link_type
```

Penamaan atribut lengkap lihat production mapping; jangan mengulang pendekatan fulfillment-only. Source header/line/accounting/link identities dan unique keys harus dijaga.

### 5.4 Sync SR

`modules/sales-return/sync.mjs`:

- `--dry-run`: OAuth + source fetch/map/validate, tanpa data write/checkpoint write; log exact `DRY RUN PASS: source validated; inventory-cost decimals preserved exactly; BigQuery/checkpoints unchanged.`
- `--sync`: staging 4 tabel, transaction atomic header MERGE + scoped detail replace + **4 checkpoints**; retries **hanya** pada checkpoint concurrent-update yang terbukti transient; fail closed jika source checkpoint berubah di luar expected guard.
- Incremental overlap 5 menit.
- `--timing` opsional untuk diagnosis performance, **tetap modul existing** bukan scheduler tambahan.
- Tidak punya shared lock internal; lock di controller runner.

SR 4 `record_type` checkpoint:

```text
sales_return_headers
sales_return_lines
sales_return_accounting_lines
sales_return_source_links
```

Pada 23 Oktober 2026 seluruh empat baris checkpoint diverifikasi BigQuery:

```text
last_successful_modified_at = 2026-10-21T14:31:24
last_successful_sync_at     = 2026-10-23 07:18:52 (UTC rendering)
updated_at                  = 2026-10-23 07:18:52
```

Header/lines/accounting/links seragam. Last modified tetap Oktober 21 **bukan gagal**, karena source belum berubah; `last_successful_sync_at` menunjukkan successful run.

### 5.5 SuiteQL coverage and probe history

Probe awal `probe.mjs`, `probe-workflow.mjs`, `diagnose-return-source.mjs`, `diagnose-itemship-receipt.mjs` dipakai sebelum table/mapping. YTD physical return counts yang pernah ditemukan: Jan 4, Feb 1, Mar 2, Mei 1, Jul 1, Agu 1, Sep 1, Okt 1; target KPI period Okt–Des, November/Des belum berlangsung per 23 Oktober. Jangan simpulkan kosong bulan depan sebagai bug sekarang.

---

## 6. Critical decimal precision baseline — jangan ganti `NUMERIC` ke `DECIMAL`

### 6.1 Audit schema, October 23

Pengguna menjalankan `INFORMATION_SCHEMA.COLUMNS` pada seluruh 7 modul. **47 kolom numerik finansial** yang ditemukan semuanya bertipe **`NUMERIC`**, tidak ada `FLOAT64`/`BIGNUMERIC` pada hasil tersebut. `rounding_mode` bernilai `null`. Itu tidak menjamin NS data >9-digit fractional dapat tersimpan exak.

BigQuery:
- `DECIMAL` **alias `NUMERIC`** (bukan solusi precision).
- `NUMERIC`: maksimum **9 digit pecahan**.
- `BIGNUMERIC`/`BIGDECIMAL`: sampai **38 digit pecahan**; migrasi schema saja tidak cukup, karena existing validators/mapping/staging/check juga harus dirancang ulang.
- **Jangan migrasi production spontan**, terlebih ketujuh modul telah FINAL_PASS.

### 6.2 Helper existing: `common/decimal-precision.mjs`

Tiga exports yang **diverifikasi lewat source**:

```js
validateNumeric(value, context = {})
normalizeNumericRate(value, context = {})
validateNumericRows(rows, fields, context = {})
```

`canonical(value)` (internal helper) parses numeric/scientific notation sebagai string (tanpa floating-point) dan merapikan trailing zeros. `MAX_INTEGER_DIGITS = 29`; `SCALE = 9`.

- `validateNumeric`: reject jika lebih dari 29 integer digits atau 9 fractional digits; throw `BigQuery NUMERIC precision violation [module ... record=... field=...]: value`; **no silent loss**.
- `normalizeNumericRate`: bila fractional >9, round half-up berbasis `BigInt`, lalu validate; **hanya untuk rate/exchange rate yang secara eksplisit dipilih oleh mapping**; bisa mengubah representasi nilai sumber secara sengaja. Jangan menggunakannya pada financial totals/GL tanpa kebijakan tervalidasi.
- `validateNumericRows`: iterates fields schema bertipe `NUMERIC` dan validasi values sebelum staging.

**Usage confirmed:**

| Modul | File/pola |
|---|---|
| SI | `modules/sales-invoice/sync.mjs`: `validateNumericRows` headers + lines |
| IF | `modules/item-fulfillment/sync.mjs`: `validateNumericRows` |
| SO | `modules/sales-order/mapping.mjs`: `normalizeNumericRate(... rate ...)`; `sync.mjs`: `validateNumericRows` |
| IR | `modules/item-receipt/sync.mjs`: `validateNumericRows` |
| PO | `modules/purchase-order/sync.mjs`: `validateNumericRows` |
| PI | `modules/purchase-invoice/mapping.mjs`: `normalizeNumericRate(... exchangerate/rate ...)`; `sync.mjs`: `validateNumericRows` |
| SR | `modules/sales-return/mapping.mjs`: `validateNumeric`, `check-financial.mjs`: exact, `sync.mjs`: `validateNumericRows` |

**SR intentionally no `normalizeNumericRate`**: inventory-cost rate exact decimal string, fail if unrepresentable, rather than silent rounding. Jangan paksa semua modul menggunakan fungsi normalisasi yang sama; ikuti policy field-specific.

### 6.3 Reconciliation cents vs exact values

`modules/sales-order/check.mjs` memakai `cents()` pada financial values, `qty()` toFixed(6); source vs BQ raw string formatting seperti `8372420.00` vs `8372420` bisa berbeda **tanpa** berbeda numerik. Targeted diagnostic string-level terlihat satu format difference tetapi official check memang menggunakan cents; jangan 'repair' format ini.

Batasan: exact cent comparison tidak menjamin perbandingan rate 9 digit sempurna. Bagi modul baru, bedakan `rate precision` vs `posted financial amount`, dan tambah strict validators sesuai kontrak existing.

---

## 7. Verified deletion: baseline universal + jalur nyata

### 7.1 Engine single-record: `scripts/verified-deletion.mjs`

**Registry tepat 7 modul:**

```js
const recordTypes = {
  'sales-invoice':     { recordtypeid:'invoice',         type:'INVOICE',         table:'sales_invoice_headers' },
  'sales-order':       { recordtypeid:'salesorder',      type:'SALESORDER',      table:'sales_order_headers' },
  'item-fulfillment':  { recordtypeid:'itemfulfillment', type:'ITEMFULFILLMENT', table:'item_fulfillment_headers' },
  'item-receipt':      { recordtypeid:'itemreceipt',     type:'ITEMRECEIPT',     table:'item_receipt_headers' },
  'purchase-order':    { recordtypeid:'purchaseorder',   type:'PURCHASEORDER',   table:'purchase_order_headers' },
  'purchase-invoice':  { recordtypeid:'vendorbill',      type:'VENDORBILL',      table:'purchase_invoice_headers' },
  'sales-return':      { recordtypeid:'itemreceipt',     type:'ITEMRECEIPT',     table:'sales_return_headers' }
};
```

Process:
1. Validates ID/module/flags, `--apply` requires `NETSUITE_VERIFIED_DELETE_CONFIRM=I_CONFIRM_VERIFIED_SOFT_DELETE`.
2. Query NetSuite: `SELECT recordid,recordtypeid,type,name,deleteddate,deletedby,context FROM deletedrecord WHERE recordid=...`.
3. Requires **exactly one** matching recordid AND exact recordtypeid/type AND deletion date.
4. Query `Transaction WHERE id=...` — **must NOT be visible**.
5. Query BQ header by `CAST(internal_id AS STRING)=@id`, **exactly one**, active; already deleted yields NO-OP.
6. Dry-run prints `DRY RUN PASS: NetSuite proof verified, BigQuery unchanged` (no write).
7. Apply fetches `deletedrecord` & source visibility again; **re-proof**.
8. Single BQ transaction with `ASSERT` before and after, `UPDATE ... SET is_deleted=TRUE, deleted_at=CURRENT_TIMESTAMP()` **header table only**.
9. Post-commit BQ verified, append JSONL `logs/verified-deletions/audit.jsonl` with at/id/type/deleteddate/deletedby/result.
10. **No delete of lines/GL/link tables, no checkpoint modification.**

**Caveat audit:** audit JSONL ditulis setelah BQ commit. Process crash tepat di antara commit dan log write bisa menyebabkan already-deleted state tanpa audit row. Dicatat sebagai *known residual risk*; jangan anggap semua crash-window sudah ditutup.

### 7.2 Shared batch: `common/verified-deletion-batch.mjs`

Supported:

```text
item-receipt
purchase-order
purchase-invoice
sales-return
```

- `inspectDeletionInventory(module)` menjalankan presence read-only; IR legacy text parser; PO/PI/SR JSON parser; validasi lists/duplicates/exit statuses.
- `processVerifiedDeletionBatch(module, inventory, {apply=false})` menggunakan **`onlyBigQuery.slice(0,3)`**; untuk setiap kandidat jalankan single-record `--dry-run`, lanjut `--apply` hanya jika dry proof pass dan mode sync/eligible; rerun inventory after batch.
- `backlog` logs adalah jumlah kandidat awal, tidak langsung berarti semuanya terhapus; `applied` count yang benar.
- Invalid/incomplete proof ⇒ print `VERIFIED DELETION BLOCKED`; if no proof, no write.
- Batch maksimal 3 **per run**, bukan lifetime quota.

### 7.3 Legacy controller: SI, SO, IF

`common/recovery-controller.mjs` punya pathway lama:
- `allowDelete = verifiedDeletionEnabled && (SI|SO|IF && verifiedIFDeletionEnabled)`.
- Parses missing NetSuite visibility evidence dari presence, verifies unique inventory.
- Bounded `missing.slice(0,maxDeletePerRun)` dengan `maxDeletePerRun=3`.
- Calls `scripts/verified-deletion.mjs` dry-run/apply; semua kandidat wajib **independent deletedrecord proof**.
- **Jangan refactor/menggabungkan secara prematur**; proven existing behavior, maintain stability.

### 7.4 Shared controller: IR, PO, PI, SR

- Uses `specialDeletionGuard(mod)` and `verifiedDeletionEnabled` config.
- Runs inventory; if `--sync` and `onlyBigQuery>0` and deletion enabled, invokes `processVerifiedDeletionBatch(...,{apply:true})` and re-inspects.
- If discrepancies remain, reports `NEEDS_REVIEW` and does not pretend FINAL_PASS.
- SR uses this path; new module 8 should follow **closest comparable module** and only add registration after proven exact NetSuite type.

### 7.5 Actual testing/proof completed in this chat

1. SR direct engine negative: `node scripts/verified-deletion.mjs --module sales-return --id 3158014 --dry-run` ⇒ no deletedrecord proof, exit **1**, **no write**.
2. SR clean batch test: `test-deletion-batch-readonly.mjs` ⇒ inventory `onlyNetSuite=[]`, `onlyBigQuery=[]`, candidates=0, applied=0, exit 0.
3. SR **simulated candidate** `3158014`, `{apply:false}` ⇒ `VERIFIED DELETION BLOCKED`, candidates 1, applied 0, exit 0 (test wrapper asserts behavior).
4. SR **simulated five candidate IDs** `3158014..3158018` ⇒ only first **3** inspected, `backlog=5`, `applied=0`, limit test PASS.
5. SI audit trail production shows deletion Oct 22–23; BQ sampled IDs `3159881`,`3159886`,`3159891`,`3159895`: all `is_deleted=true`, `deleted_at` filled; audit JSONL match.
6. No `ONLY BIGQUERY` backlog observed during final reconciliation across modules; not proof all future deletes succeed.

For module 8, **do not simulate actual deletion in production**: use dry-run negative and pure bounded batch tests first. Positive apply only with real independent proof, under normal controller, not artificial deletedrecord.

---

## 8. Controller, Fast Delta, patch history, scheduler

### 8.1 Production integration delta performed Oct 23

Earlier `common/recovery-controller.mjs` had two distinct module lists, each six modules. Patch added `sales-return` to **both**.

Added `if(mod==='sales-return')` branch in guarded core:
- `--sync` / `--dry-run`: execute `modules/sales-return/sync.mjs` with appropriate args.
- Dry-run marker exact `DRY RUN PASS: source validated`.
- Sync marker regex `SALES RETURN SYNC SUCCESS|SALES RETURN NO CHANGES: SUCCESS`.
- `specialDeletionGuard('sales-return')` plus `presence.mjs`, `check.mjs`, `check-financial.mjs` enforcement to get FINAL_PASS.
- `--audit-only`: read-only; succeeded with `AUDIT_CLEAN`.

`common/recovery-controller.mjs --core --all --audit-only` audits 7 modules. Independent controller `--core sales-return --dry-run` and `--audit-only` both passed.

`scripts/fast-delta.mjs` patch:
- Old flags: `NETSUITE_PO_ENABLED`, `NETSUITE_PI_ENABLED` used to control module array.
- Post-patch: **all seven registered by default**, no PO/PI feature flags required.
- Added SR markers for `sync`/no changes, SR receives `--sync` explicitly like IR/PO/PI; dry-run `--dry-run`.
- `moduleTimeoutMs=30*60*1000` per module.
- Shared lock `createSharedLock({stateDir: path.join(root,'logs','scheduler'), worker:'fast-delta'})`.
- Progress/health in `logs/fast-delta/health-v2.json`.

Patch helper `apply-integration.ps1` was copied to root; `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...` required because policy rejects unsigned `.ps1`. Preview output:

```text
PREVIEW OK: controller registries=2; SR guarded core branch; Fast Delta registry/marker/args
DRY PREVIEW ONLY. No files changed.
```

Applied with `-Apply`; result `PATCH APPLIED, syntax PASS`. Backup path:

```text
C:\netsuite-backup\backups\before-sr-integration-20261023-140738
```

**Warning:** This patch applied directly to live controller and fast delta; scheduler could pick it up on next run. For module 8 do not mutate registry during testing; backup before apply and validate scheduled-run safety.

### 8.2 Shared lock and scheduler safety

- `worker='fast-delta'` or `worker='scheduler'` owner, PID/hostname/token.
- `scripts/shared-lock-inspect.mjs` shows `lock` and `guard` statuses. `PID_EXISTS` while task `Running` is **normal**; never delete lock, never kill process.
- `ABSENT/ABSENT` after completed run expected.
- V3 `LastTaskResult` while `Running` can show `267009`: not definitive failure.
- `latest.json` points to **latest completed run**; latest `run-*.log` by timestamp may be **still in progress**. Always use `latest.log`, not newest file, to extract final summary.
- `latest.json` mode/slot/status/exitCode/timedOut; `history.jsonl` completed history; `health-v2.json` last attempt/success for seven modules.
- Recovery Controller may do bounded retries/repair in `--sync`; use `--audit-only` for safe read-only tests; do not invoke write-mode manually during busy Finance.

### 8.3 Regression tests

`npm test` performs:

```text
node tests/foundation-test.mjs
node tests/child-runner-test.mjs
node tests/fast-delta-integration-test.mjs
```

All three passed after integration patch.

**BOM incident:** `tests/foundation-test.mjs` line `JSON.parse(read('config/scheduler.json'))` failed because `config/scheduler.json` had UTF-8 BOM. Fix only parser line:

```js
const cfg=JSON.parse(read('config/scheduler.json').replace(/^\uFEFF/, ''));
```

A `.bak` copy was made, new test file written UTF-8 without BOM; no scheduler config modified. Subsequent tests:

```text
FOUNDATION CONTRACT TESTS PASS
CHILD RUNNER TESTS PASS
FAST DELTA INTEGRATION TESTS PASS
ExitCode: 0
```

Do not reintroduce BOM failure by overwriting test/config carelessly.

---

## 9. Exact testing sequence for Module 8 — DON'T IMPROVISE

The user requires **sequential, output-based testing**, not dumping full one-shot integration. Each test returns a concrete command; inspect output, then next step. Module 8 has to be consistent with `purchase-invoice`, `purchase-order`, `item-receipt`, and `sales-return` patterns, but **actual source semantics must be proved via probes**.

### Phase A — Read-only source discovery **BEFORE DDL**

1. Verify role `PNM NetSuite Backup Integration`, integration `PNM NetSuite Backup`, `PS256` OAuth; `Run Server SuiteScript and Trigger Workflows OFF`; no change to secrets/role unless probe demonstrates minimal missing read permission.
2. Inspect code `common/netsuite-client.mjs`, working probes and module baselines. Copy **existing** pattern; do not design new client.
3. Create `modules/purchase-return/probe.mjs` from existing read-only probe convention and run it with `node` from PowerShell. Establish concrete SuiteQL `Transaction.type`, recordtypeid, dates, statuses, `PreviousTransactionLineLink`/`NextTransactionLineLink`, quantities, GL impact and preceding PO/receipt/vendor bill. **Do not assume `VendRtnAuth` / `ItemShip` / `VendCred` without proof.**
4. Probe October–December windows (future months naturally zero until transactions exist). Capture counts, sample IDs, line cardinality, duplicate/source-late patterns, non-item/GL-only variants, exact decimal precision.
5. Agree model: whether Purchase Return is vendor return authorization (non-posting), physical return fulfillment (inventory), or vendor credit (financial); might require multiple related record types/tables. **Don't conflate them**. Use source evidence.

### Phase B — Mapping and automatic schema creation

6. Build `mapping.mjs` with strict source field identity, type and link assertions, exact numeric values, duplicates, orphan and business invariants.
7. Build `sync.mjs` using existing module template: **create-if-not-exists BQ tables automatically from Node script**, launchable from a **PowerShell copy-paste** block; no manual console DDL and no standalone scheduler.
8. Add module-specific schema fields, typed staging, `validateNumericRows`, exact amounts, `is_deleted/deleted_at` in header, checkpoint names matching tables, 5-minute overlap, bounded fetch paging, atomic MERGE+scoped detail replace+checkpoint transaction.
9. Validate idempotence and no data writes from `--dry-run`. Capture `DRY RUN PASS` required by orchestrator; do not invent marker incompatible with baseline.
10. On first safe controlled `--sync` after lock inspection and deployment window: use existing module entrypoint. **No FORCE SYNC**. Confirm automatic ensure-table created exactly intended schemas; run `--sync` only after source mapping test PASS.

### Phase C — Mandatory module-specific audits

11. `presence.mjs` with supported JSON fields `netSuite`, `bigQuery`, `onlyNetSuite`, `onlyBigQuery`, `sourceDuplicate`, `bigQueryDuplicate`; exit **0** clean, **3** discrepancy, **1** error/duplicate; adapt only if module's existing closest comparable contract demands an alternative.
12. `check.mjs` full October snapshot **field-by-field on all needed tables** + unique IDs/line keys + orphans; strict but do not mistake string formatting for numeric differences.
13. `check-financial.mjs` (if physical/GL impact exists): exact source/BQ GL debit/credit and quantity/link count; if no GL, explicitly document non-posting and validate correct entity.
14. Verify checkpoint persisted for every table; fixed watermark across table rows is allowed; `last_successful_sync_at` should reflect successful subsequent sync. Cross-check BQ schema.
15. Validate no unintended data change on re-run; test `--dry-run` and read-only presence/check again.

### Phase D — Deletion hardening BEFORE production registry

16. Extend single-record `recordTypes` with correct exact NetSuite `recordtypeid` and `type` only after empirical deletedrecord investigation or grounded NetSuite evidence. Ensure header table `is_deleted` exists.
17. Register in `common/verified-deletion-batch.mjs` only after parser output compatibility and negative proof. Do not assume Purchase Return is one transaction type.
18. Mandatory deletion tests: clean inventory, non-proof blocked (direct single-record dry-run exit nonzero), shared batch simulated one invalid candidate blocked and applied=0, simulated five candidates processed max 3; no BQ writes; test idempotent already-deleted path where safe.
19. **Never fabricate real deletions**. Positive production proof can remain pending until a real NS deletedrecord event. Re-proof, no lines/checkpoints mutate, audit trail.

### Phase E — Controller + Fast Delta integration LAST

20. Backup `common/recovery-controller.mjs` and `scripts/fast-delta.mjs`. Inspect **both** module registries in controller, module array in fast delta, marker map, explicit `--sync` argument routing.
21. Add one guarded module branch with same conventions as SR/PI/PO and verification scripts. No separate task, no feature flag if module is approved production; but stage rollout carefully.
22. Run `node --check` changed files and `npm test` (Foundation/Child/Fast Delta integration PASS). No impact six/seven old modules.
23. Run controller module `--audit-only`, module `--dry-run`, fast delta `--dry-run` **only when lock free** and no concurrent scheduler risk.
24. Observe **normal scheduled production cycle** from existing Fast Delta/Recovery V3; don't add standalone permanent runner. Read `health-v2.json` for module `SYNC_OK`; `latest.json` and its referenced completed log for module `FINAL_PASS`.
25. Confirm post-production presence, full integrity, GL reconciliation/checkpoints; perform final one stable-source reconciliation during low Finance traffic if source moving; don't force.
26. Update documentation/handovers and module status; don't claim completed if only `SYNC_OK` or `AUDIT_CLEAN`.

### Production safe commands — copy/paste blocks

**Inspect tasks and lock**:

```powershell
cd C:\netsuite-backup
Get-ScheduledTask | Where-Object {$_.TaskName -match 'NetSuite Backup'} | Select-Object TaskName,State
node .\scripts\shared-lock-inspect.mjs
```

**Regression**:

```powershell
cd C:\netsuite-backup
node --check .\common\recovery-controller.mjs
node --check .\scripts\fast-delta.mjs
npm test
Write-Host 'Regression ExitCode:' $LASTEXITCODE
```

**Full seven-module read-only audit** (expensive while Finance busy; do not run repeatedly):

```powershell
cd C:\netsuite-backup
node .\common\recovery-controller.mjs --core --all --audit-only
Write-Host 'Full Audit ExitCode:' $LASTEXITCODE
```

**Single module audit**:

```powershell
node .\common\recovery-controller.mjs --core sales-return --audit-only
Write-Host 'ExitCode:' $LASTEXITCODE
```

**SR dry-run**:

```powershell
node .\common\recovery-controller.mjs --core sales-return --dry-run
Write-Host 'ExitCode:' $LASTEXITCODE
```

**Fast Delta dry-run** (all registered modules, read-only, expensive):

```powershell
node .\scripts\fast-delta.mjs --dry-run
Write-Host 'ExitCode:' $LASTEXITCODE
```

**FINAL STATUS — use COMPLETED V3 LOG, not newest run log**:

```powershell
cd C:\netsuite-backup
$latest = Get-Content .\logs\scheduler\latest.json -Raw | ConvertFrom-Json
$logPath = Join-Path '.\logs\scheduler' $latest.log
Write-Host 'V3 Status:' $latest.status 'ExitCode:' $latest.exitCode 'Finished:' $latest.finishedAt
if (Test-Path $logPath) {
  $content = Get-Content $logPath -Raw
  if ($content -match '(?s)========== RECOVERY SUMMARY ==========(.*?)(?:Scheduler status=|$)') {
    $Matches[1].Trim()
  } else { Write-Host 'Completed run summary not found' }
}
$health = Get-Content .\logs\fast-delta\health-v2.json -Raw | ConvertFrom-Json
$health.modules.PSObject.Properties | ForEach-Object {
  [PSCustomObject]@{ Module=$_.Name; Status=$_.Value.lastResult; LastSuccess=$_.Value.lastSuccessAt }
} | Format-Table -AutoSize
Write-Host 'Fast Delta Overall:' $health.lastRunStatus
```

Read-only verification scripts should not print `--apply` instruction as recommendation; legacy presence output may do so generically, **do not follow that blindly**.

---

## 10. Problems/bottlenecks found in this chat, mitigations, residual risks

### 10.1 SR physical return source identification — SOLVED

Incorrect initial assumption was Sales Return via return authorization only. Probe showed actual physical receipt `ItemRcpt`, `CostRtrn` ItemShip + `ShipRcpt` RtnAuth. Added both source links, financial GL, physical qty. Do not repeat mistake in Purchase Return.

### 10.2 SR BigQuery checkpoint conflict / sync latency — MITIGATED, residual concurrency

- One incremental sync SR took **5485.98s (~91m26s)**, disproportionate to BQ job SQL time (~16–17s). Root cause for the historic 91m occurrence **not proven**.
- `scripts/diagnose-bigquery-jobs.mjs` read-only analysis: staging ~1 sec, transactional commit ~13–17 sec; checkpoint conflict observed.
- Instrumented SR `sync.mjs --timing`. Later production test **64.54 sec**: checkpoint ~1.06s, source until 3.15s, ensureTables ~1.08s, four staging operations ~8.1s, atomic commit with retry **51.20s** due to **two concurrent update conflicts** (retry delays 1500/3500ms), cleanup ~0.8s.
- Cause suspected scheduler writing shared `sync_checkpoints` while manual sync lacked lock; not proven as sole root cause for 91min.
- Mitigation: **do not standalone sync concurrently**, allow shared orchestrator; staged retry only if checkpoint evidence unchanged; don't modify shared helper/lock casually.

### 10.3 Module 7 deletion registration + batch compatibility — SOLVED/TESTED NEGATIVE

- Added SR to `scripts/verified-deletion.mjs` using `itemreceipt/ITEMRECEIPT`.
- Added SR to shared batch supported set; JSON presence integrated.
- Clean, negative proof, max-three batch simulated tests PASS. Positive apply for SR not observed; leave coverage qualification.

### 10.4 Patch execution policy Windows — SOLVED

Unsigned `apply-integration.ps1` blocked by PowerShell policy; use one-process:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\netsuite-backup\apply-integration.ps1'
# -Apply only after read-only preview and safe deployment checks
```

No permanent policy change. Actual patch apply PASS, backup created.

### 10.5 BOM in foundation tests — SOLVED

`config/scheduler.json` UTF-8 BOM caused `JSON.parse` `Unexpected token '\uFEFF'` at `tests/foundation-test.mjs:7`. Read-time `.replace(/^\uFEFF/,'')` patched, `npm test` all PASS. No scheduler JSON contents modified.

### 10.6 BigQuery CLI Windows Python failure — SOLVED

CLI `bq` initially picked invalid pyenv shim / WindowsApps python, causing startup errors. Found valid:

```powershell
$env:CLOUDSDK_PYTHON = 'C:\laragon\bin\python\python-3.10\python.exe'
bq version
# Python 3.10.6, BigQuery CLI 2.1.26
```

Environment variable is per PowerShell session. `gcloud components update` message was advisory, not blocker.

### 10.7 SQL quoting `%` in `bq query` PowerShell — SOLVED

Inline SQL string with `LIKE "%sales_return%"` caused `%` syntax error through Windows shell quoting. Use **UTF-8 no BOM temp SQL file piped via stdin**:

```powershell
$sql = @'
SELECT * FROM `even-gearbox-255203.netsuite_backup.sync_checkpoints`
WHERE LOWER(record_type) LIKE '%sales_return%'
ORDER BY record_type
'@
$f=Join-Path $env:TEMP 'netsuite-check.sql'
[System.IO.File]::WriteAllText($f,$sql,[System.Text.UTF8Encoding]::new($false))
Get-Content $f -Raw | bq query --project_id=even-gearbox-255203 --location=asia-southeast1 --use_legacy_sql=false --format=prettyjson
Write-Host 'ExitCode:' $LASTEXITCODE
```

Google Cloud CLI reauthentication was successful; not backup fault.

### 10.8 Distinguish active log from completed V3 status — SOLVED

Newest `run-*.log` while V3 running might not have `RECOVERY SUMMARY`, leading to `RECOVERY SUMMARY not found`. Correct approach: `logs/scheduler/latest.json` points to completed log; extract summary from `$latest.log`. A V3 in `Running` with shared lock `PID_EXISTS` is healthy; do not kill process, delete guard, or manually trigger sync.

### 10.9 Finance-high-traffic Sales Order mismatches — NATURALLY RECOVERED in final completed run

- Initial full read-only audit: IF NS-only `3160173` and SO NS-only `3160174`; user requested **leave it; sync catching up**, no forced intervention.
- V3 14:20 run `FAILED` exit 1: SO `check.mjs` header/line mismatch despite successful atomic sync; bounded source-moving retry and one targeted active refresh happened **automatically through existing Recovery V3**, not user manual force-sync.
- V3 14:40 run `NEEDS_REVIEW` exit 3; source-moving detection `changed=inventory,rawLineAmount; defer full verification; no checkpoint changes`; SO 472 lines mismatch at a snapshot, financial raw line amount mismatch while moving.
- Subsequent read-only check: SO 1013 NS vs 1013 BQ, 6252 lines equal; 3 header mismatch + 1538 line mismatch, then 1 header + 2 lines, then 3 header + 22 lines as new Finance events arrived. Finance total/raw line amount often PASS, duplicates/orphans 0.
- BQ timestamps three large SO `3160064` (`GTSP261023A`, 521 lines, modified 14:53:26), `3160065` (`GTSP261023B`, 502, 14:53:25), `3160066` (`GTSP261023C`, 509, 14:53:25) internally consistent; SO checkpoints both `2026-10-23T14:53:26`, `last_successful_sync_at=07:57:24Z`.
- Targeted diagnostic `3159848` (`SO261010736`, two lines) showed **only string representation** header `total_amount`: NS `8372420.00` vs BQ `8372420`, which are numerically equal; two lines identical. Source moving vs exact current fields remained timing-sensitive.
- Final **completed** V3 15:00 run, ended 15:10:43, **all 7 FINAL_PASS**. Therefore **do not keep debugging transaction by transaction**; user explicitly rejected time-wasting repetitive per-ID checks. Monitor technical errors, checkpoint stall, persistent financial mismatches during low traffic.

### 10.10 Decimal more-than-nine precision and type misunderstanding — CLARIFIED

- `NUMERIC` ≡ `DECIMAL` alias, changing name does nothing; `BIGNUMERIC` migration requires code/schema/staging/validation changes.
- `normalizeNumericRate` exists and deliberately rounds chosen SO/PI rates >9 fractional digits, `validateNumeric` strict others, SR strict exact inventory cost.
- Schema audit 47 numeric columns all `NUMERIC`; no `FLOAT64` observed. **This is not NetSuite→BQ equality proof**. Maintain defensive fail-fast.

### 10.11 SI deletion backlog history — SOLVED in observed production

- SI previously had eight deleted invoices `3147029..3147036` with independent deletedrecord proof, soft-deleted.
- Later SI production deletion audit Oct 22–23 had many additional real `SOFT_DELETED` records; checked BQ actual sample `3159881`,`3159886`,`3159891`,`3159895`, all `is_deleted=true` and `deleted_at` present.
- Bounded max three candidates per run is proven; multiple batches can process more than 3 total.
- Audit append-after-commit crash window remains known theoretical issue (§7.1).

### 10.12 V3 `--audit-only` coverage semantics

When audit-only ran Oct 23:
- SI presence 1389/1389, controller printed `Full KPI check skipped outside --sync`.
- IF 1005 NS / 1004 BQ, one `onlyNetSuite=3160173`, `NEEDS_REVIEW`.
- SO 1013 NS / 1012 BQ, one `onlyNetSuite=3160174`, `NEEDS_REVIEW`.
- IR printed `IR AUDIT: financial detail not certified outside --sync`.
- PO 151 headers, 585 lines matched; PI 337 headers, 1595 lines, 1595 GL, 251 links matched; SR 1/3/2/2 all matched.
- Full audit exit 3 then resolved on *completed V3 run* all FINAL_PASS. **Audit-only summary may be less comprehensive for legacy SI and IR**; do not misread partial audit `AUDIT_CLEAN` as full financial certification.

---

## 11. Operational status inspection, read-only rules, interpretation

**Status meanings**:

| Label | Meaning |
|---|---|
| `SYNC_OK` | Fast Delta child returned expected marker/exit success; NOT a full recon certificate |
| `AUDIT_CLEAN` | Selected audit/presence/compare checks passed; some modules skip financial outside sync |
| `FINAL_PASS` | Recovery V3 declared full required checks passed for that module at completed run |
| `NEEDS_REVIEW` | discrepancy (may be live source moving), exit 3, not a forced repair mandate |
| `ERROR`/`FAILED` | check/core run failed, exit 1; investigate technical or persistent mismatch |
| `PID_EXISTS` lock + Task Running | expected healthy lock owner; **do not remove** |
| `ABSENT` lock+guard when no tasks running | expected ready state |

**Incident triage priority:**
1. Decimal `precision violation`, invalid numeric, BQ out of range → **investigate** (fail-closed; no casting workaround).
2. Verified deletion missing proof/backlog → do not delete solely based on presence.
3. OAuth/SuiteQL fetch/pagination/timeout → no checkpoint advancement on failure.
4. Repeated checkpoint conflicts, stalled watermark despite source updates → inspect shared lock and BQ jobs, do not force.
5. Finance traffic high + source moving + financial amount consistent → leave incremental scheduler alone; recheck later when stable.
6. `LastTaskResult=0` means task call success; ensure latest completed V3 summary, health per module, and timestamp are valid.

**Do not log secrets**. Avoid posting entire NetSuite credentials or tokens into documentation.

---

## 12. Module 8 — Purchase Return: next work and warnings

**Next module selected:** **Purchase Return**, internal slug/folder `purchase-return`. Business motivation: complete Purchase Order → receipt/bill → return-to-vendor lifecycle. But *actual NetSuite transaction semantics remain UNKNOWN UNTIL PROBE*.

Potential entities to distinguish (examples, not assumed implementation): vendor return authorization (may be non-posting), physical return fulfillment/shipment, and vendor credit (separate accounting document). Always confirm SuiteQL types and links; do not simply transplant SR `ItemRcpt` mapping or create `purchase_return_headers` before evidence.

**Required minimum investigation before coding any schema**:

- Transaction type / `recordtypeid` / `deletedrecord.type` confirmed from NetSuite account.
- Physical quantity sign and movement; inventory accounting cost; GL debit/credit vs non-posting behavior.
- Source transaction relations (PO, receipt, bill, vendor return authorization, vendor credit) and link types exactly.
- Source lines (item, expense, GL-only, mainline/tax), unique keys, currency/exchange, lastmodifieddate.
- October 2026 source counts, sample IDs, monetary KPIs; November/December readiness.
- Role `PNM NetSuite Backup Integration` permissions just enough to read these entities (View), preserve SuiteCloud toggles, PS256.
- Match exact existing create-tables-via-script, staging/transaction/checkpoint design.
- Full prescribed testing in §9; integrate into **existing V3 and Fast Delta last**.

**No independent scheduling, no forced sync, no hand-wavy code paths, no fake NetSuite permissions.**

---

## 13. Handover acceptance checklist (for the NEXT chat)

- [x] Module 7 SR 4-table mapping and source links correctly identified.
- [x] SR dry-run, sync, presence, full check, GL/financial, checkpoints.
- [x] SR verified deletion negative and max 3 batch tested; positive remains pending real event.
- [x] SR registry in controller (both lists) and Fast Delta; PO/PI flags removed from Fast Delta modules selection.
- [x] Integration patch applied, backup present, `npm test` PASS.
- [x] All 7 modules `SYNC_OK` in fast delta after normal production run.
- [x] All 7 modules `FINAL_PASS` in last completed V3 run (Oct 23 15:10 WIB).
- [x] Verified-deletion SI audit trail cross-checked against BQ header state for 4 IDs.
- [x] BigQuery `NUMERIC` schema inventory and code helper verified.
- [x] Known bottlenecks and safe handling documented.
- [x] NetSuite integration role name, ID, OAuth PS256, known permission labels/levels, SuiteScript OFF documented.
- [x] Module 8 = Purchase Return; source transaction type not presumed.
- [ ] Module 8 role permission for return-specific entities — **VERIFY LOCALLY**.
- [ ] Module 8 discovery probes / mapping / DDL / checks — **NOT STARTED**.
- [ ] Positive real deletedrecord apply for SR/other newer modules — **PENDING NATURAL EVENT**, do not manufacture.

### Suggested first prompt for new chat

> Baca dan patuhi dokumen `NETSUITE_BACKUP_HANDOVER_MODULE_7_TO_8_2026-10-23.md` sepenuhnya. Kita mulai **Module 8 Purchase Return**. Gunakan persis baseline 7 modul existing; jangan bikin scheduler/task/client terpisah; no FORCE SYNC; jangan langsung membuat tabel sebelum NetSuite read-only probe memastikan jenis return dan link. Ingat NetSuite role `PNM NetSuite Backup Integration` (`customrole1042`), integration `PNM NetSuite Backup`, OAuth2 M2M JWT `PS256`, SuiteScript/workflow trigger OFF. Auto-create tables dari script `.mjs` yang dibuat dan dijalankan melalui PowerShell copy-paste. Testing harus satu langkah per satu langkah mengikuti modul terdahulu dan hasil command. Mulai dengan membaca folder existing yang relevan dan membuat **probe read-only** tanpa mengubah production.

---

## 14. Accuracy / source-of-truth boundary

Dokumen ini berdasarkan kode dan output yang dibagikan di chat, serta riwayat setup awal yang tercatat. Tidak seluruh filesystem lokal user dapat dibaca oleh asisten secara langsung. **Exact schema DDL, exact complete `tree`, exact value permission return-specific, and every handler implementation must be inspected from local source before modification.** Perintah/paths yang sudah tampil di output user dipertahankan, tetapi jangan menganggap semua file yang diindikasikan tersedia tanpa mengecek. Reconciliation final merupakan snapshot completed run, bukan guarantee setiap saat.

**END OF HANDOVER — 23 OCT 2026**
