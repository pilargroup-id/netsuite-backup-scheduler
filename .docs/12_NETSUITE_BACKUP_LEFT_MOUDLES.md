# [Azi] NETSUITE BACKUP — MASTER HANDOVER 15 MODULE, HARD FREEZE, CLEANUP & NEXT: DYNAMIC SCHEDULER

**Versi:** handover 2 November 2026 WIB.  **Proyek:** `[Azi] Netsuite Backup`.
**Root production Windows:** `C:\netsuite-backup`. **Flow utama:** NetSuite SuiteQL → BigQuery (transactional backup), empat Windows Scheduled Tasks. **Dokumen dibaca wajib sebelum membuat perubahan dalam chat berikutnya.**

> **PERINTAH PRIORITAS USER — JANGAN MENGULANG RIBUAN TEST.** Semua modul yang telah lulus fase build/reconciliation wajib diperlakukan sebagai **HARD FREEZE**. **Tidak boleh menulis ulang, menyisipkan refactor, mengubah mapper/schema/checkpoint, memperbaiki modul lama diam-diam, atau melakukan manual `--sync` pada modul production.** Jangan stop, disable, restart, pause, reschedule, mengganti trigger/task, membunuh proses, menghapus lock/health/log, atau mengubah shared controller/scheduler karena modul baru. Perubahan scheduler di chat selanjutnya adalah **pekerjaan baru yang perlu approval terpisah dan preview terlebih dahulu**. Tidak ada izin apply dari handover ini.

> **DEFINISI PENTING:** `baseline development/reconciliation PASS` ≠ semua modul selalu `FINAL_PASS` setiap menit; NetSuite sedang diedit Finance. Jangan jadikan status global V3 `FAILED` sebagai alasan mengganggu modul yang sudah freeze. `REGISTERED` ≠ bukti otomatis `SYNC_OK`. Status audit read-only ≠ bukti successful scheduled sync. Ketepatan istilah wajib.

## 0. HOW TO USE THIS HANDOVER IN NEW CHAT

1. Perlakukan bab 1–6 sebagai kontrak keras; jangan langsung menulis atau menjalankan patch.
2. Berangkat dari **15 modul** yang sudah dibuat dan dua controller yang sudah memuat Module 15. Jangan kembali mengembangkan Module 15 dari nol.
3. **Next pekerjaan utama: normalisasi jadwal keempat Windows Task** lewat satu file config + validate/preview/apply, **bukan membangun Module 16**. Status daftar 6 additional sudah berakhir di Module 15.
4. User meminta code dan cara test **sama dengan pola modul sebelumnya**, bukan alternatif hasil kreasi asisten. Baca `.docs` historis dan source aktual. Dokumen ini menyertakan arsip teks handover sebelumnya di lampiran; teks historis tidak boleh menimpa status terbaru.
5. Jika butuh mengubah production, audit source yang benar-benar ada **di mesin user** (task XML, module source, hash). ZIP percakapan adalah **reference snapshots**, bukan jaminan sama dengan production. Hasil kode/hash aktual tidak boleh dikarang.
6. Delivery perubahan **hanya file yang direvisi** dalam **ZIP siap overwrite**. Jangan deliver `.mjs`/`.js` sendirian. Tidak perlu `Expand-Archive`; user ekstrak ZIP sendiri. Test output di terminal; **jangan** membuat `.txt` menggunakan Tee-Object, Out-File, atau redirection.
7. Dokumentasi `.md` bernama `yy-mm-ddThh:mm:ss-<name>.md` (timestamp WIB). Aturan ini **hanya .md**, bukan .sql.

## 1. RESMI: 9 REQUIRED + 6 AGREED ADDITIONAL (URUTAN FIXED)

**WAJIB DICANTUMKAN PADA SETIAP DOKUMENTASI PROJECT KE DEPAN**. Jangan pernah menyebut semua 15 sebagai required. User secara eksplisit mengulangi kesepakatan original scope.

| # | Slug folder / transaksi | Klasifikasi | NS transaction type / catatan |
|---:|---|---|---|
| 1 | `sales-invoice` | REQUIRED (original 1–9) | Sales Invoice, `CustInvc` menurut sumber historis; verifikasi source jika dipakai |
| 2 | `item-fulfillment` | REQUIRED | Item Fulfillment |
| 3 | `sales-order` | REQUIRED | Sales Order |
| 4 | `item-receipt` | REQUIRED | Item Receipt |
| 5 | `purchase-order` | REQUIRED | Purchase Order |
| 6 | `purchase-invoice` | REQUIRED | Purchase Invoice / Vendor Bill |
| 7 | `sales-return` | REQUIRED | Sales Return / Return Authorization |
| 8 | `purchase-return` | REQUIRED | `SCHEMA_ONLY / NO_SOURCE` (jangan palsukan FINAL_PASS) |
| 9 | `sales-payment` | REQUIRED | Customer Payment |
| 10 | `customer-credit-memo` | ADDITIONAL #1 | **Customer Credit Memo (`CustCred`)** |
| 11 | `vendor-credit` | ADDITIONAL #2 | **Vendor Credit (`VendCred`)** |
| 12 | `vendor-payment` | ADDITIONAL #4 | **Vendor Payment (`VendPymt`)** |
| 13 | `journal-entry` | ADDITIONAL #3 | **Journal Entry (`Journal`)** |
| 14 | `inventory-transfer` | ADDITIONAL #5 | **Inventory Transfer** (`InvTrnfr`) |
| 15 | `inventory-adjustment` | ADDITIONAL #6 | **Inventory Adjustment** (`InvAdjst`) |

**PENTING:** User menulis daftar *agreed additional* secara urut: **Customer Credit Memo, Vendor Credit, Journal Entry, Vendor Payment, Inventory Transfer, Inventory Adjustment**. Namun **nomor implementasi final** menunjukkan Vendor Payment **Module 12** dan Journal Entry **Module 13**. **JANGAN UBAH** nomor folder/urutan proses agar cocok dengan urutan presentasi kesepakatan. Cantumkan kedua fakta secara eksplisit seperti tabel di atas, supaya tidak terjadi salah rute.

**Tidak ada next Module 16 yang disepakati.** Setelah Module 15, **next phase adalah scheduler normalization / hardening**.

## 2. HARD FREEZE CONTRACT — PERMANEN

### 2.1 Scope dan praktik

- Original **1–9** required dan additional **10–15** telah dibangun; Module 15 lulus pre-registration dan live audit. Treat seluruh source modul yang telah dilepas ke production sebagai **do not touch** kecuali user memberikan persetujuan khusus untuk file tertentu.
- Freeze termasuk `modules/<slug>/*`, mapping, decimal handling, schema, BigQuery tables, data, checkpoint, reconciliation, verified deletion, preservation of history, inter-module contracts, Node runner, controller, scheduler registration, shared lock, status health, Task Scheduler action/principal/triggers. Pekerjaan jadwal yang nanti disetujui hanya mengubah **trigger terbatas yang diotorisasi**; bukan izin mengubah kode modul.
- Tidak menjalankan ad-hoc `--sync`, `--apply`, `--repair-*` untuk modul production, meski live source mismatch. Yang sah tanpa persetujuan tambahan: inspeksi read-only pada waktu tidak mengganggu scheduler; `--audit-only`, presence, exact reconciliation, inspect logs, `--dry-run` jika safe dan sudah ada pola tersebut. Jangan lakukan audit read-only panjang saat scheduler sedang running jika bisa membebani NetSuite/lock.
- Jangan menganggap `Get-ScheduledTaskInfo.LastTaskResult = 0` berarti semua modul sync sukses. Fast Delta `SKIPPED_LOCKED` juga bisa exit 0. Jangan menganggap scheduler `Ready` berarti healthy; baca log dan `latest.json`/health.
- Penghapusan di NetSuite bukan bukti untuk melakukan soft-delete BigQuery. **Verified deletion gate:** identitas authoritative `deletedrecord`, independent exact proof, source tidak terlihat secara global, dry-run, max batch **3**, header-only soft delete, retain detail/lines/GL/links, audit trail, **checkpoint unchanged**, fail closed jika bukti kurang. Tidak boleh hard delete historical BQ.
- Source changes akibat Finance dapat menimbulkan `NEEDS_REVIEW`, `ERROR`, dan mismatch sementara. Jangan menuntut seluruh 15 `FINAL_PASS` bersamaan sebagai gate untuk pekerjaan infrastruktur scheduler.
- Source old baseline 29 Okt 09:19:47 WIB: V3 `FINAL_PASS`, exit 0, 10 `FINAL_PASS`, Purchase Return `NO_SOURCE`. Ini milestone historis, **bukan bukti terakhir semua 15 FINAL_PASS**.

### 2.2 Prosedur perubahan yang diterima

`read actual files → map dependency → propose narrowly-scoped diff → explicit approval → offline syntax/test → preview → ZIP with only changed paths → wait until user-authorized safe apply → verify result → record hashes`.

Tidak mengedit controller ataupun shared lock saat bekerja scheduler intervals kecuali terbukti benar-benar dibutuhkan dan user setuju terpisah. Tidak mengganggu task running.

## 3. INFRASTRUKTUR / ROLE / PERMISSION NETSUITE — WAJIB DIIKUTI

### 3.1 Connection & identity

| Field | Baseline |
|---|---|
| Host project Windows | `C:\netsuite-backup` |
| Node runtime yang pernah tampak | `C:\nvm4w\nodejs\node.exe` |
| Role NetSuite | **`PNM NetSuite Backup Integration`** |
| Integration record | **`PNM NetSuite Backup`** |
| Authentication | OAuth 2.0 M2M JWT `PS256` sesuai existing client |
| Source | NetSuite SuiteQL; transaksi Oct 2026 onward (specific window per modul) |
| Target | BigQuery; exact decimal, no lossy JS `Number` casts |
| Secrets | local existing credential configuration; **jangan tulis token/private key dalam docs/ZIP** |

**NetSuite permissions baseline, Transactions → View**, dari dokumen historis: `Bills`, `Credit Memo`, `Credit Returns`, `Customer Payment`, `Enter Vendor Credits`, `Find Transaction`, `Fulfill Orders`, `Invoice`, `Item Fulfillment`, `Item Receipt`, `Purchase Order`, `Return Authorization`, `Sales Order`, `Vendor Bill`, `Pay Bills` (sejumlah UI NetSuite memetakan Bill/vendor bill dan payment secara berbeda; jangan mengarang nama permission baru). Source historic menyebut `Transactions → Transfer Inventory: View` untuk Module 14; internal id permission `TRAN_INVTRNFR`. Modul 14 juga butuh `Lists → Items: View`, `Lists → Locations: View`. Pada setup historis `Subsidiaries` tidak tersedia dan dilewati; jangan memaksa hak akses tersebut. Untuk Module 15: read-only inventory adjustment SuiteQL telah berhasil dan identity `deletedrecord` sudah tersertifikasi, **nama exact UI permission Module 15 belum tervalidasi dari materi percakapan terakhir; jangan tebak**. Jika terjadi `PERMISSION_VIOLATION`, lakukan probe read-only, minta penambahan View yang spesifik ke role existing, dan validasi lagi. Jangan buat role/integration baru atau broad admin permissions.

**Jika perlu menyalin role**: dokumentasikan label dan izin dari UI aktual sebelum mengubah apapun; jangan menyimpulkan izin tersembunyi dari hasil query belaka. Baca dokumen baseline lama untuk detail tambahan, jangan mengubah baseline akibat interpretasi.

### 3.2 Fitur dan domain ledger

- Query sumber dan raw mapping dari `modules/<mod>/mapping.mjs`, credentials/utilities dari `common/` dan `credentials/` (struktur credential file aktual harus diaudit sebelum patch).
- BQ decimal numeric amounts `NUMERIC` 9-scale jika cukup; `BIGNUMERIC` untuk rate atau financial values sesuai kontrak modul; use `validateNumeric`/decimal string handling, **tidak cast ke JS float**.
- Initial schema creation **otomatis lewat script module** yang dipanggil dari PowerShell; **BUKAN** user manual menulis/create BQ table via console. Alur lama `node .\modules\<slug>\initialize-schema.mjs` hanya jika file dan argumen cocok source aktual; jangan membuat sintaks/dry-run baru yang tidak ada.
- Initial backfill, incremental, checkpoint initialization, exact reconcile, GL, deletion identity dilakukan **berfase**. Table dan checkpoint hanya khusus modul baru; bukan recreate shared dataset.

## 4. STRUKTUR FOLDER YANG DIKETAHUI / SUMBER KEBENARAN

```text
C:\netsuite-backup\
├── .docs\                            # arsip dokumentasi handover sebelumnya
├── .archive\                         # arsip legacy/diagnostic historis bila ada
├── config\                           # existing config, perlu inventory untuk hardening
├── credentials\                      # rahasia; jangan diekspor
├── common\
│   ├── bigquery-client.mjs
│   ├── recovery-controller.mjs       # 15-module registration & V3 audit/sync
│   ├── shared-lock.mjs               # production concurrency; HARD FREEZE
│   ├── verified-deletion-batch.mjs   # common deletion guard (nama terobservasi)
│   └── ...                            # jangan simpulkan lengkap tanpa directory listing
├── scripts\
│   ├── fast-delta.mjs                # 15-module list, routes M14/M15 standalone
│   ├── scheduler-runner.mjs          # V3 entry, DO NOT PATCH casually
│   ├── run-fast-delta-hidden.vbs     # Windows hidden wrapper
│   ├── run-fast-delta.ps1            # existing Fast Delta wrapper
│   └── ...
├── modules\
│   ├── sales-invoice\               # 1 REQUIRED
│   ├── item-fulfillment\            # 2
│   ├── sales-order\                 # 3
│   ├── item-receipt\                # 4
│   ├── purchase-order\              # 5
│   ├── purchase-invoice\            # 6
│   ├── sales-return\                # 7
│   ├── purchase-return\             # 8 NO_SOURCE
│   ├── sales-payment\               # 9
│   ├── customer-credit-memo\        # 10 ADDITIONAL
│   ├── vendor-credit\               # 11
│   ├── vendor-payment\              # 12
│   ├── journal-entry\               # 13
│   ├── inventory-transfer\          # 14
│   └── inventory-adjustment\        # 15
└── logs\
    ├── scheduler\latest.json        # V3 last completed summary
    ├── scheduler\run-*.log
    └── fast-delta\
        ├── health-v2.json
        └── run-*.log
```

**Path di atas campuran: terobservasi dari output user dan diketahui dari baseline dokumen lama. Bukan jaminan inventory file keseluruhan.** Jangan mengarang file `config/scheduler.config.json` sudah ada — itu baru DESAIN FUTURE.

### 4.1 Exact module 14 listing dari user SEBELUM cleanup (23 files)

```text
certify-deletion-identity.mjs
check-financial.mjs
coverage-audit.mjs
deletion-identity.confirmed.json
deletion-identity-probe.mjs
deletion-inventory.mjs
diagnose-null-quantity.mjs
incremental-preflight.mjs
incremental-sync.mjs
initialize-schema.mjs
mapping.mjs
pre-registration-gate.mjs
probe.mjs
schema-contract.mjs
standalone-runner.mjs
sync.mjs
test-incremental-safety-offline.mjs
test-registration-offline.mjs
test-standalone-runner-offline.mjs
test-verified-deletion-offline.mjs
validate-mapping.mjs
verified-deletion.mjs
verify-deletion-identity.mjs
```

### 4.2 Exact module 15 listing dari user SEBELUM cleanup (22 files)

```text
certify-deletion-identity.mjs
check-financial.mjs
deletion-identity.confirmed.json
deletion-identity-probe.mjs
deletion-inventory.mjs
incremental-preflight.mjs
incremental-sync.mjs
initialize-schema.mjs
mapping.mjs
pre-registration-gate.mjs
probe.mjs
schema-contract.mjs
standalone-runner.mjs
sync.mjs
test-incremental-safety-offline.mjs
test-negative-concurrency-offline.mjs
test-standalone-runner-offline.mjs
test-verified-deletion-offline.mjs
validate-coverage.mjs
validate-mapping.mjs
verified-deletion.mjs
verify-deletion-identity.mjs
```

### 4.3 Cleanup in this chat — exact chronology and status (do not fabricate)

- User meminta cleanup M14/M15 seperti treatment modul sebelumnya. Assistant **terlalu lama mengategorikan/cek referensi dan melewatkan file `test-*` sebagai target obvious**. User menegur; aturan baru: pikirkan file test, probes, diagnostics, gates secara proaktif, jangan melempar audit repetitif yang tidak perlu.
- Ada dependency review output: `check-financial`, `incremental-sync`, `standalone-runner`, `verified-deletion`, `sync`, mapping dan schema tampil terpakai; hasil pencarian **berdasarkan basename file** sehingga banyak false-positive lintas-modul. Angka `References=0` **bukan** izin otomatis menghapus.
- Kandidat final yang **diusulkan** assistant berjumlah **19 file**, 10 M14 + 9 M15; assistant memberikan script PowerShell `Move-Item` ke folder eksternal `C:\netsuite-backup-cleanup-<timestamp>` sebagai backup, dan `node --check` pada file `.mjs` tersisa.
- **TIDAK ADA output user yang membuktikan script cleanup telah dijalankan.** Jangan tulis `cleanup DONE`, `13 files remaining`, atau file benar-benar dihapus. Keadaan aktual tetap **PENDING VERIFICATION** sampai user menunjukkan listing terkini. Jangan mengulang mass-cleanup secara membabi-buta.

**M14 kandidat move (10):**
`probe.mjs`, `deletion-identity-probe.mjs`, `diagnose-null-quantity.mjs`, `coverage-audit.mjs`, `certify-deletion-identity.mjs`, `pre-registration-gate.mjs`, `test-incremental-safety-offline.mjs`, `test-registration-offline.mjs`, `test-standalone-runner-offline.mjs`, `test-verified-deletion-offline.mjs`.

**M15 kandidat move (9):**
`probe.mjs`, `deletion-identity-probe.mjs`, `validate-coverage.mjs`, `certify-deletion-identity.mjs`, `pre-registration-gate.mjs`, `test-incremental-safety-offline.mjs`, `test-negative-concurrency-offline.mjs`, `test-standalone-runner-offline.mjs`, `test-verified-deletion-offline.mjs`.

**26 target remaining (if move actually applied):** 13 files per module, including `sync.mjs`, `initialize-schema.mjs`, `validate-mapping.mjs`, `verify-deletion-identity.mjs`. Do not auto-delete these; a deliberate decision is needed for certifying utilities. If cleanup not executed, still 23+22.

## 5. MODULE 14 — INVENTORY TRANSFER: ENGINEERING BASELINE

- Role access `Transfer Inventory (View)`, Items/Locations View.
- Source transaction type `InvTrnfr`, scope Oct 2026 onward; Module14 import/export patterns aligned with Module13 standalone runner.
- Two BQ tables: `inventory_transfer_headers`, `inventory_transfer_lines`; two checkpoints. Initial historic Phase B: 609 headers, 29,705 lines, 13,565 balanced item groups (these are historical values; not current counts). `Cost of Sales Adjustment` lines with `quantity=NULL` are legitimate and **must not** be discarded or coerced to zero. Historical count 1,488 null-quantity lines.
- Current 2 November live audit: **644/644 headers, 30,634/30,634 lines**, zero missing/extra/field mismatches; NetSuite/BQ quantity balance groups check PASS, no staging residue, deletion flags anomalies zero, checkpoint and source watermark `2026-11-02 14:40:00`, `sourceAhead=false`; module status `AUDIT_CLEAN`.
- `fast-delta.mjs` dispatches M14 to `modules/inventory-transfer/standalone-runner.mjs`; marker `MODULE 14 STANDALONE RUNNER FINAL_PASS: INCREMENTAL + EXACT RECONCILIATION; NO DELETION APPLY`.
- Runtime files to protect include `standalone-runner.mjs`, `incremental-sync.mjs`, `sync.mjs`, `check-financial.mjs`, `verified-deletion.mjs`, `deletion-inventory.mjs`, `mapping.mjs`, `schema-contract.mjs`, `deletion-identity.confirmed.json`, `initialize-schema.mjs` and relevant preflight utilities. Verified deletion must not auto-apply.
- Absolute claims of all schedulers success for Module14 **not grounded** by latest snapshot; the V3 last completed summary showed `FINAL_PASS` but Fast Delta health reported `NOT_REPORTED` in the early check, because health version/last attempt may lag.

## 6. MODULE 15 — INVENTORY ADJUSTMENT: COMPLETE DEVELOPMENT / AUDIT, AUTO SYNC PENDING PROOF

### 6.1 Source + schema + reconciliation

- `Transaction.type = 'InvAdjst'`; `2026-10-01` onward, open-ended, initially **19 October documents**, zero November/December at initial build. No unfounded source rows.
- Three BigQuery tables: `inventory_adjustment_headers` **19**, `inventory_adjustment_lines` **438** (19 mainline + 419 item lines), `inventory_adjustment_accounting_lines` **438**.
- Financial values via **exact decimal/BIGNUMERIC**, not `Number`; scientific notation from NetSuite (e.g. `-2.3322597963E8`) explicitly supported, GL all balanced.
- Module-only checkpoints: `inventory_adjustment_headers`, `_lines`, `_accounting_lines`; watermark `2026-10-28 08:59:44` (source); initial successful BQ sync timestamp observed `2026-11-02 06:49:14.668+00` (13:49:14 WIB). This timestamp **from initial backfill** is not proof of scheduled sync.
- **Exact full reconciliation** NetSuite ↔ BigQuery: all 895 total table rows match; zero missing, extra, field mismatch; source and BQ GL unbalanced=0; deletion flags anomalies=0.
- Phase H 16 offline PASS; I 33 PASS; N 34 PASS; O 19 PASS; **102 offline safety tests PASS**. Phase P pre-registration gate PASS; three live dry-runs (incremental, verified deletion, standalone) PASS, read-only.
- Identity certificate: NetSuite `deletedrecord.recordtypeid=inventoryadjustment`, `deletedrecord.type=INVENTORYADJUSTMENT`, **12 historical independent positive proofs**, negative control. No live deletion candidates. Strict header-only verified deletion and max batch 3; checkpoint unchanged.
- No duplicate initial backfill: two Enter attempts; second failed harmlessly because module-only checkpoint already existed (safe fail closed).

### 6.2 Runtime behavior / registration

`modules/inventory-adjustment/standalone-runner.mjs`:

- `--dry-run`: incremental dry-run then verified-deletion dry-run when no delta, no changes.
- `--sync`: requires environment confirmation **`NETSUITE_INVENTORY_ADJUSTMENT_RUNNER_CONFIRM=MODULE15_STANDALONE_RUNNER_AUTHORIZED`**, then runs Module15-only incremental, exact financial compare; **NEVER auto-apply deletion**.
- Success marker: `MODULE 15 STANDALONE RUNNER FINAL_PASS: INCREMENTAL + EXACT RECONCILIATION; NO DELETION APPLY`.

Phase Q patch **two files only** (`scripts/fast-delta.mjs`, `common/recovery-controller.mjs`) to include Module15 in lists and routing. Actual registered controller code confirmed by user:

```js
// Actual lines observed (representative excerpts, NOT full files)
const modules = ['sales-invoice', 'item-fulfillment', 'sales-order', 'item-receipt', 'purchase-order', 'purchase-invoice', 'sales-return', 'purchase-return', 'sales-payment', 'customer-credit-memo', 'vendor-credit', 'vendor-payment', 'journal-entry', 'inventory-transfer', 'inventory-adjustment'];
// Fast Delta success marker:
'inventory-adjustment': ['MODULE 15 STANDALONE RUNNER FINAL_PASS: INCREMENTAL + EXACT RECONCILIATION; NO DELETION APPLY']
// Route uses modules/inventory-adjustment/standalone-runner.mjs for Module15.
```

Confirmed hashes when Phase Q was compared on production after user overwrite (historical **not current source hash guarantee**):

```text
scripts/fast-delta.mjs         SHA256 C575C90E88CDCA5F59B06D8C0198C6171A4CEB71688F7C0D75B750BF2F77A46A
common/recovery-controller.mjs SHA256 035A88CE21F8BACF9AA577E4D15E32778608055E4E0E52934451ECB8B6449FBC
```

Pre-Phase-Q M14-only hashes (for audit history, **not values to revert to**):

```text
scripts/fast-delta.mjs         1AC4074F7C81AC05FB2054240BA5E03283CD906C2AD3016C81FDF85E69CEEE78
common/recovery-controller.mjs 3135AC8FF0F279AF4900646ADC610DEC522787EF3A4A39954E347B2DEA82565F
```

**Last actual live audit 2 November 15:28+ WIB** reached:

```text
====== RECOVERY inventory-adjustment --audit-only ======
MODULE 15 INVENTORY ADJUSTMENT EXACT RECONCILIATION | STRICT READ ONLY
EXACT_COMPARE inventory_adjustment_headers           source=19 bigquery=19 missingBQ=0 extraBQ=0 mismatchedFields=0
EXACT_COMPARE inventory_adjustment_lines             source=438 bigquery=438 missingBQ=0 extraBQ=0 mismatchedFields=0
EXACT_COMPARE inventory_adjustment_accounting_lines  source=438 bigquery=438 missingBQ=0 extraBQ=0 mismatchedFields=0
GL_BALANCE NetSuite unbalanced=0; BigQuery unbalanced=0
WATERMARK checkpoint=2026-10-28 08:59:44; latestLiveSource same; sourceAhead=false
MODULE 15 EXACT RECONCILIATION PASS, bqWrites=0, checkpointChanges=0, schedulerChanges=0
inventory-adjustment: AUDIT_CLEAN
```

**DO NOT CLAIM:** V3 scheduled `inventory-adjustment: FINAL_PASS` or Fast Delta scheduled `inventory-adjustment: SYNC_OK` occurred. In all logged inspections, **NO EXECUTION EVIDENCE** yet. Why: Fast Delta frequently `SKIPPED_LOCKED` (exit 0); completed run aborted at Module10 and cannot reach later modules; V3 current cycle was running Module10 and did not yet report Module15. **No manual sync or bypass of CCM**; user explicitly does not need universal FINAL_PASS while Finance keeps changing records. Module15 development and audit are accepted; automatic sync proof remains operational outstanding.

## 7. FOUR WINDOWS TASKS — ACTUAL PRODUCTION

| Exact TaskName | Function | Observed cadence | Workflow / caveat |
|---|---|---|---|
| `NetSuite Backup Fast Delta` | Frequent incremental changes NS→BQ | approx 5min | Windows `wscript.exe` → `scripts/run-fast-delta-hidden.vbs` → PowerShell `run-fast-delta.ps1` → `scripts/fast-delta.mjs --sync`; sequential modules 1–15; shared lock. |
| `NetSuite Backup Freshness Monitor` | Monitor lateness/data freshness | approx 5min | Monitor, not regular transaction writer. LastResult 2 observed; actual action/trigger NEEDS EXPORT. |
| `NetSuite Backup V3` | Deep reconciliation/recovery | approx 20min | `scripts/scheduler-runner.mjs` → `common/recovery-controller.mjs --all --sync`, isolated child processes; shared lock. |
| `NetSuite Backup Watchdog` | Monitor scheduler/worker health | approx 20min | LastResult 0 at last screenshot; actual action/trigger NEEDS EXPORT. |

**Snapshot terakhir user pada 2 November 15:41 WIB**:

```text
NetSuite Backup Fast Delta         Ready    LastRun 15:41:34  NextRun 15:46:33
NetSuite Backup Freshness Monitor  Ready    LastRun 15:41:37  NextRun 15:46:36
NetSuite Backup V3                 Running  LastRun 15:41:05  NextRun 15:50:00
NetSuite Backup Watchdog           Ready    LastRun 15:41:05  NextRun 15:50:00
```

Old snapshot **15:28:28 WIB**: four `Ready`; task last results Fast Delta 0, Freshness Monitor 2, V3 1, Watchdog 0. `logs/scheduler/latest.json` V3 `FAILED` exit1 finished `15:28:03 WIB`. `logs/fast-delta/health-v2.json` `RUNNING`, updated `14:59:40 WIB` (might be stale). **Do not confuse status task Ready with successful sync.**

`Fast Delta` task settings historically `ExecutionTimeLimit=PT0S`, `MultipleInstances=IgnoreNew`, `RestartCount=0` (historical: verify latest). Global shared lock `minStaleMs=120000` and owner PID liveness check. Lock `STALE_ARCHIVED` on old dead owner can occur; **DO NOT MODIFY/DELETE LOCK WITHOUT USER APPROVAL**.

### 7.1 Operational audit facts that triggered user decision

- 15:16, 15:11, 15:06, 15:01 Fast Delta logs `SKIPPED_LOCKED; reason=LOCK_OWNER_ALIVE; EXIT CODE:0` — **not full sync**.
- 14:56 Fast Delta sync reached `customer-credit-memo` and aborted due repair blocked BQ-only header; Modules 11–15 did not run.
- V3 15:01 running process tree: PID 17124 `scheduler-runner`, PID 19816 `recovery-controller --all --sync`, PID 23092 child `recovery-controller --core customer-credit-memo --sync`, PID 12580 CCM `incremental-sync --sync`. Do not kill; PIDs are historic.
- 15:28 completed V3 showed Sales Order `NEEDS_REVIEW`, CCM `ERROR`, others `FINAL_PASS` and Purchase Return `NO_SOURCE`; M15 **absent** in final V3 summary at that moment. User later ran `--all --audit-only` which DID reach Module15.
- **User explicitly said:** DO NOT keep looping status checks with identical answer; choose a concrete next action. For scheduler hardening, stop demanding universal FINAL_PASS. Finance keeps changing NS transactions; dynamic sync handles source movement.

### 7.2 Live audit ALL 15 at 2 Nov 15:28+ (read-only) — detail

| Mod | Last V3 summary at 15:28 | Subsequent LIVE AUDIT | Notes |
|---:|---|---|---|
| 1 SI | FINAL_PASS | NEEDS_REVIEW | 15 source-only new IDs, zero BQ-only; requires normal scheduled catchup, no manual sync |
| 2 IF | FINAL_PASS | AUDIT_CLEAN | 1291/1291, 5028 lines, GL reconcile zero |
| 3 SO | NEEDS_REVIEW | NEEDS_REVIEW | 4 BQ-only IDs 3165004, 3165017, 3166834, 3166842 `OUTSIDE_PERIOD_OR_CHANGED_TYPE`, **not proof of deletion** |
| 4 IR | FINAL_PASS | AUDIT_CLEAN | Verified deletion inventory clean; financial not certified outside sync |
| 5 PO | FINAL_PASS | AUDIT_CLEAN | 193 headers, 758 lines, exact pass |
| 6 PI | FINAL_PASS | AUDIT_CLEAN | 569 headers, 2620 lines, 2620 GL, 297 links exact pass |
| 7 SR | FINAL_PASS | AUDIT_CLEAN | 1 header, 3 lines, 2 GL, 2 links, exact financial pass |
| 8 PR | NO_SOURCE | NO_SOURCE | SCHEMA_ONLY, source 0, checkpoint 0 |
| 9 SP | FINAL_PASS | AUDIT_CLEAN | 1299 headers, 2598 lines/GL, 4203 applications exact pass |
| 10 CCM | ERROR | NEEDS_REVIEW | 465 NS vs 466 BQ, BQ-only ID **3149265**; user says Credit Note deleted in NetSuite. Still independent `deletedrecord` proof required before soft delete |
| 11 VC | FINAL_PASS | AUDIT_CLEAN | 131 headers, 407 lines, 407 GL, 279/279 links, GL balanced |
| 12 VP | FINAL_PASS | AUDIT_CLEAN | 384 live, BQ total 386 includes 2 verified historical deletions IDs 3155057 & 3163644; five-table exact match, GL pass |
| 13 JE | FINAL_PASS | ERROR | source modified two headers IDs 3158507 & 3168157 to `2026-11-02 15:30:37`, checkpoint 15:02:49, field mismatches=2; not automatic code bug |
| 14 IT | FINAL_PASS | AUDIT_CLEAN | 644 headers, 30634 lines, quantity invariants match |
| 15 IA | NOT_REPORTED | AUDIT_CLEAN | 19/438/438, GL pass, unchanged watermark; no evidence scheduled --sync |

**Important user correction:** CCM credit note was deleted in NS. Nonetheless user asked to defer investigation, so stop proposing emergency CCM repair, manual sync, scheduler skip, or change Module10; it is not a blocker to performing separate read-only scheduler design work.

## 8. CODE / TESTING APPROACH — COPY EXISTING BASELINE, NO FREEHAND

**Mandatory new work pattern:**

1. Before code: read actual affected source and `.docs` handovers, read all task settings, map paths/imports/CLI flags/exit codes. If >300 lines or high-impact edits, show exact file scope and confirm before overwrite. User demands **NO ASSUMPTION**.
2. For new module (if ever authorized): NetSuite role permission probe READ ONLY first; source sample/coverage, detect transaction type, table shapes, posting, null quantities, fiscal period; schema contract, precise datatype mapping, all data transformations; never rely on guesses.
3. **Create tables automatically** by copy/paste Node PowerShell command from existing module's `initialize-schema.mjs`; create module-only tables/checkpoints only, idempotent/atomic as pattern dictates. Do not give standalone custom SQL DDL unless user specifically requests.
4. Execute **phases exactly as previous modules**: source probe → schema → mapping/decimal → initial backfill → exact live compare → incremental dry-run/preflight → offline negative/concurrency safety → verified deletion inventory and exact identity certificate/negative control → standalone runner (dry run) → final gate → only then register controller (minimum diff and after approval). Specific filenames/arguments must come from actual source; not speculative.
5. Test **live row parity** across headers, lines, accounting lines, links as applicable; `missingNS`, `missingBQ`, `fieldMismatch` =0, GL debit-credit=0, no duplicates/orphans/staging residue; preserve source immutable watermark/exact decimals. For volatile source, retry bounded per existing pattern, fail closed, do not compare inconsistent snapshots as deletion.
6. Test BigQuery writer atomic/staging, checkpoint update only on actual successful commit, no checkpoint shift from dry-run/deletion verification, no touching other modules; `--sync` only for NEW standalone candidate with explicit authorization before registration, never pre-existing production module.
7. Offline tests for invalid env, false proof, negative controls, lock busy, concurrency, dead owner handling, deletion >3 candidates, fail closed, controlled retry, data drift, simulated errors; specific test list from module's proven source, not new invented phases. Module15 has **102 PASS** total; earlier modules have their own gates.
8. Validate code syntax (`node --check`) and PowerShell 5.1 parser before delivery; **avoid the exact syntax mistake from this chat:** piping directly after `for/foreach` closing brace produced `EmptyPipeElement`. Use `$results = for (...) {...}; $results | Format-Table`.
9. ZIP contains **only revised files in correct relative folders**; provide PowerShell execution commands from `C:\netsuite-backup`. No log `.txt` output/redirect, no `Expand-Archive` instructions.
10. After each test, read actual output, interpret explicitly, no fabricated PASS. Do not repeatedly send the same log-check command if action cannot change outcome.

### 8.1 Known working read-only operations (not a sync command)

```powershell
cd C:\netsuite-backup

# Four tasks and real runtime state:
Get-ScheduledTask -TaskName 'NetSuite Backup*' |
  ForEach-Object {
    $t = $_; $i = $t | Get-ScheduledTaskInfo
    [pscustomobject]@{ Task=$t.TaskName; State=$t.State; LastResult=$i.LastTaskResult; LastRun=$i.LastRunTime; NextRun=$i.NextRunTime }
  } | Format-Table -AutoSize

# Latest V3 status (READ ONLY):
Get-Content .\logs\scheduler\latest.json -Raw | ConvertFrom-Json | Format-List *

# Hash baseline before *any* patch:
Get-FileHash .\scripts\fast-delta.mjs -Algorithm SHA256
Get-FileHash .\common\recovery-controller.mjs -Algorithm SHA256

# Audit of all modules already run in this chat; DOES NOT WRITE, but may query NetSuite and be long:
# node .\common\recovery-controller.mjs --all --audit-only
```

**Avoid running extra live audits during task execution**; no audit necessary just to design scheduler config.

### 8.2 BigQuery / checkpoints — prior verified read-only extraction

```js
// EXCERPT only: existing common client contract as observed in conversation
const { query, T } = await import('./common/bigquery-client.mjs');
const rows = await query(`
  SELECT record_type,
         FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS watermark,
         CAST(last_successful_sync_at AS STRING) AS last_sync
  FROM ${T('sync_checkpoints')}
  WHERE record_type IN UNNEST(@names)
  ORDER BY record_type
`, {names:[
  'inventory_adjustment_accounting_lines',
  'inventory_adjustment_headers',
  'inventory_adjustment_lines'
]});
console.log(JSON.stringify(rows,null,2));
```

Script above shows READ ONLY contract, not instruction to execute sync or recreate schema. Some flags/field types may change with source; verify actual file.

## 9. SCHEDULER NORMALIZATION — NEXT WORK, DESIGN ONLY (NOT APPLIED)

### 9.1 User-approved direction, not approved modification

**Goal:** central config controls scheduling intervals for **exactly four existing Windows Scheduled Tasks**, and one script validates/previews/applies explicitly to selected task(s). User wants change timing by changing few config lines, **no edit to 15 modules**. The assistant previously proposed this as conceptual structure:

```text
C:\netsuite-backup\
├── config\
│   └── scheduler.config.json        [FUTURE, NOT YET CREATED]
└── scripts\scheduler\
    ├── validate-config.ps1          [FUTURE, NOT YET CREATED]
    ├── preview-schedule.ps1         [FUTURE, NOT YET CREATED]
    └── apply-schedule.ps1           [FUTURE, NOT YET CREATED]
```

**Draft config only (DO NOT TREAT AS MACHINE LIVE CONFIG):**

```json
{
  "timezone": "Asia/Jakarta",
  "tasks": {
    "fastDelta": { "taskName": "NetSuite Backup Fast Delta", "intervalMinutes": 5, "enabled": true },
    "freshnessMonitor": { "taskName": "NetSuite Backup Freshness Monitor", "intervalMinutes": 5, "enabled": true },
    "v3": { "taskName": "NetSuite Backup V3", "intervalMinutes": 20, "enabled": true },
    "watchdog": { "taskName": "NetSuite Backup Watchdog", "intervalMinutes": 20, "enabled": true }
  }
}
```

**Caution about `enabled`:** just because draft contains `enabled: true`, script MUST NOT disable or enable actual task based on config absent explicit separate approval. Prefer config design only for timing and keep enabled state untouched; name/action/principal/settings unchanged. Interval min/max/PowerShell Task Scheduler quirks must be discovered from actual triggers.

### 9.2 Mandatory Step A — inventory actual four tasks READ ONLY

Before writing any implementation, user should run one **read-only, single-shot** PowerShell inventory of four Task definitions. Check: task name/path, triggers and their types (daily/time/calendar/repetition interval/duration/start boundary), Settings.ExecutionTimeLimit/MultipleInstances, Actions.Execute/Arguments/WorkingDirectory, Principal.UserId/LogonType/RunLevel, enabled state, last/next/run result, repetition ties, timezone, schedules outside working hours, whether applying trigger will reset other triggers. **Do not assume** all tasks are simple 5m/20m forever. Export full XML **read only** for faithful baseline/rollback but protect sensitive args from sharing; script should not write secrets publicly. Original task schedule had historical 08:00–22:00 windows; verify live.

Expected result: baseline manifest table, exact trigger XML, diff plan and change guard. Keep all four TaskNames unchanged.

### 9.3 Step B — design/config/validator

- Single authoritative config; parse JSON safely with Windows PowerShell 5.1. Types validated, interval integer >0, allowed windows/timezone, non-duplicate tasks, exactly approved task names, no user-chosen arbitrary task selection (whitelist), reject unknown/missing config keys if policy requires.
- Preview shows **CURRENT vs DESIRED** for every target (triggers only) and whether change is needed; no side effects. No default auto-apply, no background watcher/service. Editing JSON alone cannot magically reschedule Windows Scheduler; explicit authorized apply needed.
- `apply` must be opt-in and user-approved; limit to explicitly selected tasks; preserve original principal/action/settings/other triggers and task name, no disable/stop/restart, no runner reboot. Preserve running tasks and their child process. If Task Scheduler APIs can't safely set desired repetition without altering other properties, **fail closed** instead of guessing.
- Backup/export original task XML under local user machine before applying, save SHA256/diff; provide `rollback` plan not overwriting unrelated tasks. Do not put production credentials/token in docs or ZIP.
- Scripts must not modify `common/recovery-controller.mjs`, `scripts/fast-delta.mjs`, shared-lock, module files, BigQuery checkpoint or any database.

### 9.4 Step C — offline test matrix BEFORE distribution

Test Windows PowerShell 5.1 syntax parser; valid config; invalid JSON; duplicate/wrong TaskName; zero/negative/bad interval; nonexistent target; multiple triggers; restricted execution; no elevation; changed task between preview/apply; unsafe task state (running); settings/principal invariants; rollback roundtrip on non-production test fixture **without touching 4 actual scheduled tasks**. Since no Windows environment in ChatGPT container, do not claim integration PASS unless user ran it on Windows.  `node --check` only applies to JS files; `.ps1` needs PowerShell parser/test under Windows.

### 9.5 Step D — production rollout (requires separate permission)

1. Make one ZIP of new config/scripts only, no files from Modules 1–15.
2. User extracts manually. Audit files and SHA256, preview only.
3. User separately authorizes targeted apply, ideally when tasks are all Ready and not running; do **not** stop tasks to force this condition.
4. Apply selected trigger, read Task Scheduler again; ensure actions/principal/settings SHA/serialized equivalents unchanged, no missing scheduler, no unexpected tasks disabled, four tasks preserved.
5. Observe normal scheduled runs/logs and shared-lock behavior, do **not** force manual production sync. Revert only with user approval using captured task XML.
6. Record resulting interval and config version; if no permission, leave all current schedules unchanged.

**NEXT ASK IN CHAT BARU:** "Audit dulu keempat task Windows Scheduled Task di `C:\netsuite-backup` secara READ ONLY dan desain centralized scheduler config. Berikan SATU command PowerShell 5.1 yang valid untuk export/print actual definition. Jangan buat atau apply patch sebelum melihat output. Modules 1–15 freeze; no sync, task-stop, lock manipulation." 

## 10. BOTTLENECK / BUG / WHAT WAS SOLVED IN THIS CHAT

| Issue | Evidence | Outcome |
|---|---|---|
| Module15 not shown in all-module status | Old PS status hardcoded label `ALL 10 MODULES`, log reader last status only | A separate read-only 15-module status command was provided. It includes M15 as row 15; `NOT_REPORTED` correctly means no log record yet. No source change needed. |
| PowerShell `EmptyPipeElement` | Used `} | Format-Table` immediately after `for` | Syntax error acknowledged and fixed with `$results = for (...) {...}; $results | Format-Table`. Mandatory no-repeat. |
| M15 controller registration | User showed Fast Delta module list and recovery lists | Both `Module15=True`; registration CONFIRMED. |
| M15 scheduled execution not logged | Fast Delta locked/aborted at CCM; V3 still at CCM | **NOT SOLVED** as of last captured scheduled logs. Do not claim auto sync PASS. |
| M15 data integrity | Live read-only audit 19/438/438, GL 0 mismatches | **SOLVED: AUDIT_CLEAN**, baseline data stable at snapshot. |
| CCM header mismatch | NS 465 vs BQ 466, BQ-only 3149265; user confirmed Credit Note deleted | Deferred intentionally; cannot infer deletion solely from missing NS. Verified deletion independent proof required. No direct patch or manual sync. |
| SO data moved | BQ-only 4, classified outside period/changed type | Deferred; not automatic deletion proof. |
| SI 15 source-only | Live NS newly changed | Recognized normal source movement; scheduled catchup, no manual sync. |
| JE 2 mismatched `last_modified` | New NS timestamps later than BQ watermark | Recognized active source movement; not assumed code bug. |
| Cleanup M14/M15 | 45 files, user wanted remove `test-*`; assistant initially missed | Candidate list 19 and backup-move script provided; **execution NOT evidenced**, cleanup status pending. |
| Repeated status loops | User explicitly frustrated | New rule: stop redundant checks, act on actual blocker and user goal. |
| Scheduler design | Asked centralized scheduling | Direction agreed; **no files created, no task changes**. |

## 11. CRITICAL NO-ASSUMPTIONS / BEHAVIOR / DELIVERY RULES ADDED BY USER

- Speak concise/direct for quick questions; when asked full handover, be exhaustive.
- Before changes inspect actual files, dependencies and current task definitions. `No assumptions`; ask to inspect files instead of inventing paths/flags/permissions or modifying entire project.
- Do not create full project ZIP unless explicitly asked; **only modified files packaged in ZIP** with correct relative paths. No direct downloadable `.mjs`/`.js`.
- Avoid PowerShell `Expand-Archive`: user extracts manually and overwrites. Test commands from `C:\netsuite-backup`.
- Testing output in terminal only; no output logs `.txt` by default, no `Tee-Object`, `Out-File`, redirects.
- `.md` timestamps only, not SQL.
- Use existing role/integration and record exact access. Permission at least View, not invented broad admin grants.
- All new module code style, naming, checkpoint patterns, test phases, cleanup conventions, deletion safety and error handling must be based on **the previous working modules**, not fresh invention.
- Test files `test-*` and one-off probe candidates should be identified **immediately** during cleanup rather than after multiple repetitive scans. Do not remove evidence/identity certs/production utilities if still needed; human-confirmed safe cleanup only.
- Always distinguish `REGISTERED`, `AUDIT_CLEAN`, `FINAL_PASS`, `SYNC_OK`, and `SKIPPED_LOCKED`. Do not represent a stale log as current success.
- **Never expect finance activity to stop**; system must tolerate moving data. Universal FINAL_PASS isn't required for scheduler hardening.
- Freeze remains valid even if later a module has transient `NEEDS_REVIEW`. Don't do "fix" to known-passed modules because status changed after finance edits.
- Work in small verifiable steps, syntax QA before user copy-pastes, no syntax bugs; if mistakes occur acknowledge accurately and fix, no endless status loops.

## 12. CODE REFERENCE / SOURCE SNAPSHOT CAUTION

The chat includes ZIP artifacts of prior phases: `module-14-phase-q-registration-validated.zip`, `module15-phase-q-source.zip`, `module-15-phase-q-integration-candidate.zip`, and `netsuite-backup(20261029-025724).zip` (older full project archive containing `.docs` versions 1–11). **These are archived conversation artifacts**; they are not proof of latest production file contents. Module15 code changed after Oct29 archive, and M14/M15 cleanup may or may not have been run. Do not claim exact current file content/line count from ZIP.

**User asked include all code in the documentation:** it is unsafe to fabricate a full production source listing from incomplete current machine context. This handover instead includes **real observed snippets above** and embeds the **complete prior master handover** (with its own archival code appendices) below. For current canonical production code, new chat must request a *sanitized* current source snapshot/ZIP and hash manifest from `C:\netsuite-backup`, excluding secrets. Never publish private key or tokens or silently replace production with reference archive.

### 12.1 Module10 source actually exposed in this conversation (for bottleneck diagnosis only)

```js
// Actual observed branch inside modules/customer-credit-memo/incremental-sync.mjs
if (mode==='--repair-audit') {
  const fullHeaders=await fetchHeaders(access);
  const fullIds=fullHeaders.map(h=>String(h.internal_id));
  // map full source to groups, then compare with stored BigQuery keys
  for (const g of GROUPS) {
    const source=sourceRows(fullMapped,g), stored=await storedRows(g);
    const keys=compareKeys(source,stored,g);
    if (keys.onlyNetSuite || keys.onlyBigQuery || keys.source!==keys.bigquery)
      fail('REPAIR BLOCKED: inventory/key mismatch '+g.table+
           ' sourceOnly='+keys.onlyNetSuite+' bqOnly='+keys.onlyBigQuery);
  }
}
```

**Do not modify this file or invoke repair manually; snippet included solely to explain why Fast Delta can stop at CCM.**

## 13. ACCEPTANCE CRITERIA FOR NEXT CHAT

**Next chat is successful only if:** (a) reads this handover and preserves 15-module freeze, (b) correctly inventories actual four Windows Scheduled Task XML/properties before design, (c) produces centralized config and safe PowerShell 5.1 validate/preview/apply/rollback pattern without scheduler modifications until explicit approval, (d) no regressions in names, actions, principals, shared lock, scheduling concurrency, (e) no manual production `--sync`, (f) gives only revised ZIP and fully grounded test commands, (g) records hashes and results only when measured, and (h) DOES NOT invent Module16.

---

# APPENDIX A — HISTORICAL MASTER HANDOVER (29 OCT 2026; ARCHIVED, SUPERSEDED WHERE CONFLICTS)

**ARCHIVAL NOTE:** Content below is copied from an older project backup handover existing in the user-supplied archive. It offers extensive historical code snippets, full early module records, role setup, and verification methodology. Its descriptions of "currently 11 modules" and "next Vendor Payment" are **outdated**. The current state is **15 modules with next Scheduler Normalization**, as documented above. The strict freeze rules remain active. This appendix is retained to keep past context intact, NOT to overwrite the November 2 findings.

# [Azi] NETSUITE → BIGQUERY BACKUP — MASTER HANDOVER, 11 MODULE HARD FREEZE, NEXT MODULE

**Tanggal baseline:** 29 Oktober 2026 (WIB). **Tujuan:** dibuka sebagai sumber konteks utama pada chat baru. **SATU dokumen handover** yang menggabungkan perkembangan, freeze, konfigurasi, testing, known pitfalls, dan lampiran kode non-rahasia. **Jangan pecah aturan freeze menjadi dokumen terpisah.**

> **PRIORITAS ABSOLUT — HARD FREEZE:** Modul 1–11 yang telah lolos production V3 tidak boleh diubah, ditulis ulang, dijalankan `--sync` manual, di-reset checkpoint, diubah mapping/schema, dihentikan/diubah schedulernya, diubah shared-lock/controller-nya, atau diganggu untuk menyelesaikan modul baru. Bangun modul 12+ secara standalone dan hanya integrasikan ke produksi setelah semua fase lulus serta user menyetujui integrasi. **Jangan pernah mengorbankan modul yang sudah PASS untuk modul baru.**

## 0. Ringkasan eksekutif dan status bukti

- **Production V3 paling akhir yang user buktikan:** `slot: 09:00`, `FINAL_PASS`, `exitCode: 0`, `finishedAt: 2026-10-29T02:19:47.078Z` = **09:19:47 WIB**.
- Pemeriksaan status lengkap **09:22 WIB 29 Okt 2026:** 4 task terdaftar; Fast Delta `RUNNING` (normal, sedang sinkron), V3 `Ready`, V3 result `FINAL_PASS` exit 0, dengan summary sembilan required-module `FINAL_PASS`, CCM `FINAL_PASS`, Vendor Credit `FINAL_PASS`, Purchase Return `NO_SOURCE`. Live audit all modul `SKIPPED` pada saat itu karena Fast Delta sedang running; **bukan bukti audit gagal**. Audit read-only penuh 11 modul pernah `AUDIT_CLEAN`/`NO_SOURCE` 28 Okt 15:31 WIB sebelum perubahan data berikutnya.
- **Vendor Credit (Module 11)**: live atomic commit, exact presence, exact financial reconcile, GL balance PASS; automatic V3 catch-up B34 berhasil dibuktikan oleh slot 09:00.
- **Customer Credit Memo (Module 10)**: historical soft-deletion ID 3162655 terjadi pada 29 Okt 08:16:44 WIB dengan independent proof; B33 automatic CRUD reconciliation di V3 slot 08:40 `FINAL_PASS`; slot 09:00 kembali `FINAL_PASS`.
- **Bukti terbatas:** PASS tersebut snapshot/hasil schedule, bukan bukti tidak ada future source movement. Actual Vendor Credit verified deletion masih **PENDING_NO_EVENT** karena belum ada event penghapusan nyata yang teruji. Jangan membuat klaim live delete PASS untuk VC.
- **TOTAL SCOPE RESMI 15 modul:** 9 mandatory + 6 agreed additional; 11 selesai, 4 outstanding.

## 1. HARD FREEZE — KONTRAK OPERASIONAL TIDAK BISA DITAWAR

1. Production modules 1–11 **FROZEN**: tidak menyentuh file, logika, mapping, schema, checkpoint, data, deletion proof, health status, schedule atau Windows task existing demi modul baru. Modul 10 dan 11 pun kini frozen setelah 09:00 FINAL_PASS.
2. **Tidak pernah** stop, pause, disable, reschedule, restart, hapus atau interfere dengan 4 existing scheduled tasks/child process. Jangan menunggu/menyelesaikan konflik dengan merusak scheduler produksi.
3. **Tidak pernah** jalankan ad-hoc/manual `--sync`, `--apply`, `--repair-audit` untuk modul yang dikelola scheduler kecuali user secara eksplisit memberikan izin controlled exception. Check read-only (`presence`, `check`, `check-financial`, `--audit-only`, `--dry-run`) boleh jika memang diperlukan, dengan perhatian bahwa dry-run tidak membuktikan live commit.
4. Tidak hapus shared lock, file health, audit, checkpoints; tidak hard-delete historical lines/GL/links. Verified deletion: authoritative exact NetSuite `deletedrecord` proof + source globally absent + identity tuple + max 3 per batch + audit + header-only soft delete + no checkpoint shift; fail closed.
5. Modul baru **standalone**: probe NetSuite permissions, schema design, source reconciliation, numerical exactness, offline safety, immutable checkpoint CAS, atomic BigQuery, verified deletion dry-run, idempotent rerun, concurrent source handling, rollback. **Integrasi scheduler adalah tahap paling akhir** setelah PASS dan persetujuan user. Jangan edit `common/`/`scripts/` existing selama development.
6. Gunakan **arsip kode produksi aktual** sebagai baseline, bukan menyalin desain dari model lain/berimprovisasi. Jangan mengulangi B29–B34; pahami root cause dan sertakan positive + negative tests sejak awal.
7. File JS/MJS yang diberikan untuk download **harus ZIP** dengan folder relatif `modules/<new>/...`; user extract manual menimpa file. Jangan memberi file `.js/.mjs` unduh langsung; jangan sertakan `Expand-Archive`.
8. Output test **hanya terminal**, jangan otomatis membuat `.txt`/`Tee-Object`/`Out-File`/redirect test logs. Berikan syntax PowerShell executable langsung dari `C:\netsuite-backup` dan instruksi timing yang pasti (run sekarang/jika Ready/setelah scheduled V3 selesai).
9. Setup BigQuery table **dibuat otomatis dari script Node yang disalin ke PowerShell**, seperti modul-modul sebelumnya. Jangan minta user membuat tabel satu per satu via UI/SQL manual; penamaan, schema, checkpoint mengikuti baseline.
10. Hindari audit/probe berulang tanpa hipotesis, waiting cycles tak jelas, patch trial-and-error. Sekali kesalahan muncul, baca **log terbaru spesifik** dan sumber terkait, patch minimum, uji standalone, observe scheduled run. `Ready` saja tidak membuktikan recovery dijalankan. `LastTaskResult=0` juga bisa berarti `SKIPPED`.
11. Dokumentasi handover berikutnya harus **satu dokumen** yang memuat seluruh ketentuan ini, snapshot struktur, roles, permissions, exact commands, patches, tests, status dan source manifest. Jangan buat dokumentasi tersendiri sebelum user minta.

## 2. Daftar resmi modul dan prioritas

| # | Modul | Kategori | NetSuite transaction type | Status 29 Okt 09:19 |
|---|---|---|---|---|
| 1 | Sales Invoice | REQUIRED | `CustInvc` (verifikasi mapping source) | FINAL_PASS |
| 2 | Item Fulfillment | REQUIRED | `ItemShip` (verifikasi mapping source) | FINAL_PASS |
| 3 | Sales Order | REQUIRED | `SalesOrd` (verifikasi mapping source) | FINAL_PASS |
| 4 | Item Receipt | REQUIRED | `ItemRcpt` (verifikasi mapping source) | FINAL_PASS |
| 5 | Purchase Order | REQUIRED | `PurchOrd` (verifikasi mapping source) | FINAL_PASS |
| 6 | Purchase Invoice / Vendor Bill | REQUIRED | `VendBill` | FINAL_PASS |
| 7 | Sales Return | REQUIRED | `RtnAuth` (verifikasi mapping source) | FINAL_PASS |
| 8 | Purchase Return | REQUIRED | source belum tersedia | NO_SOURCE (normal, gated) |
| 9 | Sales Payment | REQUIRED | `CustPymt` | FINAL_PASS |
| 10 | Customer Credit Memo | ADDITIONAL #1 | `CustCred` | FINAL_PASS |
| 11 | Vendor Credit | ADDITIONAL #2 | `VendCred` | FINAL_PASS |
| 12 | Vendor Payment | ADDITIONAL #4 | `VendPymt` | **NEXT yang direkomendasikan** |
| 13 | Journal Entry | ADDITIONAL #3 | `Journal` | Belum dibangun |
| 14 | Inventory Transfer | ADDITIONAL #5 | validasi type dari NetSuite | Belum dibangun |
| 15 | Inventory Adjustment | ADDITIONAL #6 | validasi type dari NetSuite | Belum dibangun |

**PENTING: DAFTAR ADDITIONAL YANG DISEPAKATI (urut asli, tidak berubah):** 1. Customer Credit Memo (`CustCred`); 2. Vendor Credit (`VendCred`); 3. Journal Entry (`Journal`); 4. Vendor Payment (`VendPymt`); 5. Inventory Transfer; 6. Inventory Adjustment. **Urutan pembangunan tidak harus mengikuti urut daftar.** Diskusi terakhir memilih **Vendor Payment dulu** (sebagai Module 12 berdasarkan urutan implementasi), kemudian JE (Module 13), Inventory Transfer (14), Inventory Adjustment (15). Ini rekomendasi prioritas, bukan perubahan enam scope asli.

**Alasan prioritas VP:** memanfaatkan baseline Purchase Invoice, Vendor Credit, dan pola pembayaran Sales Payment; bisa menutup rekonsiliasi Accounts Payable/settlements lebih dahulu. Journal Entry tetap penting tetapi desain multi-book/intercompany dan general-ledger mapping perlu probe mandiri. Jika akun NetSuite ternyata tidak mempunyai VP source atau permission, dokumentasikan temuan dan pilih ulang setelah persetujuan user.

## 3. NetSuite setup awal — PERTAHANKAN IDENTITAS DAN PERMISSION ASLI

| Aspek | Nilai terkonfirmasi / historis |
|---|---|
| **Role NetSuite** | **`PNM NetSuite Backup Integration`** |
| Role internal ID historis | `customrole1042` (**verifikasi ulang live jika dipakai**, jangan hardcode) |
| **Integration record** | **`PNM NetSuite Backup`** |
| Auth | OAuth 2.0 Machine-to-Machine, client credentials dengan JWT assertion |
| JWT signature | `PS256`; existing certificate/private key |
| API | REST Web Services / SuiteQL (`common/netsuite-client.mjs`) |
| **Run Server SuiteScript and Trigger Workflows** | **OFF — JANGAN DIAKTIFKAN** |
| Access model | read-only minimum **View** untuk transaksi/master; **bukan Edit/Full** tanpa bukti dan approval |

**Permission yang ditranskripsi dari screenshot role sebelumnya (snapshot historis):**

**Transactions — View:** `Bills`, `Credit Memo`, `Credit Returns`, `Enter Vendor Credits`, `Find Transaction`, `Fulfill Orders`, `Invoice`, `Item Fulfillment`, `Item Receipt`, `Purchase Order`, `Return Authorization`, `Sales Order`, `Vendor Return Authorization`, `Vendor Returns`.

**Lists — View:** `Accounts`, `Currency`, `Items`, `Locations`, `Perform Search`, `Vendors`.

**Reports:** `SuiteAnalytics Workbook` — **Edit** (existing, jangan diturunkan tanpa review).

**Setup:** `Deleted Records` — **View**; `Log in using OAuth 2.0 Access Tokens` — **Full**; `REST Web Services` — **Full**. **Full** di setup adalah baseline historis yang sudah ada, bukan instruksi memberikan Full secara massal.

**Perubahan pada Module 9:** probe Sales Payment semula tidak dapat membaca transaksi `CustPymt`. User menambahkan izin **Customer Payment — View**, setelah itu transaksi bisa dibaca dan sync berhasil. Jangan mengasumsikan `Customers` View sudah disetujui/ditambahkan bila tidak ada bukti screenshot terbaru. Untuk modul selanjutnya, probe read-only dengan role ini, lihat error nyata, baru usulkan permission minimal yang spesifik:
- `CustCred` → cek `Credit Memo` View existing; source visibility dan link tetap wajib diprobe.
- `VendCred` → cek `Enter Vendor Credits` View existing; jangan menyamakan semua vendor credits dengan physical returns.
- `Journal` → permission jurnal perlu **dibuktikan**, belum ada screenshot akses live yang menjamin.
- `VendPymt` → permission Vendor Payment dan vendor-related lists perlu **dibuktikan**; jangan tebak label NetSuite UI dari type SuiteQL.

Source account fitur SuiteCloud pernah memiliki Server SuiteScript, REST Web Services, OAuth 2.0, SOAP Web Services, Token-Based Auth; fakta historis bukan instruksi mengubah setup. Jangan pernah menaruh JWT private key, certificate, integration secret, credential CLIXML, token, chat id dalam ZIP patch/handover maupun output. **Jangan mencetak env atau credential ke terminal.**

### Kewajiban setup modul 12 (VP)

- Pertahankan **role `PNM NetSuite Backup Integration`** dan **integration `PNM NetSuite Backup`**; gunakan OAuth 2.0 M2M JWT `PS256` sebagaimana existing. Jangan buat role/integration lain tanpa alasan dan approval; jangan hardcode historical role ID.
- Uji SuiteQL read-only untuk `VendPymt`, join `Transaction`, `TransactionLine`, `TransactionAccountingLine`, dan vendor-bill/payment application/link yang benar **berdasarkan response live**. `VendPymt` tidak otomatis sama bentuk aplikasinya dengan `CustPymt`.
- Permission **Vendor Payment** pada Transactions perlu dipastikan dari role UI/probe. Jika missing, ajukan permission spesifik **View**; jangan invent exact label UI atau menaikkan privilege blanket. `Find Transaction` dan `Vendors` View adalah existing.
- SuiteQL field mapping, period, accounting book, GL signs, void/reversal, discount, application idempotency dan deletedrecord tuple harus dibuktikan, bukan diimajinasikan.
- Jika mengubah role permission, catat screenshot bukti, label persis, level, role name, reason, test before/after. No credentials in docs.

## 4. Infrastruktur production dan folder

| Item | Baseline |
|---|---|
| Root Windows | `C:\netsuite-backup` |
| Runtime | Node via `C:\nvm4w\nodejs\node.exe` (Windows task) |
| BigQuery | project `even-gearbox-255203`, dataset `netsuite_backup`, region `asia-southeast1` |
| Auth | NetSuite OAuth 2.0 M2M + BigQuery existing service account; never copy secrets |
| Production timezone | `Asia/Jakarta` |
| V3 workflow | `common/recovery-controller.mjs` orchestrated by `scripts/scheduler-runner.mjs` |
| Fast Delta | `scripts/fast-delta.mjs --sync` |
| Shared lock | `common/shared-lock.mjs`, audit `logs/scheduler/shared-lock-audit.jsonl` |
| V3 status/history | `logs/scheduler/latest.json`, `history.jsonl`, `skips.jsonl`, `run-*.log` |
| Fast Delta state | `logs/fast-delta/health-v2.json`, `run-*.log` |
| Windows scheduler | `NetSuite Backup Fast Delta`, `NetSuite Backup Freshness Monitor`, `NetSuite Backup V3`, `NetSuite Backup Watchdog` |
| Intervals | Fast Delta ~5 min; V3 config production 20 min slots `:00/:20/:40` within 08:00–22:00; Windows task repetition every 10 min (valid slot logic in runner) |
| Purchase Return gate | `SCHEMA_ONLY`, `NO_SOURCE` until legitimate source records, not error |

### Struktur folder diketahui dari snapshot historis + patch

```text
C:\netsuite-backup\
  .docs\                                # handover versi lama; satu handover baru ini sebagai yang terbaru
  common\                               # shared libraries; HARD FREEZE setelah 11 PASS
    bigquery-client.mjs
    netsuite-client.mjs
    recovery-controller.mjs             # B34 latest patch
    shared-lock.mjs
    child-runner.mjs
    decimal-precision.mjs
    source-movement.mjs
    verified-deletion-proof.mjs
    verified-deletion-batch.mjs
    v3-status-contract.mjs
    ...
  config\
    scheduler.json                      # production 20 min, do NOT alter
    self-healing.json
    ...credential files                 # exclude from archives and handover
  modules\
    sales-invoice\
    item-fulfillment\
    sales-order\
    item-receipt\
    purchase-order\
    purchase-invoice\
    sales-return\
    purchase-return\
    sales-payment\
    customer-credit-memo\              # B33 reconciliation + verified deletion SQL hotfix
    vendor-credit\                    # B31 latest incremental writer, B34 recovery registration
    vendor-payment\                   # PLANNED, NOT CREATED
  scripts\
    fast-delta.mjs                      # B28 registered 11 modules
    scheduler-runner.mjs                # B32 updated slot/lock logic
    ...
  logs\
    fast-delta\health-v2.json
    scheduler\latest.json
    scheduler\history.jsonl
    scheduler\skips.jsonl
    scheduler\shared-lock-audit.jsonl
    verified-deletions\audit.jsonl
  node_modules\                       # never send in patch/handover
```

**Catatan kebenaran struktur:** daftar di atas gabungan arsip lama 28 Okt sebelum modul 11 dijadikan produksi dan patch yang diakses dalam konteks ini. File tambahan yang ada pada host produksi tetapi belum diekspor harus diinventarisasi sebelum membuat *byte-for-byte frozen baseline*. Daftar kode aktual tersedia di Lampiran A.

## 5. Workflow produksi: scheduler vs recovery

1. **Fast Delta** memperoleh shared lock, menjalankan modul sequential, mengisi `health-v2.json` module `SYNC_OK` atau `NO_SOURCE`. `RUNNING` menandakan sedang aktif; `SKIPPED_LOCKED` adalah skip normal, tidak otomatis failure. Log harus menunjukkan run summary dan exit 0 untuk membuktikan selesai.
2. **V3** Windows invokes `scheduler-runner.mjs`, config interval 20 min; runner memproses canonical slot dan lock. Setelah recovery controller `--all --sync` selesai, status `FINAL_PASS`/`FAILED`/`NEEDS_REVIEW` dicatat di `latest.json` & `history.jsonl`. `Ready` **bukan** bukti FINAL_PASS.
3. **Recovery controller** melakukan preflight/deletion inventory, sync, audit, financial checks sesuai baseline masing-masing. **Vendor Credit B34** harus mengejar CREATE/UPDATE source sebelum menolak deletion inventory akibat source-only record (jangan balikan urutannya). Bila source bergerak, bounded retry dan fail-closed; current backlog/lag boleh `NEEDS_REVIEW` sesuai aturan, bukan pretend PASS.
4. **CCM B33** active-only reconciliation mengeluarkan header soft-deleted berikut historical details dari perbandingan aktif; row historis tetap ada. Bounded automatic financial catch-up untuk transaksi lama (`max 10 docs` per execution), atomic and checkpoint unchanged.
5. **No-source** Purchase Return tetap valid bila source nol. Verified deletion MAX 3 per batch; jangan usulkan hard delete atau perluasan batch demi cepat PASS.

## 6. Module 11 Vendor Credit — technical contract dan hasil

- SuiteQL `Transaction.type='VendCred'` bukan vendor return fisik. Scope Oct 1 2026 onward open-ended; historical before Oct excluded by agreed scope.
- BigQuery target 5 tabel: `vendor_credit_headers`, `vendor_credit_lines`, `vendor_credit_accounting_lines`, `vendor_credit_previous_links`, `vendor_credit_next_links`.
- Initial baseline `98,307,307,206,206` (total 1,124) dengan checkpoint NetSuite `2026-10-28 09:23:44`.
- During changing source: 100/102/106 headers and rekey details; 28 Oct scheduled live B31 committed **106 headers, 331 lines, 331 GL, 222 previous links, 222 next links** (total **1,212**), checkpoint `2026-10-28 15:06:16`.
- Source/target exact reconciliation: all five tables count exact, missing 0, field mismatches 0, GL 106 groups 0 imbalanced, `deleted=0`. Vendor Credit live verified-deletion event **not observed** (PENDING_NO_EVENT).
- Testing recorded: **13/13** offline deletion/safety, **19/19** offline writer after B31, exact `presence.mjs` PASS, `check-financial.mjs` PASS, Fast Delta `SYNC_OK`, V3 `FINAL_PASS` on 29 Oct 09:00.
- Writer: BigQuery atomic staged upsert + active detail re-key; stage duplicate/count guards, source snapshot bounded retries, checkpoint compare-and-swap guard; rollback, staging cleanup; never hard-delete headers. SQL correlated anti-join must include an equality predicate between both sides (`vendor_credit_id`).
- Any source-only new record during V3 is **catch-up opportunity**; run module incremental first, then deletion guard/audit in B34. Keep `deletedrecord` exact tuple mandatory and max 3.

## 7. Module 10 Customer Credit Memo — technical contract dan hasil

- SuiteQL transaction type `CustCred`. Six BigQuery targets: `customer_credit_memo_headers`, `customer_credit_memo_lines`, `customer_credit_memo_accounting_lines`, `customer_credit_memo_previous_links`, `customer_credit_memo_next_links`, `customer_credit_memo_financial_classification`.
- Identified independently certified deletedrecord identity: `recordtypeid=creditmemo`, `type=CREDITMEMO`, example evidence `3144782`; confirmation file `modules/customer-credit-memo/deletion-identity.confirmed.json`. **Do not copy identity evidence as proof for future deletion without independent exact check.**
- ID **3162655** actual deleted 28 Oct; audited `SOFT_DELETED` on 29 Oct 08:16:44 WIB with exact proof and source absence. Header soft-delete only; historical details preserved; no checkpoint move by deletion.
- Fixed UTF-8 BOM in identity JSON (host-specific file content encoding), then BigQuery SQL unintended `BEGIN` before `BEGIN TRANSACTION` in `verified-deletion.mjs`. **Do not reintroduce BOM or unbalanced BEGIN/END.**
- Exact presence previously compared soft-deleted headers and historical details against active NetSuite → false extra rows 1 header, 3 lines, 3 GL, 1 financial classification. B33 active-only reconcile now handles without deleting details.
- Previously 26 financial mismatches in lines and 26 in GL (e.g. rate `26443.87` vs `26443.86`), beyond overlap checkpoint; B33 established bounded auto-repair of historical active mismatches (10 docs per execution, no CP drift).
- User witnessed B33 scheduled V3 **CCM FINAL_PASS** slot 08:40 and again 09:00 29 Oct. Frozen.

## 8. Timeline troubleshooting dan root causes — JANGAN ULANGI

| Fase | Symptom | Penyebab | Perbaikan/lesson |
|---|---|---|---|
| B28 integration | VC registered in Fast Delta/V3 | controllers previously only 10 | Final-stage addition only; don't replace entire modules |
| B29 | `target rows missing from source` on detail | NetSuite changed line/GL identity, re-key | active detail replacement atomic; preserve header/deletion guard |
| B30 | `source payload changed during preparation` | source moving during snapshots | bounded compare/retry with order-independent stable snapshots, fail closed |
| B31 | BigQuery `LEFT ANTISEMI JOIN cannot be used ... equality` | correlated SQL missing equality predicate | fix explicit vendor_id equality; offline 19/19; live atomic commit PASS |
| V3 schedule B32 | latest V3 stuck slot 15:00 while Fast Delta PASS | runner slot/lock timing and missing recovery processing; investigation produced repeated misleading `Ready` | patch runner slot/lock handling; observe real `latest.json`, not `Ready` only |
| CCM verified-delete | BOM `Unexpected token U+FEFF` | identity JSON UTF-8 BOM | remove only leading BOM; keep identity intact |
| CCM verified-delete | BigQuery `Unexpected end of script` | extra unclosed `BEGIN` | remove stray BEGIN; do not alter deletion guard |
| CCM B33 | false orphan after source deleted ID 3162655 and 26+26 financial mismatch | all-rows reconciliation includes soft-deleted; checkpoint overlap misses historical active precision changes | active-only reconcile, bounded automatic repair, preserve historical rows/checkpoints |
| VC B34 | V3 `deletion-inventory` blocks source 112 / BQ 111 before sync | wrong order for live new transaction while source moving | catch-up incremental **before** deletion inventory, bounded retry and safe review |
| 29 Oct 09:00 | V3 final | CCM and VC `FINAL_PASS`; other modules FINAL_PASS/NO_SOURCE | HARD FREEZE entire 11-module baseline |

**Important:** The user should not repeatedly run dozens of diagnostics. For new module, prepare test plan in advance (negative and concurrency); stage local off-production; minimize production observations; isolate modifications.

## 9. Source mapping, schema, BigQuery write/test design — required for new modules

A. Read source fields **using existing SuiteQL client and mapping approach** from module analog; establish transaction scope and links with actual evidence. Distinguish transactionHeader, transactionLines, accountingLines, previous/next links and application relations. Do not invent link cardinality. Use numeric **exact decimal strings** (never JS float silently rounded), authoritative GL source; audit debit/credit, credit application/reversal, per-book classification.

B. `schema-contract.mjs` defines table names, column definitions/types, unique composite keys, nullable keys and source groups; generated schema creation via Node `initialize-schema.mjs`/initialization script, **one-time & idempotent** as in existing modules. BigQuery project/region remain stable, checkpoint entries module-specific. **Automatic table creation must be scripted**, user copies PS commands, not manual BigQuery UI.

C. Before write, check duplicates and source anomalies; staged destination counts; exact key/field compare. Use bounded transaction with appropriate BigQuery MERGE and child detail replace (active only), stage/target key guards, orphan check, checkpoint CAS; retry only safe concurrent conflicts, no silent retries over uncertain checkpoint; dry-run ZERO writes and no checkpoint shift. No unconditional overwrite.

D. Verified deletion uses independent exact NetSuite deletedrecord tuple, source globally absent, requery before commit, max batch 3, header-only `is_deleted` & `deleted_at`, audit trail, historical lines untouched; never treat `onlyBigQuery` alone as proof; missingNetSuite can be source visibility/filter issue. No auto delete of data outside certified identity.

E. Source moving and scheduler catch-up: newly created ID *before* V3 reconciliation must be synced first (don't block on deletion inventory); fail-closed if source still changing. No manual production `--sync` as shortcut.

## 10. Mandatory phased testing: follow precedent, do not improvise

**New module ONLY; commands below are a template, exact filenames must be copied from existing reference/new-module design. Never run these against frozen existing modules as ad-hoc writes.**

1. **A — NetSuite role/permission READ-ONLY probe:** prove `VendPymt` visible; classify type/code; source header/line/GL/applications/link counts and edge cases; no table creation yet.
2. **B1/B2 — Source mapping and key cardinalities:** sample recent records, inspect unique keys, temporal bounds, real-world source missing; verify type, decimal precision, GL balance and application relations.
3. **B3/B4 — schema contract and automatic BigQuery schema init:** write scripts to create required tables/checkpoints; run idempotent initialization **via `node .\modules\vendor-payment\initialize-schema.mjs` only once after inspect**; no manual SQL table creation. Maintain source initial backfill boundaries and region.
4. **B5 — initial dry-run:** ensure source counts & table shape, zero writes; freeze source scope and initial checkpoint policy.
5. **B6 — initial controlled sync/backfill** for the *new, not yet scheduler-managed* module only after readiness and user consent; validate staging/atomic commit, keys, counts, no duplicate.
6. **B7 — full field-by-field presence and financial checks** (read-only) across all tables; exact numeric; debit/credit, quantity and applications invariants; zero mismatches required.
7. **B8 — incremental audit/negative tests:** no-change, create, update, detail rekey, source moving, active deletions/certified deletion, source-only newly created, failed staging, CAS concurrency, rollback, rerun idempotency.
8. **B9 — verified deletion dry-run:** independent tuple certification with exact `deletedrecord` tuple, proof absent/source remains, max 3 batch, historical children untouched. If no delete event: `PENDING_NO_EVENT`, **do not manufacture an event**.
9. **B10 — offline writer contract/safety:** must meet or exceed 13 safety / 19 writer tests where applicable, explicitly test BigQuery SQL anti-join constraint, BOM input, balanced BEGIN/END, checkpoint conflict, zero-write dry-run; do not treat offline PASS as live write PASS.
10. **B11 — new-module live changed-source proof** only when legitimate data change occurs and user approves; staging, atomic commit + exact reconcile. Do not force test changes to financial data.
11. **B12 — readiness/integration gate:** **only after standalone all PASS** and deletion baseline certified, propose minimal surgical controller registration; user approves; prepare one ZIP with narrow file changes and a diff/manifest; never touch old modules. Verify 4 Windows tasks Ready before manual extraction, no stop/disable. Then wait scheduled Fast Delta and V3 and read their actual logs.
12. **FINAL PASS:** Fast Delta module in health, `SYNC_OK` (or justified `NO_SOURCE`); V3 `FINAL_PASS`, exit 0 and new module summary `FINAL_PASS`; read-only exact reconciliation after scheduled write; freeze new baseline with SHA-256.

### PowerShell examples — READ-ONLY checks (safe, no log output files)

```powershell
cd C:\netsuite-backup
Get-ScheduledTask | Where-Object { $_.TaskName -like 'NetSuite Backup*' } | ForEach-Object {
  $i = $_ | Get-ScheduledTaskInfo
  [PSCustomObject]@{ Task=$_.TaskName; State=$_.State; LastRun=$i.LastRunTime; NextRun=$i.NextRunTime; Result=$i.LastTaskResult }
} | Format-Table -AutoSize
```

```powershell
cd C:\netsuite-backup
$h=Get-Content .\logs\fast-delta\health-v2.json -Raw | ConvertFrom-Json
$h.modules.PSObject.Properties | ForEach-Object {
 [PSCustomObject]@{Module=$_.Name;Status=$_.Value.lastResult;LastSuccess=$_.Value.lastSuccessAt}
} | Format-Table -AutoSize
$h | Select-Object lastRunStatus,lastAttemptAt,lastFinishedAt | Format-List
```

```powershell
cd C:\netsuite-backup
$v3=Get-Content .\logs\scheduler\latest.json -Raw | ConvertFrom-Json
$v3 | Select-Object slot,status,exitCode,startedAt,finishedAt,log | Format-List
$log=Join-Path .\logs\scheduler $v3.log
if(Test-Path $log){
 $lines=Get-Content $log
 $match=$lines | Select-String '^========== RECOVERY SUMMARY ==========' | Select-Object -Last 1
 if($match){$lines | Select-Object -Skip ($match.LineNumber-1) -First 18}
}
```

**Never rely solely on task `Ready`.** `267009` = currently task running. `lastRunStatus: RUNNING` while Windows task Running means state not final, and Fast Delta runs may skip due shared lock. V3 `latest.json` is updated on completed recovery (not each scheduler invocation). `LAST EXIT CODE 0` alone may represent SKIPPED.

## 11. New Module 12 — Vendor Payment, design brief for next chat

- Next recommended module **Vendor Payment (`VendPymt`)** first, notwithstanding original additional-list order. Reference **Sales Payment (`CustPymt`)** for payment/application logic and **Purchase Invoice + Vendor Credit** for payable-side relationships; do not use existing modules as a target for change.
- Distinguish vendor payment header, transaction lines, accounting lines, applications to vendor bills, credits and links; inspect discount, exchange currency, multi-book, reversal/void cases with live read-only SuiteQL before declaring BigQuery tables.
- One module folder `modules/vendor-payment/` isolated. Expected file architecture comparable to previous: `probe.mjs`, `mapping.mjs`, `schema-contract.mjs`, `initialize-schema.mjs`, `sync.mjs`, `incremental-sync.mjs`, `presence.mjs`, `check.mjs`, `check-financial.mjs`, `deletion-inventory.mjs`, `verified-deletion.mjs`, `test-safety.mjs`, `test-incremental-writer-offline.mjs` where contract actually requires; filenames are examples, take conventions from source code appendix rather than generating speculative contracts.
- First step: confirm role `PNM NetSuite Backup Integration` can View `VendPymt`, obtain sample production read-only records, record permission name if missing. Build schema automatically from scripts and manage module-only checkpoints.
- Satisfy standalone tests and full reconciliation **before** any scheduler registration. Controller integration only after explicit approval, minimal diff, ZIP packaging, no disruption.

## 12. Artifacts, SHA-256 and limits of evidence

**This environment contains:** a user-provided historic full project archive `netsuite-backup(20261028-023146).zip` (BEFORE final 29 Oct 11-module PASS); patch ZIPs B28–B34 for latest selected files; conversation's manually applied host edits. These are **not** a live read of `C:\netsuite-backup` as of 29 Oct 09:19. Thus source below is a **reconstructed reference**, NOT certified byte-for-byte final production. To create a genuine code-complete freeze later, take a read-only snapshot/hash manifest of production source on user PC, exclude secrets/node_modules/logs, compare with overlay hashes. **Do not overwrite host production with appendix reconstruction.**

Known original pre-integration SHA-256 historical: `scripts/fast-delta.mjs`: `23A2906977E26DDA1F007C6F00780FD8CD1695899EC81970AFAFB72C2319227D`; `common/recovery-controller.mjs`: `C14D619E26E8AF4FB36DC9B077FCC5E1FC917C60F42BF8B5049D30B3C4EB6DE1`; `config/scheduler.json`: `DECFB66D38BDC283AE6F7CCA0C6E8FB97597E78067A45EC2B588D5FD9986D73F`. **Historical hashes, not 29 Oct live hashes.**

**B31, B32, B33, B34 are the reference *patch* sources** for their respective files, and any manual host edits (BOM removal, CCM stray-BEGIN fix) must be verified against live source. No credential/secret files are embedded. Do not embed server logs, API keys, JWT, config credential CLIXML or private key.

## Appendix A — Source code reference, complete available safe `.mjs`/`.js`

This large appendix contains actual non-secret source code captured from the user-provided 28 Oct archive, overlaid with B28–B34 ZIPs and with the explicitly described one-line CCM `BEGIN` fix. **It is provided for inspection/compare, not direct production replacement.** File contents from earlier modules remain historic snapshot, not attested live 29 Oct. Git diffs/checksums must be re-established from actual Windows production folder before new module integration.

### A.1 Source manifest (sha256 = reconstructed artifact, **not** host production)

| File | Bytes | SHA-256 | Provenance |
|---|---:|---|---|
| `common/bigquery-client.mjs` | 486 | `a22e1a2019072b8929fe8c7d8e1ad6e96921ab48e0afcbd9d778be775b8e6f57` | historic archive |
| `common/child-runner.mjs` | 2264 | `e0433b397dfbba0d83a09afbfa9439de9d1df1f1edcf2ad1c81f72f205b0b102` | historic archive |
| `common/decimal-precision.mjs` | 3961 | `66aa5a67a55c64932a20136bb5d212afc2d92f7a494d4f340f79c58d360576fd` | historic archive |
| `common/netsuite-client.mjs` | 2579 | `ca945e19051711bb9cd3cba7fff0366ec64666906e0e72f28e0eb58b4b2be428` | historic archive |
| `common/presence-reconcile.mjs` | 5397 | `80fe48d758c3ef2965460da536eeca5bce84f561af03534120cc3bbf5fbc5ffb` | historic archive |
| `common/recovery-controller.mjs` | 34412 | `5903767cdc87fc5db02d3c69a571b804f55eca258b36c259c1b0b31a4d4130d5` | patch-overlaid |
| `common/shared-lock.mjs` | 5803 | `f1258bd1b93e9d4a920607d77d37261eeef71c2e0cf5d133d61755ad958e10b1` | historic archive |
| `common/so-mismatch-candidates.mjs` | 1077 | `0e5279c5590fdc29e4e92278f6c8623266fd5a400aa5689a8224d43fa2f84de7` | historic archive |
| `common/source-movement.mjs` | 1594 | `be4bf277ac71f439d37dfc9fd3a2854d055c163b510fa97ff44bad48d0756140` | historic archive |
| `common/sync-utils.mjs` | 715 | `4de8e5ffa5ec52de13664a732bdbafd19864830b730339fbb5666833c9f73617` | historic archive |
| `common/targeted-recovery.mjs` | 4430 | `ee6bf0da6a5385c5dcf8f62c316fd7fa5f39366de4d9e669ba6cec8caca2719b` | historic archive |
| `common/v3-status-contract.mjs` | 1566 | `e8472e3ccb41aa28b5e19479d685d9519752e3cd10f5bdc7fb17b5961e884fd9` | historic archive |
| `common/verified-deletion-batch.mjs` | 6072 | `63fdd63761f92f55200a69ab874e119fc389e68f127577e312ab0735f1c6cbba` | historic archive |
| `common/verified-deletion-proof.mjs` | 590 | `abb2c81a66cdf573a73507087c2f9bc86ed81fea5272743c428d768e130b2d66` | historic archive |
| `modules/customer-credit-memo/check-financial.mjs` | 2084 | `b2df28f4a4624e29a67165a320a63c6ae8658a42c88c9b0b283e00b4c7a8ee34` | patch-overlaid |
| `modules/customer-credit-memo/deletion-inventory.mjs` | 1232 | `e789f3f9c11c0f7a7099aba58bb13232ad3f0bef9f4da8dbb2e6f7609d997c04` | historic archive |
| `modules/customer-credit-memo/deletion-proof.mjs` | 1255 | `a18fdc9b84378647efba26fc631ac9358a14ab83c0b722655542bd985fce7f4d` | historic archive |
| `modules/customer-credit-memo/incremental-sync.mjs` | 14921 | `200d0babb6da225d0ff6c6e3b7cd1f73dc38cfbeee96904b8416ff9989ad4633` | patch-overlaid |
| `modules/customer-credit-memo/initialize-schema.mjs` | 4019 | `951afc15551769ca492f1d5d0edb7bb58eca55018cc6065ff279a515021e712b` | historic archive |
| `modules/customer-credit-memo/mapping.mjs` | 12979 | `bc454adf8054639979b2186fcf262846d7a14af2030b3667a6c5e2706a3de846` | historic archive |
| `modules/customer-credit-memo/presence.mjs` | 990 | `16822f08a28ed05afff974aca6d32027cf24afc79df79e9a8ce21eda57b7c21c` | historic archive |
| `modules/customer-credit-memo/reconcile-common.mjs` | 4143 | `afd56759ed13b6264a22dce93628077d824480fc0028f6782817581629de5719` | patch-overlaid |
| `modules/customer-credit-memo/schema-contract.mjs` | 3140 | `f0307c8ba30203626bfde58a9a75619ae0218280b3bbb5d8cdc27f0dde883d6c` | historic archive |
| `modules/customer-credit-memo/sync.mjs` | 10873 | `f3126d6809b3833aa43aeaa0116c1ab02f9e402d8cbc317b12b3452292415cf8` | historic archive |
| `modules/customer-credit-memo/verified-deletion.mjs` | 6011 | `819432944f6b5b8bcfe0f6f3fd80ac43528b245fdb2529918bf5a2e406fd547d` | patch-overlaid |
| `modules/item-fulfillment/check.mjs` | 17870 | `634b411ea6a4ea94a2b78edf8d182190a4be2bd72c4fb7c462d806b4a19067ea` | historic archive |
| `modules/item-fulfillment/mapping.mjs` | 8202 | `81b20f90f42fa706d092bb83774fa5db391184e1740c3b97d46fb69b062d37b0` | historic archive |
| `modules/item-fulfillment/presence.mjs` | 237 | `bf5741aa5bc4df03c199e925d13bdf78c4b3464c7934ccfeaa3fbffebac3fb32` | historic archive |
| `modules/item-fulfillment/reconcile-accounting.mjs` | 8970 | `8e7f58b5878ee5f1ec9c947d8c4900988f60d3d688aa1f6d09f5beb051d91c0f` | historic archive |
| `modules/item-fulfillment/recover.mjs` | 20400 | `5eca152f589e1251adeebd07fd75e50ea4876be38e79d970d5dcf3fb93b559dd` | historic archive |
| `modules/item-fulfillment/repair-accounting-bounded.mjs` | 4765 | `8f1c2e3eca10463998d4df714a6b2d3fd0b1edacc0a49fa12d6ea6c8fc001f00` | historic archive |
| `modules/item-fulfillment/sync.mjs` | 22008 | `93476b0abf9058e421ca9a81a57a108011873523934b5b61187423099df5ba6e` | historic archive |
| `modules/item-receipt/check-financial.mjs` | 5399 | `3fa15c3b49b4ffa84d3c97549bee1dba3ba11f8f4f29c208fbedbdb6cfd25e29` | historic archive |
| `modules/item-receipt/check.mjs` | 2117 | `feaa96d4a3ab77b7866997c4c7a94a2f67aab1793483039a2e59f149ae698fc3` | historic archive |
| `modules/item-receipt/mapping.mjs` | 4550 | `ed4013316ab134af4d1b71c19d0fb5f1aaf00edfc05870ccde14ff7fff16a692` | historic archive |
| `modules/item-receipt/presence.mjs` | 890 | `14267302aa543af89851a51d7f3091dbbc683417293585ec19f95a2d67809b21` | historic archive |
| `modules/item-receipt/probe.mjs` | 1319 | `b4a7387898785cb9d20af0d5b7e4be81c1d6f594ca834577b43c93f2f1ada98a` | historic archive |
| `modules/item-receipt/recover.mjs` | 159 | `22594f5d9db566968b40e8b833b05533b5544fb43dd75d7afd51520f6049bf31` | historic archive |
| `modules/item-receipt/sync.mjs` | 7456 | `ef91aa7a15642dd9ecf0432076b94522761388536ef1ed04ae6268bb5c68fe3e` | historic archive |
| `modules/purchase-invoice/check.mjs` | 6660 | `bfa96d7e28c48b21a2ed75bbc7eb345d46a23e654e0ddf6dd798c8fa96126035` | historic archive |
| `modules/purchase-invoice/mapping.mjs` | 7829 | `811cbb723643d01601d47efadf196719a05a460c93198bcb1f17b7d603992dfb` | historic archive |
| `modules/purchase-invoice/presence.mjs` | 1214 | `7f5aa4ddcc5c9bc6f7b02a90c216809b21a64b6d0a8908db8d4d55b7ceebc592` | historic archive |
| `modules/purchase-invoice/probe.mjs` | 4188 | `2238f598d575f742767b5f298463c92347f359109adeb92e11aa808603899dad` | historic archive |
| `modules/purchase-invoice/sync.mjs` | 10660 | `98b82a6f70b0c528532a661b3cf8d5f324d76a59d9f38344fbf5623f5e614945` | historic archive |
| `modules/purchase-order/check.mjs` | 5349 | `47ba6e19921be59c6c8613c56121e967067aa56e8c015b922c2850ea6b1f6776` | historic archive |
| `modules/purchase-order/mapping.mjs` | 5333 | `2a19b818efe19bf42f9ff8876fc0c13be1774b44018b1bc041d20cdb2cbc4a88` | historic archive |
| `modules/purchase-order/presence.mjs` | 862 | `81c542894e1f492d4055a3f4b7e3ccf411cd6f76c82e76f13edab96da19a3370` | historic archive |
| `modules/purchase-order/probe.mjs` | 4473 | `ec3f55920f413dce4ffa396cbce425211f04ac91de45eee472783dc97b067909` | historic archive |
| `modules/purchase-order/recover.mjs` | 145 | `18d4cc147fa9befe2b3438128a04fba0a92d01687cce052dc693429a94ce6c21` | historic archive |
| `modules/purchase-order/sync.mjs` | 9677 | `f9eb2a4395b2eb5859dc2b3afff8c7c4e53cc41dca1667d91ee849f5039165de` | historic archive |
| `modules/purchase-return/audit-common.mjs` | 3813 | `7bb4ffc45a2ee72b9ccfdd95b36d41016d3fb100063979a302dd5d391616a334` | historic archive |
| `modules/purchase-return/check-financial.mjs` | 2456 | `fae57f00b436d58ef3ee8a16c9cf47450612af14ea7839bd072cd5c0735efd73` | historic archive |
| `modules/purchase-return/check.mjs` | 2342 | `818c1c5af5cf051b3bc48e8ab4bc5e504321f7046f9d09f5e60a1945fa9c5240` | historic archive |
| `modules/purchase-return/deletion-inventory.mjs` | 972 | `e2db8d0ad96b70f53b9c6c2c45a67ab2d4a5a8a74472e56c434715f990ff6c7f` | historic archive |
| `modules/purchase-return/initialize-schema.mjs` | 5277 | `81f025e26d9286df6adfd83e9633c0cd2e19b9ef0b450dfb4dfd159c232d3e40` | historic archive |
| `modules/purchase-return/mapping.mjs` | 8338 | `3b7e90d13cc53d5f10c26005d360638981ba0beeceb08a0d17f121ac9ae67072` | historic archive |
| `modules/purchase-return/presence.mjs` | 1765 | `8126fac59f901542d549be0bcd8f00e4ce02d7bf67fbd5e257c4658969da15a6` | historic archive |
| `modules/purchase-return/scheduler-gate.mjs` | 1253 | `9add7efc0f89cbf9f5d08059e53a5802e80ef0bb7dec437de86fe8978b7c5250` | historic archive |
| `modules/purchase-return/sync.mjs` | 13195 | `3743dce169b686aa560ec5e3b1bf7b9f021148bdeb99b086af01cda7a53614b3` | historic archive |
| `modules/sales-invoice/check.mjs` | 19539 | `3f9628ce5a86dc6266c2afa9877212a7cf15330b48c0c6e2cd52820c2a91295e` | historic archive |
| `modules/sales-invoice/mapping.mjs` | 3702 | `ad79bc4a48462081e6c437b173d9906162512531f9c97d48c4f53e96367122b0` | historic archive |
| `modules/sales-invoice/presence.mjs` | 234 | `2bd8d0d07b35e7dfc2f62da18d9855c79c7b6351722395407de71417bc7735c2` | historic archive |
| `modules/sales-invoice/recover.mjs` | 10039 | `05878b66a3e55fc5c9c1c8433bffabfb0e8ba1121dcbb9bbcd330b777f91e308` | historic archive |
| `modules/sales-invoice/sync.mjs` | 14071 | `1e0fc570584b7a3f397eadb5b1ab210422d15cf388ca4b6b6edbd54b2a12f437` | historic archive |
| `modules/sales-order/check.mjs` | 6945 | `0dace30a9f3b8306f50c6970eca43969cb62f80eb6781d726c784333635ec56b` | historic archive |
| `modules/sales-order/mapping.mjs` | 8275 | `4dce3c3a329839509f066ad65a0f912e20a8b2ebe99e8f0b90978ae3f4737f25` | historic archive |
| `modules/sales-order/presence.mjs` | 232 | `d45897b4fc03df8a6bb2a5f09cb322ce41e58dfa194b6c5c7faa1ce16aed476a` | historic archive |
| `modules/sales-order/recover.mjs` | 7995 | `0020d557b03240eaddf2762a19ea760e0defae826b8dc8904ef9d3f39653d101` | historic archive |
| `modules/sales-order/repair-active.mjs` | 7938 | `9abbc30424d5fad0cb733708f8a2cf1535db49b2fee679d944ea06672ab6f109` | historic archive |
| `modules/sales-order/sync.mjs` | 19336 | `024344ce8f773ba63f5b64a1ec2dc75fba384f8e1aa56492c126d6e7c0c2c3ec` | historic archive |
| `modules/sales-payment/audit-source.mjs` | 7174 | `a131f0e7db21aeaf24da06bf5e569b3f10e672d200ccb7aab0d9d1ccd718ae0b` | historic archive |
| `modules/sales-payment/check-financial.mjs` | 4482 | `c57293d5b5eab1ea28174446668f420d56802ab7f2e5e5c09ac8e9b4356ff5c2` | historic archive |
| `modules/sales-payment/check.mjs` | 6599 | `232cba049914f11ce3cc0303927e27c1be1a1831a1947bb9792d469c40927d9e` | historic archive |
| `modules/sales-payment/diagnose-financial.mjs` | 7123 | `31c10861fe1ab105e1f776d7f3d64952d0067ecc1cf33c0ae07371eeb3b0faac` | historic archive |
| `modules/sales-payment/mapping.mjs` | 7948 | `97ace1d1a6a2fdd5b110900d3fb8a362d18c738f1767cca55ead98db08b542f5` | historic archive |
| `modules/sales-payment/presence.mjs` | 1503 | `458d6a79695c1a12899a13a2301fbec2b94c04837aa7843edc34c3e4b6d902ce` | historic archive |
| `modules/sales-payment/probe-deletion-identity.mjs` | 5192 | `51d820364fca09a002b51cc118d881cbbc0594eee6f3098e8f00eda10f21341e` | historic archive |
| `modules/sales-payment/probe.mjs` | 12442 | `4a96acf754b714fde14db292f974e01df6207635b239ee3e5fcd0686e5b6ef0b` | historic archive |
| `modules/sales-payment/sync.mjs` | 10689 | `aafd5b78a220a802ec9a21ce2362852705a6cd4cf79d416e82e243cb199cdf9c` | historic archive |
| `modules/sales-payment/test-mapping.mjs` | 1100 | `c258d4f1adf0c5d517820bcdb6b039ecd8028e9eb896739c5ad300703a1a8fa5` | historic archive |
| `modules/sales-return/check-financial.mjs` | 5262 | `d57633ebe5193abfaaf88ca75a7aafb928fa197277a36dc9b301bec3945e9b92` | historic archive |
| `modules/sales-return/check.mjs` | 8935 | `6939893c50c22c2190a9d94f3b3e3725bee0c6e833097bb8d1cc2e49d8695842` | historic archive |
| `modules/sales-return/mapping.mjs` | 10460 | `d7ad464d1996a1fda475b1ec0a9c5eb978d642cc33a3fe81e9669bff00a10a33` | historic archive |
| `modules/sales-return/presence.mjs` | 1360 | `67851eca4df03b3b5a78c438f87035d4dfedb88ce91d19115dacd82f60ca9c0a` | historic archive |
| `modules/sales-return/probe.mjs` | 3854 | `c5cc9b6652c467e910d0590563f300983662321abac6a3517a5df02a970daa1f` | historic archive |
| `modules/sales-return/sync.mjs` | 12582 | `e31aeb4d0afd41e071305bef9c0095cc38e86b14ebcdaa3921bf57973cabb6e4` | historic archive |
| `modules/vendor-credit/incremental-sync.mjs` | 13636 | `43c8e7c2c4bfc3fef7cdd8cbe0a39435237643a51ec4ae870fc95660a79e5e3d` | patch-overlaid |
| `modules/vendor-credit/test-incremental-writer-offline.mjs` | 6602 | `eaa444b20d4fe1e77fea20645d234aaab48951c3e8e81145976088d327ef492d` | patch-overlaid |
| `modules/vendor-credit/test-safety.mjs` | 3527 | `011cc54ad6c9ceaa7d9f198195f3109e5f9b95536ce85fefc36bd50807077dff` | patch-overlaid |
| `scripts/diagnose-transaction.mjs` | 3036 | `927a4350f0eacd73d6dd98041d17f583b7f5356c216bf6e44d26fa65b9b6c936` | historic archive |
| `scripts/fast-delta-freshness-alert.mjs` | 2223 | `b1bb6951d048c5ed72315470532a9a2f2c3db9b354cb30ca3d61b4255d196015` | historic archive |
| `scripts/fast-delta-freshness.mjs` | 1264 | `6986e5e063024ab75db7ec4431ffdff0f1b0ca15122a87c89cd6c514ec8b6a96` | historic archive |
| `scripts/fast-delta.mjs` | 8618 | `8e7a0fcefefeaa0efa120c768d7fc62bff953663d1a0f515466ff0507f625ae8` | patch-overlaid |
| `scripts/freshness-incident-core.mjs` | 2792 | `9dcef1ed874f53a4fec7900ddb4d75460cf649756a0004e1249fed9d12f2b335` | historic archive |
| `scripts/monitor-alert.mjs` | 2356 | `25959ad6a633e1ad7ded89ecd9aaf9b4e81570ed56b1f2249735baa3f37ec2c3` | historic archive |
| `scripts/sales-payment-deletion-inventory.mjs` | 967 | `9b54c2f93bb3b7a9930e797a7e2d479135f49144dfbcb96b9115b457ed495416` | historic archive |
| `scripts/scheduler-runner.mjs` | 9356 | `bc34756f898f3e9a01d8776f4a460b3f21974afa3984e9161e7e30c4c4991331` | patch-overlaid |
| `scripts/scheduler-watchdog.mjs` | 3588 | `33ccd26e34bfead02e92b8f0ab1fa16b707f66ff924dafbd524cd63a34772172` | historic archive |
| `scripts/shared-lock-inspect.mjs` | 1390 | `890c41ee8ea5d4dd83b45c7ff47d65e373d45fd049b455e44137b7d5681b82f7` | historic archive |
| `scripts/verified-deletion.mjs` | 6248 | `f33269dd9219c03ed8d3ed503392efcfd21a4c0b0b3581781c7c1bd427eb8b27` | historic archive |

### `common/bigquery-client.mjs`

**Reconstructed SHA-256:** `a22e1a2019072b8929fe8c7d8e1ad6e96921ab48e0afcbd9d778be775b8e6f57`.

```javascript
import { BigQuery } from '@google-cloud/bigquery';
export const PROJECT = 'even-gearbox-255203';
export const DATASET = 'netsuite_backup';
export const LOCATION = 'asia-southeast1';
export const bq = new BigQuery({ projectId: PROJECT });
export const dataset = bq.dataset(DATASET);
export const T = name => `\`${PROJECT}.${DATASET}.${name}\``;
export async function query(sql, params = {}) {
  const [rows] = await bq.query({ query: sql, params, location: LOCATION });
  return rows;
}
```

### `common/child-runner.mjs`

**Reconstructed SHA-256:** `e0433b397dfbba0d83a09afbfa9439de9d1df1f1edcf2ad1c81f72f205b0b102`.

```javascript
import { spawn, spawnSync } from 'node:child_process';

// Streaming subprocess; unlike spawnSync, does not buffer entire SuiteQL/BigQuery logs.
// Success requires exit 0 AND the expected terminal marker.
export function runChild(command, args, { cwd, timeoutMs, markers, onOutput = () => {}, env = process.env } = {}) {
  if (!Array.isArray(markers) || markers.length === 0) throw Error('markers required');
  return new Promise((resolve) => {
    let settled = false, timedOut = false, spawnError = null;
    let tail = '', stderrTail = '';
    let child;
    const finish = (exit, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const markerFound = markers.some(m => tail.includes(m));
      const ok = !timedOut && !spawnError && exit === 0 && markerFound;
      resolve({ ok, exit, signal, timedOut, markerFound, error: spawnError, detail: timedOut ? `TIMEOUT_${Math.round(timeoutMs / 60000)}_MIN` : spawnError ?? (exit !== 0 ? `EXIT_${exit}_SIGNAL_${signal ?? 'NONE'}` : markerFound ? null : 'SUCCESS_MARKER_MISSING'), stderrTail });
    };
    try {
      child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ok:false,exit:null,signal:null,timedOut:false,markerFound:false,error:e.message,detail:e.message,stderrTail:''});
      return;
    }
    const push = (data, isErr) => {
      const s = data.toString('utf8');
      onOutput(s, isErr);
      // Keep bounded output, allowing markers to cross chunk boundaries.
      tail = (tail + s).slice(-65536);
      if (isErr) stderrTail = (stderrTail + s).slice(-8192);
    };
    child.stdout?.on('data', d => push(d, false));
    child.stderr?.on('data', d => push(d, true));
    child.on('error', e => {spawnError = e.message;});
    child.on('close', finish);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        // Terminate descendant processes too; otherwise a BigQuery writer may continue
        // after the shared lock is released.
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, timeout:15000});
      } else child.kill('SIGKILL');
    }, timeoutMs);
  });
}
```

### `common/decimal-precision.mjs`

**Reconstructed SHA-256:** `66aa5a67a55c64932a20136bb5d212afc2d92f7a494d4f340f79c58d360576fd`.

```javascript
const MAX_INTEGER_DIGITS = 29;
const SCALE = 9;

function canonical(value) {
  if (value === null || value === undefined || value === '') return null;

  const raw = String(value).trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) throw new Error(`Invalid decimal: ${raw}`);

  const negative = match[1] === '-';
  const whole = match[2] ?? '';
  const frac = match[3] ?? match[4] ?? '';
  const exponent = Number(match[5] ?? 0);

  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) {
    throw new Error(`Unsupported decimal exponent: ${raw}`);
  }

  const digits = (whole + frac).replace(/^0+/, '') || '0';
  const shift = exponent - frac.length;

  let result;
  if (shift >= 0) {
    result = digits + '0'.repeat(shift);
  } else {
    const position = digits.length + shift;
    result = position > 0
      ? digits.slice(0, position) + '.' + digits.slice(position)
      : '0.' + '0'.repeat(-position) + digits;
  }

  let [integer, fractional = ''] = result.split('.');
  integer = integer.replace(/^0+(?=\d)/, '');
  fractional = fractional.replace(/0+$/, '');

  const normalized = integer + (fractional ? '.' + fractional : '');
  return negative && normalized !== '0' ? '-' + normalized : normalized;
}

function contextLabel(context) {
  return [
    context.module,
    context.recordId && `record=${context.recordId}`,
    context.field && `field=${context.field}`
  ].filter(Boolean).join(' ');
}

export function validateNumeric(value, context = {}) {
  const s = canonical(value);
  if (s === null) return null;

  const unsigned = s.replace(/^-/, '');
  const [integer, fraction = ''] = unsigned.split('.');

  if (fraction.length > SCALE || integer.length > MAX_INTEGER_DIGITS) {
    throw new Error(
      `BigQuery NUMERIC precision violation [${contextLabel(context)}]: ${s}`
    );
  }

  return s;
}

export function normalizeNumericRate(value, context = {}) {
  const s = canonical(value);
  if (s === null) return null;

  const negative = s.startsWith('-');
  const [integer, fraction = ''] = s.replace(/^-/, '').split('.');

  if (fraction.length <= SCALE) {
    return validateNumeric(s, context);
  }

  let units = BigInt(integer + fraction.slice(0, SCALE));
  if (fraction[SCALE] >= '5') units += 1n;

  const padded = units.toString().padStart(SCALE + 1, '0');
  const split = padded.length - SCALE;

  const rounded = (
    padded.slice(0, split) + '.' + padded.slice(split)
  ).replace(/0+$/, '').replace(/\.$/, '');

  return validateNumeric(
    negative && units !== 0n ? '-' + rounded : rounded,
    context
  );
}

export function validateNumericRows(rows, fields, context = {}) {
  const numericFields = fields
    .filter(([, type]) => type === 'NUMERIC')
    .map(([name]) => name);

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];

    const recordId =
      row.internal_id ??
      row.bill_internal_id ??
      row.po_internal_id ??
      row.receipt_internal_id ??
      row.invoice_internal_id ??
      row.sales_order_internal_id ??
      `row-${index + 1}`;

    for (const field of numericFields) {
      validateNumeric(row[field], {
        ...context,
        recordId,
        field
      });
    }
  }

  return rows;
}

// Additive BIGNUMERIC validator. Existing NUMERIC behavior is unchanged.
// Store as a string in BigQuery inserts, never convert monetary values to JS Number.
// For BIGNUMERIC, a conservative exact range guard is 38 integer digits and
// 38 fractional digits; any value outside these bounds fails closed.
export function validateBigNumeric(value, context = {}) {
  const s = canonical(value);
  if (s === null) return null;

  const [integer, fraction = ''] = s.replace(/^-/, '').split('.');
  if (integer.length > 38 || fraction.length > 38) {
    throw new Error(
      `BigQuery BIGNUMERIC precision violation [${contextLabel(context)}]: ${s}`
    );
  }
  return s;
}
```

### `common/netsuite-client.mjs`

**Reconstructed SHA-256:** `ca945e19051711bb9cd3cba7fff0366ec64666906e0e72f28e0eb58b4b2be428`.

```javascript
import fs from 'node:fs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { CLIENT_ID, CERTIFICATE_ID, PRIVATE_KEY_PATH } from '../credentials/netsuite-secrets.mjs';
export const BASE_URL = 'https://6930902.suitetalk.api.netsuite.com';
const TOKEN_URL = `${BASE_URL}/services/rest/auth/oauth2/v1/token`;
export async function token() {
  if (!CLIENT_ID || !CERTIFICATE_ID || !PRIVATE_KEY_PATH) throw new Error('NetSuite secrets not configured');
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign({
    iss: CLIENT_ID, scope: ['rest_webservices'], aud: TOKEN_URL,
    iat: now, exp: now + 300, jti: crypto.randomUUID()
  }, fs.readFileSync(PRIVATE_KEY_PATH, 'utf8'), {
    algorithm: 'PS256', keyid: CERTIFICATE_ID, header: { typ: 'JWT' }
  });
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`OAuth HTTP ${response.status}: ${text}`);
  const value = JSON.parse(text).access_token;
  if (!value) throw new Error('OAuth token missing');
  return value;
}
// Retry policy mirrors existing successful SI/IF scripts.
export async function suiteql(access, sql, limit = 1000, offset = 0, attempts = 3) {
  const url = `${BASE_URL}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Prefer: 'transient' },
      body: JSON.stringify({ q: sql })
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if (attempt === attempts || ![429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`SuiteQL HTTP ${res.status}: ${text}\nSQL: ${sql}`);
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
  }
}
export async function fetchAll(access, sql, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await suiteql(access, sql, pageSize, offset);
    const items = page.items ?? [];
    rows.push(...items);
    if (!page.hasMore) return rows;
    if (!items.length || offset >= 999000) throw new Error('SuiteQL pagination problem');
  }
}
```

### `common/presence-reconcile.mjs`

**Reconstructed SHA-256:** `80fe48d758c3ef2965460da536eeca5bce84f561af03534120cc3bbf5fbc5ffb`.

```javascript
// Periodic presence reconciliation for deleted/relocated NetSuite transactions.
// Read-only by default. --apply changes backup flags; no destructive SQL.
import { token, BASE_URL } from './netsuite-client.mjs';
import { query, T } from './bigquery-client.mjs';

const MODULES = {
  'sales-invoice': { type: 'CustInvc', header: 'sales_invoice_headers', line: 'sales_invoice_lines', id: 'internal_id', lineFK: 'invoice_internal_id' },
  'item-fulfillment': { type: 'ItemShip', header: 'item_fulfillment_headers', line: 'item_fulfillment_lines', id: 'internal_id', lineFK: 'fulfillment_internal_id' },
  'sales-order': { type: 'SalesOrd', header: 'sales_order_headers', line: 'sales_order_lines', id: 'internal_id', lineFK: 'sales_order_internal_id' }
};
const RANGE = /^\d{4}-\d{2}-\d{2}$/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function suiteql(access, sql, limit = 1000, offset = 0) {
  const url = `${BASE_URL}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;
  for (let n = 0; n < 4; n++) {
    const r = await fetch(url, {method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json',Prefer:'transient'},body:JSON.stringify({q:sql})});
    const txt = await r.text();
    if (r.ok) return JSON.parse(txt);
    if (![429,500,502,503,504].includes(r.status) || n === 3) throw new Error(`NetSuite SuiteQL ${r.status}: ${txt}`);
    await sleep(1000 * (n + 1));
  }
}
async function allRows(access, sql) {
  const out=[];
  for(let offset=0;;offset+=1000){
    const p=await suiteql(access,sql,1000,offset);
    const items=p.items??[];out.push(...items);
    if(!p.hasMore) return out;
    if(items.length===0 || offset>1000000) throw new Error('Invalid SuiteQL pagination');
  }
}
async function verifyById(access, id) {
  const x = Number(id);
  if(!Number.isSafeInteger(x) || x <= 0) throw new Error('Invalid NetSuite ID');
  return allRows(access,`SELECT id, type, TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date FROM Transaction WHERE id = ${x}`);
}
const quoted = ids => ids.map(id => String(Number(id))).join(',');

export async function reconcilePresence(moduleName,{from='2026-10-01',to='2026-11-01',apply=false}={}) {
  const c=MODULES[moduleName];
  if(!c) throw new Error(`Unsupported module: ${moduleName}`);
  if(!RANGE.test(from)||!RANGE.test(to)||from>=to) throw new Error('Invalid period');
  const access=await token();
  const sql=`SELECT id FROM Transaction WHERE type='${c.type}' AND trandate >= TO_DATE('${from}','YYYY-MM-DD') AND trandate < TO_DATE('${to}','YYYY-MM-DD') ORDER BY id`;
  const source=await allRows(access,sql);
  const sourceIds=new Set(source.map(r=>String(r.id)));
  if(sourceIds.size !== source.length || source.length === 0) throw new Error('Unreliable source inventory; aborting');
  const target=await query(`SELECT CAST(internal_id AS STRING) AS id FROM ${T(c.header)} WHERE transaction_date >= DATE '${from}' AND transaction_date < DATE '${to}' AND COALESCE(is_deleted,FALSE)=FALSE`);
  const targetIds=new Set(target.map(r=>String(r.id)));
  if(targetIds.size!==target.length)throw new Error('Duplicate BigQuery header IDs');
  const missing=[...targetIds].filter(id=>!sourceIds.has(id));
  const newIds=[...sourceIds].filter(id=>!targetIds.has(id));
  console.log(`MODULE: ${moduleName} | NetSuite=${sourceIds.size} BQ active=${targetIds.size}`);
  console.log(`ONLY BIGQUERY: ${missing.length} | ONLY NETSUITE: ${newIds.length}`);
  const unresolved=[];const verified=[];
  for(const id of missing){
    const records=await verifyById(access,id);
    if(records.length===0){verified.push({id,reason:'NOT_VISIBLE_IN_NETSUITE'});continue;}
    const r=records[0];
    if(r.type!==c.type || r.transaction_date < from || r.transaction_date >= to){
      verified.push({id,reason:'OUTSIDE_PERIOD_OR_CHANGED_TYPE'});continue;
    }
    unresolved.push(id);
  }
  for(const r of verified)console.log(`MISSING ${r.id}: ${r.reason}`);
  if(unresolved.length)throw new Error(`Source inventory inconsistent for: ${unresolved.join(',')}`);
  if(newIds.length)console.log(`NETSUITE ONLY IDs (requires delta sync / initial recovery): ${newIds.slice(0,50).join(', ')}`);
  if(!apply){console.log('READ ONLY: no BigQuery changes. Run --apply after reviewing results.');return;}
  // SO apply supported after Phase 2C schema and active-only checker migration.
  if(newIds.length) throw new Error('Apply blocked: source records missing in BigQuery; run sync/check first');
  if(missing.length>Math.max(10, Math.ceil(target.length*0.05)))throw new Error('Mass deletion guard triggered');
  if(!verified.length){console.log('No missing records.');return;}
  // Use script-level BigQuery transaction and explicit ID list. Preserve lines for audit.
  const idList = moduleName === 'sales-order'
    ? verified.map(r => `'${String(Number(r.id))}'`).join(',')
    : quoted(verified.map(r=>r.id));
  const statement=`BEGIN TRANSACTION;
    UPDATE ${T(c.header)} SET is_deleted=TRUE, deleted_at=CURRENT_TIMESTAMP()
    WHERE internal_id IN (${idList}) AND COALESCE(is_deleted,FALSE)=FALSE;
    ASSERT (SELECT COUNT(*) FROM ${T(c.header)} WHERE internal_id IN (${idList}) AND is_deleted=TRUE) = ${verified.length} AS 'Flag count mismatch';
    COMMIT TRANSACTION;`;
  await query(statement);
  console.log(`SOFT DELETE FLAGS APPLIED: ${verified.length}. Lines retained for history.`);
}
```

### `common/recovery-controller.mjs`

**Reconstructed SHA-256:** `5903767cdc87fc5db02d3c69a571b804f55eca258b36c259c1b0b31a4d4130d5`.

```javascript
import { inspectDeletionInventory, processVerifiedDeletionBatch } from './verified-deletion-batch.mjs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { parseSoMismatchCandidates } from './so-mismatch-candidates.mjs';
import { detectSourceMovement } from './source-movement.mjs';
// Single recovery controller. --core is internal; do not schedule directly.
async function coreMain() {
// Guarded self-healing workflow. Only NetSuite-only missing/soft-deleted documents
// can be recovered automatically, following catch-up and strict source validation.
// BigQuery-only records, conflicts and accounting mismatches remain review-only.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const modules = ['sales-invoice','item-fulfillment','sales-order','item-receipt','purchase-order','purchase-invoice','sales-return','purchase-return','sales-payment','customer-credit-memo','vendor-credit'];
const [selection,mode] = process.argv.slice(3);
const cfgPath = join(root,'config','self-healing.json');
const config = JSON.parse(readFileSync(cfgPath,'utf8'));
const max = config.maxRecoveryPerModulePerRun;
const verifiedDeletionEnabled = config.verifiedDeletionEnabled === true;
const verifiedIFDeletionEnabled = config.verifiedIFDeletionEnabled === true;
const maxDeletePerRun = 3;
const maxRecoveryPasses = 4; // maximum 12 targeted recoveries per module run
if (!Number.isInteger(max) || max < 1 || max > 10 || typeof config.enabled !== 'boolean' || typeof config.catchUpSync !== 'boolean') throw Error('Invalid self-healing config');
if (process.argv.length !== 5 || !(selection === '--all' || modules.includes(selection)) || !['--sync','--dry-run','--audit-only'].includes(mode)) {
  console.error('Usage: node common/recovery-controller.mjs <--all|sales-invoice|item-fulfillment|sales-order|item-receipt> <--sync|--dry-run|--audit-only>');
  process.exit(2);
}
const selected = selection === '--all' ? modules : [selection];
const summary=[];
function exec(mod, file, argv=[],allowed=[0], withExit=false) {
  const fp=join(root,'modules',mod,file);
  if(!existsSync(fp))throw Error('Missing '+fp);
  console.log(`\n--- ${mod}/${file} ${argv.join(' ')} ---`);
  const r=spawnSync(process.execPath,[fp,...argv],{cwd:root,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024});
  if(r.stdout)process.stdout.write(r.stdout);
  if(r.stderr)process.stderr.write(r.stderr);
  if(r.error)throw r.error;
  if(!allowed.includes(r.status))throw Error(`${mod}/${file} exited ${r.status??r.signal}`);
  const output = r.stdout||'';
  return withExit ? { text: output, exit: r.status } : output;
}
function sync(mod, dry=false) {
  const txt=exec(mod,'sync.mjs',dry?['--dry-run']:[]);
  if(dry && !txt.includes('DRY RUN PASS'))throw Error('Missing dry-run success marker');
  if(!dry && !/(?:SALES INVOICE DELTA SYNC SUCCESS|NO CHANGES: SUCCESS|ITEM FULFILLMENT DELTA SYNC SUCCESS|NO CHANGES\. DELTA SYNC SUCCESS|SALES ORDER SYNC SUCCESS)/.test(txt))throw Error('Missing delta sync success marker');
}
function presence(mod) {
  const text=exec(mod,'presence.mjs');
  const m=text.match(/ONLY BIGQUERY:\s*(\d+)\s*\|\s*ONLY NETSUITE:\s*(\d+)/);
  if(!m||!text.includes('READ ONLY: no BigQuery changes.'))throw Error('Presence output not auditable/read-only');
  const onlyBQ=Number(m[1]), onlyNS=Number(m[2]);
  const match=text.match(/NETSUITE ONLY IDs[^\n]*:\s*([^\n]*)/);
  const ids= match ? match[1].match(/\b\d{1,15}\b/g)||[] : [];
  // Reject incomplete, duplicate and truncated candidate lists; never guess IDs.
  if(onlyNS>0 && (ids.length!==onlyNS || new Set(ids).size!==ids.length)){
    console.log(`REVIEW: presence ID list incomplete (${ids.length}/${onlyNS}); auto-recovery blocked`);
    return {onlyBQ,onlyNS,ids:[],complete:false};
  }
  return {onlyBQ,onlyNS,ids,complete:true};
}
// A transaction can appear between a clean presence check and IF accounting audit.
// Re-run the normal delta sync first; never auto-edit accounting or mark a mismatch PASS.
function auditAccountingWithCatchUp(mod) {
  const attempts = 2; // first audit + one bounded catch-up attempt
  for (let attempt=1; attempt<=attempts; attempt++) {
    let out;
    try {
      out=exec(mod,'reconcile-accounting.mjs');
    } catch(error) {
      // Only the known inventory race can be retried; all other failures remain errors.
      const message=String(error?.message??'');
      if (mode==='--sync' && config.catchUpSync && attempt<attempts &&
          message.includes('reconcile-accounting.mjs exited 1')) {
        console.log('IF ACCOUNTING AUDIT ERROR: checking presence before bounded catch-up');
        const inventory=presence(mod);
        if (inventory.onlyBQ===0 && inventory.onlyNS>0 && inventory.complete) {
          console.log(`IF ACCOUNTING CATCH-UP ${attempt}/${attempts-1}: missing=${inventory.onlyNS}`);
          sync(mod);
          const after=presence(mod);
          if (after.onlyBQ || after.onlyNS) return 'NEEDS_REVIEW';
          continue;
        }
      }
      throw error;
    }
    const x=out.match(/ACCOUNTING RECONCILIATION COMPLETE; differences=(\d+); mode=READ ONLY/);
    if(!x)throw Error('Missing read-only accounting result');
    if(Number(x[1])!==0)return 'NEEDS_REVIEW';
    return 'PASS';
  }
  return 'NEEDS_REVIEW';
}
function recover(mod,id) {
  const dry=exec(mod,'recover.mjs',['--id',id,'--dry-run']);
  if(/ALREADY ACTIVE:\s*NO-OP/.test(dry))return 'already-active';
  if(!/BigQuery header:\s*(?:MISSING|SOFT[_-]DELETED)/.test(dry) ||
     !/SOURCE VALIDATION:\s*PASS/.test(dry) ||
     !/ACTION:\s*(?:RECOVER(?:_MISSING)?|RESTORE)\b/.test(dry) ||
     !/DRY RUN PASS/.test(dry)) throw Error(`Safety gate failed for ${mod} id=${id}`);
  const apply=exec(mod,'recover.mjs',['--id',id,'--apply']);
  if(!/ATOMIC (?:RECOVER(?:_MISSING)?|RESTORE|RECOVERY MERGE).*SUCCESS/.test(apply) &&
     !/ALREADY ACTIVE:\s*NO-OP/.test(apply)) throw Error(`Recovery completion marker absent for ${id}`);
  return 'applied';
}

  function specialDeletionGuard(mod) {
    let inventory = inspectDeletionInventory(mod);

    if (
      mode === '--sync' &&
      verifiedDeletionEnabled &&
      inventory.onlyBigQuery.length > 0
    ) {
      console.log(
        `VERIFIED DELETION CHECK ${mod}: backlog=${inventory.onlyBigQuery.length}`
      );

      processVerifiedDeletionBatch(mod, inventory, { apply: true });
      inventory = inspectDeletionInventory(mod);
    }

    if (
      inventory.onlyBigQuery.length > 0 ||
      inventory.onlyNetSuite.length > 0
    ) {
      console.log(
        `NEEDS REVIEW ${mod}: ONLY BIGQUERY=${inventory.onlyBigQuery.length}; ONLY NETSUITE=${inventory.onlyNetSuite.length}`
      );
      return false;
    }

    console.log(`VERIFIED DELETION INVENTORY CLEAN ${mod}`);
    return true;
  }
for(const mod of selected){
  console.log(`\n========== CORE ${mod.toUpperCase()} | ${mode.toUpperCase()} ==========`);
  try {
    // PO uses its own read-only presence/check interfaces; never call targeted recovery.
    // PI follows the PO guarded full-reconciliation path; no targeted recovery/deletion.
    // Sales Return: existing guarded deletion engine, exact full + financial reconciliation.
    // This module has no targeted recovery; only source-proven header soft deletion.
    if(mod==='vendor-credit') {
      // Vendor Credit: do not mistake NetSuite-only CREATE/UPDATE lag for a deletion.
      // Independently proven BigQuery-only deletion stays guarded and precedes sync.
      // A mixed inventory is ambiguous: fail closed, without changing checkpoints.
      const vcInventory=()=>{
        const result=exec(mod,'deletion-inventory.mjs',['--dry-run'],[0,2],true);
        const line=result.text.split(/\r?\n/).find(x=>x.startsWith('DELETION_INVENTORY_RESULT '));
        if(!line)throw Error('VC deletion inventory marker absent');
        const inv=JSON.parse(line.slice('DELETION_INVENTORY_RESULT '.length));
        if(!Array.isArray(inv.onlyNetSuite)||!Array.isArray(inv.onlyBigQuery)||
           inv.duplicateSource||inv.duplicateTarget||
           !['CLEAN','BLOCKED','CANDIDATES_REQUIRE_INDEPENDENT_PROOF'].includes(inv.status))
          throw Error('VC deletion inventory invalid');
        if(result.exit===2 && inv.status!=='BLOCKED')throw Error('VC unexpected inventory exit');
        return inv;
      };
      const vcSync=()=>{
        const out=exec(mod,'incremental-sync.mjs',[mode]);
        if(mode==='--sync' && !/PHASE B19 (?:PASS_NO_CHANGE:|ATOMIC COMMIT PASS)/.test(out))
          throw Error('VC incremental success marker absent');
        if(mode==='--dry-run' && !out.includes('PHASE B19 DRY RUN PASS: ZERO WRITES'))
          throw Error('VC incremental dry-run marker absent');
      };
      let inv=vcInventory();
      if((inv.onlyNetSuite.length && inv.onlyBigQuery.length) || inv.onlyBigQuery.length>3){
        console.log('VC INVENTORY NEEDS_REVIEW: mixed/oversized mismatch; no unproven deletion');
        summary.push([mod,'NEEDS_REVIEW']);continue;
      }
      if(inv.onlyBigQuery.length){
        const proof=exec(mod,'verified-deletion.mjs',['--dry-run']);
        if(!proof.includes('MODULE 11 VERIFIED DELETION DRY RUN PASS'))
          throw Error('VC independent deletion proof marker absent');
        if(mode==='--sync') {
          const previousConfirm=process.env.NETSUITE_VERIFIED_DELETE_CONFIRM;
          try {
            process.env.NETSUITE_VERIFIED_DELETE_CONFIRM='I_CONFIRM_VERIFIED_SOFT_DELETE';
            const applied=exec(mod,'verified-deletion.mjs',['--apply']);
            if(!applied.includes('MODULE 11 VERIFIED DELETION APPLY PASS'))throw Error('VC deletion apply marker absent');
          } finally {
            if(previousConfirm===undefined)delete process.env.NETSUITE_VERIFIED_DELETE_CONFIRM;
            else process.env.NETSUITE_VERIFIED_DELETE_CONFIRM=previousConfirm;
          }
        } else {
          summary.push([mod,'NEEDS_REVIEW']);continue;
        }
      }
      // Source-only records are normal CREATE/UPDATE lag. Catch up first, then
      // require a fresh independent inventory before any FINAL_PASS verdict.
      if(mode==='--sync'||mode==='--dry-run')vcSync();
      inv=vcInventory();
      if(inv.onlyNetSuite.length || inv.onlyBigQuery.length){
        console.log('VC INVENTORY NEEDS_REVIEW: source/target still moving after bounded sync; next scheduled cycle will retry');
        summary.push([mod,'NEEDS_REVIEW']);continue;
      }
      const presence=exec(mod,'presence.mjs');
      if(!presence.includes('MODULE 11 EXACT PRESENCE PASS'))throw Error('VC presence marker absent');
      const financial=exec(mod,'check-financial.mjs');
      if(!financial.includes('MODULE 11 EXACT FINANCIAL RECONCILIATION PASS'))throw Error('VC financial marker absent');
      const finalInv=vcInventory();
      if(finalInv.onlyNetSuite.length||finalInv.onlyBigQuery.length||finalInv.status!=='CLEAN'){
        console.log('VC FINAL INVENTORY NEEDS_REVIEW: source moved during reconciliation');
        summary.push([mod,'NEEDS_REVIEW']);continue;
      }
      summary.push([mod,mode==='--sync'?'FINAL_PASS':'AUDIT_CLEAN']);
      continue;
    }
    if(mod==='customer-credit-memo') {
      // B9: CCM has no targeted repair. Exact six-table reconciliation is mandatory.
      // No use of the legacy deletion batch; only its standalone exact-proof runner.
      if(mode==='--sync' || mode==='--dry-run') {
        const delta=exec(mod,'incremental-sync.mjs',[mode]);
        const ok=mode==='--sync'
          ? /B6 INCREMENTAL (?:NO_CHANGE:|ATOMIC COMMIT PASS:)/.test(delta)
          : /B6 INCREMENTAL (?:NO_CHANGE:|DRY RUN PASS:)/.test(delta);
        if(!ok)throw Error('CCM incremental success marker absent');
      }
      // No candidate is inferred from BQ absence alone. The CCM proof runner independently
      // checks deletedrecord tuple, current source absence and active BQ header.
      const inventory=exec(mod,'deletion-inventory.mjs',[],[0,3],true);
      const lines=inventory.text.trim().split(/\r?\n/);
      const jsonLine=lines.find(x=>x.trim().startsWith('{') && x.includes('onlyBigQuery'));
      if(!jsonLine)throw Error('CCM deletion inventory missing');
      const d=JSON.parse(jsonLine);
      if(d.sourceDuplicate||d.bigQueryDuplicate || !Array.isArray(d.onlyNetSuite)||!Array.isArray(d.onlyBigQuery))throw Error('CCM deletion inventory invalid');
      if(d.onlyNetSuite.length || d.onlyBigQuery.length) {
        if(mode==='--sync' && d.onlyNetSuite.length===0 && d.onlyBigQuery.length>0) {
          // Fail closed: any proof failure / >3 candidates causes ERROR, never FINAL_PASS.
          const del=exec(mod,'verified-deletion.mjs',['--apply']);
          if(!del.includes('CCM B7 VERIFIED DELETION APPLY PASS:'))throw Error('CCM deletion apply marker absent');
          const after=exec(mod,'deletion-inventory.mjs');
          if(!after.includes('"onlyNetSuite":[]') || !after.includes('"onlyBigQuery":[]'))throw Error('CCM deletion inventory not clean after apply');
        } else {
          console.log('CCM INVENTORY NEEDS_REVIEW: source/BQ mismatch; no inferred deletion');
          summary.push([mod,'NEEDS_REVIEW']);continue;
        }
      }
      const p=exec(mod,'presence.mjs');
      if(!p.includes('B5 EXACT PRESENCE: PASS'))throw Error('CCM six-table presence marker absent');
      let f;
      try {
        f=exec(mod,'check-financial.mjs');
      } catch (error) {
        // Production V3 only. Never repair in --audit-only or --dry-run.
        // Existing bounded source-moving retry remains the fallback for other errors.
        if(mode!=='--sync' || !String(error?.message??'').includes('check-financial.mjs exited 1'))throw error;
        console.log('CCM VERIFIED BOUNDED AUTO REPAIR: full financial check failed');
        const repair=exec(mod,'incremental-sync.mjs',['--repair-audit']);
        if(!/CCM AUTO REPAIR (?:ATOMIC COMMIT PASS:|NO_CHANGE:)/.test(repair))
          throw Error('CCM repair success marker absent');
        // FULL SIX-TABLE RECONCILIATION IS STILL MANDATORY.
        f=exec(mod,'check-financial.mjs');
      }
      if(!f.includes('B5 EXACT FINANCIAL RECONCILIATION: PASS'))throw Error('CCM full exact financial marker absent');
      summary.push([mod,mode==='--sync'?'FINAL_PASS':'AUDIT_CLEAN']);
      continue;
    }
    if(mod==='sales-payment') {
      // Customer Payment: four exact-decimal tables; no targeted recovery.
      // Verified deletion applies only with independent recordtypeid/type proof.
      if(mode==='--sync' || mode==='--dry-run') {
        const output=exec(mod,'sync.mjs',[mode]);
        if(mode==='--dry-run' && !output.includes('DRY RUN PASS: source validated')) throw Error('SP dry run marker absent');
        if(mode==='--sync' && !output.includes('SALES PAYMENT SYNC SUCCESS; RUN reconciliation checks; NOT FINAL_PASS')) throw Error('SP sync marker absent');
      }
      if(!specialDeletionGuard(mod)) {summary.push([mod,'NEEDS_REVIEW']);continue;}
      const p=exec(mod,'presence.mjs',[],[0,3],true);
      if(p.exit===3) {
        if(!p.text.includes('SALES PAYMENT PRESENCE NEEDS_REVIEW')) throw Error('SP presence review marker absent');
        console.log('SP SOURCE MOVEMENT: presence needs review; no false ERROR or FINAL_PASS');
        summary.push([mod,'NEEDS_REVIEW']);
        continue;
      }
      if(!p.text.includes('SALES PAYMENT PRESENCE PASS')) throw Error('SP presence marker absent');
      const c=exec(mod,'check.mjs',[],[0,3],true);
      if(c.exit===3) {
        if(!c.text.includes('SALES PAYMENT CHECK NEEDS_REVIEW')) throw Error('SP check review marker absent');
        console.log('SP SOURCE MOVEMENT: field check needs review; no false ERROR or FINAL_PASS');
        summary.push([mod,'NEEDS_REVIEW']);
        continue;
      }
      if(!c.text.includes('SALES PAYMENT CHECK PASS')) throw Error('SP full check marker absent');
      const a=exec(mod,'check-financial.mjs');
      if(!a.includes('SALES PAYMENT FINANCIAL CHECK PASS')) throw Error('SP financial check marker absent');
      summary.push([mod,mode==='--sync'?'FINAL_PASS':'AUDIT_CLEAN']);
      continue;
    }
    if(mod==='purchase-return') {
      const gate=exec(mod,'scheduler-gate.mjs');
      if(gate.includes('PURCHASE RETURN GATE: NO_SOURCE')) {
        summary.push([mod,'NO_SOURCE']);
        continue;
      }
      if(gate.includes('PURCHASE RETURN GATE: SOURCE_PENDING_INITIAL_SYNC')) {
        console.log('PURCHASE RETURN FIRST SOURCE: initial production sync requires manual validation; no writes');
        summary.push([mod,'NEEDS_REVIEW']);
        continue;
      }
      if(!gate.includes('PURCHASE RETURN GATE: READY'))throw Error('Purchase Return gate status missing');
      if(mode==='--sync' || mode==='--dry-run') {
        const output=exec(mod,'sync.mjs',[mode]);
        if(mode==='--dry-run' && !output.includes('DRY RUN PASS: source validated'))throw Error('PR dry-run marker absent');
        if(mode==='--sync' && !/(?:PURCHASE RETURN SYNC SUCCESS; RUN presence\/check\/check-financial; NOT FINAL_PASS|PURCHASE RETURN NO CHANGES: SUCCESS)/.test(output))throw Error('PR sync marker absent');
      }
      if(!specialDeletionGuard(mod)) {summary.push([mod,'NEEDS_REVIEW']);continue;}
      const p=exec(mod,'presence.mjs');
      const c=exec(mod,'check.mjs');
      const a=exec(mod,'check-financial.mjs');
      if(!p.includes('PRESENCE PASS: initialized target reconciled') ||
         !c.includes('CHECK PASS: initialized target reconciled') ||
         !a.includes('FINANCIAL PASS: initialized target reconciled'))throw Error('PR reconciliation marker absent');
      summary.push([mod,mode==='--sync'?'FINAL_PASS':'AUDIT_CLEAN']);
      continue;
    }
    if(mod==='sales-return') {
      if(mode==='--sync' || mode==='--dry-run') {
        const output=exec(mod,'sync.mjs',[mode]);
        if(mode==='--dry-run' && !output.includes('DRY RUN PASS: source validated'))throw Error('SR dry run marker absent');
        if(mode==='--sync' && !/(?:SALES RETURN SYNC SUCCESS|SALES RETURN NO CHANGES: SUCCESS)/.test(output))throw Error('SR sync marker absent');
      }
      if (!specialDeletionGuard(mod)) {
        summary.push([mod,'NEEDS_REVIEW']);
        continue;
      }
      const p=exec(mod,'presence.mjs');
      if(!p.includes('SALES RETURN PRESENCE PASS'))throw Error('SR presence marker absent');
      const check=exec(mod,'check.mjs');
      if(!check.includes('SALES RETURN CHECK PASS'))throw Error('SR full check marker absent');
      const financial=exec(mod,'check-financial.mjs');
      if(!financial.includes('SALES RETURN FINANCIAL CHECK PASS'))throw Error('SR financial check marker absent');
      summary.push([mod,mode==='--sync'?'FINAL_PASS':'AUDIT_CLEAN']);
      continue;
    }
    if(mod==='purchase-invoice') {
      if(mode==='--sync' || mode==='--dry-run') {
        const output=exec(mod,'sync.mjs',[mode]);
        if(mode==='--dry-run' && !output.includes('DRY RUN PASS: source validated'))throw Error('PI dry run marker absent');
        if(mode==='--sync' && !/(?:VENDOR BILL SYNC SUCCESS; RUN reconciliation checks; NOT FINAL_PASS|VENDOR BILL NO CHANGES: SUCCESS)/.test(output))throw Error('PI sync marker absent');
      }
      if (!specialDeletionGuard(mod)) {
        summary.push([mod,'NEEDS_REVIEW']);
        continue;
      }
      const presenceResult=exec(mod,'presence.mjs');
      if(!presenceResult.includes('PURCHASE INVOICE PRESENCE PASS'))throw Error('PI presence marker absent');
      const checkResult=exec(mod,'check.mjs');
      if(!checkResult.includes('PURCHASE INVOICE CHECK PASS'))throw Error('PI check marker absent');
      summary.push([mod,mode==='--sync'?'FINAL_PASS':'AUDIT_CLEAN']);
      continue;
    }
    if(mod==='purchase-order') {
      if(mode==='--sync' || mode==='--dry-run') {
        const output=exec(mod,'sync.mjs',[mode]);
        if(mode==='--dry-run' && !output.includes('DRY RUN PASS: no BigQuery write'))throw Error('PO dry run marker absent');
        if(mode==='--sync' && !/(?:PURCHASE ORDER SYNC SUCCESS; RUN check\.mjs \+ presence\.mjs; NOT FINAL_PASS|PURCHASE ORDER NO CHANGES: SUCCESS)/.test(output))throw Error('PO sync marker absent');
      }
      // Both validation scripts must exit 0 and emit their exact PASS marker.
      // Missing/extra source rows remain NEEDS_REVIEW, never auto-deleted or repaired.
      if (!specialDeletionGuard(mod)) {
        summary.push([mod,'NEEDS_REVIEW']);
        continue;
      }
      const presenceResult=exec(mod,'presence.mjs');
      if(!presenceResult.includes('PURCHASE ORDER PRESENCE PASS'))throw Error('PO presence marker absent');
      const checkResult=exec(mod,'check.mjs');
      if(!checkResult.includes('PURCHASE ORDER CHECK PASS'))throw Error('PO field-by-field check marker absent');
      summary.push([mod,mode==='--sync'?'FINAL_PASS':'AUDIT_CLEAN']);
      continue;
    }
    if(mod==='item-receipt') {
      if(mode==='--sync' || mode==='--dry-run') {
        const irsync=exec(mod,'sync.mjs',[mode]);
        if(mode==='--sync' && !/(?:ITEM RECEIPT SYNC SUCCESS|ITEM RECEIPT NO CHANGES: SUCCESS)/.test(irsync)) throw Error('IR success marker absent');
        if(mode==='--dry-run' && !irsync.includes('DRY RUN PASS')) throw Error('IR dry-run marker absent');
      }
      if (!specialDeletionGuard(mod)) {
        summary.push([mod,'NEEDS_REVIEW']);
        continue;
      }
      if(mode==='--sync') {
        const check=exec(mod,'check.mjs');
        if(!check.includes('ITEM RECEIPT CHECK: PASS')) throw Error('IR integrity check marker absent');
        const detail=exec(mod,'check-financial.mjs');
        if(!detail.includes('ITEM RECEIPT FINANCIAL DETAIL CHECK: PASS')) throw Error('IR financial detail marker absent');
        console.log('IR SCOPE: count/presence/line financial DETAIL verified; header GL accounting book NOT certified.');
        summary.push([mod,'FINAL_PASS']);
      } else {
        console.log('IR AUDIT: financial detail not certified outside --sync');
        summary.push([mod,'AUDIT_CLEAN']);
      }
      continue;
    }
    if(mode==='--dry-run'||mode==='--sync')sync(mod,mode==='--dry-run');
    let p=presence(mod);
    if(mode==='--sync' && (p.onlyBQ||p.onlyNS) && config.catchUpSync){
      console.log(`SELF-HEAL catch-up sync ${mod}`);
      sync(mod);
      p=presence(mod);
    }
    // CORE: A bounded portion of a large deletion backlog is considered every run.
    // NEVER infer deletion from an absent SuiteQL Transaction row: use deletedrecord proof.
    const allowDelete = verifiedDeletionEnabled &&
      (['sales-invoice','sales-order'].includes(mod) || (mod==='item-fulfillment' && verifiedIFDeletionEnabled));
    if(mode==='--sync' && allowDelete && p.onlyBQ>0){
      const auditText=exec(mod,'presence.mjs');
      const missing=[...auditText.matchAll(/^MISSING (\d+): NOT_VISIBLE_IN_NETSUITE$/gm)].map(m=>m[1]);
      if(missing.length===p.onlyBQ && new Set(missing).size===missing.length){
        const fp=join(root,'scripts','verified-deletion.mjs');
        if(!existsSync(fp))throw Error('Missing verified-deletion script');
        let processed=0;
        for(const id of missing.slice(0,maxDeletePerRun)){
          const dry=spawnSync(process.execPath,[fp,'--module',mod,'--id',id,'--dry-run'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
          if(dry.stdout)process.stdout.write(dry.stdout);
          if(dry.stderr)process.stderr.write(dry.stderr);
          if(dry.error || dry.status!==0 || !dry.stdout?.includes('DRY RUN PASS')){
            console.log(`VERIFIED DELETION BLOCKED: id=${id} lacks valid proof; skipped`);
            continue;
          }
          const applied=spawnSync(process.execPath,[fp,'--module',mod,'--id',id,'--apply'],{
            cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,
            env:{...process.env,NETSUITE_VERIFIED_DELETE_CONFIRM:'I_CONFIRM_VERIFIED_SOFT_DELETE'}
          });
          if(applied.stdout)process.stdout.write(applied.stdout);
          if(applied.stderr)process.stderr.write(applied.stderr);
          if(applied.error || applied.status!==0 || !applied.stdout?.includes('VERIFIED SOFT DELETE PASS')){
            console.log(`VERIFIED DELETION FAILED: id=${id}; module remains reviewable`);
          } else processed++;
        }
        console.log(`VERIFIED DELETION BATCH: ${processed}/${Math.min(missing.length,maxDeletePerRun)} applied; backlog before batch=${missing.length}`);
        p=presence(mod);
      } else console.log('VERIFIED DELETION BLOCKED: incomplete or ambiguous source inventory');
    }
    // A large NetSuite-only backlog is recovered in independently validated batches.
    // Still do not recover while unverified BigQuery-only conflicts remain.
    if(mode==='--sync' && config.enabled && p.onlyBQ===0 && p.onlyNS>0 && p.complete){
      for(let pass=0;pass<maxRecoveryPasses && p.onlyBQ===0 && p.onlyNS>0;pass++){
        if(!p.complete || p.ids.length!==p.onlyNS)break;
        const batch=p.ids.slice(0,max);
        console.log(`SELF-HEAL batch ${pass+1}/${maxRecoveryPasses}, IDs=${batch.join(',')}; remaining=${p.onlyNS}`);
        for(const id of batch)console.log(`SELF-HEAL ${mod} ${id}: ${recover(mod,id)}`);
        const next=presence(mod);
        if(next.onlyNS>=p.onlyNS && next.onlyBQ===0){
          console.log('SELF-HEAL no progress; stopping bounded batches');p=next;break;
        }
        p=next;
      }
    }
    if(p.onlyBQ||p.onlyNS){
      console.log(`NEEDS REVIEW: ONLY BIGQUERY=${p.onlyBQ}; ONLY NETSUITE=${p.onlyNS}. No auto-delete.`);
      summary.push([mod,'NEEDS_REVIEW']);continue;
    }
    if(mod==='item-fulfillment'){
      const accounting=auditAccountingWithCatchUp(mod);
      if(accounting!=='PASS'){
        console.log('NEEDS REVIEW: IF accounting/inventory mismatch persists. No automatic COGS modification.');
        summary.push([mod,'NEEDS_REVIEW']);continue;
      }
    }
    if(mode==='--sync'){
      const out=exec(mod,'check.mjs');
      if(!out.includes('CHECK: PASS'))throw Error('Final reconciliation marker absent');
    } else console.log('Full KPI check skipped outside --sync');
    summary.push([mod,mode==='--sync'?'FINAL_PASS':'AUDIT_CLEAN']);
  }catch(e){console.error(`MODULE ERROR (${mod}): ${e.message}`);summary.push([mod,'ERROR']);}
}
console.log('\n========== CORE SUMMARY ==========');
for(const [mod,status] of summary)console.log(`${mod}: ${status}`);
console.log(`SAFETY: verified SI/SO deletion ${verifiedDeletionEnabled?'ENABLED':'DISABLED'}, IF deletion ${verifiedIFDeletionEnabled?'ENABLED':'DISABLED'} (independent NetSuite proof required); no automatic accounting repair.`);
if(summary.some(([,s])=>s==='ERROR'))process.exitCode=1;
else if(summary.some(([,s])=>s==='NEEDS_REVIEW'))process.exitCode=3;

}

async function recoveryMain() {
// RECOVERY candidate: RECOVERY guarded recovery + SO mismatch key parser, no scheduler changes.
// Invoke under scheduler-runner shared lock. NEVER run concurrently with fast-delta.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const selection = process.argv[2];
const mode = process.argv[3];
const modules = ['sales-invoice','item-fulfillment','sales-order','item-receipt','purchase-order','purchase-invoice','sales-return','purchase-return','sales-payment','customer-credit-memo','vendor-credit'];
if (process.argv.length !== 4 || !(selection === '--all' || modules.includes(selection)) || !['--sync','--dry-run','--audit-only'].includes(mode)) {
  console.error('Usage: node common/recovery-controller.mjs <--all|module> <--sync|--dry-run|--audit-only>');
  process.exit(2);
}
const selected=selection==='--all'?modules:[selection];
const base=fileURLToPath(import.meta.url);
function run(file,args,shown=true) {
  if (!existsSync(file)) throw Error(`Missing file ${file}`);
  const result=spawnSync(process.execPath,[file,...args],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:96*1024*1024});
  if(shown) { if(result.stdout) process.stdout.write(result.stdout); if(result.stderr) process.stderr.write(result.stderr); }
  if(result.error || result.signal) throw Error(`${file} execution failed: ${result.error?.message??result.signal}`);
  return {exit:result.status,out:result.stdout??'',err:result.stderr??''};
}
function status(mod,out) {
  const escaped=mod.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const m=out.match(new RegExp(`^${escaped}: (FINAL_PASS|NEEDS_REVIEW|ERROR|AUDIT_CLEAN|NO_SOURCE)$`,'m'));
  if(!m)throw Error(`Missing workflow result for ${mod}`);
  return m[1];
}
function verifySummary(result,mod) {
  const s=status(mod,result.out);
  if(s==='FINAL_PASS' && result.exit!==0)throw Error('Conflicting final status/exit code');
  return s;
}

const states=[];
for(const mod of selected){
  try {
    console.log(`\n====== RECOVERY ${mod} ${mode} ======`);
    // Modes other than --sync are strictly delegated read-only.
    if(mode!=='--sync') {
      const a=run(base,['--core',mod,mode]);
      states.push([mod,verifySummary(a,mod)]);
      continue;
    }
    let result=run(base,['--core',mod,'--sync']);
    let current=verifySummary(result,mod);
    const firstAttempt = result;
    if(current==='FINAL_PASS' || current==='NO_SOURCE'){states.push([mod,current]);continue;}
    // Source may move between delta and full check. Do one fresh catch-up pass
    // before diagnosing a stable inconsistency. No unbounded loops.
    console.log(`RECOVERY SOURCE-MOVING RETRY ${mod}: first=${current}; bounded re-sync`);
    result=run(base,['--core',mod,'--sync']);
    current=verifySummary(result,mod);
    if(current==='FINAL_PASS' || current==='NO_SOURCE'){states.push([mod,current]);continue;}
    // A proven moving NetSuite KPI means this comparison was not a stable snapshot.
    // Classify as pending review, NEVER as FINAL_PASS; let the next scheduled
    // reconciliation verify a quiet snapshot. Unchanged/unknown source remains
    // an actual error and is not hidden.
    const movement = detectSourceMovement(mod, firstAttempt.out, result.out);
    if(movement.moving){
      console.log(`SOURCE_MOVING_DETECTED ${mod}: changed=${movement.changed.join(',')}; defer full verification; no checkpoint changes`);
      states.push([mod,'NEEDS_REVIEW']);
      continue;
    }
    if(mod==='item-fulfillment' && current==='NEEDS_REVIEW' && /ACCOUNTING RECONCILIATION COMPLETE; differences=[1-9]\d*; mode=READ ONLY/.test(result.out)) {
      const path=join(root,'modules',mod,'repair-accounting-bounded.mjs');
      const dry=run(path,[],true);
      if(dry.exit===0 && dry.out.includes('ACCOUNTING DRY RUN PASS: no changes')) {
        const applied=run(path,['--apply']);
        if(applied.exit===0 && applied.out.includes('IF ACCOUNTING AUTO RECOVERY PASS')) {
          result=run(base,['--core',mod,'--sync']);
          current=verifySummary(result,mod);
        } else {
          current='NEEDS_REVIEW';

          // Accounting repair may have committed successfully while
          // NetSuite inventory changed during the final full audit.
          // Perform one bounded catch-up through the existing core workflow.
          // Never bypass accounting validation or force FINAL_PASS.
          const inventoryMoved =
            applied.out.includes('Document inventory mismatch') ||
            applied.err.includes('Document inventory mismatch');

          const repairCommitted =
            /ACCOUNTING REPAIRED: [1-9][0-9]*/.test(applied.out);

          if(inventoryMoved && repairCommitted) {
            console.log(
              'IF ACCOUNTING INVENTORY MOVED: automatic bounded catch-up'
            );

            const catchup=run(base,['--core',mod,'--sync']);
            const catchupStatus=verifySummary(catchup,mod);

            if(catchupStatus==='FINAL_PASS') {
              result=catchup;
              current='FINAL_PASS';
              console.log('IF ACCOUNTING CATCH-UP: FINAL_PASS');
            } else {
              current='NEEDS_REVIEW';
              console.log(
                'IF ACCOUNTING CATCH-UP: NEEDS_REVIEW; defer to next scheduled cycle'
              );
            }
          }
        }
      } else current='NEEDS_REVIEW';
    }
    if(mod==='sales-order' && current==='ERROR' && result.out.includes('SALES ORDER CHECK: FAIL')) {
      // Ensure presence is currently clean: do not use a field repair to disguise
      // missing/deleted transactions or an incomplete inventory.
      const p=run(join(root,'modules',mod,'presence.mjs'),[]);
      const clean=p.exit===0 && /ONLY BIGQUERY:\s*0\s*\|\s*ONLY NETSUITE:\s*0/.test(p.out);
      const parsed=parseSoMismatchCandidates(result.out,8);
      const ids=parsed.ok?parsed.ids:null;
      console.log(`RECOVERY SO PARSER: ${parsed.reason}; ids=${ids?.join(',') ?? 'NONE'}`);
      if(clean && ids?.length && ids.length<=8) {
        console.log(`RECOVERY SO guarded refresh candidates=${ids.join(',')}`);
        let safe=true;
        for(const id of ids){
          const file=join(root,'modules',mod,'repair-active.mjs');
          const dry=run(file,['--id',id,'--dry-run']);
          if(dry.exit!==0 || !dry.out.includes('DRY RUN PASS')){safe=false;break;}
        }
        if(safe){
          for(const id of ids){
            const applied=run(join(root,'modules',mod,'repair-active.mjs'),['--id',id,'--apply']);
            if(applied.exit!==0 || !applied.out.includes('ATOMIC REFRESH: SUCCESS')){safe=false;break;}
          }
          if(safe) {
            result=run(base,['--core',mod,'--sync']);
            current=verifySummary(result,mod);
          }
        }
      } else console.log('RECOVERY SO guarded refresh BLOCKED: presence unclean or incomplete/large mismatch list');
    }
    states.push([mod,current]);
  }catch(e){console.error(`RECOVERY MODULE ERROR ${mod}: ${e.message}`);states.push([mod,'ERROR']);}
}
console.log('\n========== RECOVERY SUMMARY ==========');
for(const [mod,s] of states)console.log(`${mod}: ${s}`);
if(states.some(([,s])=>s==='ERROR'))process.exitCode=1;
else if(states.some(([,s])=>s==='NEEDS_REVIEW'))process.exitCode=3;

}

if (process.argv[2] === '--core') await coreMain();
else await recoveryMain();
```

### `common/shared-lock.mjs`

**Reconstructed SHA-256:** `f1258bd1b93e9d4a920607d77d37261eeef71c2e0cf5d133d61755ad958e10b1`.

```javascript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export function createSharedLock({
  stateDir,
  worker,
  minStaleMs = 120000,
  now = () => Date.now(),
  isAlive = defaultIsAlive
}) {
  if (!stateDir || !worker) {
    throw Error('stateDir and worker required');
  }

  const lockDir = path.join(stateDir, '.running.lock');
  const guardDir = path.join(stateDir, '.lock-maintenance.guard');
  const archiveDir = path.join(stateDir, 'stale-lock-archives');
  const auditFile = path.join(stateDir, 'shared-lock-audit.jsonl');

  const identity = {
    pid: process.pid,
    host: os.hostname(),
    token: crypto.randomUUID(),
    startedAt: new Date(now()).toISOString(),
    worker
  };

  let owned = false;

  function audit(event, detail = {}) {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.appendFileSync(
      auditFile,
      JSON.stringify({
        at: new Date(now()).toISOString(),
        event,
        worker,
        pid: process.pid,
        ...detail
      }) + '\n'
    );
  }

  function readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  function sameOwner(a, b) {
    return !!(
      a && b &&
      a.pid === b.pid &&
      a.host === b.host &&
      a.token === b.token &&
      a.startedAt === b.startedAt
    );
  }

  function validOwner(owner) {
    return !!(
      owner &&
      owner.host === os.hostname() &&
      Number.isInteger(owner.pid) &&
      owner.pid > 0 &&
      typeof owner.token === 'string' &&
      owner.token.length > 0 &&
      Number.isFinite(Date.parse(owner.startedAt))
    );
  }

  function readLockOwner() {
    return readJson(path.join(lockDir, 'owner.json'));
  }

  function readGuardOwner() {
    return readJson(path.join(guardDir, 'owner.json'));
  }

  function withGuard(callback) {
    fs.mkdirSync(stateDir, { recursive: true });

    try {
      fs.mkdirSync(guardDir);
    } catch (error) {
      if (error.code === 'EEXIST') {
        return {
          acquired: false,
          released: false,
          reason: 'GUARD_BUSY'
        };
      }
      throw error;
    }

    const guardIdentity = {
      ...identity,
      guardToken: crypto.randomUUID(),
      createdAt: new Date(now()).toISOString()
    };

    // If metadata creation fails, leave the guard in place.
    // Never make an uncertain guard available automatically.
    fs.writeFileSync(
      path.join(guardDir, 'owner.json'),
      JSON.stringify(guardIdentity),
      { flag: 'wx' }
    );

    try {
      return callback();
    } finally {
      const current = readGuardOwner();

      if (sameOwner(guardIdentity, current) &&
          current.guardToken === guardIdentity.guardToken) {
        try {
          fs.rmSync(guardDir, {
            recursive: true,
            force: true
          });
        } catch (error) {
          console.error(
            'GUARD CLEANUP NEEDS REVIEW:',
            error.message
          );
        }
      } else {
        console.error(
          'GUARD OWNER MISMATCH: cleanup blocked'
        );
      }
    }
  }

  function acquire() {
    return withGuard(() => {
      if (!fs.existsSync(lockDir)) {
        fs.mkdirSync(lockDir);

        fs.writeFileSync(
          path.join(lockDir, 'owner.json'),
          JSON.stringify(identity),
          { flag: 'wx' }
        );

        owned = true;
        audit('ACQUIRED', { owner: identity });

        return {
          acquired: true,
          reason: 'ACQUIRED'
        };
      }

      const owner = readLockOwner();

      if (!validOwner(owner)) {
        audit('UNKNOWN_LOCK_OWNER', { owner });

        return {
          acquired: false,
          reason: 'UNKNOWN_OWNER'
        };
      }

      const ageMs = now() - Date.parse(owner.startedAt);

      if (ageMs < 0 || ageMs < minStaleMs) {
        return {
          acquired: false,
          reason: 'LOCK_HELD_RECENT'
        };
      }

      if (isAlive(owner.pid)) {
        return {
          acquired: false,
          reason: 'LOCK_OWNER_ALIVE'
        };
      }

      const verified = readLockOwner();

      if (!sameOwner(owner, verified)) {
        audit('LOCK_OWNER_CHANGED');

        return {
          acquired: false,
          reason: 'OWNER_CHANGED'
        };
      }

      fs.mkdirSync(archiveDir, { recursive: true });

      const archive = path.join(
        archiveDir,
        'stale-' + now() + '-' + crypto.randomUUID()
      );

      fs.renameSync(lockDir, archive);

      audit('STALE_ARCHIVED', {
        previousOwner: owner,
        archive
      });

      return {
        acquired: false,
        reason: 'STALE_ARCHIVED',
        archive
      };
    });
  }

  function release() {
    if (!owned) {
      return {
        released: false,
        reason: 'NOT_OWNED'
      };
    }

    return withGuard(() => {
      const current = readLockOwner();

      if (!sameOwner(identity, current)) {
        audit('RELEASE_OWNER_MISMATCH');

        return {
          released: false,
          reason: 'OWNER_MISMATCH'
        };
      }

      fs.rmSync(lockDir, {
        recursive: true,
        force: true
      });

      owned = false;
      audit('RELEASED');

      return {
        released: true,
        reason: 'RELEASED'
      };
    });
  }

  function inspect() {
    return {
      lockExists: fs.existsSync(lockDir),
      lockOwner: readLockOwner(),
      guardExists: fs.existsSync(guardDir),
      guardOwner: readGuardOwner(),
      ownedByCurrentWorker: owned
    };
  }

  return { acquire, release, inspect };
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}
```

### `common/so-mismatch-candidates.mjs`

**Reconstructed SHA-256:** `0e5279c5590fdc29e4e92278f6c8623266fd5a400aa5689a8224d43fa2f84de7`.

```javascript
// Pure parser of verified SO checker mismatch examples. No writes or side effects.
export function parseSoMismatchCandidates(output, maxIds = 8) {
  if (typeof output !== 'string') return {ok:false,reason:'INVALID_OUTPUT',ids:[]};
  const matches = [...output.matchAll(/^Mismatch examples:\s*([^\r\n]+)$/gm)];
  if (matches.length !== 1) return {ok:false,reason:'MISSING_OR_AMBIGUOUS_EXAMPLES',ids:[]};
  const parts = matches[0][1].split(/,\s*/).map(x=>x.trim());
  if (!parts.length || parts.length > 100 || parts.some(x=>!x)) return {ok:false,reason:'INVALID_EXAMPLES',ids:[]};
  const ids = new Set();
  for (const part of parts) {
    // MISSING LINE/EXTRA LINE are mismatched keys, not evidence of deleted transactions.
    const match = /^(?:HEADER|LINE|EXTRA LINE|MISSING LINE)\s+([1-9]\d{0,14})(?::[1-9]\d*)?$/.exec(part);
    if (!match) return {ok:false,reason:`UNRECOGNIZED_EXAMPLE:${part}`,ids:[]};
    ids.add(match[1]);
  }
  if (!ids.size || ids.size > maxIds) return {ok:false,reason:'TOO_MANY_IDS',ids:[]};
  return {ok:true,reason:'PARSED',ids:[...ids]};
}
```

### `common/source-movement.mjs`

**Reconstructed SHA-256:** `be4bf277ac71f439d37dfc9fd3a2854d055c163b510fa97ff44bad48d0756140`.

```javascript
// Read-only evidence that the NetSuite source changed between two reconciliation attempts.
// This is NOT a consistent snapshot; never use it to certify FINAL_PASS.
const rules = {
  'sales-invoice': [
    ['headers', /NetSuite COUNT\s*:\s*(\d+)/i],
    ['headerTotal', /NetSuite TOTAL\s*:\s*([-\d.]+)/i],
    ['lines', /NetSuite LINE COUNT\s*:\s*(\d+)/i],
    ['lineTotal', /NetSuite LINE AMOUNT\s*:\s*([-\d.]+)/i],
  ],
  'sales-order': [
    ['inventory', /NetSuite:\s*headers=(\d+),\s*lines=(\d+)/i],
    ['headerTotal', /HEADER TOTAL EXACT CENTS\s*:\s*(?:PASS|FAIL)\s*\|\s*NetSuite=([-\d.]+)/i],
    ['rawLineAmount', /RAW LINE AMOUNT MATCH\s*:\s*(?:PASS|FAIL)\s*\|\s*NS signed=([-\d.]+)/i],
  ],
  'item-fulfillment': [
    ['inventory', /NetSuite=(\d+),\s*BQ active=\d+/i],
    ['headers', /NetSuite COUNT\s*:\s*(\d+)/i],
    ['headerCogs', /NetSuite COGS\s*:\s*([-\d.]+)/i],
    ['lines', /NetSuite LINES\s*:\s*(\d+)/i],
  ],
};

export function sourceEvidence(mod, output) {
  const result = {};
  for (const [key, regex] of rules[mod] ?? []) {
    const matches = [...String(output ?? '').matchAll(new RegExp(regex.source, 'gi'))];
    if (matches.length) result[key] = matches.at(-1).slice(1).join('/');
  }
  return result;
}

export function detectSourceMovement(mod, beforeOutput, afterOutput) {
  const before = sourceEvidence(mod, beforeOutput);
  const after = sourceEvidence(mod, afterOutput);
  const changed = Object.keys(before).filter(key =>
    Object.hasOwn(after, key) && before[key] !== after[key]
  );
  return {moving:changed.length > 0, changed, before, after};
}
```

### `common/sync-utils.mjs`

**Reconstructed SHA-256:** `4de8e5ffa5ec52de13664a732bdbafd19864830b730339fbb5666833c9f73617`.

```javascript
// Shared, semantics-preserving helpers for future module additions.
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function chunks(rows, size) {
  if (!Number.isInteger(size) || size <= 0) throw new Error('Invalid chunk size');
  const result = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
}
export function subtractMinutes(datetime, minutes = 5) {
  const date = new Date(String(datetime).replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) throw new Error('Invalid datetime: ' + datetime);
  date.setUTCMinutes(date.getUTCMinutes() - minutes);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
```

### `common/targeted-recovery.mjs`

**Reconstructed SHA-256:** `ee6bf0da6a5385c5dcf8f62c316fd7fa5f39366de4d9e669ba6cec8caca2719b`.

```javascript
// Phase 2B: targeted transaction recovery diagnosis, deliberately READ ONLY.
// Run from C:\netsuite-backup. Does not change NetSuite, BigQuery, checkpoints or lines.
import { token, BASE_URL } from './netsuite-client.mjs';
import { query, T } from './bigquery-client.mjs';

const modules = {
  'sales-invoice': { type:'CustInvc', header:'sales_invoice_headers', lines:'sales_invoice_lines', lineId:'invoice_internal_id', softDelete:true },
  'item-fulfillment': { type:'ItemShip', header:'item_fulfillment_headers', lines:'item_fulfillment_lines', lineId:'fulfillment_internal_id', softDelete:true },
  'sales-order': { type:'SalesOrd', header:'sales_order_headers', lines:'sales_order_lines', lineId:'sales_order_internal_id', softDelete:false }
};
const [moduleName, rawId, ...flags] = process.argv.slice(2);
if (!modules[moduleName] || !/^[1-9][0-9]{0,14}$/.test(rawId ?? '') || flags.some(x=>x !== '--dry-run')) {
  console.error('Usage: node common/targeted-recovery.mjs <sales-invoice|item-fulfillment|sales-order> <internal_id> [--dry-run]');
  process.exit(2);
}
const c = modules[moduleName];
const id = rawId;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function suiteql(access, q) {
  const url = `${BASE_URL}/services/rest/query/v1/suiteql?limit=100&offset=0`;
  for (let attempt=1;attempt<=4;attempt++) {
    const response = await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json',Prefer:'transient'},body:JSON.stringify({q})});
    const body = await response.text();
    if (response.ok) {
      const parsed=JSON.parse(body);
      if (parsed.hasMore) throw new Error('Unexpected >100 source rows for a single ID');
      return parsed.items??[];
    }
    if (![429,500,502,503,504].includes(response.status) || attempt===4) throw new Error(`SuiteQL HTTP ${response.status}: ${body.slice(0,500)}`);
    await sleep(attempt*1000);
  }
}
async function main() {
  console.log(`TARGETED RECOVERY AUDIT | ${moduleName.toUpperCase()} | ID ${id} | READ ONLY`);
  const access = await token();
  const ns = await suiteql(access, `SELECT id, tranid, type, TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date, TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified FROM Transaction WHERE id=${id}`);
  const modifiedCol = moduleName === 'sales-order' ? 'last_modified' : 'netsuite_last_modified_at';
  const idPredicate = moduleName === 'sales-order' ? `internal_id='${id}'` : `internal_id=${id}`;
  const rows = await query(`SELECT CAST(internal_id AS STRING) AS id, CAST(transaction_date AS STRING) AS transaction_date, ${c.softDelete?'COALESCE(is_deleted,FALSE)':'FALSE'} AS is_deleted, CAST(${modifiedCol} AS STRING) AS last_modified FROM ${T(c.header)} WHERE ${idPredicate}`);
  if (ns.length>1 || rows.length>1) throw new Error('Unexpected duplicate header for internal ID');
  const source=ns[0]??null, backup=rows[0]??null;
  console.log('NetSuite:', source ? JSON.stringify(source) : 'NOT_VISIBLE (not proof of deletion)');
  console.log('BigQuery:',backup ? JSON.stringify(backup) : 'MISSING');
  let classification;
  if (source && source.type !== c.type) classification='TYPE_CHANGED_OR_WRONG_MODULE';
  else if (!source && !backup) classification='NOT_FOUND_IN_EITHER_SOURCE';
  else if (!source) classification='BIGQUERY_ONLY_VERIFY_UI_PERMISSIONS_PERIOD';
  else if (!backup) classification='RECOVERY_CANDIDATE_MISSING_HEADER';
  else if (backup.is_deleted === true || String(backup.is_deleted).toLowerCase()==='true') classification='RESTORE_CANDIDATE_SOFT_DELETED';
  else if (String(source.transaction_date)!==String(backup.transaction_date)) classification='PERIOD_OR_DATE_RELOCATION_CANDIDATE';
  else if (String(source.last_modified)!==String(backup.last_modified)) classification='TIMESTAMP_DIFFERENCE_REVIEW_DELTA_SYNC';
  else classification='HEADER_PRESENCE_AND_TIMESTAMP_MATCH_NOT_A_FULL_KPI_CHECK';
  console.log('CLASSIFICATION:',classification);
  // This intentionally does not compare raw NetSuite transaction lines with mapped BigQuery lines:
  // the three modules use different line filters and accounting calculations.
  console.log('NO CHANGES: headers, lines, checkpoints and historical data preserved.');
  if (classification!=='HEADER_PRESENCE_AND_TIMESTAMP_MATCH_NOT_A_FULL_KPI_CHECK') process.exitCode=3;
}
main().catch(err=>{console.error('TARGETED AUDIT ERROR:',err.message);process.exitCode=1;});
```

### `common/v3-status-contract.mjs`

**Reconstructed SHA-256:** `e8472e3ccb41aa28b5e19479d685d9519752e3cd10f5bdc7fb17b5961e884fd9`.

```javascript
// Pure parser for the V3 recovery summary. Never grants success from missing entries.
export const REQUIRED_V3_MODULES = Object.freeze([
  'sales-invoice', 'item-fulfillment', 'sales-order', 'item-receipt',
  'purchase-order', 'purchase-invoice', 'sales-return', 'purchase-return', 'sales-payment'
]);
const ALLOWED = new Set(['FINAL_PASS','NO_SOURCE','NEEDS_REVIEW','AUDIT_CLEAN','ERROR','FAILED']);
export function classifyV3Recovery(code, output, timedOut=false) {
  if (timedOut) return 'FAILED';
  if (code === 3) return 'NEEDS_REVIEW';
  if (code !== 0) return 'FAILED';
  const marker = '========== RECOVERY SUMMARY ==========';
  const at = String(output).lastIndexOf(marker);
  if (at < 0) return 'NEEDS_REVIEW';
  const tail = String(output).slice(at + marker.length);
  const statuses = new Map();
  for (const line of tail.split(/\r?\n/)) {
    const m = line.trim().match(/^([a-z]+(?:-[a-z]+)*):\s*([A-Z_]+)$/);
    if (!m || !REQUIRED_V3_MODULES.includes(m[1])) continue;
    if (statuses.has(m[1]) || !ALLOWED.has(m[2])) return 'NEEDS_REVIEW';
    statuses.set(m[1], m[2]);
  }
  if (statuses.size !== REQUIRED_V3_MODULES.length) return 'NEEDS_REVIEW';
  if (REQUIRED_V3_MODULES.some(name => ['FAILED','ERROR'].includes(statuses.get(name)))) return 'FAILED';
  for (const name of REQUIRED_V3_MODULES) {
    const value = statuses.get(name);
    if (name === 'purchase-return' && value === 'NO_SOURCE') continue;
    if (value === 'NO_SOURCE') return 'NEEDS_REVIEW';
    if (value !== 'FINAL_PASS') return 'NEEDS_REVIEW';
  }
  return 'FINAL_PASS';
}
```

### `common/verified-deletion-batch.mjs`

**Reconstructed SHA-256:** `63fdd63761f92f55200a69ab874e119fc389e68f127577e312ab0735f1c6cbba`.

```javascript
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const supported = new Set([
  'item-receipt',
  'purchase-order',
  'purchase-invoice',
  'sales-return',
  'purchase-return',
  'sales-payment'
]);

function run(module, args) {
  const file = args[0] === 'presence'
    ? join(root, 'modules', module, 'presence.mjs')
    : join(root, 'scripts', 'verified-deletion.mjs');

  const argv = args[0] === 'presence'
    ? (['purchase-return', 'sales-payment'].includes(module) ? ['--deletion-inventory'] : [])
    : ['--module', module, '--id', args[1], args[2]];

  const result = spawnSync(process.execPath, [file, ...argv], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: args[2] === '--apply'
      ? {
          ...process.env,
          NETSUITE_VERIFIED_DELETE_CONFIRM:
            'I_CONFIRM_VERIFIED_SOFT_DELETE'
        }
      : process.env
  });

  if (result.error || result.signal) {
    throw Error(
      `Execution failed: ${result.error?.message ?? result.signal}`
    );
  }

  return {
    exit: result.status,
    out: result.stdout ?? '',
    err: result.stderr ?? ''
  };
}

function validIds(ids) {
  return Array.isArray(ids) &&
    ids.every(id => /^[1-9]\d{0,14}$/.test(String(id))) &&
    new Set(ids.map(String)).size === ids.length;
}

function parsePresence(module, result) {
  if (![0, 3].includes(result.exit)) {
    throw Error(`${module} presence execution failed: ${result.err}`);
  }

  if (module === 'item-receipt') {
    const totals = result.out.match(
      /NETSUITE\s+(\d+)\s+BIGQUERY\s+(\d+)\s+ONLY NETSUITE\s+(\d+)\s+ONLY BIGQUERY\s+(\d+)/
    );

    const nsList = result.out.match(
      /ONLY NETSUITE IDs:\s*\[([^\]]*)\]/
    );

    const bqList = result.out.match(
      /ONLY BIGQUERY IDs:\s*\[([^\]]*)\]/
    );

    if (!totals || !nsList || !bqList) {
      throw Error('IR presence output incomplete');
    }

    const parseList = text => {
      const trimmed = text.trim();
      if (!trimmed) return [];

      const quoted = [...trimmed.matchAll(/['"](\d+)['"]/g)]
        .map(m => m[1]);

      const residue = trimmed
        .replace(/['"]\d+['"]/g, '')
        .replace(/[\s,]/g, '');

      if (residue) throw Error('IR presence list ambiguous');
      return quoted;
    };

    const onlyNetSuite = parseList(nsList[1]);
    const onlyBigQuery = parseList(bqList[1]);

    if (
      onlyNetSuite.length !== Number(totals[3]) ||
      onlyBigQuery.length !== Number(totals[4])
    ) {
      throw Error('IR presence count/list mismatch');
    }

    return { onlyNetSuite, onlyBigQuery };
  }

  const start = result.out.indexOf('{');
  const end = result.out.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw Error(`${module} missing JSON presence inventory`);
  }

  const data = JSON.parse(result.out.slice(start, end + 1));

  if (
    !Array.isArray(data.onlyNetSuite) ||
    !Array.isArray(data.onlyBigQuery)
  ) {
    throw Error(`${module} presence lists missing`);
  }

  if (
    data.sourceDuplicate === true ||
    data.bigQueryDuplicate === true ||
    Number(data.sourceDuplicates ?? 0) !== 0 ||
    Number(data.bigQueryDuplicates ?? 0) !== 0
  ) {
    throw Error(`${module} duplicate inventory`);
  }

  // Refuse truncated/mismatched inventory: deletion must see every candidate.
  if ((data.onlyNetSuiteCount !== undefined && Number(data.onlyNetSuiteCount) !== data.onlyNetSuite.length) ||
      (data.onlyBigQueryCount !== undefined && Number(data.onlyBigQueryCount) !== data.onlyBigQuery.length)) {
    throw Error(`${module} incomplete deletion inventory; refusing batch`);
  }
  return {
    onlyNetSuite: data.onlyNetSuite.map(String),
    onlyBigQuery: data.onlyBigQuery.map(String)
  };
}

export function inspectDeletionInventory(module) {
  if (!supported.has(module)) {
    throw Error(`Unsupported deletion module: ${module}`);
  }

  const result = run(module, ['presence']);
  const inventory = parsePresence(module, result);

  if (
    !validIds(inventory.onlyNetSuite) ||
    !validIds(inventory.onlyBigQuery)
  ) {
    throw Error(`${module} invalid or duplicate inventory IDs`);
  }

  const clean = !inventory.onlyNetSuite.length &&
    !inventory.onlyBigQuery.length;

  if (clean && result.exit !== 0) {
    throw Error(`${module} conflicting clean presence exit`);
  }

  if (!clean && result.exit !== 3) {
    throw Error(`${module} conflicting discrepancy exit`);
  }

  return inventory;
}

export function processVerifiedDeletionBatch(
  module,
  inventory,
  { apply = false } = {}
) {
  if (!supported.has(module)) {
    throw Error(`Unsupported deletion module: ${module}`);
  }

  if (
    !validIds(inventory.onlyBigQuery) ||
    !validIds(inventory.onlyNetSuite)
  ) {
    throw Error('Deletion inventory is not auditable');
  }

  const candidates = inventory.onlyBigQuery.slice(0, 3);
  let applied = 0;

  for (const id of candidates) {
    const dry = run(module, ['delete', id, '--dry-run']);

    if (
      dry.exit !== 0 ||
      !dry.out.includes('DRY RUN PASS')
    ) {
      console.log(
        `VERIFIED DELETION BLOCKED ${module} id=${id}: no valid proof`
      );
      continue;
    }

    console.log(
      `VERIFIED DELETION PROOF PASS ${module} id=${id}`
    );

    if (!apply) continue;

    const result = run(module, ['delete', id, '--apply']);

    if (
      result.exit !== 0 ||
      !result.out.includes('VERIFIED SOFT DELETE PASS')
    ) {
      console.error(result.err || result.out);
      throw Error(
        `VERIFIED DELETION APPLY FAILED ${module} id=${id}`
      );
    }

    applied++;
    console.log(
      `VERIFIED SOFT DELETE PASS ${module} id=${id}`
    );
  }

  console.log(
    `VERIFIED DELETION BATCH ${module}: ` +
    `applied=${applied} candidates=${candidates.length} ` +
    `backlog=${inventory.onlyBigQuery.length}`
  );

  return { applied, candidates: candidates.length };
}
```

### `common/verified-deletion-proof.mjs`

**Reconstructed SHA-256:** `abb2c81a66cdf573a73507087c2f9bc86ed81fea5272743c428d768e130b2d66`.

```javascript
// Reusable strict NetSuite deletedrecord proof; unrelated record-ID collisions are ignored.
// Fail closed when the exact record tuple has zero or multiple candidates.
export function matchDeletedRecordProof(rows, rawId, record) {
  if (!Array.isArray(rows) || !record) return [];
  return rows.filter(row =>
    String(row.recordid ?? '') === String(rawId) &&
    String(row.recordtypeid ?? '').toLowerCase() === String(record.recordtypeid ?? '').toLowerCase() &&
    String(row.type ?? '').toUpperCase() === String(record.type ?? '').toUpperCase() &&
    Boolean(row.deleteddate)
  );
}
```

### `modules/customer-credit-memo/check-financial.mjs`

**Reconstructed SHA-256:** `b2df28f4a4624e29a67165a320a63c6ae8658a42c88c9b0b283e00b4c7a8ee34`.

```javascript
// Exact all-field, all-grain source-to-BigQuery audit; values not rounded.
import {query,T} from '../../common/bigquery-client.mjs';
import {GROUPS,liveSource,sourceRows,storedRows,compareKeys,compareFields} from './reconcile-common.mjs';
async function main(){
 console.log('MODULE 10 CUSTOMER CREDIT MEMO B5 EXACT FINANCIAL / DATA RECONCILIATION | READ ONLY');
 const mapped=await liveSource();let failed=false;
 for(const group of GROUPS){const source=sourceRows(mapped,group),stored=await storedRows(group);const r=compareKeys(source,stored,group);const fields=compareFields(r.a,r.b,group);
  console.log('EXACT_COMPARE',JSON.stringify({table:group.table,source:r.source,bigquery:r.bigquery,onlyNetSuite:r.onlyNetSuite,onlyBigQuery:r.onlyBigQuery,fieldMismatches:fields.mismatches,missingSourceSample:r.onlyNetSuiteSample,missingBigQuerySample:r.onlyBigQuerySample,mismatchSample:fields.samples}));
  if(r.onlyNetSuite||r.onlyBigQuery||r.source!==r.bigquery||fields.mismatches)failed=true;
 }
 const header=await query(`SELECT COUNTIF(is_deleted IS TRUE) AS deleted_count,COUNTIF(is_deleted IS NULL) AS null_deleted_count,COUNTIF(is_deleted IS TRUE AND deleted_at IS NULL) AS missing_deleted_at FROM ${T('customer_credit_memo_headers')}`);
 const deleted=Number(header[0]?.deleted_count??0),nullable=Number(header[0]?.null_deleted_count??0),missingAt=Number(header[0]?.missing_deleted_at??0);
 // A verified soft-delete is valid history, not an active presence mismatch.
 // Incomplete/null deletion flags remain blockers.
 console.log('HEADER_DELETION_FLAGS',JSON.stringify({deleted,null_is_deleted:nullable,missing_deleted_at:missingAt}));if(nullable||missingAt)failed=true;
 const classifications=mapped.financialClassification.reduce((x,r)=>(x[r.classification]=(x[r.classification]??0)+1,x),{});
 console.log('SOURCE_CLASSIFICATIONS',JSON.stringify(classifications));
 console.log('B5 EXACT FINANCIAL RECONCILIATION:',failed?'BLOCKED':'PASS');if(failed)process.exitCode=1;
}
main().catch(e=>{console.error('B5 FINANCIAL BLOCKED:',e?.stack??String(e));process.exitCode=1;});
```

### `modules/customer-credit-memo/deletion-inventory.mjs`

**Reconstructed SHA-256:** `e789f3f9c11c0f7a7099aba58bb13232ad3f0bef9f4da8dbb2e6f7609d997c04`.

```javascript
// Module 10 only. Mirrors purchase-return/deletion-inventory.mjs. Read-only.
import {token,fetchHeaders} from './mapping.mjs';
import {query,T} from '../../common/bigquery-client.mjs';
const valid=x=>{const s=String(x??'');if(!/^[1-9][0-9]{0,14}$/.test(s))throw Error('Invalid credit memo ID '+s);return s;};
async function main(){
 const a=await token();const src=await fetchHeaders(a);
 const bq=await query(`SELECT credit_memo_id FROM ${T('customer_credit_memo_headers')} WHERE COALESCE(is_deleted,FALSE)=FALSE`);
 const nsIds=src.map(x=>valid(x.internal_id)),bqIds=bq.map(x=>valid(x.credit_memo_id));
 const ns=new Set(nsIds),stored=new Set(bqIds);
 const result={netSuite:nsIds.length,bigQuery:bqIds.length,
  onlyNetSuite:[...ns].filter(x=>!stored.has(x)).sort(),onlyBigQuery:[...stored].filter(x=>!ns.has(x)).sort(),
  sourceDuplicate:ns.size!==nsIds.length,bigQueryDuplicate:stored.size!==bqIds.length};
 console.log('CCM VERIFIED DELETION INVENTORY | READ ONLY');console.log(JSON.stringify(result));
 if(result.sourceDuplicate||result.bigQueryDuplicate||result.onlyNetSuite.length||result.onlyBigQuery.length)process.exitCode=3;
}
main().catch(e=>{console.error('CCM INVENTORY BLOCKED:',e.stack??e);process.exitCode=1;});
```

### `modules/customer-credit-memo/deletion-proof.mjs`

**Reconstructed SHA-256:** `a18fdc9b84378647efba26fc631ac9358a14ab83c0b722655542bd985fce7f4d`.

```javascript
// Module 10 standalone deletedrecord evidence probe. READ ONLY; no writes.
import {token} from './mapping.mjs';
import {fetchAll} from '../../common/netsuite-client.mjs';
import {query,T} from '../../common/bigquery-client.mjs';
const args=process.argv.slice(2),pos=args.indexOf('--id');
if(args.length!==2||pos!==0||!/^[1-9][0-9]{0,14}$/.test(args[1]))throw Error('Usage: node modules/customer-credit-memo/deletion-proof.mjs --id <numericId>');
const id=args[1];
async function main(){
 const access=await token();
 const evidence=await fetchAll(access,`SELECT recordid,recordtypeid,type,name,deleteddate,deletedby,context FROM deletedrecord WHERE recordid = ${id}`);
 const visible=await fetchAll(access,`SELECT id,type FROM Transaction WHERE id = ${id}`);
 const stored=await query(`SELECT credit_memo_id,is_deleted FROM ${T('customer_credit_memo_headers')} WHERE credit_memo_id=@id`,{id});
 console.log('CCM DELETION PROOF | READ ONLY | NOT AN APPLY');
 console.log(JSON.stringify({id,evidence,sourceVisible:visible,headers:stored}));
 console.log('APPLY: DISABLED until exact CustCred deletedrecord recordtypeid/type tuple independently validated.');
}
main().catch(e=>{console.error('CCM DELETION PROOF BLOCKED:',e.stack??e);process.exitCode=1;});
```

### `modules/customer-credit-memo/incremental-sync.mjs`

**Reconstructed SHA-256:** `200d0babb6da225d0ff6c6e3b7cd1f73dc38cfbeee96904b8416ff9989ad4633`.

```javascript
// Module 10 ONLY: standalone CustCred delta; no legacy module/scheduler modifications.
// --dry-run is read-only. --sync commits module rows + module checkpoint via one BQ transaction.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dataset,query,T,LOCATION,DATASET} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
import {sourceRows,storedRows,compareKeys,compareFields} from './reconcile-common.mjs';
import {validateNumeric,validateBigNumeric} from '../../common/decimal-precision.mjs';

const mode=process.argv[2];
if(process.argv.length!==3||!['--dry-run','--sync','--repair-audit'].includes(mode))throw Error('Usage: node modules/customer-credit-memo/incremental-sync.mjs --dry-run|--sync|--repair-audit');
const MODULE='customer-credit-memo';
const TABLES=GROUPS.map(g=>g.table);
const CP_TBL=T('sync_checkpoints');
const RETRIES=5;
const MAX_REPAIR_DOCUMENTS=10;
const DELAYS=[1500,3000,6000,12000];
const fail=message=>{throw Error('MODULE 10 INCREMENTAL BLOCKED: '+message);};
const val=x=>typeof x==='object'&&x!==null&&'value' in x?x.value:x;
const num=x=>Number(val(x));
const isConflict=e=>/transaction is aborted due to concurrent update against table/i.test(String(e?.message??e))&&/sync_checkpoints/i.test(String(e?.message??e));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function minusFiveMinutes(s){
 if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s))fail('Invalid checkpoint '+s);
 const ms=Date.parse(s.replace(' ','T')+'Z');if(!Number.isFinite(ms))fail('Invalid checkpoint date');
 return new Date(ms-300000).toISOString().slice(0,19).replace('T',' ');
}
async function checkpoint(){
 const rows=await query(`SELECT record_type, FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS watermark FROM ${CP_TBL} WHERE record_type IN UNNEST(@tables)`,{tables:TABLES});
 if(rows.length!==TABLES.length||new Set(rows.map(r=>r.record_type)).size!==TABLES.length)fail('Missing or duplicate module checkpoints');
 const versions=[...new Set(rows.map(r=>r.watermark))];
 if(versions.length!==1||!versions[0])fail('Divergent/empty module checkpoint');
 return versions[0];
}
async function targetShape(){
 for(const g of GROUPS){
  const [exists]=await dataset.table(g.table).exists();if(!exists)fail('Missing target '+g.table);
  const [md]=await dataset.table(g.table).getMetadata();const fields=md.schema?.fields??[];const expected=columnDefinitions(g);
  if(fields.length!==expected.length)fail('Schema column count '+g.table);
  for(const [name,type] of expected){const f=fields.find(x=>x.name.toLowerCase()===name.toLowerCase());if(!f||(f.type.toUpperCase()==='BOOLEAN'?'BOOL':f.type.toUpperCase())!==type)fail('Schema mismatch '+g.table+'.'+name);}
 }
}
function checkVal(value,type,where){
 if(value==null)return;
 if(type==='STRING'&&typeof value==='string')return;
 if(type==='BOOL'&&typeof value==='boolean')return;
 if(type==='DATE'&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return;
 if(type==='DATETIME'&&typeof value==='string'&&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value))return;
 if(type==='NUMERIC'&&typeof value==='string'&&validateNumeric(value,{module:MODULE,field:where})===value)return;
 if(type==='BIGNUMERIC'&&typeof value==='string'&&validateBigNumeric(value,{module:MODULE,field:where})===value)return;
 fail('Invalid '+type+' at '+where);
}
function validateGroup(group,rows,ids){
 const seen=new Set();
 rows.forEach((r,i)=>{
  if(!ids.has(String(r.credit_memo_id)))fail('Foreign credit memo in '+group.table);
  for(const [field,type] of group.fields)checkVal(r[field],type,group.table+'['+i+'].'+field);
  for(const field of group.key){if(!(group.nullableKey??[]).includes(field)&&(r[field]==null||r[field]===''))fail('Missing key '+group.table+'.'+field);}
  for(const field of Object.keys(r))if(!group.fields.some(([k])=>k===field))fail('Unexpected field '+group.table+'.'+field);
  const key=JSON.stringify(group.key.map(k=>r[k]??null));if(seen.has(key))fail('Duplicate key '+group.table+' '+key);seen.add(key);
 });
}
async function stage(name,rows,group){
 const table=dataset.table(name);
 if(!rows.length){await query(`CREATE TABLE ${T(name)} (${group.fields.map(([n,t])=>`${n} ${t}`).join(', ')})`);}
 else{
  const filename=path.join(os.tmpdir(),`ccm-delta-${crypto.randomUUID()}.ndjson`);
  await fs.writeFile(filename,rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});
  try{await table.load(filename,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:group.fields.map(([name,type])=>({name,type}))},location:LOCATION});}
  finally{await fs.rm(filename,{force:true});}
 }
 const count=await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);
 if(num(count[0].n)!==rows.length)fail('Staging count mismatch '+group.table);
}
async function main(){
 console.log('MODULE 10 CUSTOMER CREDIT MEMO B6 STANDALONE INCREMENTAL |',mode,'|',DATASET,'|',LOCATION);
 console.log('RULE: DO NOT TOUCH EXISTING MODULES, SCHEDULERS, OR THEIR CHECKPOINTS');
 await targetShape();const cp=await checkpoint(),since=minusFiveMinutes(cp);
 console.log('CHECKPOINT:',cp,'OVERLAP_SINCE:',since);
 const access=await token();console.log('OAuth: SUCCESS');
 let headers,ids,idSet,lines,gl,previous,next,mapped;
 if(mode==='--repair-audit'){
  // The audit is authoritative: do not widen the incremental checkpoint window.
  // Fail closed on inventory/key differences, duplicates, and excessive repair scope.
  const fullHeaders=await fetchHeaders(access);
  const fullIds=fullHeaders.map(h=>String(h.internal_id));
  if(fullIds.length!==new Set(fullIds).size)fail('Duplicate full source headers');
  const [allLines,allGL,allPrevious,allNext]=await Promise.all([
   fetchLines(access,fullIds),fetchGL(access,fullIds),fetchPreviousLinks(access,fullIds),fetchNextLinks(access,fullIds)
  ]);
  const fullMapped=mapSource(fullHeaders,allLines,allGL,allPrevious,allNext);
  const candidates=new Set();
  for(const g of GROUPS){
   const source=sourceRows(fullMapped,g),stored=await storedRows(g);
   const keys=compareKeys(source,stored,g);
   if(keys.onlyNetSuite||keys.onlyBigQuery||keys.source!==keys.bigquery)
    fail('REPAIR BLOCKED: inventory/key mismatch '+g.table+' sourceOnly='+keys.onlyNetSuite+' bqOnly='+keys.onlyBigQuery);
   const differences=compareFields(keys.a,keys.b,g,{maxExamples:50});
   for(const [key,sourceRow] of keys.a){
    const targetRow=keys.b.get(key);
    if(!targetRow)continue;
    if(compareFields(new Map([[key,sourceRow]]),new Map([[key,targetRow]]),g).mismatches)
     candidates.add(String(sourceRow.credit_memo_id));
   }
   console.log('REPAIR AUDIT',JSON.stringify({table:g.table,fieldMismatches:differences.mismatches}));
  }
  ids=[...candidates].sort((a,b)=>Number(a)-Number(b));
  console.log('REPAIR CANDIDATE IDS:',ids.join(',')||'NONE');
  if(!ids.length){console.log('CCM AUTO REPAIR NO_CHANGE: ZERO writes');return;}
  if(ids.length>MAX_REPAIR_DOCUMENTS)fail('REPAIR BLOCKED: affected documents '+ids.length+' exceed '+MAX_REPAIR_DOCUMENTS);
  idSet=new Set(ids);
  headers=fullHeaders.filter(r=>idSet.has(String(r.internal_id)));
  // Reuse precisely the source snapshot audited above. Nothing outside the candidate IDs.
  mapped=Object.fromEntries(Object.entries(fullMapped).map(([k,v])=>[
   k,Array.isArray(v)?v.filter(r=>idSet.has(String(r.credit_memo_id))):v
  ]));
  console.log('REPAIR MODE: exact source snapshot, bounded candidates, checkpoint unchanged');
 }else{
  headers=await fetchHeaders(access,since);ids=headers.map(h=>String(h.internal_id));idSet=new Set(ids);
  if(ids.length!==idSet.size)fail('Duplicate source header');
  console.log('CHANGED_HEADERS:',ids.length);
  if(!ids.length){console.log('B6 INCREMENTAL NO_CHANGE: no source headers, no writes');return;}
  [lines,gl,previous,next]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchPreviousLinks(access,ids),fetchNextLinks(access,ids)]);
  mapped=mapSource(headers,lines,gl,previous,next);
 }
 const prepared=[];let changed=false;
 for(const g of GROUPS){
  const source=sourceRows(mapped,g);validateGroup(g,source,idSet);
  const stored=(await storedRows(g)).filter(r=>idSet.has(String(r.credit_memo_id)));
  const keys=compareKeys(source,stored,g);const fields=compareFields(keys.a,keys.b,g);
  const change=keys.onlyNetSuite+keys.onlyBigQuery+fields.mismatches;
  changed ||= change>0;
  console.log('DELTA',JSON.stringify({table:g.table,source:source.length,stored:stored.length,newKeys:keys.onlyNetSuite,staleKeys:keys.onlyBigQuery,fieldMismatches:fields.mismatches}));
  prepared.push({g,rows:source});
 }
 if(!changed){console.log(mode==='--repair-audit'?'CCM AUTO REPAIR NO_CHANGE: ZERO writes':'B6 INCREMENTAL NO_CHANGE: overlap-only, ZERO writes, checkpoint unchanged');return;}
 const classifications=mapped.financialClassification.map(x=>x.classification);
 if(classifications.some(x=>!['GL_EXACT_BALANCED','SOURCE_ADJUSTMENT_VERIFIED'].includes(x)))fail('Unverified financial classification');
 const wm=headers.map(h=>h.last_modified).filter(Boolean).sort().at(-1);
 if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(wm??''))fail('Invalid max source timestamp');
 const nextWatermark = wm > cp ? wm : cp;
 if(mode==='--dry-run'){console.log('B6 INCREMENTAL DRY RUN PASS: changes detected; ZERO writes');return;}
 if(await checkpoint()!==cp)fail('Module checkpoint changed during source fetch');
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,18);
 const stages=prepared.map(({g,rows},i)=>({g,rows,name:`_stage_ccm_delta_${i}_${suffix}`}));
 try{
    let stageIndex=0;
  await Promise.all(Array.from({length:2},async()=>{
    while(stageIndex<stages.length){
      const st=stages[stageIndex++];
      console.log('STAGING START',st.g.table,new Date().toISOString());
      const started=Date.now();
      await stage(st.name,st.rows,st.g);
      console.log('STAGED',st.g.table,st.rows.length,'duration_ms='+String(Date.now()-started));
    }
  }));
  const stageAssertions=stages.map(st=>`ASSERT (SELECT COUNT(*) FROM ${T(st.name)})=${st.rows.length} AS 'Stage count ${st.g.table}';`).join('\n');
  const stageKeys=stages.map(st=>`ASSERT (SELECT COUNT(*) FROM (SELECT ${st.g.key.join(',')} FROM ${T(st.name)} GROUP BY ${st.g.key.join(',')} HAVING COUNT(*)>1))=0 AS 'Duplicate stage key ${st.g.table}';`).join('\n');
  const cpGuard=`ASSERT (SELECT COUNT(*) FROM ${CP_TBL} WHERE record_type IN UNNEST(@tables) AND FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at)=@cp)=${TABLES.length} AS 'Module checkpoint changed';`;
  const headGuard=`ASSERT (SELECT COUNT(*) FROM ${T(GROUPS[0].table)} WHERE credit_memo_id IN UNNEST(@ids) AND is_deleted IS TRUE)=0 AS 'Deleted header in changed set';`;
  // Match purchase-return production baseline: header MERGE, detail replace only.
  const statements=stages.map((st,i)=>{
   const names=st.g.fields.map(([name])=>name);
   if(i===0){
    const key='credit_memo_id';
    const updates=names.filter(n=>n!==key).map(n=>`d.${n}=s.${n}`).join(',');
    return `MERGE ${T(st.g.table)} d USING ${T(st.name)} s ON d.${key}=s.${key}\nWHEN MATCHED AND COALESCE(d.is_deleted,FALSE)=FALSE THEN UPDATE SET ${updates},d.synced_at=CURRENT_TIMESTAMP()\nWHEN NOT MATCHED THEN INSERT (${[...names,'synced_at','is_deleted','deleted_at'].join(',')}) VALUES (${[...names.map(n=>`s.${n}`),'CURRENT_TIMESTAMP()','FALSE','NULL'].join(',')});`;
   }
   return `DELETE FROM ${T(st.g.table)} WHERE credit_memo_id IN UNNEST(@ids);\nINSERT INTO ${T(st.g.table)} (${[...names,'synced_at'].join(',')}) SELECT ${[...names,'CURRENT_TIMESTAMP()'].join(',')} FROM ${T(st.name)};`;
  }).join('\n');
  const orphan=stages.slice(1).map(st=>`ASSERT (SELECT COUNT(*) FROM ${T(st.g.table)} AS d LEFT JOIN ${T(GROUPS[0].table)} AS h ON h.credit_memo_id=d.credit_memo_id WHERE h.credit_memo_id IS NULL)=0 AS 'Orphans ${st.g.table}';`).join('\n');
  const cpWrite=mode==='--repair-audit'?'':`UPDATE ${CP_TBL} SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP() WHERE record_type IN UNNEST(@tables);\nASSERT @@row_count=${TABLES.length} AS 'Checkpoint update count';`;
  const sql=`BEGIN\nBEGIN TRANSACTION;\n${cpGuard}\n${headGuard}\n${stageAssertions}\n${stageKeys}\n${statements}\n${orphan}\n${cpWrite}\nCOMMIT TRANSACTION;\nEXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;\nEND;`;
  const params={ids,tables:TABLES,cp,wm:nextWatermark};
  for(let attempt=1;attempt<=RETRIES;attempt++){
   if(await checkpoint()!==cp)fail('Module checkpoint changed; retry prohibited');
   try{await query(sql,params);console.log(mode==='--repair-audit'?'CCM AUTO REPAIR ATOMIC COMMIT PASS: candidate IDs only, checkpoint unchanged; attempts='+attempt:'B6 INCREMENTAL ATOMIC COMMIT PASS: 6 module tables + 6 module checkpoints; attempts='+attempt);return;}
   catch(e){
    if(!isConflict(e))throw e;
    if(await checkpoint()!==cp)fail('Checkpoint advanced during uncertain commit; stop, reconcile first');
    if(attempt===RETRIES)fail('Checkpoint concurrency retries exhausted');
    console.log('MODULE 10 ONLY CHECKPOINT CONFLICT: RETRY',attempt);
    await sleep(DELAYS[attempt-1]);
   }
  }
 }finally{for(const st of stages){try{await dataset.table(st.name).delete({ignoreNotFound:true});}catch(e){console.warn('STAGING CLEANUP WARNING',st.name,e.message);}}}
}
// Production --sync also closes historical field drift not reflected in
// last_modified. This calls the existing bounded six-table --repair-audit mode;
// it never widens the checkpoint or repairs soft-deleted historical rows.
// A failed repair is a real module failure; never silently claim SYNC_OK.
main().then(()=>{
 if(mode!=='--sync')return;
 console.log('CCM B10 AUTOMATIC ACTIVE REPAIR START');
 const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--repair-audit'],{
  cwd:process.cwd(),encoding:'utf8',windowsHide:true,timeout:300000,
  maxBuffer:8*1024*1024,env:process.env
 });
 if(result.stdout)process.stdout.write(result.stdout);
 if(result.stderr)process.stderr.write(result.stderr);
 if(result.error||result.status!==0){
  console.error('CCM B10 AUTOMATIC ACTIVE REPAIR BLOCKED:',result.error?.message??('exit='+result.status));
  process.exitCode=1;return;
 }
 if(!/CCM AUTO REPAIR (?:ATOMIC COMMIT PASS:|NO_CHANGE:)/.test(result.stdout??'')){
  console.error('CCM B10 AUTOMATIC ACTIVE REPAIR BLOCKED: success marker absent');
  process.exitCode=1;return;
 }
 console.log('CCM B10 AUTOMATIC ACTIVE REPAIR PASS');
}).catch(e=>{console.error('B6 INCREMENTAL BLOCKED:',e?.stack??String(e));process.exitCode=1;});
```

### `modules/customer-credit-memo/initialize-schema.mjs`

**Reconstructed SHA-256:** `951afc15551769ca492f1d5d0edb7bb58eca55018cc6065ff279a515021e712b`.

```javascript
// Schema-only init matching Purchase Return convention. Never writes transaction rows/checkpoints.
import {dataset,query,T,DATASET,LOCATION} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';

const DRY=process.argv.includes('--dry-run'),APPLY=process.argv.includes('--apply-schema');
if(DRY===APPLY||process.argv.length!==3)throw Error('Choose exactly one --dry-run or --apply-schema');
const cpNames=GROUPS.map(g=>`'${g.table}'`).join(',');
function assert(ok,msg){if(!ok)throw Error('BLOCKED: '+msg);}
function expected(g){return columnDefinitions(g).map(([name,type])=>({name,type}));}
function compareSchema(g,metadata){
 const actual=metadata.schema?.fields??[];
 for(const x of expected(g)){
  const column=actual.find(y=>y.name.toLowerCase()===x.name.toLowerCase());
  assert(column,`${g.table} missing column ${x.name}`);
  assert((column.type.toUpperCase()==='BOOLEAN'?'BOOL':column.type.toUpperCase())===x.type,`${g.table}.${x.name} has ${column.type}, expected ${x.type}`);
 }
 assert(actual.length===expected(g).length,`${g.table} unexpected extra column(s)`);
}
async function checkTables(){
 const states=[];
 for(const g of GROUPS){
  const table=dataset.table(g.table);
  const [exists]=await table.exists();
  let n=null;
  if(exists){
   const [metadata]=await table.getMetadata();compareSchema(g,metadata);
   const rows=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);
   n=Number(rows[0].n);assert(n===0,`${g.table} already has ${n} rows; use sync/reconciliation workflow`);
  }
  states.push({table:g.table,exists,rows:n,fields:expected(g).length});
 }
 return states;
}
async function main(){
 console.log(`CUSTOMER CREDIT MEMO B3 SCHEMA-ONLY | ${DRY?'DRY RUN':'APPLY'} | ${DATASET} | ${LOCATION}`);
 const [cpExists]=await dataset.table('sync_checkpoints').exists();assert(cpExists,'shared sync_checkpoints missing');
 const checkpoints=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames})`);
 assert(checkpoints.length===0,'Customer Credit Memo checkpoints already exist');
 const before=await checkTables();console.log('BEFORE:',JSON.stringify(before));
 console.log('CONTRACT:',JSON.stringify(GROUPS.map(g=>({table:g.table,source:g.source,fields:expected(g)}))));
 if(DRY){console.log('B3 SCHEMA DRY RUN PASS: no DDL, no data writes, no checkpoints');return;}
 const access=await token();const headers=await fetchHeaders(access);
 assert(headers.length>0,'source has no CustCred headers; refusing to initialize');
 console.log('LIVE SOURCE HEADERS:',headers.length);
 for(const g of GROUPS){
  const mandatory = new Set(g.source==='headers'?['credit_memo_id']:g.source==='transactionLines'?['credit_memo_id','line_unique_key']:g.source==='accountingLines'?['credit_memo_id','accounting_book_id','line_id']:g.source==='financialClassification'?['credit_memo_id','accounting_book_id']:['credit_memo_id','previous_doc_id','next_doc_id']);
  const defs=g.fields.map(([name,type])=>`${name} ${type}${mandatory.has(name)?' NOT NULL':''}`).join(',');
  const extra=g===GROUPS[0]?',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP':',synced_at TIMESTAMP';
  const partition=g===GROUPS[0]?' PARTITION BY transaction_date':'';
  const cluster=g===GROUPS[0]?' CLUSTER BY credit_memo_id':` CLUSTER BY ${g.key.slice(0,4).join(',')}`;
  await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${defs}${extra})${partition}${cluster}`);
 }
 const after=await checkTables();assert(after.every(g=>g.exists),'one or more tables missing after schema init');
 const checkpointAfter=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames})`);
 assert(checkpointAfter.length===0,'checkpoint unexpectedly created');
 console.log('B3 SCHEMA ONLY PASS: 6 empty tables, 0 checkpoint rows; NOT SYNC PASS');
}
main().catch(e=>{console.error('B3 SCHEMA BLOCKED:',e.stack??String(e));process.exitCode=1;});
```

### `modules/customer-credit-memo/mapping.mjs`

**Reconstructed SHA-256:** `bc454adf8054639979b2186fcf262846d7a14af2030b3667a6c5e2706a3de846`.

```javascript
// Module 10 — source mapping only. No BigQuery writes, DDL, checkpoint, or deletion.
import {token,fetchAll} from '../../common/netsuite-client.mjs';
import {validateNumeric,validateBigNumeric} from '../../common/decimal-precision.mjs';
// Inlined decimal validation and financial-classification helpers (no algorithm changes).
const HEADER_DECIMAL_TYPES = Object.freeze({
  exchange_rate: 'NUMERIC', foreign_total: 'NUMERIC', base_total: 'NUMERIC'
});
const LINE_DECIMAL_TYPES = Object.freeze({
  quantity: 'NUMERIC', rate: 'BIGNUMERIC', foreign_amount: 'NUMERIC', net_amount: 'NUMERIC'
});
const ACCOUNTING_DECIMAL_TYPES = Object.freeze({debit: 'NUMERIC', credit: 'NUMERIC'});
const LINK_DECIMAL_TYPES = Object.freeze({applied_amount: 'NUMERIC'});

function mapDecimal(field, value, type, recordId) {
  const context = {module: 'customer-credit-memo', recordId, field};
  if (type === 'NUMERIC') return validateNumeric(value, context);
  if (type === 'BIGNUMERIC') return validateBigNumeric(value, context);
  throw new Error(`Unsupported decimal type ${type} for ${field}`);
}

function validateDecimalRecord(row, types, recordId) {
  const out = {...row};
  for (const [field, type] of Object.entries(types)) {
    if (Object.hasOwn(out, field)) out[field] = mapDecimal(field, out[field], type, recordId);
  }
  return out;
}

const SCALE = 1000000000n;
const ctx = (id, field) => ({ module: 'customer-credit-memo', recordId: String(id), field });
function units(value, id, field) {
  if (value === null || value === undefined || value === '') return 0n;
  const s = validateNumeric(String(value), ctx(id, field));
  if (s === null) return 0n;
  const negative = s.startsWith('-');
  const [whole, fraction = ''] = (negative ? s.slice(1) : s).split('.');
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(9, '0'));
  return negative ? -result : result;
}
function formatUnits(value) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const frac = String(abs % SCALE).padStart(9, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${abs / SCALE}${frac ? '.' + frac : ''}`;
}
const classStr = v => v === undefined || v === null ? null : String(v);
const isTrue = v => String(v ?? 'F').toUpperCase() === 'T';
const keyFor = r => classStr(r.line_id ?? r.transactionline);

// classification is per document AND accounting book. Allowed adjustment is evidence,
// not a financial tolerance and not a replacement journal entry.
function classifyDocument({ header, transactionLines, accountingLines, bookId = '1' }) {
  const id = classStr(header.internal_id ?? header.credit_memo_id ?? header.transaction_id);
  if (!/^\d+$/.test(id ?? '')) throw Error('Invalid credit memo ID');
  const lines = transactionLines.filter(r => classStr(r.transaction_id ?? r.credit_memo_id) === id);
  const gl = accountingLines.filter(r => classStr(r.transaction_id ?? r.credit_memo_id) === id && classStr(r.accounting_book_id ?? r.book_id) === classStr(bookId));
  if (!gl.length) return { id, bookId: classStr(bookId), classification: 'BLOCKED', reason: 'MISSING_GL' };
  let debit = 0n, credit = 0n;
  for (const g of gl) {
    if (isTrue(g.posting) === false) return { id, bookId: classStr(bookId), classification: 'BLOCKED', reason: 'NONPOSTING_GL_ROW' };
    debit += units(g.debit, id, 'debit');
    credit += units(g.credit, id, 'credit');
  }
  const delta = debit - credit;
  if (delta === 0n) return { id, bookId: classStr(bookId), classification: 'GL_EXACT_BALANCED', gl_delta: '0', adjustment_lines: 0 };
  // All conditions required: dedicated adjustment item, non-mainline, non-tax, non-COGS,
  // no account, zero net amount, one matching GL row without account, exact foreignamount.
  const candidates = [];
  for (const l of lines) {
    if (classStr(l.item_id) !== '17653' || isTrue(l.mainline) || isTrue(l.taxline) || isTrue(l.iscogs) || classStr(l.account_id) !== null) continue;
    if (units(l.netamount, id, 'netamount') !== 0n) continue;
    const amount = units(l.foreignamount, id, 'foreignamount');
    if (amount === 0n) continue;
    const matching = gl.filter(g => keyFor(g) === keyFor(l) && classStr(g.account_id) === null);
    if (matching.length !== 1) continue;
    const glDelta = units(matching[0].debit, id, 'debit') - units(matching[0].credit, id, 'credit');
    if (amount !== glDelta || glDelta === 0n) continue;
    candidates.push({ line: l, gl: matching[0], amount, glDelta });
  }
  if (candidates.length !== 1 || candidates[0].glDelta !== delta) return {
    id, bookId: classStr(bookId), classification: 'BLOCKED', reason: 'UNEXPLAINED_GL_DELTA',
    gl_delta: formatUnits(delta), adjustment_candidates: candidates.length
  };
  const selected = candidates[0];
  return {
    id, bookId: classStr(bookId), classification: 'SOURCE_ADJUSTMENT_VERIFIED',
    gl_delta: formatUnits(delta), adjustment_line_id: keyFor(selected.line),
    adjustment_unique_key: classStr(selected.line.line_unique_key),
    adjustment_foreign_amount: formatUnits(selected.amount),
    non_adjustment_gl_delta: '0'
  };
}

export {token};
export const TYPE='CustCred', FROM='2026-10-01', TO='2027-01-01';
const PERIOD=`t.type='${TYPE}' AND t.trandate>=TO_DATE('${FROM}','YYYY-MM-DD') AND t.trandate<TO_DATE('${TO}','YYYY-MM-DD')`;
const str=x=>x==null?null:String(x);
const flag=x=>String(x??'F').toUpperCase()==='T';
const linkDatetime=(value,creditMemoId)=>{if(value==null||value==='')return null;const v=String(value);if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v))throw Error('Invalid link lastmodifieddate for '+creditMemoId+': '+v);return v;};
const id=x=>{const v=str(x);if(!/^[1-9]\d*$/.test(v??''))throw Error('Invalid NetSuite identity: '+v);return v;};
async function batches(access,ids,sql){const result=[];for(let i=0;i<ids.length;i+=25){const part=ids.slice(i,i+25).map(id).join(',');result.push(...await fetchAll(access,sql(part)));}return result;}
export async function fetchHeaders(access,since=null){if(since!==null&&!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(since))throw Error('Invalid watermark');const extra=since?` AND t.lastmodifieddate>=TO_DATE('${since}','YYYY-MM-DD HH24:MI:SS')`:'';return fetchAll(access,`SELECT t.id AS internal_id,t.tranid AS document_number,TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,t.status AS status_id,t.entity AS customer_id,BUILTIN.DF(t.entity) AS customer_name,t.currency AS currency_id,BUILTIN.DF(t.currency) AS currency_name,t.exchangerate,t.foreigntotal,t.total,t.postingperiod AS posting_period_id,t.subsidiary AS subsidiary_id,t.void,t.voided FROM Transaction t WHERE ${PERIOD}${extra} ORDER BY t.id`);}
export async function fetchLines(access,ids){return batches(access,ids,s=>`SELECT tl.transaction AS transaction_id,tl.id AS line_id,tl.uniquekey AS line_unique_key,tl.linesequencenumber AS line_number,tl.mainline,tl.taxline,tl.iscogs,tl.accountinglinetype,tl.expenseaccount AS account_id,tl.item AS item_id,tl.quantity,tl.rate,tl.foreignamount,tl.netamount FROM TransactionLine tl WHERE tl.transaction IN (${s}) ORDER BY tl.transaction,tl.id`);}
export async function fetchGL(access,ids){return batches(access,ids,s=>`SELECT transaction AS transaction_id,transactionline AS line_id,accountingbook AS accounting_book_id,account AS account_id,posting,debit,credit FROM TransactionAccountingLine WHERE transaction IN (${s}) ORDER BY transaction,accountingbook,transactionline,account`);}
export async function fetchPreviousLinks(access,ids){return batches(access,ids,s=>`SELECT previousdoc,previousline,nextdoc,nextline,previoustype,nexttype,linktype,foreignamount,discount,TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS lastmodifieddate FROM PreviousTransactionLineLink WHERE nextdoc IN (${s}) ORDER BY nextdoc,previousdoc,previousline,nextline`);}
export async function fetchNextLinks(access,ids){return batches(access,ids,s=>`SELECT previousdoc,previousline,nextdoc,nextline,previoustype,nexttype,linktype,foreignamount,TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS lastmodifieddate FROM NextTransactionLineLink WHERE previousdoc IN (${s}) ORDER BY previousdoc,nextdoc,previousline,nextline`);}
export function mapSource(headers,lines,gl,previousLinks,nextLinks){
 const out={headers:[],transactionLines:[],accountingLines:[],previousLinks:[],nextLinks:[],financialClassification:[]};
 const lookup=new Map(),byLines=new Map(),byGL=new Map(),lineKeys=new Set(),glKeys=new Set(),linkKeys=new Set(),mainlines=new Map();
 for(const h of headers){const p=id(h.internal_id);if(lookup.has(p))throw Error('Duplicate header '+p);if(!/^\d{4}-\d\d-\d\d$/.test(h.transaction_date??''))throw Error('Invalid transaction date '+p);if(h.last_modified!=null&&!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(h.last_modified))throw Error('Invalid modified date '+p);
 const row=validateDecimalRecord({credit_memo_id:p,document_number:str(h.document_number),transaction_date:h.transaction_date,last_modified:str(h.last_modified),status_id:str(h.status_id),customer_id:str(h.customer_id),customer_name:str(h.customer_name),currency_id:str(h.currency_id),currency_name:str(h.currency_name),exchange_rate:h.exchangerate,foreign_total:h.foreigntotal,base_total:h.total,posting_period_id:str(h.posting_period_id),subsidiary_id:str(h.subsidiary_id),is_void:flag(h.void)||flag(h.voided)},HEADER_DECIMAL_TYPES,p);if(row.foreign_total==null||row.base_total==null)throw Error('Missing header financial '+p);lookup.set(p,row);out.headers.push(row);}
 const known=p=>{if(!lookup.has(p))throw Error('Orphan detail '+p);};
 for(const l of lines){const p=id(l.transaction_id);known(p);const unique=id(l.line_unique_key),key=p+':'+unique;if(lineKeys.has(key))throw Error('Duplicate line '+key);lineKeys.add(key);const row=validateDecimalRecord({credit_memo_id:p,line_id:str(l.line_id),line_unique_key:unique,line_number:str(l.line_number),is_mainline:flag(l.mainline),is_taxline:flag(l.taxline),is_cogs:flag(l.iscogs),accounting_line_type:str(l.accountinglinetype),account_id:str(l.account_id),item_id:str(l.item_id),quantity:l.quantity,rate:l.rate,foreign_amount:l.foreignamount,net_amount:l.netamount},LINE_DECIMAL_TYPES,p);out.transactionLines.push(row);if(!byLines.has(p))byLines.set(p,[]);byLines.get(p).push({...l,transaction_id:p});if(row.is_mainline){mainlines.set(p,(mainlines.get(p)||0)+1);if(row.net_amount==null||units(row.net_amount,p,'mainline_net')!==units(lookup.get(p).base_total,p,'base_total'))throw Error('Mainline mismatch '+p);}}
 for(const a of gl){const p=id(a.transaction_id);known(p);const book=id(a.accounting_book_id),key=[p,book,str(a.line_id),str(a.account_id)].join(':');if(glKeys.has(key))throw Error('Duplicate GL grain '+key);glKeys.add(key);const row=validateDecimalRecord({credit_memo_id:p,line_id:str(a.line_id),accounting_book_id:book,account_id:str(a.account_id),posting:flag(a.posting),debit:a.debit,credit:a.credit},ACCOUNTING_DECIMAL_TYPES,p);out.accountingLines.push(row);if(!byGL.has(p))byGL.set(p,[]);byGL.get(p).push({...a,transaction_id:p});}
 const addLink=(l,direction)=>{const p=id(direction==='previous'?l.nextdoc:l.previousdoc);known(p);const key=[direction,p,str(l.previousdoc),str(l.previousline),str(l.nextdoc),str(l.nextline),str(l.linktype),str(l.previoustype),str(l.nexttype)].join('|');if(linkKeys.has(key))throw Error('Duplicate link identity '+key);linkKeys.add(key);const type=direction==='previous'&&l.linktype==='Payment'&&l.previoustype==='CustInvc'?'INVOICE_APPLICATION':'RELATED_TRANSACTION';const row=validateDecimalRecord({credit_memo_id:p,previous_doc_id:id(l.previousdoc),previous_line_id:str(l.previousline),next_doc_id:id(l.nextdoc),next_line_id:str(l.nextline),previous_type:str(l.previoustype),next_type:str(l.nexttype),link_type:str(l.linktype),relationship_class:type,applied_amount:l.foreignamount,discount_flag:str(l.discount),last_modified:linkDatetime(l.lastmodifieddate,p)},LINK_DECIMAL_TYPES,p);out[direction==='previous'?'previousLinks':'nextLinks'].push(row);};
 for(const l of previousLinks)addLink(l,'previous');for(const l of nextLinks)addLink(l,'next');
 for(const [p,h] of lookup){if(mainlines.get(p)!==1)throw Error('Exactly one AR mainline required '+p);if((byLines.get(p)||[]).length<2)throw Error('Missing detail lines '+p);if(!byGL.has(p))throw Error('Missing GL '+p);const books=new Set(byGL.get(p).map(g=>id(g.accounting_book_id)));for(const b of books){const status=classifyDocument({header:{internal_id:p},transactionLines:byLines.get(p)||[],accountingLines:byGL.get(p),bookId:b});if(status.classification==='BLOCKED')throw Error('GL BLOCKED '+p+': '+status.reason);out.financialClassification.push({...status,credit_memo_id:p});}}
 out.counts={headers:out.headers.length,transaction_lines:out.transactionLines.length,accounting_lines:out.accountingLines.length,previous_links:out.previousLinks.length,next_links:out.nextLinks.length,financial_book_groups:out.financialClassification.length};return out;
}
```

### `modules/customer-credit-memo/presence.mjs`

**Reconstructed SHA-256:** `16822f08a28ed05afff974aca6d32027cf24afc79df79e9a8ce21eda57b7c21c`.

```javascript
// Exact identity presence for all six Customer Credit Memo tables. No writes.
import {GROUPS,liveSource,sourceRows,storedRows,compareKeys} from './reconcile-common.mjs';
async function main(){
 console.log('MODULE 10 CUSTOMER CREDIT MEMO B5 EXACT PRESENCE | READ ONLY | NO SCHEDULER CHANGES');
 const mapped=await liveSource();let failed=false;
 for(const group of GROUPS){const source=sourceRows(mapped,group),stored=await storedRows(group);const r=compareKeys(source,stored,group);
  console.log('PRESENCE',JSON.stringify({table:group.table,source:r.source,bigquery:r.bigquery,onlyNetSuite:r.onlyNetSuite,onlyBigQuery:r.onlyBigQuery,onlyNetSuiteSample:r.onlyNetSuiteSample,onlyBigQuerySample:r.onlyBigQuerySample}));
  if(r.onlyNetSuite||r.onlyBigQuery||r.source!==r.bigquery)failed=true;
 }
 console.log('B5 EXACT PRESENCE:',failed?'BLOCKED':'PASS');if(failed)process.exitCode=1;
}
main().catch(e=>{console.error('B5 EXACT PRESENCE BLOCKED:',e?.stack??String(e));process.exitCode=1;});
```

### `modules/customer-credit-memo/reconcile-common.mjs`

**Reconstructed SHA-256:** `afd56759ed13b6264a22dce93628077d824480fc0028f6782817581629de5719`.

```javascript
// Module 10 standalone read-only NetSuite/BigQuery reconciliation helpers.
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
import {GROUPS} from './schema-contract.mjs';

export {GROUPS};
const numericTypes=new Set(['NUMERIC','BIGNUMERIC']);
const canonicalDecimal=value=>{
  if(value===null||value===undefined)return null;
  let s=String(value).trim();
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))throw Error('Invalid exact decimal: '+s);
  let sign='';if(s[0]==='-'||s[0]==='+'){sign=s[0]==='-'?'-':'';s=s.slice(1);}
  let [whole,fraction='']=s.split('.');whole=(whole||'0').replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');
  if(whole==='0'&&!fraction)return '0';
  return sign+whole+(fraction?'.'+fraction:'');
};
function stringify(value,type){
 if(value==null)return null;
 if(numericTypes.has(type))return canonicalDecimal(value?.value??value);
 if(type==='BOOL')return value===true?'true':value===false?'false':String(value);
 if(type==='DATE')return String(value?.value??value).slice(0,10);
 if(type==='DATETIME')return String(value?.value??value).replace('T',' ').replace(/(?:\.0+)?Z?$/,'');
 return String(value);
}
export function rowKey(row,g){return JSON.stringify(g.key.map(k=>row[k]==null?null:String(row[k])));}
export function indexed(rows,g,side){const result=new Map();for(const row of rows){const key=rowKey(row,g);if(result.has(key))throw Error(`DUPLICATE ${side} ${g.table} key=${key}`);result.set(key,row);}return result;}
export async function liveSource(){
 const access=await token();console.log('OAuth: SUCCESS');
 const headers=await fetchHeaders(access);const ids=headers.map(h=>String(h.internal_id));
 const [lines,gl,previous,next]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchPreviousLinks(access,ids),fetchNextLinks(access,ids)]);
 const mapped=mapSource(headers,lines,gl,previous,next);
 return mapped;
}
export function sourceRows(mapped,g){
 if(g.source==='financialClassification')return mapped.financialClassification.map(r=>({credit_memo_id:r.credit_memo_id,accounting_book_id:r.bookId,classification:r.classification,gl_delta:r.gl_delta,adjustment_line_id:r.adjustment_line_id??null,adjustment_unique_key:r.adjustment_unique_key??null,adjustment_foreign_amount:r.adjustment_foreign_amount??null,non_adjustment_gl_delta:r.non_adjustment_gl_delta??null}));
 return mapped[g.source];
}
export async function storedRows(g){
 // Reconcile active records only. Verified soft-deleted CCM headers and their
 // historical detail remain physically stored and must never be deleted.
 const expr=g.fields.map(([name,type])=>type==='NUMERIC'||type==='BIGNUMERIC'?`CAST(d.${name} AS STRING) AS ${name}`:type==='DATE'?`FORMAT_DATE('%Y-%m-%d',d.${name}) AS ${name}`:type==='DATETIME'?`FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',d.${name}) AS ${name}`:`d.${name} AS ${name}`).join(', ');
 const active=g.table==='customer_credit_memo_headers'
  ? 'COALESCE(d.is_deleted,FALSE)=FALSE'
  : `EXISTS (SELECT 1 FROM ${T('customer_credit_memo_headers')} AS h WHERE h.credit_memo_id=d.credit_memo_id AND COALESCE(h.is_deleted,FALSE)=FALSE)`;
 return query(`SELECT ${expr} FROM ${T(g.table)} AS d WHERE ${active}`);
}
export function compareKeys(source,stored,g,{maxExamples=5}={}){
 const a=indexed(source,g,'NetSuite'),b=indexed(stored,g,'BigQuery');
 const onlyNS=[...a.keys()].filter(x=>!b.has(x));const onlyBQ=[...b.keys()].filter(x=>!a.has(x));
 return {source:source.length,bigquery:stored.length,onlyNetSuite:onlyNS.length,onlyBigQuery:onlyBQ.length,onlyNetSuiteSample:onlyNS.slice(0,maxExamples),onlyBigQuerySample:onlyBQ.slice(0,maxExamples),a,b};
}
export function compareFields(a,b,g,{maxExamples=5}={}){
 let mismatches=0;const samples=[];
 for(const [key,source] of a){const target=b.get(key);if(!target)continue;
  for(const [field,type] of g.fields){const x=stringify(source[field],type),y=stringify(target[field],type);if(x!==y){mismatches++;if(samples.length<maxExamples)samples.push({key,field,source:x,bigquery:y});}}
 }
 return {mismatches,samples};
}
```

### `modules/customer-credit-memo/schema-contract.mjs`

**Reconstructed SHA-256:** `f0307c8ba30203626bfde58a9a75619ae0218280b3bbb5d8cdc27f0dde883d6c`.

```javascript
// Module 10 CustCred schema contract. No I/O. Keep numeric fields exact.
export const GROUPS = [
 {table:'customer_credit_memo_headers',source:'headers',key:['credit_memo_id'],fields:[
  ['credit_memo_id','STRING'],['document_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],['status_id','STRING'],['customer_id','STRING'],['customer_name','STRING'],['currency_id','STRING'],['currency_name','STRING'],['exchange_rate','NUMERIC'],['foreign_total','NUMERIC'],['base_total','NUMERIC'],['posting_period_id','STRING'],['subsidiary_id','STRING'],['is_void','BOOL']]},
 {table:'customer_credit_memo_lines',source:'transactionLines',key:['credit_memo_id','line_unique_key'],fields:[
  ['credit_memo_id','STRING'],['line_id','STRING'],['line_unique_key','STRING'],['line_number','STRING'],['is_mainline','BOOL'],['is_taxline','BOOL'],['is_cogs','BOOL'],['accounting_line_type','STRING'],['account_id','STRING'],['item_id','STRING'],['quantity','NUMERIC'],['rate','BIGNUMERIC'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC']]},
 {table:'customer_credit_memo_accounting_lines',source:'accountingLines',key:['credit_memo_id','accounting_book_id','line_id','account_id'],nullableKey:['account_id'],fields:[
  ['credit_memo_id','STRING'],['line_id','STRING'],['accounting_book_id','STRING'],['account_id','STRING'],['posting','BOOL'],['debit','NUMERIC'],['credit','NUMERIC']]},
 {table:'customer_credit_memo_previous_links',source:'previousLinks',key:['credit_memo_id','previous_doc_id','previous_line_id','next_doc_id','next_line_id','link_type','previous_type','next_type'],fields:[
  ['credit_memo_id','STRING'],['previous_doc_id','STRING'],['previous_line_id','STRING'],['next_doc_id','STRING'],['next_line_id','STRING'],['previous_type','STRING'],['next_type','STRING'],['link_type','STRING'],['relationship_class','STRING'],['applied_amount','NUMERIC'],['discount_flag','STRING'],['last_modified','DATETIME']]},
 {table:'customer_credit_memo_next_links',source:'nextLinks',key:['credit_memo_id','previous_doc_id','previous_line_id','next_doc_id','next_line_id','link_type','previous_type','next_type'],fields:[
  ['credit_memo_id','STRING'],['previous_doc_id','STRING'],['previous_line_id','STRING'],['next_doc_id','STRING'],['next_line_id','STRING'],['previous_type','STRING'],['next_type','STRING'],['link_type','STRING'],['relationship_class','STRING'],['applied_amount','NUMERIC'],['discount_flag','STRING'],['last_modified','DATETIME']]},
 {table:'customer_credit_memo_financial_classification',source:'financialClassification',key:['credit_memo_id','accounting_book_id'],fields:[
  ['credit_memo_id','STRING'],['accounting_book_id','STRING'],['classification','STRING'],['gl_delta','NUMERIC'],['adjustment_line_id','STRING'],['adjustment_unique_key','STRING'],['adjustment_foreign_amount','NUMERIC'],['non_adjustment_gl_delta','NUMERIC']]} 
];
export const EXTRA_HEADER = [['synced_at','TIMESTAMP'],['is_deleted','BOOL'],['deleted_at','TIMESTAMP']];
export const EXTRA_DETAIL = [['synced_at','TIMESTAMP']];
export const columnDefinitions = (g) => [...g.fields,...(g===GROUPS[0]?EXTRA_HEADER:EXTRA_DETAIL)];
```

### `modules/customer-credit-memo/sync.mjs`

**Reconstructed SHA-256:** `f3126d6809b3833aa43aeaa0116c1ab02f9e402d8cbc317b12b3452292415cf8`.

```javascript
// Module 10 Customer Credit Memo: guarded INITIAL load only.
// Mirrors purchase-return stage -> BigQuery transaction -> checkpoints baseline.
// Subsequent incremental sync requires a separate reviewed implementation.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {dataset,query,T,LOCATION,DATASET} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
import {validateNumeric} from '../../common/decimal-precision.mjs';
import {validateBigNumeric} from '../../common/decimal-precision.mjs';

if(process.argv.length!==3||process.argv[2]!=='--sync')throw Error('INITIAL SYNC requires exactly --sync. Run dry-run-sync.mjs --dry-run beforehand.');
const cpNames=GROUPS.map(g=>g.table);
const quoted=cpNames.map(x=>`'${x}'`).join(',');
const fail=m=>{throw Error('CUSTOMER CREDIT MEMO INITIAL SYNC BLOCKED: '+m);};
const countValue=x=>Number(typeof x==='object'&&x!==null&&'value' in x?x.value:x);

// Module-local concurrency recovery. Never pause or alter pre-existing production tasks.
// Retry ONLY when BigQuery explicitly reports a transaction update conflict.
const MAX_COMMIT_ATTEMPTS=5;
const RETRY_DELAYS_MS=[1500,3000,6000,12000];
export const isCheckpointConflict=error=>{
 const message=String(error?.message??error??'');
 return /transaction is aborted due to concurrent update against table/i.test(message)
   && /sync_checkpoints/i.test(message);
};
export async function commitWithIsolation({execute,ensureClean,sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms)),log=console.log,maxAttempts=MAX_COMMIT_ATTEMPTS,delays=RETRY_DELAYS_MS}){
 if(!Number.isInteger(maxAttempts)||maxAttempts<1)throw Error('Invalid retry attempts');
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  // Mandatory before every commit, including the first one. Checks both targets and module checkpoints.
  await ensureClean();
  try{
   await execute();
   return {attempts:attempt};
  }catch(error){
   // Fail closed for all errors other than the *specific* checkpoint concurrency conflict.
   if(!isCheckpointConflict(error))throw error;
   // An uncertain/partial commit must never be retried. Any data or module CP => BLOCKED.
   await ensureClean();
   if(attempt===maxAttempts)throw Error(`Customer Credit Memo standalone checkpoint conflict retry exhausted (${attempt} attempts)`,{cause:error});
   const delay=delays[Math.min(attempt-1,delays.length-1)];
   log(`STANDALONE CHECKPOINT CONFLICT: retry ${attempt}/${maxAttempts-1}; module targets and checkpoints confirmed empty; existing schedulers unchanged`);
   await sleep(delay);
  }
 }
}

const accountingRow=r=>({credit_memo_id:r.credit_memo_id,accounting_book_id:r.bookId,classification:r.classification,gl_delta:r.gl_delta,adjustment_line_id:r.adjustment_line_id??null,adjustment_unique_key:r.adjustment_unique_key??null,adjustment_foreign_amount:r.adjustment_foreign_amount??null,non_adjustment_gl_delta:r.non_adjustment_gl_delta??null});
function assertType(value,type,where){
 if(value==null)return;
 if(type==='STRING'&&typeof value==='string')return;
 if(type==='BOOL'&&typeof value==='boolean')return;
 if(type==='DATE'&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return;
 if(type==='DATETIME'&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return;
 if(type==='NUMERIC'){if(typeof value!=='string'||validateNumeric(value,{module:'customer-credit-memo',field:where})!==value)fail(where+' NUMERIC invalid');return;}
 if(type==='BIGNUMERIC'){if(typeof value!=='string'||validateBigNumeric(value,{module:'customer-credit-memo',field:where})!==value)fail(where+' BIGNUMERIC invalid');return;}
 fail(where+' type '+type+' invalid');
}
async function preconditions(){
 const [hasCP]=await dataset.table('sync_checkpoints').exists();if(!hasCP)fail('sync_checkpoints absent');
 const checkpoint=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${quoted}) OR record_type IN ('customer-credit-memo','customer_credit_memo')`);
 if(checkpoint.length)fail('module checkpoint exists; initial-only sync must not rerun');
 for(const g of GROUPS){const tbl=dataset.table(g.table);const [exists]=await tbl.exists();if(!exists)fail('Missing '+g.table);
  const [metadata]=await tbl.getMetadata();const actual=metadata.schema?.fields??[];const expected=columnDefinitions(g);
  if(actual.length!==expected.length)fail('Schema field count '+g.table);
  for(const [name,type] of expected){const field=actual.find(f=>f.name.toLowerCase()===name.toLowerCase());if(!field||(field.type.toUpperCase()==='BOOLEAN'?'BOOL':field.type.toUpperCase())!==type)fail('Schema mismatch '+g.table+'.'+name);}
  const rows=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);if(countValue(rows[0].n)!==0)fail('Target not empty '+g.table);
 }
}
async function stage(stagingName,rows,fields){
 const table=dataset.table(stagingName);
 if(!rows.length){
  // BigQuery rejects SELECT expressions + WHERE without FROM.
  // Create a typed, genuinely empty staging table; do not synthesize a row.
  await query(`CREATE TABLE ${T(stagingName)} (${fields.map(([name,type])=>`${name} ${type}`).join(', ')})`);
  const [res]=await query(`SELECT COUNT(*) AS n FROM ${T(stagingName)}`);
  if(countValue(res.n)!==0)fail('Empty staging count mismatch '+stagingName);
  return;
 }
 const filename=path.join(os.tmpdir(),`netsuite-ccm-${crypto.randomUUID()}.ndjson`);
 await fs.writeFile(filename,rows.map(row=>JSON.stringify(row)).join('\n')+'\n',{mode:0o600});
 try{await table.load(filename,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:fields.map(([name,type])=>({name,type}))},location:LOCATION});}
 finally{await fs.rm(filename,{force:true});}
 const [res]=await query(`SELECT COUNT(*) AS n FROM ${T(stagingName)}`);if(countValue(res.n)!==rows.length)fail('Staging count mismatch '+stagingName);
}
async function main(){
 console.log(`CUSTOMER CREDIT MEMO B4 INITIAL PRODUCTION SYNC | ${DATASET} | ${LOCATION}`);
 console.log('GUARD: INITIAL LOAD ONLY | ATOMIC MERGE + 6 CHECKPOINTS | NO DELETION / SCHEDULER');
 await preconditions();
 const access=await token();console.log('OAuth: SUCCESS');
 const h=await fetchHeaders(access),ids=h.map(x=>String(x.internal_id));if(!ids.length)fail('Empty source initial load');
 if(ids.length!==new Set(ids).size)fail('Duplicate source header');
 const [l,a,p,n]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchPreviousLinks(access,ids),fetchNextLinks(access,ids)]);
 const mapped=mapSource(h,l,a,p,n);
 const prepared=GROUPS.map(g=>({g,rows:g.source==='financialClassification'?mapped.financialClassification.map(accountingRow):mapped[g.source]}));
 for(const {g,rows} of prepared){const seen=new Set();for(let i=0;i<rows.length;i++){const r=rows[i];for(const [field,type] of g.fields)assertType(r[field],type,`${g.table}[${i}].${field}`);
   for(const k of g.key){if((g.nullableKey??[]).includes(k))continue;if(r[k]==null||r[k]==='')fail('Missing key '+g.table+'.'+k);}
   const key=JSON.stringify(g.key.map(k=>r[k]));if(seen.has(key))fail('Duplicate '+g.table+' '+key);seen.add(key);
   for(const k of Object.keys(r))if(!g.fields.some(f=>f[0]===k))fail('Unexpected column '+g.table+'.'+k);
  }console.log('PAYLOAD',g.table,rows.length);}
 const classifications=mapped.financialClassification.reduce((r,x)=>(r[x.classification]=(r[x.classification]??0)+1,r),{});
 if(Object.keys(classifications).some(k=>!['GL_EXACT_BALANCED','SOURCE_ADJUSTMENT_VERIFIED'].includes(k)))fail('Financial classification BLOCKED');
 console.log('FINANCIAL_CLASSIFICATION:',JSON.stringify(classifications));
 const wm=h.map(x=>x.last_modified).filter(Boolean).sort().at(-1);
 if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(wm??''))fail('Source watermark invalid');
 // Recheck target/checkpoint before staging. Transaction repeats these guards to catch races.
 await preconditions();
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);
 const stages=prepared.map(({g,rows},index)=>({g,rows,name:`_stage_ccm_${index}_${suffix}`}));
 try{
  for(const s of stages){await stage(s.name,s.rows,s.g.fields);console.log('STAGED:',s.g.table,s.rows.length);}
  const asserts=stages.map(s=>`ASSERT (SELECT COUNT(*) FROM ${T(s.name)})=${s.rows.length} AS 'Stage row count ${s.g.table}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${s.g.key.join(',')} FROM ${T(s.name)} GROUP BY ${s.g.key.join(',')} HAVING COUNT(*)>1))=0 AS 'Stage duplicate ${s.g.table}';`).join('\n');
  const inserts=stages.map((s,i)=>{const cols=s.g.fields.map(([name])=>name);const extra=i===0?'synced_at,is_deleted,deleted_at':'synced_at';const vals=i===0?'CURRENT_TIMESTAMP(),FALSE,NULL':'CURRENT_TIMESTAMP()';return `INSERT INTO ${T(s.g.table)} (${cols.join(',')},${extra}) SELECT ${cols.join(',')},${vals} FROM ${T(s.name)};`;}).join('\n');
  const orphan=stages.slice(1).map(s=>`ASSERT (SELECT COUNT(*) FROM ${T(s.g.table)} d LEFT JOIN ${T(GROUPS[0].table)} h ON h.credit_memo_id=d.credit_memo_id WHERE h.credit_memo_id IS NULL)=0 AS 'Orphan ${s.g.table}';`).join('\n');
  const checkpointSql=`MERGE ${T('sync_checkpoints')} d USING (SELECT record_type FROM UNNEST([${quoted}]) AS record_type) s ON d.record_type=s.record_type\nWHEN MATCHED THEN UPDATE SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP()\nWHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());`;
  const nonempty=GROUPS.map(g=>`ASSERT (SELECT COUNT(*) FROM ${T(g.table)})=0 AS 'Target changed ${g.table}';`).join('\n');
  const sql=`BEGIN\nBEGIN TRANSACTION;\n${asserts}\nASSERT (SELECT COUNT(*) FROM ${T('sync_checkpoints')} WHERE record_type IN (${quoted}) OR record_type IN ('customer-credit-memo','customer_credit_memo'))=0 AS 'Checkpoint appeared';\n${nonempty}\n${inserts}\n${orphan}\n${checkpointSql}\nCOMMIT TRANSACTION;\nEXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;\nEND;`;
  const outcome=await commitWithIsolation({execute:()=>query(sql,{wm}),ensureClean:preconditions});
  console.log('B4 INITIAL ATOMIC SYNC COMMITTED: 6 tables + 6 checkpoints; attempts='+outcome.attempts);
  console.log('NEXT: run presence/check/financial reconciliation; NOT FINAL_PASS; automatic verified deletion not enabled.');
 }finally{for(const s of stages){try{await dataset.table(s.name).delete({ignoreNotFound:true});}catch(e){console.warn('Staging cleanup:',s.name,e.message);}}}
}
main().catch(e=>{console.error('CUSTOMER CREDIT MEMO B4 SYNC BLOCKED:',e?.stack??String(e));process.exitCode=1;});
```

### `modules/customer-credit-memo/verified-deletion.mjs`

**Reconstructed SHA-256:** `819432944f6b5b8bcfe0f6f3fd80ac43528b245fdb2529918bf5a2e406fd547d`.

```javascript
// CCM B7 standalone verified deletion; mirrors existing verified-deletion baseline.
// No integration with existing scheduler or legacy module files.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {token,fetchHeaders} from './mapping.mjs';
import {fetchAll} from '../../common/netsuite-client.mjs';
import {query,T} from '../../common/bigquery-client.mjs';
import {matchDeletedRecordProof} from '../../common/verified-deletion-proof.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const mode=process.argv[2];
if(process.argv.length!==3||!['--dry-run','--apply'].includes(mode))throw Error('Usage: node modules/customer-credit-memo/verified-deletion.mjs --dry-run|--apply');
const apply=mode==='--apply', LIMIT=3, idRx=/^[1-9][0-9]{0,14}$/;
const table=T('customer_credit_memo_headers');
const idConfig=path.join(root,'modules','customer-credit-memo','deletion-identity.confirmed.json');
const fail=(s)=>{throw Error('CCM VERIFIED DELETION BLOCKED: '+s)};
const val=x=>typeof x==='object'&&x!==null&&'value' in x?x.value:x;
const recordId=x=>{const v=String(val(x));if(!idRx.test(v))fail('Invalid ID '+v);return v;};
function confirmedIdentity(){
 if(!fs.existsSync(idConfig))fail('No independently verified CCM deletedrecord identity; only CLEAN inventory is certifiable.');
 const c=JSON.parse(fs.readFileSync(idConfig,'utf8'));
 if(c.module!=='customer-credit-memo'||c.transactionType!=='CustCred'||!c.independentlyVerified||!c.evidenceRecordId||!idRx.test(String(c.evidenceRecordId))||!c.recordtypeid||!c.type||!c.confirmedBy||!c.confirmedAt)fail('Identity confirmation incomplete');
 if(!/^[a-z][a-z0-9_]*$/i.test(c.recordtypeid)||!/^[A-Z][A-Z0-9_]*$/.test(c.type))fail('Invalid identity tuple format');
 return {recordtypeid:c.recordtypeid,type:c.type,evidenceRecordId:String(c.evidenceRecordId)};
}
async function proof(access,id,identity){
 const rows=await fetchAll(access,`SELECT recordid,recordtypeid,type,name,deleteddate,deletedby,context FROM deletedrecord WHERE recordid = ${id}`);
 const matching=matchDeletedRecordProof(rows,id,identity);
 if(matching.length!==1)fail('Independent deletedrecord tuple is not unique for '+id+' (rows='+rows.length+',matches='+matching.length+')');
 return matching[0];
}
async function absence(access,id){
 const rows=await fetchAll(access,`SELECT id,type FROM Transaction WHERE id = ${id}`);
 if(rows.length)fail('Source still visible: '+id);
}
async function bqState(id){
 const rows=await query(`SELECT credit_memo_id,COALESCE(is_deleted,FALSE) AS is_deleted FROM ${table} WHERE credit_memo_id=@id`,{id});
 if(rows.length!==1||rows[0].is_deleted)fail('Invalid/soft-deleted BQ header '+id);
}
function audit(row){
 const dir=path.join(root,'logs','verified-deletions');fs.mkdirSync(dir,{recursive:true});
 fs.appendFileSync(path.join(dir,'audit.jsonl'),JSON.stringify(row)+'\n');
}
async function main(){
 console.log('CCM B7 VERIFIED DELETION |',mode,'| STANDALONE | MAX_BATCH=3');
 console.log('GUARD: proof + source absence + atomic header soft-delete; historical detail/checkpoint untouched');
 const access=await token();console.log('OAuth: SUCCESS');
 const [headers,raw]=await Promise.all([
   fetchHeaders(access),
   query(`SELECT credit_memo_id FROM ${table} WHERE COALESCE(is_deleted,FALSE)=FALSE`)
 ]);
 const srcIds=headers.map(x=>recordId(x.internal_id));
 const bqIds=raw.map(x=>recordId(x.credit_memo_id));
 const source=new Set(srcIds),bq=new Set(bqIds);
 if(source.size!==srcIds.length||bq.size!==bqIds.length)fail('Duplicate presence IDs');
 const onlyNS=[...source].filter(x=>!bq.has(x)).sort();
 const onlyBQ=[...bq].filter(x=>!source.has(x)).sort();
 console.log('INVENTORY',JSON.stringify({netSuite:srcIds.length,bigQuery:bqIds.length,onlyNetSuite:onlyNS,onlyBigQuery:onlyBQ}));
 if(onlyNS.length)fail('Unsynced NetSuite records: '+onlyNS.join(',')+'; sync/reconcile first');
 if(!onlyBQ.length){console.log('CCM B7 DELETION INVENTORY CLEAN: PASS | no candidate | ZERO writes');return;}
 if(onlyBQ.length>LIMIT)fail('Candidate count exceeds max 3; no automatic partial deletion');
 const identity=confirmedIdentity();
 const proofAccess=await token();
 for(const id of onlyBQ){await proof(proofAccess,id,identity);await absence(proofAccess,id);await bqState(id);console.log('VERIFIED CANDIDATE',id,JSON.stringify(identity));}
 if(!apply){console.log('CCM B7 VERIFIED DELETION DRY RUN PASS: candidates='+onlyBQ.length+' | ZERO writes');return;}
 if(process.env.NETSUITE_VERIFIED_DELETE_CONFIRM!=='I_CONFIRM_VERIFIED_SOFT_DELETE')fail('Explicit deletion confirmation missing');
 // Apply one proven deletion at a time, same as shared production baseline.
 for(const id of onlyBQ){
   const live=await token();const e=await proof(live,id,identity);await absence(live,id);await bqState(id);
   // The only persisted mutation: header soft-delete; no child deletes, no checkpoint update.
   await query(`BEGIN TRANSACTION;\nASSERT (SELECT COUNT(*) FROM ${table} WHERE credit_memo_id=@id AND COALESCE(is_deleted,FALSE)=FALSE)=1 AS 'Header state changed';
UPDATE ${table} SET is_deleted=TRUE,deleted_at=CURRENT_TIMESTAMP() WHERE credit_memo_id=@id AND COALESCE(is_deleted,FALSE)=FALSE;
ASSERT (SELECT COUNT(*) FROM ${table} WHERE credit_memo_id=@id AND is_deleted=TRUE)=1 AS 'Soft-delete assertion failed';
COMMIT TRANSACTION;`,{id});
   const check=await query(`SELECT is_deleted FROM ${table} WHERE credit_memo_id=@id`,{id});
   if(check.length!==1||check[0].is_deleted!==true)fail('Post-commit verification failed for '+id);
   audit({at:new Date().toISOString(),module:'customer-credit-memo',id,recordtypeid:e.recordtypeid,type:e.type,deleteddate:e.deleteddate,deletedby:e.deletedby,result:'SOFT_DELETED'});
   console.log('VERIFIED SOFT DELETE PASS',id);
 }
 console.log('CCM B7 VERIFIED DELETION APPLY PASS: deleted='+onlyBQ.length+' | detail/checkpoints untouched');
}
main().catch(e=>{console.error(e?.stack??String(e));process.exitCode=1;});
```

### `modules/item-fulfillment/check.mjs`

**Reconstructed SHA-256:** `634b411ea6a4ea94a2b78edf8d182190a4be2bd72c4fb7c462d806b4a19067ea`.

```javascript
import { bq as sharedBQ } from '../../common/bigquery-client.mjs';
import { token as sharedToken } from '../../common/netsuite-client.mjs';

import fs from 'fs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
  CLIENT_ID,
  CERTIFICATE_ID,
  PRIVATE_KEY_PATH
} from '../../credentials/netsuite-secrets.mjs';

// =====================================================
// CONFIGURATION
// =====================================================

const BASE_URL =
  'https://6930902.suitetalk.api.netsuite.com';

const TOKEN_URL =
  `${BASE_URL}/services/rest/auth/oauth2/v1/token`;

const PROJECT_ID = 'even-gearbox-255203';
const DATASET_ID = 'netsuite_backup';
const LOCATION = 'asia-southeast1';

const DATE_FROM = '2026-10-01';
const DATE_TO = '2026-11-01';

const ACCOUNTING_BOOK = '1';
const BATCH_SIZE = 25;
const PAGE_SIZE = 1000;

const bq = sharedBQ;

const table = name =>
  `\`${PROJECT_ID}.${DATASET_ID}.${name}\``;

// =====================================================
// HELPERS
// =====================================================

function n(value) {
  const raw =
    value && typeof value === 'object' &&
    'value' in value ? value.value : value;

  const result = Number(raw ?? 0);

  if (!Number.isFinite(result)) {
    throw new Error(`Invalid numeric value: ${raw}`);
  }

  return result;
}

function sum(rows, field) {
  return rows.reduce(
    (total, row) => total + n(row[field]),
    0
  );
}

function money(value) {
  return n(value).toFixed(2);
}

function fmt(value) {
  return n(value).toLocaleString('en-US', {
    maximumFractionDigits: 6
  });
}

function amountMatch(a, b) {
  return Math.abs(n(a) - n(b)) < 0.005;
}

function quantityMatch(a, b) {
  return Math.abs(n(a) - n(b)) < 0.000001;
}

function chunks(array, size) {
  const result = [];

  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }

  return result;
}

function assertId(value) {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid transaction ID: ${value}`);
  }

  return id;
}

async function bqQuery(sql) {
  const [rows] = await bq.query({
    query: sql,
    location: LOCATION
  });

  return rows;
}

// =====================================================
// NETSUITE OAUTH
// =====================================================

const getToken = sharedToken;

async function suiteql(
  token,
  sql,
  limit = PAGE_SIZE,
  offset = 0
) {
  const url =
    `${BASE_URL}/services/rest/query/v1/suiteql` +
    `?limit=${limit}&offset=${offset}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'transient'
      },
      body: JSON.stringify({ q: sql })
    });

    const text = await response.text();

    if (response.ok) {
      return JSON.parse(text);
    }

    if (
      attempt === 3 ||
      ![429, 500, 502, 503, 504].includes(response.status)
    ) {
      throw new Error(
        `SuiteQL HTTP ${response.status}: ${text}\n${sql}`
      );
    }

    await new Promise(resolve =>
      setTimeout(resolve, attempt * 2000)
    );
  }
}

async function getAllRows(token, sql) {
  const rows = [];
  let offset = 0;

  while (true) {
    const page = await suiteql(
      token,
      sql,
      PAGE_SIZE,
      offset
    );

    const items = page.items ?? [];

    rows.push(...items);

    if (!page.hasMore) break;

    if (!items.length) {
      throw new Error('SuiteQL pagination failed');
    }

    offset += PAGE_SIZE;

    if (offset > 1000000) {
      throw new Error('Pagination safety limit reached');
    }
  }

  return rows;
}

// =====================================================
// FETCH NETSUITE HEADERS
// =====================================================

async function getHeaders(token) {
  return getAllRows(token, `
    SELECT
      id,
      tranid,
      TO_CHAR(trandate, 'YYYY-MM-DD')
        AS transaction_date
    FROM Transaction
    WHERE type = 'ItemShip'
      AND trandate >= TO_DATE(
        '${DATE_FROM}', 'YYYY-MM-DD'
      )
      AND trandate < TO_DATE(
        '${DATE_TO}', 'YYYY-MM-DD'
      )
    ORDER BY id
  `);
}

// =====================================================
// FETCH NETSUITE LINES AND GL
// =====================================================

async function getDetails(token, ids, type) {
  const results = [];
  const batches = chunks(ids, BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const idList = batches[i].join(',');

    const sql = type === 'lines'
      ? `
        SELECT
          transaction,
          id,
          uniquekey,
          item,
          mainline,
          iscogs,
          accountinglinetype,
          quantity
        FROM TransactionLine
        WHERE transaction IN (${idList})
        ORDER BY transaction, id
      `
      : `
        SELECT
          transaction,
          transactionline,
          accountingbook,
          posting,
          debit,
          credit,
          netamount
        FROM TransactionAccountingLine
        WHERE transaction IN (${idList})
        ORDER BY transaction, transactionline
      `;

    const rows = await getAllRows(token, sql);

    results.push(...rows);

    console.log(
      `${type} batch ${i + 1}/${batches.length}: ${rows.length}`
    );
  }

  return results;
}

// =====================================================
// NETSUITE KPI
// =====================================================

function calculateNetSuite(headers, lines, accounting) {
  const headerIds = new Set(
    headers.map(row => String(row.id))
  );

  const cogsLines = lines.filter(row =>
    row.mainline === 'F' &&
    row.iscogs === 'T' &&
    row.accountinglinetype === 'COGS' &&
    row.item != null
  );

  const assetLines = lines.filter(row =>
    row.mainline === 'F' &&
    row.accountinglinetype === 'ASSET'
  );

  const accountingMap = new Map();

  for (const row of accounting) {
    if (
      String(row.accountingbook) !== ACCOUNTING_BOOK ||
      row.posting !== 'T'
    ) {
      continue;
    }

    const key = `${row.transaction}:${row.transactionline}`;

    if (!accountingMap.has(key)) {
      accountingMap.set(key, []);
    }

    accountingMap.get(key).push(row);
  }

  const errors = [];
  const uniqueKeys = new Set();
  const lineDocumentIds = new Set();

  let cogsAmount = 0;
  let assetCredit = 0;
  let totalQty = 0;
  let assetQty = 0;

  for (const line of cogsLines) {
    const key =
      `${line.transaction}:${line.uniquekey}`;

    if (
      line.uniquekey == null ||
      uniqueKeys.has(key)
    ) {
      errors.push(`Duplicate/missing COGS key: ${key}`);
    }

    uniqueKeys.add(key);
    lineDocumentIds.add(String(line.transaction));

    if (!headerIds.has(String(line.transaction))) {
      errors.push(`Orphan source line: ${key}`);
    }

    const gl =
      accountingMap.get(
        `${line.transaction}:${line.id}`
      ) ?? [];

    if (!gl.length) {
      errors.push(`Missing COGS GL: ${key}`);
    }

    cogsAmount += sum(gl, 'debit');
    totalQty += n(line.quantity);
  }

  for (const line of assetLines) {
    const gl =
      accountingMap.get(
        `${line.transaction}:${line.id}`
      ) ?? [];

    if (!gl.length) {
      errors.push(
        `Missing ASSET GL: ${line.transaction}:${line.id}`
      );
    }

    assetCredit += sum(gl, 'credit');
    assetQty += n(line.quantity);
  }

  const withoutLines =
    [...headerIds].filter(
      id => !lineDocumentIds.has(id)
    ).length;

  if (cogsLines.length !== assetLines.length) {
    errors.push('COGS and ASSET line count mismatch');
  }

  if (!amountMatch(cogsAmount, assetCredit)) {
    errors.push('COGS debit and ASSET credit mismatch');
  }

  if (!quantityMatch(totalQty, -assetQty)) {
    errors.push('COGS and ASSET quantity mismatch');
  }

  if (withoutLines > 0) {
    errors.push(`${withoutLines} headers without COGS lines`);
  }

  return {
    count: headers.length,
    lineCount: cogsLines.length,
    documentCount: lineDocumentIds.size,
    quantity: totalQty,
    cogs: cogsAmount,
    assetCredit,
    assetLineCount: assetLines.length,
    withoutLines,
    errors
  };
}

// =====================================================
// BIGQUERY KPI
// =====================================================

async function getBigQueryKpi() {
  const rows = await bqQuery(`
    WITH h AS (
      SELECT *
      FROM ${table('item_fulfillment_headers')}
      WHERE transaction_date >= DATE '${DATE_FROM}'
        AND transaction_date < DATE '${DATE_TO}'
        AND is_deleted = FALSE
    ),
    l AS (
      SELECT l.*
      FROM ${table('item_fulfillment_lines')} l
      JOIN h
        ON h.internal_id = l.fulfillment_internal_id
      WHERE l.transaction_date >= DATE '${DATE_FROM}'
        AND l.transaction_date < DATE '${DATE_TO}'
    )
    SELECT
      (SELECT COUNT(*) FROM h) AS header_count,

      (SELECT COUNT(*) FROM l) AS line_count,

      (SELECT COUNT(DISTINCT fulfillment_internal_id)
       FROM l) AS document_count,

      (SELECT COALESCE(SUM(total_quantity_shipped), 0)
       FROM h) AS header_qty,

      (SELECT COALESCE(SUM(quantity_shipped), 0)
       FROM l) AS line_qty,

      (SELECT COALESCE(SUM(total_cogs_amount), 0)
       FROM h) AS header_cogs,

      (SELECT COALESCE(SUM(cogs_amount), 0)
       FROM l) AS line_cogs,

      (SELECT COUNT(*) FROM (
        SELECT internal_id
        FROM h
        GROUP BY internal_id
        HAVING COUNT(*) > 1
      )) AS duplicate_headers,

      (SELECT COUNT(*) FROM (
        SELECT
          fulfillment_internal_id,
          line_unique_key
        FROM l
        GROUP BY
          fulfillment_internal_id,
          line_unique_key
        HAVING COUNT(*) > 1
      )) AS duplicate_lines,

      (SELECT COUNT(*)
       FROM l
       LEFT JOIN h
         ON h.internal_id = l.fulfillment_internal_id
       WHERE h.internal_id IS NULL) AS orphan_lines,

      (SELECT COUNT(*)
       FROM h
       LEFT JOIN (
         SELECT DISTINCT fulfillment_internal_id
         FROM l
       ) x
         ON x.fulfillment_internal_id = h.internal_id
       WHERE x.fulfillment_internal_id IS NULL)
       AS headers_without_lines
  `);

  return rows[0];
}

// =====================================================
// DOCUMENT-LEVEL COGS DIAGNOSTIC (READ ONLY)
// =====================================================

async function showCogsDifferences(headers, lines, accounting) {
  const sourceById = new Map(headers.map(h => [String(h.id), {
    number: h.tranid ?? null,
    cogs: 0
  }]));
  const cogsKeys = new Set(
    lines.filter(l => l.mainline === 'F' && l.iscogs === 'T' &&
      l.accountinglinetype === 'COGS' && l.item != null)
      .map(l => `${l.transaction}:${l.id}`)
  );
  for (const gl of accounting) {
    if (String(gl.accountingbook) !== ACCOUNTING_BOOK || gl.posting !== 'T') continue;
    if (!cogsKeys.has(`${gl.transaction}:${gl.transactionline}`)) continue;
    const doc = sourceById.get(String(gl.transaction));
    if (doc) doc.cogs += n(gl.debit);
  }

  const rows = await bqQuery(`
    SELECT internal_id, fulfillment_number, total_cogs_amount,
           FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', netsuite_last_modified_at) AS last_modified
    FROM ${table('item_fulfillment_headers')}
    WHERE transaction_date >= DATE '${DATE_FROM}'
      AND transaction_date < DATE '${DATE_TO}'
      AND COALESCE(is_deleted, FALSE) = FALSE
  `);
  const targetById = new Map(rows.map(r => [String(r.internal_id), r]));
  const differences = [];
  for (const [id, doc] of sourceById) {
    const target = targetById.get(id);
    if (!target) {
      differences.push({ id, document: doc.number, issue: 'MISSING_IN_BIGQUERY' });
      continue;
    }
    const diff = doc.cogs - n(target.total_cogs_amount);
    if (Math.abs(diff) >= 0.005) {
      differences.push({ id, document: doc.number, source_cogs: money(doc.cogs),
        bigquery_cogs: money(target.total_cogs_amount), difference: money(diff),
        bigquery_last_modified: target.last_modified });
    }
  }
  for (const [id, target] of targetById) {
    if (!sourceById.has(id)) {
      differences.push({ id, document: target.fulfillment_number,
        issue: 'ACTIVE_ONLY_IN_BIGQUERY' });
    }
  }
  console.log('\nDOCUMENT-LEVEL COGS DIAGNOSTIC (READ ONLY)');
  console.log(`Different documents: ${differences.length}`);
  for (const item of differences.slice(0, 40)) console.log(JSON.stringify(item));
  if (differences.length > 40) console.log(`Additional mismatches: ${differences.length - 40}`);
}

// =====================================================
// COMPARISON
// =====================================================

function compare(source, target) {
  const checks = [];

  function check(name, a, b, comparator = quantityMatch) {
    const pass = comparator(a, b);

    checks.push({ name, pass });

    console.log(
      `${name.padEnd(27)} : ${pass ? 'PASS' : 'FAIL'}`
    );

    return pass;
  }

  console.log('\n==========================================');
  console.log('HEADER RECONCILIATION');
  console.log('==========================================');

  console.log(`NetSuite COUNT : ${source.count}`);
  console.log(`BigQuery COUNT : ${target.header_count}`);

  console.log(
    `NetSuite COGS  : ${money(source.cogs)}`
  );

  console.log(
    `BigQuery COGS  : ${money(target.header_cogs)}`
  );

  check('HEADER COUNT',
    source.count, target.header_count);

  check('HEADER COGS',
    source.cogs, target.header_cogs, amountMatch);

  check('HEADER QUANTITY',
    source.quantity, target.header_qty);

  console.log('\n==========================================');
  console.log('LINE RECONCILIATION');
  console.log('==========================================');

  console.log(`NetSuite LINES : ${source.lineCount}`);
  console.log(`BigQuery LINES : ${target.line_count}`);

  console.log(`NetSuite QTY   : ${fmt(source.quantity)}`);
  console.log(`BigQuery QTY   : ${fmt(target.line_qty)}`);

  console.log(`NetSuite COGS  : ${money(source.cogs)}`);
  console.log(`BigQuery COGS  : ${money(target.line_cogs)}`);

  check('LINE COUNT',
    source.lineCount, target.line_count);

  check('DOCUMENTS WITH LINES',
    source.documentCount, target.document_count);

  check('LINE QUANTITY',
    source.quantity, target.line_qty);

  check('LINE COGS',
    source.cogs, target.line_cogs, amountMatch);

  console.log('\n==========================================');
  console.log('INTEGRITY CHECK');
  console.log('==========================================');

  console.log(`Source COGS lines  : ${source.lineCount}`);
  console.log(`Source ASSET lines : ${source.assetLineCount}`);

  console.log(`COGS debit         : ${money(source.cogs)}`);
  console.log(`ASSET credit       : ${money(source.assetCredit)}`);

  console.log(`Duplicate headers  : ${target.duplicate_headers}`);
  console.log(`Duplicate lines    : ${target.duplicate_lines}`);
  console.log(`Orphan lines       : ${target.orphan_lines}`);
  console.log(`Headers no lines   : ${target.headers_without_lines}`);

  check('COGS/ASSET LINE COUNT',
    source.lineCount, source.assetLineCount);

  check('COGS/ASSET AMOUNT',
    source.cogs, source.assetCredit, amountMatch);

  check('DUPLICATE HEADERS',
    target.duplicate_headers, 0);

  check('DUPLICATE LINES',
    target.duplicate_lines, 0);

  check('ORPHAN LINES',
    target.orphan_lines, 0);

  check('HEADERS WITHOUT LINES',
    target.headers_without_lines, 0);

  check('NETSUITE SOURCE ERRORS',
    source.errors.length, 0);

  return checks.every(row => row.pass);
}

// =====================================================
// MAIN
// =====================================================

async function main() {
  console.log('\n==========================================');
  console.log('ITEM FULFILLMENT FINAL RECONCILIATION');
  console.log('==========================================');
  console.log('Period: October 2026');
  console.log('Accounting Book: 1');
  console.log('Mode: READ ONLY');

  console.log('\nRequesting NetSuite OAuth token...');

  const token = await getToken();

  console.log('NetSuite OAuth: SUCCESS');

  console.log('\nFetching NetSuite headers...');

  const headers = await getHeaders(token);

  console.log(`Fulfillments found: ${headers.length}`);

  const ids = headers.map(row => assertId(row.id));

  console.log('\nFetching NetSuite lines...');

  const lines = await getDetails(
    token, ids, 'lines'
  );

  console.log('\nFetching NetSuite GL impact...');

  const accounting = await getDetails(
    token, ids, 'accounting'
  );

  console.log('\nCalculating NetSuite KPI...');

  const source = calculateNetSuite(
    headers, lines, accounting
  );

  console.log('\nFetching BigQuery KPI...');

  const target = await getBigQueryKpi();

  const passed = compare(source, target);

  if (!passed) {
    await showCogsDifferences(headers, lines, accounting);
  }

  if (source.errors.length > 0) {
    console.log('\nSOURCE ERRORS:');

    source.errors.slice(0, 20).forEach(
      error => console.log(`- ${error}`)
    );
  }

  console.log('\n==========================================');
  console.log('FINAL RESULT');
  console.log('==========================================');

  if (passed) {
    console.log('ITEM FULFILLMENT CHECK: PASS');
    console.log('NetSuite and BigQuery are synchronized.');
  } else {
    console.log('ITEM FULFILLMENT CHECK: FAIL');
    console.log('Review mismatched KPI before continuing.');
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('\nITEM FULFILLMENT CHECK ERROR');
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
```

### `modules/item-fulfillment/mapping.mjs`

**Reconstructed SHA-256:** `81b20f90f42fa706d092bb83774fa5db391184e1740c3b97d46fb69b062d37b0`.

```javascript
const ACCOUNTING_BOOK = '1';
function num(value) {
  const result = Number(value ?? 0);

  if (!Number.isFinite(result)) {
    throw new Error(`Invalid number: ${value}`);
  }

  return result;
}

function integer(value) {
  const result = Number(value);

  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`Invalid integer: ${value}`);
  }

  return result;
}

function nullableId(value) {
  return value == null || value === ''
    ? null
    : integer(value);
}

function sum(rows, field) {
  return rows.reduce(
    (total, row) => total + num(row[field]),
    0
  );
}

function chunks(rows, size) {
  const result = [];

  for (let i = 0; i < rows.length; i += size) {
    result.push(rows.slice(i, i + size));
  }

  return result;
}

function money(value) {
  return num(value).toFixed(2);
}

function quantity(value) {
  return num(value).toFixed(6);
}

function cents(value) {
  return Math.round(num(value) * 100);
}

function validDateTime(value) {
  const text = String(value ?? '');

  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    throw new Error(`Invalid DATETIME: ${text}`);
  }

  return text;
}

export function buildData(headers, lines, accounting) {
  const linesByDoc = new Map();
  const glByLine = new Map();

  for (const line of lines) {
    const key = String(line.transaction);

    if (!linesByDoc.has(key)) {
      linesByDoc.set(key, []);
    }

    linesByDoc.get(key).push(line);
  }

  for (const gl of accounting) {
    const key = `${gl.transaction}:${gl.transactionline}`;

    if (!glByLine.has(key)) {
      glByLine.set(key, []);
    }

    glByLine.get(key).push(gl);
  }

  const headerRows = [];
  const lineRows = [];

  const seenHeaders = new Set();
  const seenLines = new Set();

  const errors = [];
  const syncedAt = new Date().toISOString();

  let totalQty = 0;
  let totalCogs = 0;

  for (const header of headers) {
    const id = integer(header.internal_id);
    const docKey = String(id);

    if (seenHeaders.has(docKey)) {
      errors.push(`Duplicate header: ${id}`);
      continue;
    }

    seenHeaders.add(docKey);

    const docLines = linesByDoc.get(docKey) ?? [];

    const cogsLines = docLines.filter(line =>
      line.mainline === 'F' &&
      line.iscogs === 'T' &&
      line.accountinglinetype === 'COGS' &&
      line.item != null
    );

    const assetLines = docLines.filter(line =>
      line.mainline === 'F' &&
      line.accountinglinetype === 'ASSET'
    );

    if (!cogsLines.length) {
      errors.push(`No COGS lines: ${header.fulfillment_number}`);
    }

    if (cogsLines.length !== assetLines.length) {
      errors.push(
        `COGS/ASSET line mismatch: ${header.fulfillment_number}`
      );
    }

    let docQty = 0;
    let assetQty = 0;
    let docCogs = 0;
    let assetCredit = 0;

    const mainLine = docLines.find(
      line => line.mainline === 'T'
    );

    for (const line of cogsLines) {
      const glKey = `${docKey}:${line.id}`;

      const glRows = (glByLine.get(glKey) ?? []).filter(
        gl =>
          gl.posting === 'T' &&
          String(gl.accountingbook) === ACCOUNTING_BOOK
      );

      if (!glRows.length) {
        errors.push(
          `Missing COGS GL: ${header.fulfillment_number}/${line.id}`
        );
      }

      const debit = sum(glRows, 'debit');
      const credit = sum(glRows, 'credit');

      if (Math.abs(credit) > 0.01) {
        errors.push(
          `Unexpected COGS credit: ${header.fulfillment_number}`
        );
      }

      const uniqueKey = nullableId(line.uniquekey);

      if (uniqueKey == null) {
        errors.push(
          `Missing unique key: ${header.fulfillment_number}`
        );
        continue;
      }

      const compositeKey = `${docKey}:${uniqueKey}`;

      if (seenLines.has(compositeKey)) {
        errors.push(`Duplicate line: ${compositeKey}`);
        continue;
      }

      seenLines.add(compositeKey);

      const qty = num(line.quantity);

      if (qty < 0) {
        errors.push(
          `Negative COGS quantity: ${header.fulfillment_number}`
        );
      }

      docQty += qty;
      docCogs += debit;

      lineRows.push({
        fulfillment_internal_id: id,
        fulfillment_number: String(header.fulfillment_number),
        line_unique_key: uniqueKey,
        line_number: nullableId(line.linesequencenumber),

        item_internal_id: nullableId(line.item),
        item_name: null,

        quantity_shipped: quantity(qty),
        unit_internal_id: nullableId(line.units),

        unit_cost: line.rate == null
          ? null
          : num(line.rate).toFixed(6),

        cogs_amount: money(debit),

        accounting_book_id: 1,
        location_internal_id: nullableId(line.location),
        created_from_id: nullableId(line.createdfrom),

        transaction_date: header.transaction_date,
        posting_period: header.posting_period ?? null,

        netsuite_last_modified_at:
          validDateTime(header.netsuite_last_modified_at),

        synced_at: syncedAt
      });
    }

    for (const line of assetLines) {
      const glKey = `${docKey}:${line.id}`;

      const glRows = (glByLine.get(glKey) ?? []).filter(
        gl =>
          gl.posting === 'T' &&
          String(gl.accountingbook) === ACCOUNTING_BOOK
      );

      if (!glRows.length) {
        errors.push(
          `Missing ASSET GL: ${header.fulfillment_number}/${line.id}`
        );
      }

      assetQty += num(line.quantity);
      assetCredit += sum(glRows, 'credit');

      if (Math.abs(sum(glRows, 'debit')) > 0.01) {
        errors.push(
          `Unexpected ASSET debit: ${header.fulfillment_number}`
        );
      }
    }

    if (cents(docCogs) !== cents(assetCredit)) {
      errors.push(
        `COGS/ASSET amount mismatch: ${header.fulfillment_number}`
      );
    }

    if (Math.abs(docQty + assetQty) > 0.000001) {
      errors.push(
        `COGS/ASSET quantity mismatch: ${header.fulfillment_number}`
      );
    }

    const firstCogs = cogsLines[0];

    headerRows.push({
      internal_id: id,
      fulfillment_number: String(header.fulfillment_number),
      transaction_date: header.transaction_date,
      posting_period: header.posting_period ?? null,
      status: header.status ?? null,

      created_from_id: nullableId(
        mainLine?.createdfrom ?? firstCogs?.createdfrom
      ),

      customer_internal_id: nullableId(mainLine?.entity),

      location_internal_id: nullableId(
        firstCogs?.location ?? mainLine?.location
      ),

      total_quantity_shipped: quantity(docQty),
      total_cogs_amount: money(docCogs),
      accounting_book_id: 1,

      netsuite_last_modified_at:
        validDateTime(header.netsuite_last_modified_at),

      synced_at: syncedAt,
      first_synced_at: syncedAt,

      is_deleted: false,
      deleted_at: null
    });

    totalQty += docQty;
    totalCogs += docCogs;
  }

  const accountingBooks = new Set(
    accounting
      .filter(row => row.posting === 'T')
      .map(row => String(row.accountingbook))
  );

  if (
    accountingBooks.size !== 1 ||
    !accountingBooks.has(ACCOUNTING_BOOK)
  ) {
    errors.push(
      `Unexpected accounting books: ${[...accountingBooks].join(',')}`
    );
  }

  if (headerRows.length !== headers.length) {
    errors.push('Header count mismatch');
  }

  if (lineRows.length !== seenLines.size) {
    errors.push('Line count mismatch');
  }

  console.log('\nSOURCE VALIDATION');
  console.log(`Headers    : ${headerRows.length}`);
  console.log(`Lines      : ${lineRows.length}`);
  console.log(`Quantity   : ${quantity(totalQty)}`);
  console.log(`COGS       : ${money(totalCogs)}`);
  console.log(`Errors     : ${errors.length}`);

  if (errors.length) {
    errors.slice(0, 30).forEach(
      error => console.error(`FAIL: ${error}`)
    );

    throw new Error(
      `SOURCE VALIDATION FAILED: ${errors.length} errors`
    );
  }

  console.log('SOURCE VALIDATION: PASS');

  return {
    headerRows,
    lineRows,
    totalQty,
    totalCogs
  };
}

// ============================================================
// BIGQUERY STAGING
// ============================================================
```

### `modules/item-fulfillment/presence.mjs`

**Reconstructed SHA-256:** `bf5741aa5bc4df03c199e925d13bdf78c4b3464c7934ccfeaa3fbffebac3fb32`.

```javascript
import { reconcilePresence } from '../../common/presence-reconcile.mjs';
reconcilePresence('item-fulfillment',{ apply:process.argv.includes('--apply') }).catch(e=>{console.error('PRESENCE CHECK ERROR:',e.stack??e);process.exitCode=1;});
```

### `modules/item-fulfillment/reconcile-accounting.mjs`

**Reconstructed SHA-256:** `8e7f58b5878ee5f1ec9c947d8c4900988f60d3d688aa1f6d09f5beb051d91c0f`.

```javascript
// October 2026 Item Fulfillment accounting reconciliation.
// Read-only by default. Apply one verified document at a time with --id N --apply.
// Does NOT touch checkpoints, historical/deleted documents, or SI/SO.
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { query, T } from '../../common/bigquery-client.mjs';
import { buildData } from './mapping.mjs';

const FROM = '2026-10-01';
const TO = '2026-11-01';
const apply = process.argv.includes('--apply');
const idArg = process.argv.indexOf('--id');
const selected = idArg === -1 ? null : process.argv[idArg + 1];
if (selected !== null && !/^[1-9][0-9]*$/.test(selected)) throw new Error('Usage: --id <positive integer>');
if (apply && !selected) throw new Error('--apply requires --id; bulk writes are disabled');
const cents = v => Math.round(Number(v ?? 0) * 100);
const numericId = v => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`Invalid ID ${v}`); return n; };
const batches = (a, size) => Array.from({length: Math.ceil(a.length / size)}, (_, i) => a.slice(i * size, (i + 1) * size));

async function sourceHeaders(access) {
  const only = selected ? `AND t.id = ${numericId(selected)}` : '';
  return fetchAll(access, `SELECT t.id AS internal_id, t.tranid AS fulfillment_number,
    TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,
    BUILTIN.DF(t.postingperiod) AS posting_period,
    BUILTIN.DF(t.status) AS status,
    TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS netsuite_last_modified_at
    FROM Transaction t WHERE t.type='ItemShip'
    AND t.trandate >= TO_DATE('${FROM}','YYYY-MM-DD')
    AND t.trandate < TO_DATE('${TO}','YYYY-MM-DD') ${only} ORDER BY t.id`);
}
async function details(access, ids, kind) {
  const out = [];
  for (const batch of batches(ids, 25)) {
    const list = batch.map(numericId).join(',');
    const sql = kind === 'lines'
      ? `SELECT transaction,id,uniquekey,linesequencenumber,item,mainline,taxline,iscogs,accountinglinetype,quantity,rate,units,location,entity,createdfrom FROM TransactionLine WHERE transaction IN (${list}) ORDER BY transaction,id`
      : `SELECT transaction,transactionline,accountingbook,posting,account,debit,credit,netamount FROM TransactionAccountingLine WHERE transaction IN (${list}) ORDER BY transaction,transactionline`;
    out.push(...await fetchAll(access, sql));
  }
  return out;
}

async function activeBQHeaders() {
  const filter = selected ? `AND internal_id = ${numericId(selected)}` : '';
  return query(`SELECT internal_id, fulfillment_number, CAST(total_cogs_amount AS STRING) AS cogs,
    FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', netsuite_last_modified_at) AS modified
    FROM ${T('item_fulfillment_headers')}
    WHERE transaction_date >= DATE '${FROM}' AND transaction_date < DATE '${TO}'
    AND COALESCE(is_deleted,FALSE)=FALSE ${filter}`);
}

async function reconcileOne(header, docLines, target) {
  const id = numericId(header.internal_id);
  const data = { lineRows: docLines };
  if (!data.lineRows.length) throw new Error(`Incomplete source details for ${id}`);
  const before = cents(target.cogs);
  const after = cents(header.total_cogs_amount);
  const diff = (after - before) / 100;
  console.log(`${id} ${header.fulfillment_number}: source=${header.total_cogs_amount} BQ=${target.cogs} diff=${diff.toFixed(2)}`);
  if (before === after) return false;
  if (!apply) return true;

  // Accounting-only repair is safe only when all line keys and quantities already match.
  const existing = await query(`SELECT CAST(line_unique_key AS STRING) AS key,
    CAST(quantity_shipped AS STRING) AS qty, CAST(cogs_amount AS STRING) AS cogs
    FROM ${T('item_fulfillment_lines')} WHERE fulfillment_internal_id = ${id}`);
  const sourceKeys = new Map(data.lineRows.map(l => [String(l.line_unique_key), l]));
  const existingKeys = new Map(existing.map(l => [String(l.key), l]));
  if (sourceKeys.size !== existing.length || existingKeys.size !== existing.length || sourceKeys.size !== existingKeys.size)
    throw new Error(`Line keys/count differ for ${id}; run normal sync or investigate rather than accounting-only apply`);
  for (const [key, line] of sourceKeys) {
    const old = existingKeys.get(key);
    if (!old || Math.abs(Number(old.qty) - Number(line.quantity_shipped)) > 0.000001)
      throw new Error(`Line missing or quantity changed: ${id}:${key}; accounting-only apply aborted`);
  }
  if (target.modified !== header.netsuite_last_modified_at)
    throw new Error(`Header timestamp changed for ${id}; use standard sync first`);

  // Build exact NUMERIC literals only from validated, mapped numeric values.
  const vals = data.lineRows.map(l => {
    const key = numericId(l.line_unique_key);
    const cogs = String(l.cogs_amount);
    if (!/^-?\d+(\.\d+)?$/.test(cogs)) throw new Error(`Invalid COGS ${cogs}`);
    return `STRUCT(${key} AS line_unique_key, NUMERIC '${cogs}' AS cogs_amount)`;
  });
  const amount = String(header.total_cogs_amount);
  const oldAmount = String(target.cogs);
  if (!/^-?\d+(\.\d+)?$/.test(amount) || !/^-?\d+(\.\d+)?$/.test(oldAmount)) throw new Error('Invalid header amount');
  const updated = await query(`BEGIN
    CREATE TEMP TABLE expected AS SELECT * FROM UNNEST([${vals.join(',')}]);
    ASSERT (SELECT COUNT(*) FROM expected) = ${vals.length} AS 'Expected line count incorrect';
    ASSERT (SELECT COUNT(*) FROM ${T('item_fulfillment_lines')} WHERE fulfillment_internal_id = ${id}) = ${vals.length} AS 'BQ line count changed';
    ASSERT (SELECT COUNT(*) FROM ${T('item_fulfillment_lines')} l JOIN expected e ON l.line_unique_key=e.line_unique_key WHERE l.fulfillment_internal_id=${id}) = ${vals.length} AS 'BQ line keys changed';
    BEGIN TRANSACTION;
    ASSERT (SELECT COUNT(*) FROM ${T('item_fulfillment_headers')} WHERE internal_id=${id} AND COALESCE(is_deleted,FALSE)=FALSE AND total_cogs_amount=NUMERIC '${oldAmount}' AND netsuite_last_modified_at=DATETIME '${header.netsuite_last_modified_at}')=1 AS 'Header changed before update';
    UPDATE ${T('item_fulfillment_headers')} SET total_cogs_amount=NUMERIC '${amount}', synced_at=CURRENT_TIMESTAMP() WHERE internal_id=${id} AND COALESCE(is_deleted,FALSE)=FALSE;
    UPDATE ${T('item_fulfillment_lines')} l SET cogs_amount=e.cogs_amount, synced_at=CURRENT_TIMESTAMP() FROM expected e WHERE l.fulfillment_internal_id=${id} AND l.line_unique_key=e.line_unique_key;
    ASSERT (SELECT COALESCE(SUM(cogs_amount),0) FROM ${T('item_fulfillment_lines')} WHERE fulfillment_internal_id=${id})=NUMERIC '${amount}' AS 'Post-write line COGS mismatch';
    COMMIT TRANSACTION;
  EXCEPTION WHEN ERROR THEN
    ROLLBACK TRANSACTION;
    RAISE;
  END;`);
  console.log(`ACCOUNTING REPAIRED: ${id} (header + ${vals.length} lines; checkpoints unchanged)`);
  return true;
}

async function main() {
  console.log(`IF ACCOUNTING RECONCILIATION | ${apply ? 'APPLY' : 'READ ONLY'} | ${selected ?? 'ALL OCTOBER'}`);
  const access = await token();
  console.log('OAuth: SUCCESS');
  const [source, target] = await Promise.all([sourceHeaders(access), activeBQHeaders()]);
  const sourceMap = new Map(source.map(h => [String(h.internal_id), h]));
  const targetMap = new Map(target.map(h => [String(h.internal_id), h]));
  if (!source.length || !target.length || sourceMap.size !== source.length || targetMap.size !== target.length) throw new Error('Empty/duplicate snapshot; aborting');
  const missingSource = [...targetMap.keys()].filter(id => !sourceMap.has(id));
  const missingBQ = [...sourceMap.keys()].filter(id => !targetMap.has(id));
  console.log(`NetSuite=${source.length}, BQ active=${target.length}, missing NS=${missingSource.length}, missing BQ=${missingBQ.length}`);
  if (missingSource.length || missingBQ.length) {
    console.log(`Only BQ: ${missingSource.slice(0,20).join(',') || 'NONE'}`);
    console.log(`Only NS: ${missingBQ.slice(0,20).join(',') || 'NONE'}`);
    throw new Error('Document inventory mismatch; run normal sync/presence first');
  }
  const ids = source.map(h => numericId(h.internal_id));
  const [rawLines, rawGL] = await Promise.all([details(access, ids, 'lines'), details(access, ids, 'gl')]);
  const mapped = buildData(source, rawLines, rawGL);
  const byId = new Map(mapped.headerRows.map(h => [String(h.internal_id), h]));
  const linesById = new Map();
  for (const l of mapped.lineRows) {
    const id = String(l.fulfillment_internal_id);
    if (!linesById.has(id)) linesById.set(id, []);
    linesById.get(id).push(l);
  }
  let count = 0;
  for (const [id, h] of byId) {
    const targetRow = targetMap.get(id);
    if (cents(h.total_cogs_amount) !== cents(targetRow.cogs)) {
      if (await reconcileOne(h, linesById.get(id) ?? [], targetRow)) count++;
    }
  }
  console.log(`ACCOUNTING RECONCILIATION COMPLETE; differences=${count}; mode=${apply ? 'APPLY' : 'READ ONLY'}`);
}
main().catch(err => { console.error('IF ACCOUNTING RECONCILIATION ERROR:', err.stack ?? err); process.exitCode=1; });
```

### `modules/item-fulfillment/recover.mjs`

**Reconstructed SHA-256:** `5eca152f589e1251adeebd07fd75e50ea4876be38e79d970d5dcf3fb93b559dd`.

```javascript
import { bq as sharedBQ } from '../../common/bigquery-client.mjs';
import { token as sharedToken } from '../../common/netsuite-client.mjs';
import { buildData } from './mapping.mjs';

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// ============================================================
// CONFIGURATION
// ============================================================

const PRIVATE_KEY_PATH =
  'C:\\netsuite-backup-cert\\private.pem';

const BASE_URL =
  'https://6930902.suitetalk.api.netsuite.com';

const TOKEN_URL =
  `${BASE_URL}/services/rest/auth/oauth2/v1/token`;

const PROJECT_ID = 'even-gearbox-255203';
const DATASET_ID = 'netsuite_backup';
const BQ_LOCATION = 'asia-southeast1';

const HEADER_TABLE = 'item_fulfillment_headers';
const LINE_TABLE = 'item_fulfillment_lines';
const CHECKPOINT_TABLE = 'sync_checkpoints';

const HEADER_RECORD_TYPE = 'item_fulfillment';
const LINE_RECORD_TYPE = 'item_fulfillment_lines';

const INITIAL_CHECKPOINT = '2026-10-01 00:00:00';
const DATE_FROM = '2026-10-01';

const OVERLAP_MINUTES = 5;
const ACCOUNTING_BOOK = '1';
const BATCH_SIZE = 25;
const PAGE_SIZE = 1000;

const args = process.argv.slice(2);
const idIndex = args.indexOf('--id');
const rawId = idIndex >= 0 ? args[idIndex + 1] : null;
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;
if (!/^[1-9][0-9]{0,14}$/.test(rawId ?? '') ||
    args.some((a, i) => !(['--id','--apply','--dry-run'].includes(a) || (i === idIndex + 1))) ||
    (args.includes('--apply') && args.includes('--dry-run'))) {
  console.error('Usage: node modules/item-fulfillment/recover.mjs --id 3152063 [--dry-run|--apply]');
  process.exit(2);
}

const bigquery = sharedBQ;

const dataset = bigquery.dataset(DATASET_ID);

const table = name =>
  `\`${PROJECT_ID}.${DATASET_ID}.${name}\``;

// ============================================================
// HELPERS
// ============================================================

function num(value) {
  const result = Number(value ?? 0);

  if (!Number.isFinite(result)) {
    throw new Error(`Invalid number: ${value}`);
  }

  return result;
}

function integer(value) {
  const result = Number(value);

  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`Invalid integer: ${value}`);
  }

  return result;
}

function nullableId(value) {
  return value == null || value === ''
    ? null
    : integer(value);
}

function sum(rows, field) {
  return rows.reduce(
    (total, row) => total + num(row[field]),
    0
  );
}

function chunks(rows, size) {
  const result = [];

  for (let i = 0; i < rows.length; i += size) {
    result.push(rows.slice(i, i + size));
  }

  return result;
}

function money(value) {
  return num(value).toFixed(2);
}

function quantity(value) {
  return num(value).toFixed(6);
}

function cents(value) {
  return Math.round(num(value) * 100);
}

function validDateTime(value) {
  const text = String(value ?? '');

  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    throw new Error(`Invalid DATETIME: ${text}`);
  }

  return text;
}

async function bqQuery(query, params = {}) {
  const [rows] = await bigquery.query({
    query,
    params,
    location: BQ_LOCATION
  });

  return rows;
}

// ============================================================
// NETSUITE AUTHENTICATION
// ============================================================

const getToken = sharedToken;

async function suiteql(token, sql, limit = PAGE_SIZE, offset = 0) {
  const url =
    `${BASE_URL}/services/rest/query/v1/suiteql` +
    `?limit=${limit}&offset=${offset}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'transient'
      },
      body: JSON.stringify({ q: sql })
    });

    const text = await response.text();

    if (response.ok) {
      return JSON.parse(text);
    }

    if (
      attempt === 3 ||
      ![429, 500, 502, 503, 504].includes(response.status)
    ) {
      throw new Error(
        `SuiteQL HTTP ${response.status}: ${text}\nSQL:\n${sql}`
      );
    }

    await new Promise(
      resolve => setTimeout(resolve, attempt * 2000)
    );
  }
}

async function getAll(token, sql) {
  const rows = [];
  let offset = 0;

  while (true) {
    const page = await suiteql(
      token,
      sql,
      PAGE_SIZE,
      offset
    );

    const items = page.items ?? [];
    rows.push(...items);

    if (!page.hasMore) {
      break;
    }

    if (items.length === 0) {
      throw new Error('Invalid SuiteQL pagination');
    }

    offset += PAGE_SIZE;

    if (offset > 1000000) {
      throw new Error('SuiteQL pagination limit exceeded');
    }
  }

  return rows;
}

// ============================================================
// CHECKPOINT - SAME PATTERN AS SALES INVOICE
// ============================================================

async function getCheckpoint() {
  const rows = await bqQuery(`
    SELECT
      record_type,
      FORMAT_DATETIME(
        '%Y-%m-%d %H:%M:%S',
        last_successful_modified_at
      ) AS checkpoint_at
    FROM ${table(CHECKPOINT_TABLE)}
    WHERE record_type IN (
      @headerType,
      @lineType
    )
  `, {
    headerType: HEADER_RECORD_TYPE,
    lineType: LINE_RECORD_TYPE
  });

  const checkpointMap = new Map(
    rows.map(row => [
      row.record_type,
      row.checkpoint_at
    ])
  );

  const headerCheckpoint =
    checkpointMap.get(HEADER_RECORD_TYPE) ??
    INITIAL_CHECKPOINT;

  const lineCheckpoint =
    checkpointMap.get(LINE_RECORD_TYPE) ??
    INITIAL_CHECKPOINT;

  // Use the earliest checkpoint to keep both datasets aligned.
  const earliest =
    headerCheckpoint < lineCheckpoint
      ? headerCheckpoint
      : lineCheckpoint;

  const result = await bqQuery(`
    SELECT
      FORMAT_DATETIME(
        '%Y-%m-%d %H:%M:%S',
        DATETIME_SUB(
          CAST(@checkpoint AS DATETIME),
          INTERVAL ${OVERLAP_MINUTES} MINUTE
        )
      ) AS fetch_from
  `, {
    checkpoint: earliest
  });

  return {
    headerCheckpoint,
    lineCheckpoint,
    fetchFrom: result[0].fetch_from,
    headerExists: checkpointMap.has(HEADER_RECORD_TYPE),
    lineExists: checkpointMap.has(LINE_RECORD_TYPE)
  };
}

// ============================================================
// FETCH CHANGED FULFILLMENTS
// ============================================================

async function fetchTargetHeader(token, targetId) {
  const sql = `
    SELECT
      t.id AS internal_id,
      t.tranid AS fulfillment_number,
      TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date,
      BUILTIN.DF(t.postingperiod) AS posting_period,
      BUILTIN.DF(t.status) AS status,
      TO_CHAR(t.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS netsuite_last_modified_at
    FROM Transaction t
    WHERE t.id = ${targetId} AND t.type = 'ItemShip'
  `;
  const rows = await getAll(token, sql);
  if (rows.length > 1) throw new Error('Duplicate source header');
  return rows;
}

async function getBackupState(targetId) {
  const rows = await bqQuery(`
    SELECT internal_id, COALESCE(is_deleted, FALSE) AS is_deleted,
           CAST(transaction_date AS STRING) AS transaction_date,
           FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', netsuite_last_modified_at) AS modified_at
    FROM ${table(HEADER_TABLE)} WHERE internal_id = @id
  `, {id: Number(targetId)});
  if (rows.length > 1) throw new Error('Duplicate BQ header');
  return rows[0] ?? null;
}

// ============================================================
// FETCH LINES AND ACCOUNTING
// ============================================================

async function fetchDetails(token, ids, type) {
  const results = [];
  const batches = chunks(ids, BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const idsText = batches[i].join(',');

    let sql;

    if (type === 'lines') {
      sql = `
        SELECT
          transaction,
          id,
          uniquekey,
          linesequencenumber,
          item,
          mainline,
          taxline,
          iscogs,
          accountinglinetype,
          quantity,
          rate,
          units,
          location,
          entity,
          createdfrom
        FROM TransactionLine
        WHERE transaction IN (${idsText})
        ORDER BY transaction, id
      `;
    } else {
      sql = `
        SELECT
          transaction,
          transactionline,
          accountingbook,
          posting,
          account,
          debit,
          credit,
          netamount
        FROM TransactionAccountingLine
        WHERE transaction IN (${idsText})
        ORDER BY transaction, transactionline
      `;
    }

    const rows = await getAll(token, sql);
    results.push(...rows);

    console.log(
      `${type} batch ${i + 1}/${batches.length}: ${rows.length}`
    );
  }

  return results;
}

// ============================================================
// TRANSFORM AND VALIDATE
// ============================================================

function writeJsonl(filePath, rows) {
  const content =
    rows.map(row => JSON.stringify(row)).join('\n') + '\n';

  fs.writeFileSync(filePath, content, 'utf8');
}

async function createStage(stageName, targetName) {
  await bqQuery(`
    CREATE TABLE ${table(stageName)}
    AS
    SELECT *
    FROM ${table(targetName)}
    WHERE FALSE
  `);
}

async function loadStage(stageName, filePath) {
  await dataset.table(stageName).load(filePath, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON',
    writeDisposition: 'WRITE_TRUNCATE',
    ignoreUnknownValues: false,
    maxBadRecords: 0,
    location: BQ_LOCATION
  });

  const [metadata] =
    await dataset.table(stageName).getMetadata();

  return Number(metadata.numRows);
}

// ============================================================
// ATOMIC MERGE + REPLACE + CHECKPOINT
// ============================================================

async function commit(headerStage, lineStage, source) {
  const headerColumns = [
    'internal_id',
    'fulfillment_number',
    'transaction_date',
    'posting_period',
    'status',
    'created_from_id',
    'customer_internal_id',
    'location_internal_id',
    'total_quantity_shipped',
    'total_cogs_amount',
    'accounting_book_id',
    'netsuite_last_modified_at',
    'synced_at',
    'first_synced_at',
    'is_deleted',
    'deleted_at'
  ];

  const lineColumns = [
    'fulfillment_internal_id',
    'fulfillment_number',
    'line_unique_key',
    'line_number',
    'item_internal_id',
    'item_name',
    'quantity_shipped',
    'unit_internal_id',
    'unit_cost',
    'cogs_amount',
    'accounting_book_id',
    'location_internal_id',
    'created_from_id',
    'transaction_date',
    'posting_period',
    'netsuite_last_modified_at',
    'synced_at'
  ];

  const updateColumns = headerColumns.filter(
    col => col !== 'internal_id' &&
           col !== 'first_synced_at'
  );

  const sql = `
    BEGIN TRANSACTION;

    -- Guard against another process activating this header after preflight.
    ASSERT (
      SELECT COUNT(*) FROM ${table(HEADER_TABLE)}
      WHERE internal_id = @targetId AND COALESCE(is_deleted, FALSE) = FALSE
    ) = 0 AS 'Already active or concurrent restore detected';

    -- HEADER MERGE
    MERGE ${table(HEADER_TABLE)} AS target
    USING ${table(headerStage)} AS source
    ON target.internal_id = source.internal_id

    WHEN MATCHED THEN
      UPDATE SET
        ${updateColumns.map(
          col => `${col} = source.${col}`
        ).join(',\n        ')}

    WHEN NOT MATCHED THEN
      INSERT (${headerColumns.join(', ')})
      VALUES (
        ${headerColumns.map(col => `source.${col}`).join(', ')}
      );

    -- REPLACE ONLY CHANGED FULFILLMENT LINES
    DELETE FROM ${table(LINE_TABLE)}
    WHERE fulfillment_internal_id IN (
      SELECT internal_id
      FROM ${table(headerStage)}
    );

    INSERT INTO ${table(LINE_TABLE)}
    (${lineColumns.join(', ')})
    SELECT
      ${lineColumns.map(col => `s.${col}`).join(', ')}
    FROM ${table(lineStage)} s;

    -- INTEGRITY ASSERTIONS
    ASSERT (
      (
        SELECT COUNT(*)
        FROM ${table(HEADER_TABLE)}
        WHERE internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) = @expectedHeaders
    ) AS 'Header count mismatch';

    ASSERT (
      (
        SELECT COUNT(*)
        FROM ${table(LINE_TABLE)}
        WHERE fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) = @expectedLines
    ) AS 'Line count mismatch';

    ASSERT (
      (
        SELECT COUNT(*)
        FROM (
          SELECT fulfillment_internal_id, line_unique_key
          FROM ${table(LINE_TABLE)}
          WHERE fulfillment_internal_id IN (
            SELECT internal_id FROM ${table(headerStage)}
          )
          GROUP BY fulfillment_internal_id, line_unique_key
          HAVING COUNT(*) > 1
        )
      ) = 0
    ) AS 'Duplicate line keys';

    ASSERT (
      (
        SELECT COUNT(*)
        FROM ${table(LINE_TABLE)} l
        LEFT JOIN ${table(HEADER_TABLE)} h
          ON h.internal_id = l.fulfillment_internal_id
        WHERE l.fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
        AND h.internal_id IS NULL
      ) = 0
    ) AS 'Orphan lines';

    COMMIT TRANSACTION;
  `;

  await bqQuery(sql, {
    targetId: Number(rawId),
    expectedHeaders: source.headerRows.length,
    expectedLines: source.lineRows.length
  });
}

// ============================================================
// POST-COMMIT RECONCILIATION
// ============================================================

async function reconcile(source, headerStage) {
  const rows = await bqQuery(`
    SELECT
      (
        SELECT COUNT(*)
        FROM ${table(HEADER_TABLE)}
        WHERE internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS header_count,

      (
        SELECT COUNT(*)
        FROM ${table(LINE_TABLE)}
        WHERE fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS line_count,

      (
        SELECT COALESCE(SUM(total_cogs_amount), 0)
        FROM ${table(HEADER_TABLE)}
        WHERE internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS header_cogs,

      (
        SELECT COALESCE(SUM(cogs_amount), 0)
        FROM ${table(LINE_TABLE)}
        WHERE fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS line_cogs,

      (
        SELECT COALESCE(SUM(quantity_shipped), 0)
        FROM ${table(LINE_TABLE)}
        WHERE fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS shipped_qty,

      (
        SELECT COUNT(*)
        FROM (
          SELECT fulfillment_internal_id, line_unique_key
          FROM ${table(LINE_TABLE)}
          WHERE fulfillment_internal_id IN (
            SELECT internal_id FROM ${table(headerStage)}
          )
          GROUP BY fulfillment_internal_id, line_unique_key
          HAVING COUNT(*) > 1
        )
      ) AS duplicates,

      (
        SELECT COUNT(*)
        FROM ${table(LINE_TABLE)} l
        LEFT JOIN ${table(HEADER_TABLE)} h
          ON h.internal_id = l.fulfillment_internal_id
        WHERE l.fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
        AND h.internal_id IS NULL
      ) AS orphans
  `);

  const r = rows[0];

  const checks = {
    headers:
      num(r.header_count) === source.headerRows.length,

    lines:
      num(r.line_count) === source.lineRows.length,

    header_cogs:
      cents(r.header_cogs) === cents(source.totalCogs),

    line_cogs:
      cents(r.line_cogs) === cents(source.totalCogs),

    quantity:
      Math.abs(num(r.shipped_qty) - source.totalQty) < 0.000001,

    duplicates:
      num(r.duplicates) === 0,

    orphans:
      num(r.orphans) === 0
  };

  console.log('\nBIGQUERY DELTA RECONCILIATION');

  for (const [name, passed] of Object.entries(checks)) {
    console.log(`${name}: ${passed ? 'PASS' : 'FAIL'}`);
  }

  if (!Object.values(checks).every(Boolean)) {
    throw new Error('BIGQUERY DELTA RECONCILIATION FAILED');
  }

  console.log('BIGQUERY DELTA RECONCILIATION: PASS');
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log(`IF TARGETED RECOVERY | ID ${rawId} | ${DRY_RUN ? 'READ ONLY' : 'APPLY'}`);
  console.log('Checkpoint: NEVER MODIFIED');
  const access = await getToken();
  console.log('NetSuite OAuth: SUCCESS');
  const headers = await fetchTargetHeader(access, rawId);
  const backup = await getBackupState(rawId);
  console.log('BigQuery header:', backup ? (backup.is_deleted ? 'SOFT-DELETED' : 'ACTIVE') : 'MISSING');
  if (!headers.length) {
    console.log('SOURCE NOT VISIBLE: no recovery permitted.');
    process.exitCode = 3;
    return;
  }
  const header = headers[0];
  if (header.transaction_date < '2026-10-01' || header.transaction_date >= '2026-11-01') {
    throw new Error(`Document outside October: ${header.transaction_date}. Period relocation requires separate review.`);
  }
  if (backup && !backup.is_deleted) {
    console.log('ALREADY ACTIVE: NO-OP. Header/line equivalence not asserted; run check.mjs for full KPI.');
    return;
  }
  const ids = [integer(rawId)];
  const lines = await fetchDetails(access, ids, 'lines');
  const accounting = await fetchDetails(access, ids, 'accounting');
  const source = buildData(headers, lines, accounting);
  console.log(`ACTION: ${backup ? 'RESTORE' : 'RECOVER_MISSING'} | header=1 lines=${source.lineRows.length}`);
  if (DRY_RUN) {
    console.log('DRY RUN PASS: No BigQuery changes.');
    return;
  }
  // Check that source did not change during detail extraction.
  const refreshed = await fetchTargetHeader(access, rawId);
  if (refreshed.length !== 1 ||
      refreshed[0].netsuite_last_modified_at !== header.netsuite_last_modified_at ||
      refreshed[0].transaction_date !== header.transaction_date) {
    throw new Error('Source changed during recovery; abort and retry.');
  }

  const suffix = crypto.randomUUID().replaceAll('-', '');

  const headerStage = `_stage_if_h_${suffix}`;
  const lineStage = `_stage_if_l_${suffix}`;

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'netsuite-if-delta-')
  );

  const headerFile = path.join(tempDir, 'headers.jsonl');
  const lineFile = path.join(tempDir, 'lines.jsonl');

  const createdStages = [];

  try {
    writeJsonl(headerFile, source.headerRows);
    writeJsonl(lineFile, source.lineRows);

    await createStage(headerStage, HEADER_TABLE);
    createdStages.push(headerStage);

    await createStage(lineStage, LINE_TABLE);
    createdStages.push(lineStage);

    const stagedHeaders = await loadStage(
      headerStage,
      headerFile
    );

    const stagedLines = await loadStage(
      lineStage,
      lineFile
    );

    if (
      stagedHeaders !== source.headerRows.length ||
      stagedLines !== source.lineRows.length
    ) {
      throw new Error('STAGING VALIDATION FAILED');
    }

    console.log('STAGING VALIDATION: PASS');

    await commit(
      headerStage,
      lineStage,
      source
    );

    console.log('ATOMIC RECOVERY MERGE: SUCCESS; checkpoints unchanged');

    await reconcile(source, headerStage);

    console.log('\n==========================================');
    console.log('ITEM FULFILLMENT TARGETED RECOVERY SUCCESS');
    console.log('==========================================');
  } finally {
    for (const stage of createdStages) {
      try {
        await dataset.table(stage).delete({
          ignoreNotFound: true
        });
      } catch (error) {
        console.error(
          `Stage cleanup warning: ${error.message}`
        );
      }
    }

    fs.rmSync(tempDir, {
      recursive: true,
      force: true
    });
  }
}

main().catch(error => {
  console.error('\nITEM FULFILLMENT TARGETED RECOVERY ERROR');
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
```

### `modules/item-fulfillment/repair-accounting-bounded.mjs`

**Reconstructed SHA-256:** `8f1c2e3eca10463998d4df714a6b2d3fd0b1edacc0a49fa12d6ea6c8fc001f00`.

```javascript
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const target = join(root, 'modules', 'item-fulfillment', 'reconcile-accounting.mjs');

const apply = process.argv.includes('--apply');

if (
  process.argv.length > 3 ||
  (process.argv.length === 3 && !apply)
) {
  throw Error(
    'Usage: node modules/item-fulfillment/repair-accounting-bounded.mjs [--apply]'
  );
}

// Maximum transactions per batch.
const MAX_PER_BATCH = 8;

// Maximum batches in one recovery execution.
const MAX_BATCHES = 4;

const MAX_PER_RUN = MAX_PER_BATCH * MAX_BATCHES;

function run(args) {
  const r = spawnSync(process.execPath, [target, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });

  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);

  if (r.error || r.status !== 0) {
    throw Error(
      'Accounting command failed: ' + args.join(' ')
    );
  }

  return r.stdout;
}

function mismatches(output) {
  const ids = [
    ...output.matchAll(
      /^([1-9][0-9]*) (DO[^:]+): source=.* BQ=.* diff=[-0-9.]+$/gm
    )
  ].map(x => x[1]);

  const end = output.match(
    /ACCOUNTING RECONCILIATION COMPLETE; differences=(\d+); mode=READ ONLY/
  );

  if (
    !end ||
    Number(end[1]) !== ids.length ||
    new Set(ids).size !== ids.length
  ) {
    throw Error(
      'Incomplete/ambiguous accounting mismatch inventory'
    );
  }

  return ids;
}

console.log(
  'IF BOUNDED ACCOUNTING RECOVERY | ' +
  (apply ? 'PRODUCTION WRITE' : 'READ ONLY')
);

console.log(
  'LIMITS: batch=' + MAX_PER_BATCH +
  ' batches=' + MAX_BATCHES +
  ' maxPerRun=' + MAX_PER_RUN
);

// Initial full accounting audit.
const initial = mismatches(run([]));

console.log(
  'ACCOUNTING CANDIDATES=' +
  initial.join(',') +
  ' count=' +
  initial.length
);

if (!initial.length) {
  console.log('ACCOUNTING CLEAN: PASS');
  process.exit(0);
}

// Dry-run validates the complete mismatch inventory.
// A backlog larger than the per-run limit is allowed.
// Actual writes remain strictly bounded.
if (!apply) {
  console.log(
    'ACCOUNTING DRY RUN PASS: no changes'
  );

  console.log(
    'PLANNED FIRST RUN=' +
    Math.min(initial.length, MAX_PER_RUN) +
    ' REMAINING AFTER BUDGET=' +
    Math.max(0, initial.length - MAX_PER_RUN)
  );

  process.exit(0);
}

let repaired = 0;
let completedBatches = 0;

for (
  let batchNumber = 1;
  batchNumber <= MAX_BATCHES;
  batchNumber++
) {
  // Re-read complete accounting state before each batch.
  const pending = mismatches(run([]));

  if (!pending.length) {
    console.log('ACCOUNTING BACKLOG CLEARED');
    break;
  }

  const batchIds = pending.slice(0, MAX_PER_BATCH);

  console.log(
    'ACCOUNTING BATCH ' +
    batchNumber +
    '/' +
    MAX_BATCHES +
    ' candidates=' +
    batchIds.length
  );

  for (const id of batchIds) {
    // Independent NetSuite/BQ revalidation immediately
    // before each individual accounting repair.
    const pre = run(['--id', id]);

    if (
      !pre.includes(
        'ACCOUNTING RECONCILIATION COMPLETE; differences=1; mode=READ ONLY'
      )
    ) {
      throw Error(
        'Candidate changed before repair ' + id
      );
    }

    // Uses existing per-ID safeguards:
    // - matching line keys
    // - matching quantities
    // - matching modified timestamp
    // - atomic header/line COGS update
    // - post-write COGS assertion
    // - rollback on failure
    const out = run(['--id', id, '--apply']);

    if (
      !out.includes(
        'ACCOUNTING REPAIRED: ' + id
      )
    ) {
      throw Error(
        'Repair completion evidence missing ' + id
      );
    }

    repaired++;
  }

  completedBatches++;

  // Verify progress after every batch.
  const remaining = mismatches(run([]));

  console.log(
    'ACCOUNTING BATCH COMPLETE ' +
    batchNumber +
    ' repairedTotal=' +
    repaired +
    ' remaining=' +
    remaining.length
  );

  if (!remaining.length) {
    break;
  }
}

// Mandatory final full accounting audit.
const finalPending = mismatches(run([]));

console.log(
  'ACCOUNTING FINAL AUDIT repaired=' +
  repaired +
  ' batches=' +
  completedBatches +
  ' remaining=' +
  finalPending.length
);

if (finalPending.length) {
  console.log(
    'BOUNDED REVIEW: remaining accounting candidates=' +
    finalPending.length +
    '; next scheduled recovery required'
  );

  // Partial recovery must NEVER be reported as FINAL_PASS.
  process.exit(3);
}

console.log(
  'IF ACCOUNTING AUTO RECOVERY PASS repaired=' +
  repaired +
  ' batches=' +
  completedBatches +
  ' postAudit=0'
);
```

### `modules/item-fulfillment/sync.mjs`

**Reconstructed SHA-256:** `93476b0abf9058e421ca9a81a57a108011873523934b5b61187423099df5ba6e`.

```javascript
import { validateNumericRows } from '../../common/decimal-precision.mjs';
import { bq as sharedBQ } from '../../common/bigquery-client.mjs';
import { token as sharedToken } from '../../common/netsuite-client.mjs';
import { buildData } from './mapping.mjs';

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// ============================================================
// CONFIGURATION
// ============================================================

const PRIVATE_KEY_PATH =
  'C:\\netsuite-backup-cert\\private.pem';

const BASE_URL =
  'https://6930902.suitetalk.api.netsuite.com';

const TOKEN_URL =
  `${BASE_URL}/services/rest/auth/oauth2/v1/token`;

const PROJECT_ID = 'even-gearbox-255203';
const DATASET_ID = 'netsuite_backup';
const BQ_LOCATION = 'asia-southeast1';

const HEADER_TABLE = 'item_fulfillment_headers';
const LINE_TABLE = 'item_fulfillment_lines';
const CHECKPOINT_TABLE = 'sync_checkpoints';

const HEADER_RECORD_TYPE = 'item_fulfillment';
const LINE_RECORD_TYPE = 'item_fulfillment_lines';

const INITIAL_CHECKPOINT = '2026-10-01 00:00:00';
const DATE_FROM = '2026-10-01';

const OVERLAP_MINUTES = 5;
const ACCOUNTING_BOOK = '1';
const BATCH_SIZE = 25;
const PAGE_SIZE = 1000;

const DRY_RUN = process.argv.includes('--dry-run');

const bigquery = sharedBQ;

const dataset = bigquery.dataset(DATASET_ID);

const table = name =>
  `\`${PROJECT_ID}.${DATASET_ID}.${name}\``;

// ============================================================
// HELPERS
// ============================================================

function num(value) {
  const result = Number(value ?? 0);

  if (!Number.isFinite(result)) {
    throw new Error(`Invalid number: ${value}`);
  }

  return result;
}

function integer(value) {
  const result = Number(value);

  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`Invalid integer: ${value}`);
  }

  return result;
}

function nullableId(value) {
  return value == null || value === ''
    ? null
    : integer(value);
}

function sum(rows, field) {
  return rows.reduce(
    (total, row) => total + num(row[field]),
    0
  );
}

function chunks(rows, size) {
  const result = [];

  for (let i = 0; i < rows.length; i += size) {
    result.push(rows.slice(i, i + size));
  }

  return result;
}

function money(value) {
  return num(value).toFixed(2);
}

function quantity(value) {
  return num(value).toFixed(6);
}

function cents(value) {
  return Math.round(num(value) * 100);
}

function validDateTime(value) {
  const text = String(value ?? '');

  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    throw new Error(`Invalid DATETIME: ${text}`);
  }

  return text;
}

async function bqQuery(query, params = {}) {
  const [rows] = await bigquery.query({
    query,
    params,
    location: BQ_LOCATION
  });

  return rows;
}

// ============================================================
// NETSUITE AUTHENTICATION
// ============================================================

const getToken = sharedToken;

async function suiteql(token, sql, limit = PAGE_SIZE, offset = 0) {
  const url =
    `${BASE_URL}/services/rest/query/v1/suiteql` +
    `?limit=${limit}&offset=${offset}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'transient'
      },
      body: JSON.stringify({ q: sql })
    });

    const text = await response.text();

    if (response.ok) {
      return JSON.parse(text);
    }

    if (
      attempt === 3 ||
      ![429, 500, 502, 503, 504].includes(response.status)
    ) {
      throw new Error(
        `SuiteQL HTTP ${response.status}: ${text}\nSQL:\n${sql}`
      );
    }

    await new Promise(
      resolve => setTimeout(resolve, attempt * 2000)
    );
  }
}

async function getAll(token, sql) {
  const rows = [];
  let offset = 0;

  while (true) {
    const page = await suiteql(
      token,
      sql,
      PAGE_SIZE,
      offset
    );

    const items = page.items ?? [];
    rows.push(...items);

    if (!page.hasMore) {
      break;
    }

    if (items.length === 0) {
      throw new Error('Invalid SuiteQL pagination');
    }

    offset += PAGE_SIZE;

    if (offset > 1000000) {
      throw new Error('SuiteQL pagination limit exceeded');
    }
  }

  return rows;
}

// ============================================================
// CHECKPOINT - SAME PATTERN AS SALES INVOICE
// ============================================================

async function getCheckpoint() {
  const rows = await bqQuery(`
    SELECT
      record_type,
      FORMAT_DATETIME(
        '%Y-%m-%d %H:%M:%S',
        last_successful_modified_at
      ) AS checkpoint_at
    FROM ${table(CHECKPOINT_TABLE)}
    WHERE record_type IN (
      @headerType,
      @lineType
    )
  `, {
    headerType: HEADER_RECORD_TYPE,
    lineType: LINE_RECORD_TYPE
  });

  const checkpointMap = new Map(
    rows.map(row => [
      row.record_type,
      row.checkpoint_at
    ])
  );

  const headerCheckpoint =
    checkpointMap.get(HEADER_RECORD_TYPE) ??
    INITIAL_CHECKPOINT;

  const lineCheckpoint =
    checkpointMap.get(LINE_RECORD_TYPE) ??
    INITIAL_CHECKPOINT;

  // Use the earliest checkpoint to keep both datasets aligned.
  const earliest =
    headerCheckpoint < lineCheckpoint
      ? headerCheckpoint
      : lineCheckpoint;

  const result = await bqQuery(`
    SELECT
      FORMAT_DATETIME(
        '%Y-%m-%d %H:%M:%S',
        DATETIME_SUB(
          CAST(@checkpoint AS DATETIME),
          INTERVAL ${OVERLAP_MINUTES} MINUTE
        )
      ) AS fetch_from
  `, {
    checkpoint: earliest
  });

  return {
    headerCheckpoint,
    lineCheckpoint,
    fetchFrom: result[0].fetch_from,
    headerExists: checkpointMap.has(HEADER_RECORD_TYPE),
    lineExists: checkpointMap.has(LINE_RECORD_TYPE)
  };
}

// ============================================================
// FETCH CHANGED FULFILLMENTS
// ============================================================

async function fetchChangedHeaders(token, fetchFrom) {
  validDateTime(fetchFrom);

  const sql = `
    SELECT
      t.id AS internal_id,
      t.tranid AS fulfillment_number,
      TO_CHAR(
        t.trandate,
        'YYYY-MM-DD'
      ) AS transaction_date,
      BUILTIN.DF(
        t.postingperiod
      ) AS posting_period,
      BUILTIN.DF(
        t.status
      ) AS status,
      TO_CHAR(
        t.lastmodifieddate,
        'YYYY-MM-DD HH24:MI:SS'
      ) AS netsuite_last_modified_at
    FROM Transaction t
    WHERE t.type = 'ItemShip'
      AND t.trandate >= TO_DATE(
        '${DATE_FROM}',
        'YYYY-MM-DD'
      )
      AND t.lastmodifieddate >= TO_DATE(
        '${fetchFrom}',
        'YYYY-MM-DD HH24:MI:SS'
      )
    ORDER BY
      t.lastmodifieddate,
      t.id
  `;

  return getAll(token, sql);
}

// ============================================================
// FETCH LINES AND ACCOUNTING
// ============================================================

async function fetchDetails(token, ids, type) {
  const results = [];
  const batches = chunks(ids, BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const idsText = batches[i].join(',');

    let sql;

    if (type === 'lines') {
      sql = `
        SELECT
          transaction,
          id,
          uniquekey,
          linesequencenumber,
          item,
          mainline,
          taxline,
          iscogs,
          accountinglinetype,
          quantity,
          rate,
          units,
          location,
          entity,
          createdfrom
        FROM TransactionLine
        WHERE transaction IN (${idsText})
        ORDER BY transaction, id
      `;
    } else {
      sql = `
        SELECT
          transaction,
          transactionline,
          accountingbook,
          posting,
          account,
          debit,
          credit,
          netamount
        FROM TransactionAccountingLine
        WHERE transaction IN (${idsText})
        ORDER BY transaction, transactionline
      `;
    }

    const rows = await getAll(token, sql);
    results.push(...rows);

    console.log(
      `${type} batch ${i + 1}/${batches.length}: ${rows.length}`
    );
  }

  return results;
}

// ============================================================
// TRANSFORM AND VALIDATE
// ============================================================

function writeJsonl(filePath, rows) {
  const content =
    rows.map(row => JSON.stringify(row)).join('\n') + '\n';

  fs.writeFileSync(filePath, content, 'utf8');
}

async function createStage(stageName, targetName) {
  await bqQuery(`
    CREATE TABLE ${table(stageName)}
    AS
    SELECT *
    FROM ${table(targetName)}
    WHERE FALSE
  `);
}

async function loadStage(stageName, filePath) {
  await dataset.table(stageName).load(filePath, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON',
    writeDisposition: 'WRITE_TRUNCATE',
    ignoreUnknownValues: false,
    maxBadRecords: 0,
    location: BQ_LOCATION
  });

  const [metadata] =
    await dataset.table(stageName).getMetadata();

  return Number(metadata.numRows);
}

// ============================================================
// ATOMIC MERGE + REPLACE + CHECKPOINT
// ============================================================

async function commit(headerStage, lineStage, source, maxModified) {
  const headerColumns = [
    'internal_id',
    'fulfillment_number',
    'transaction_date',
    'posting_period',
    'status',
    'created_from_id',
    'customer_internal_id',
    'location_internal_id',
    'total_quantity_shipped',
    'total_cogs_amount',
    'accounting_book_id',
    'netsuite_last_modified_at',
    'synced_at',
    'first_synced_at',
    'is_deleted',
    'deleted_at'
  ];

  const lineColumns = [
    'fulfillment_internal_id',
    'fulfillment_number',
    'line_unique_key',
    'line_number',
    'item_internal_id',
    'item_name',
    'quantity_shipped',
    'unit_internal_id',
    'unit_cost',
    'cogs_amount',
    'accounting_book_id',
    'location_internal_id',
    'created_from_id',
    'transaction_date',
    'posting_period',
    'netsuite_last_modified_at',
    'synced_at'
  ];

  const updateColumns = headerColumns.filter(
    col => col !== 'internal_id' &&
           col !== 'first_synced_at'
  );

  const sql = `
    BEGIN TRANSACTION;

    -- HEADER MERGE
    MERGE ${table(HEADER_TABLE)} AS target
    USING ${table(headerStage)} AS source
    ON target.internal_id = source.internal_id

    WHEN MATCHED THEN
      UPDATE SET
        ${updateColumns.map(
          col => `${col} = source.${col}`
        ).join(',\n        ')}

    WHEN NOT MATCHED THEN
      INSERT (${headerColumns.join(', ')})
      VALUES (
        ${headerColumns.map(col => `source.${col}`).join(', ')}
      );

    -- REPLACE ONLY CHANGED FULFILLMENT LINES
    DELETE FROM ${table(LINE_TABLE)}
    WHERE fulfillment_internal_id IN (
      SELECT internal_id
      FROM ${table(headerStage)}
    );

    INSERT INTO ${table(LINE_TABLE)}
    (${lineColumns.join(', ')})
    SELECT
      ${lineColumns.map(col => `s.${col}`).join(', ')}
    FROM ${table(lineStage)} s;

    -- UPDATE BOTH CHECKPOINTS
    MERGE ${table(CHECKPOINT_TABLE)} AS target
    USING (
      SELECT
        record_type,
        CAST(@maxModified AS DATETIME) AS modified_at
      FROM UNNEST([
        @headerType,
        @lineType
      ]) AS record_type
    ) AS source
    ON target.record_type = source.record_type

    WHEN MATCHED THEN
      UPDATE SET
        last_successful_modified_at = GREATEST(
          COALESCE(
            target.last_successful_modified_at,
            source.modified_at
          ),
          source.modified_at
        ),
        last_successful_sync_at = CURRENT_TIMESTAMP(),
        updated_at = CURRENT_TIMESTAMP()

    WHEN NOT MATCHED THEN
      INSERT (
        record_type,
        last_successful_modified_at,
        last_successful_sync_at,
        updated_at
      )
      VALUES (
        source.record_type,
        source.modified_at,
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
      );

    -- INTEGRITY ASSERTIONS
    ASSERT (
      (
        SELECT COUNT(*)
        FROM ${table(HEADER_TABLE)}
        WHERE internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) = @expectedHeaders
    ) AS 'Header count mismatch';

    ASSERT (
      (
        SELECT COUNT(*)
        FROM ${table(LINE_TABLE)}
        WHERE fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) = @expectedLines
    ) AS 'Line count mismatch';

    ASSERT (
      (
        SELECT COUNT(*)
        FROM (
          SELECT fulfillment_internal_id, line_unique_key
          FROM ${table(LINE_TABLE)}
          WHERE fulfillment_internal_id IN (
            SELECT internal_id FROM ${table(headerStage)}
          )
          GROUP BY fulfillment_internal_id, line_unique_key
          HAVING COUNT(*) > 1
        )
      ) = 0
    ) AS 'Duplicate line keys';

    ASSERT (
      (
        SELECT COUNT(*)
        FROM ${table(LINE_TABLE)} l
        LEFT JOIN ${table(HEADER_TABLE)} h
          ON h.internal_id = l.fulfillment_internal_id
        WHERE l.fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
        AND h.internal_id IS NULL
      ) = 0
    ) AS 'Orphan lines';

    COMMIT TRANSACTION;
  `;

  await bqQuery(sql, {
    maxModified: validDateTime(maxModified),
    headerType: HEADER_RECORD_TYPE,
    lineType: LINE_RECORD_TYPE,
    expectedHeaders: source.headerRows.length,
    expectedLines: source.lineRows.length
  });
}

// ============================================================
// POST-COMMIT RECONCILIATION
// ============================================================

async function reconcile(source, headerStage) {
  const rows = await bqQuery(`
    SELECT
      (
        SELECT COUNT(*)
        FROM ${table(HEADER_TABLE)}
        WHERE internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS header_count,

      (
        SELECT COUNT(*)
        FROM ${table(LINE_TABLE)}
        WHERE fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS line_count,

      (
        SELECT COALESCE(SUM(total_cogs_amount), 0)
        FROM ${table(HEADER_TABLE)}
        WHERE internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS header_cogs,

      (
        SELECT COALESCE(SUM(cogs_amount), 0)
        FROM ${table(LINE_TABLE)}
        WHERE fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS line_cogs,

      (
        SELECT COALESCE(SUM(quantity_shipped), 0)
        FROM ${table(LINE_TABLE)}
        WHERE fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS shipped_qty,

      (
        SELECT COUNT(*)
        FROM (
          SELECT fulfillment_internal_id, line_unique_key
          FROM ${table(LINE_TABLE)}
          WHERE fulfillment_internal_id IN (
            SELECT internal_id FROM ${table(headerStage)}
          )
          GROUP BY fulfillment_internal_id, line_unique_key
          HAVING COUNT(*) > 1
        )
      ) AS duplicates,

      (
        SELECT COUNT(*)
        FROM ${table(LINE_TABLE)} l
        LEFT JOIN ${table(HEADER_TABLE)} h
          ON h.internal_id = l.fulfillment_internal_id
        WHERE l.fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
        AND h.internal_id IS NULL
      ) AS orphans
  `);

  const r = rows[0];

  const checks = {
    headers:
      num(r.header_count) === source.headerRows.length,

    lines:
      num(r.line_count) === source.lineRows.length,

    header_cogs:
      cents(r.header_cogs) === cents(source.totalCogs),

    line_cogs:
      cents(r.line_cogs) === cents(source.totalCogs),

    quantity:
      Math.abs(num(r.shipped_qty) - source.totalQty) < 0.000001,

    duplicates:
      num(r.duplicates) === 0,

    orphans:
      num(r.orphans) === 0
  };

  console.log('\nBIGQUERY DELTA RECONCILIATION');

  for (const [name, passed] of Object.entries(checks)) {
    console.log(`${name}: ${passed ? 'PASS' : 'FAIL'}`);
  }

  if (!Object.values(checks).every(Boolean)) {
    throw new Error('BIGQUERY DELTA RECONCILIATION FAILED');
  }

  console.log('BIGQUERY DELTA RECONCILIATION: PASS');
}

// ============================================================
// CHECKPOINT UPDATE WHEN NO CHANGES
// ============================================================

async function markNoChanges() {
  const sql = `
    MERGE ${table(CHECKPOINT_TABLE)} AS target
    USING (
      SELECT record_type
      FROM UNNEST([
        @headerType,
        @lineType
      ]) AS record_type
    ) AS source
    ON target.record_type = source.record_type

    WHEN MATCHED THEN
      UPDATE SET
        last_successful_sync_at = CURRENT_TIMESTAMP(),
        updated_at = CURRENT_TIMESTAMP()

    WHEN NOT MATCHED THEN
      INSERT (
        record_type,
        last_successful_modified_at,
        last_successful_sync_at,
        updated_at
      )
      VALUES (
        source.record_type,
        CAST(@initialCheckpoint AS DATETIME),
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
      )
  `;

  await bqQuery(sql, {
    headerType: HEADER_RECORD_TYPE,
    lineType: LINE_RECORD_TYPE,
    initialCheckpoint: INITIAL_CHECKPOINT
  });
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('\n==========================================');
  console.log('NETSUITE ITEM FULFILLMENT DELTA SYNC');
  console.log('==========================================');
  console.log(`Mode     : ${DRY_RUN ? 'DRY RUN' : 'SYNC'}`);
  console.log(`Overlap  : ${OVERLAP_MINUTES} minutes`);

  const checkpoint = await getCheckpoint();

  console.log(
    `Header checkpoint : ${checkpoint.headerCheckpoint}`
  );

  console.log(
    `Lines checkpoint  : ${checkpoint.lineCheckpoint}`
  );

  console.log(
    `Fetching from     : ${checkpoint.fetchFrom}`
  );

  if (!checkpoint.headerExists || !checkpoint.lineExists) {
    console.log('First-run catch-up: ENABLED');
  }

  console.log('\nRequesting NetSuite OAuth...');

  const token = await getToken();
  console.log('NetSuite OAuth: SUCCESS');

  const headers = await fetchChangedHeaders(
    token,
    checkpoint.fetchFrom
  );

  console.log(`Changed fulfillments: ${headers.length}`);

  if (headers.length === 0) {
    if (!DRY_RUN) {
      await markNoChanges();
    }

    console.log(
      DRY_RUN
        ? 'DRY RUN PASS: No changes'
        : 'NO CHANGES. DELTA SYNC SUCCESS'
    );

    return;
  }

  const ids = headers.map(
    row => integer(row.internal_id)
  );

  const lines = await fetchDetails(token, ids, 'lines');

  const accounting = await fetchDetails(
    token,
    ids,
    'accounting'
  );

  const source = buildData(
    headers,
    lines,
    accounting
  );

  let maxModified = null;

  for (const row of headers) {
    const modified = validDateTime(
      row.netsuite_last_modified_at
    );

    if (!maxModified || modified > maxModified) {
      maxModified = modified;
    }
  }

  console.log(`Max modified: ${maxModified}`);

  if (DRY_RUN) {
    console.log('\nDRY RUN PASS: BigQuery unchanged');
    return;
  }

  const suffix = crypto.randomUUID().replaceAll('-', '');

  const headerStage = `_stage_if_h_${suffix}`;
  const lineStage = `_stage_if_l_${suffix}`;

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'netsuite-if-delta-')
  );

  const headerFile = path.join(tempDir, 'headers.jsonl');
  const lineFile = path.join(tempDir, 'lines.jsonl');

  const createdStages = [];

  try {
    validateNumericRows(source.headerRows, [
      ['total_quantity_shipped', 'NUMERIC'],
      ['total_cogs_amount', 'NUMERIC']
    ], { module: 'item-fulfillment-headers' });

    validateNumericRows(source.lineRows, [
      ['quantity_shipped', 'NUMERIC'],
      ['unit_cost', 'NUMERIC'],
      ['cogs_amount', 'NUMERIC']
    ], { module: 'item-fulfillment-lines' });
    writeJsonl(headerFile, source.headerRows);
    writeJsonl(lineFile, source.lineRows);

    await createStage(headerStage, HEADER_TABLE);
    createdStages.push(headerStage);

    await createStage(lineStage, LINE_TABLE);
    createdStages.push(lineStage);

    const stagedHeaders = await loadStage(
      headerStage,
      headerFile
    );

    const stagedLines = await loadStage(
      lineStage,
      lineFile
    );

    if (
      stagedHeaders !== source.headerRows.length ||
      stagedLines !== source.lineRows.length
    ) {
      throw new Error('STAGING VALIDATION FAILED');
    }

    console.log('STAGING VALIDATION: PASS');

    await commit(
      headerStage,
      lineStage,
      source,
      maxModified
    );

    console.log('ATOMIC MERGE + CHECKPOINT: SUCCESS');

    await reconcile(source, headerStage);

    console.log('\n==========================================');
    console.log('ITEM FULFILLMENT DELTA SYNC SUCCESS');
    console.log('==========================================');
  } finally {
    for (const stage of createdStages) {
      try {
        await dataset.table(stage).delete({
          ignoreNotFound: true
        });
      } catch (error) {
        console.error(
          `Stage cleanup warning: ${error.message}`
        );
      }
    }

    fs.rmSync(tempDir, {
      recursive: true,
      force: true
    });
  }
}

main().catch(error => {
  console.error('\nITEM FULFILLMENT DELTA SYNC ERROR');
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
```

### `modules/item-receipt/check-financial.mjs`

**Reconstructed SHA-256:** `3fa15c3b49b4ffa84d3c97549bee1dba3ba11f8f4f29c208fbedbdb6cfd25e29`.

```javascript
// Item Receipt financial detail reconciliation (READ ONLY).
// Uses existing shared NetSuite/BigQuery clients; no checkpoints or tables modified.
import { query, T } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, fetchLines, mapSource, FROM, TO } from './mapping.mjs';

const numericFields = ['quantity', 'rate', 'net_amount', 'foreign_amount'];
const amountFields = ['net_amount', 'foreign_amount'];
function scaled(value, scale, field, key) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw Error(`Invalid ${field} for ${key}: ${value}`);
  const scaledValue = Math.round(n * scale);
  if (!Number.isSafeInteger(scaledValue)) throw Error(`Unsafe numeric ${field} for ${key}`);
  return scaledValue;
}
function keyOf(row) { return `${String(row.receipt_internal_id)}:${String(row.line_unique_key)}`; }
function fmt(x, scale=100) { return (x / scale).toFixed(scale===100 ? 2 : 6); }
async function main() {
  console.log(`ITEM RECEIPT FINANCIAL CHECK | READ ONLY | ${FROM} to ${TO}`);
  const access = await token();
  const nsHeaders = await fetchHeaders(access);
  const raw = nsHeaders.length ? await fetchLines(access, nsHeaders.map(x => x.internal_id)) : [];
  const source = mapSource(nsHeaders, raw);
  const bqHeaders = await query(`SELECT internal_id,receipt_number,total_amount FROM ${T('item_receipt_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
  const bqLines = await query(`SELECT l.receipt_internal_id,l.line_unique_key,l.item_id,l.quantity,l.rate,l.net_amount,l.foreign_amount FROM ${T('item_receipt_lines')} l JOIN ${T('item_receipt_headers')} h ON h.internal_id=l.receipt_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`);
  const sourceIds = new Set(source.headers.map(x => x.internal_id));
  const bqIds = new Set(bqHeaders.map(x => String(x.internal_id)));
  const onlyNSHeaders = [...sourceIds].filter(x => !bqIds.has(x));
  const onlyBQHeaders = [...bqIds].filter(x => !sourceIds.has(x));
  const ns = new Map(source.lines.map(r => [keyOf(r), r]));
  const bq = new Map();
  const dupBQ=[];
  for (const r of bqLines) { const k=keyOf(r); if(bq.has(k))dupBQ.push(k); else bq.set(k,r); }
  const onlyNSLines = [...ns.keys()].filter(k=>!bq.has(k));
  const onlyBQLines = [...bq.keys()].filter(k=>!ns.has(k));
  const different=[];
  const perReceipt=new Map();
  function summary(id) { if (!perReceipt.has(id)) perReceipt.set(id,{nsNet:0,bqNet:0,nsForeign:0,bqForeign:0,nsQuantity:0,bqQuantity:0}); return perReceipt.get(id); }
  for(const r of source.lines){const s=summary(r.receipt_internal_id);s.nsNet+=scaled(r.net_amount,100,'net_amount',keyOf(r))??0;s.nsForeign+=scaled(r.foreign_amount,100,'foreign_amount',keyOf(r))??0;s.nsQuantity+=scaled(r.quantity,1e6,'quantity',keyOf(r))??0;}
  for(const r of bqLines){const s=summary(String(r.receipt_internal_id));s.bqNet+=scaled(r.net_amount,100,'net_amount',keyOf(r))??0;s.bqForeign+=scaled(r.foreign_amount,100,'foreign_amount',keyOf(r))??0;s.bqQuantity+=scaled(r.quantity,1e6,'quantity',keyOf(r))??0;}
  for(const [k,a] of ns){const b=bq.get(k);if(!b)continue;
    for(const f of numericFields){const scale=f==='quantity'||f==='rate'?1e6:100;const av=scaled(a[f],scale,f,k),bv=scaled(b[f],scale,f,k);if(av!==bv)different.push({key:k,field:f,netSuite:a[f],bigQuery:b[f]});}
    if((a.item_id??null)!==(b.item_id??null))different.push({key:k,field:'item_id',netSuite:a.item_id,bigQuery:b.item_id});
  }
  const receiptDifferences=[];
  for(const [id,s] of perReceipt){if(s.nsNet!==s.bqNet||s.nsForeign!==s.bqForeign||s.nsQuantity!==s.bqQuantity)receiptDifferences.push({id,netSuiteNet:fmt(s.nsNet),bigQueryNet:fmt(s.bqNet),netSuiteForeign:fmt(s.nsForeign),bigQueryForeign:fmt(s.bqForeign),netSuiteQuantity:fmt(s.nsQuantity,1e6),bigQueryQuantity:fmt(s.bqQuantity,1e6)});}
  const totals = {nsNet:0,bqNet:0,nsForeign:0,bqForeign:0,nsQuantity:0,bqQuantity:0};
  for(const s of perReceipt.values())for(const k of Object.keys(totals))totals[k]+=s[k];
  const nullHeaderAmounts=bqHeaders.filter(x=>x.total_amount==null).length;
  console.log(JSON.stringify({sourceHeaders:source.headers.length,bqHeaders:bqHeaders.length,sourceLines:source.lines.length,bqLines:bqLines.length,onlyNSHeaders,onlyBQHeaders,duplicateBQKeys:dupBQ.slice(0,20),onlyNSLines:onlyNSLines.slice(0,20),onlyBQLines:onlyBQLines.slice(0,20),fieldDifferences:different.slice(0,20),receiptDifferences:receiptDifferences.slice(0,20),summary:{netSuiteNet:fmt(totals.nsNet),bigQueryNet:fmt(totals.bqNet),netSuiteForeign:fmt(totals.nsForeign),bigQueryForeign:fmt(totals.bqForeign),netSuiteQuantity:fmt(totals.nsQuantity,1e6),bigQueryQuantity:fmt(totals.bqQuantity,1e6)},headerAmountsNull:nullHeaderAmounts},null,2));
  if(onlyNSHeaders.length||onlyBQHeaders.length||dupBQ.length||onlyNSLines.length||onlyBQLines.length||different.length||receiptDifferences.length)throw Error('ITEM RECEIPT FINANCIAL DETAIL CHECK: FAIL (review above; no changes applied)');
  console.log('ITEM RECEIPT FINANCIAL DETAIL CHECK: PASS');
  console.log('NOTICE: Header total_amount and GL accounting book reconciliation are NOT certified by this check.');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
```

### `modules/item-receipt/check.mjs`

**Reconstructed SHA-256:** `feaa96d4a3ab77b7866997c4c7a94a2f67aab1793483039a2e59f149ae698fc3`.

```javascript
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,mapSource,FROM,TO} from './mapping.mjs';
async function main(){
 const access=await token(),headers=await fetchHeaders(access);
 const raw=headers.length?await fetchLines(access,headers.map(x=>x.internal_id)):[];
 const source=mapSource(headers,raw);
 const rows=await query(`SELECT (SELECT COUNT(*) FROM ${T('item_receipt_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE) AS hc,(SELECT COUNT(*) FROM ${T('item_receipt_lines')} l JOIN ${T('item_receipt_headers')} h ON h.internal_id=l.receipt_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE) AS lc,(SELECT COUNT(*) FROM (SELECT receipt_internal_id,line_unique_key FROM ${T('item_receipt_lines')} GROUP BY 1,2 HAVING COUNT(*)>1)) AS dup,(SELECT COUNT(*) FROM ${T('item_receipt_lines')} l LEFT JOIN ${T('item_receipt_headers')} h ON h.internal_id=l.receipt_internal_id WHERE h.internal_id IS NULL) AS orphan`);
 const c=rows[0];
 const bqh=await query(`SELECT internal_id FROM ${T('item_receipt_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 const ns=new Set(source.headers.map(x=>x.internal_id)),bq=new Set(bqh.map(x=>x.internal_id));
 const onlyNS=[...ns].filter(x=>!bq.has(x)),onlyBQ=[...bq].filter(x=>!ns.has(x));
 console.log({source_headers:source.headers.length,bq_headers:Number(c.hc),source_lines:source.lines.length,bq_lines:Number(c.lc),only_ns:onlyNS.slice(0,20),only_bq:onlyBQ.slice(0,20),duplicate_lines:Number(c.dup),orphans:Number(c.orphan)});
 if(source.headers.length!==Number(c.hc)||source.lines.length!==Number(c.lc)||onlyNS.length||onlyBQ.length||Number(c.dup)||Number(c.orphan))throw Error('ITEM RECEIPT CHECK FAILED');
 console.log('ITEM RECEIPT CHECK: PASS (counts/presence/integrity ONLY)');
 console.log('AMOUNT KPI NOT CERTIFIED; NOT FINAL_PASS');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
```

### `modules/item-receipt/mapping.mjs`

**Reconstructed SHA-256:** `ed4013316ab134af4d1b71c19d0fb5f1aaf00edfc05870ccde14ff7fff16a692`.

```javascript
import {token, fetchAll} from '../../common/netsuite-client.mjs';
export {token};
export const TYPE='ItemRcpt';
export const FROM='2026-10-01';
export const TO='2026-11-01';
export const HEADER_SQL=`SELECT id AS internal_id, tranid AS receipt_number, TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date, TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified, BUILTIN.DF(status) AS status FROM Transaction WHERE type = 'ItemRcpt' AND trandate >= TO_DATE('${FROM}','YYYY-MM-DD') AND trandate < TO_DATE('${TO}','YYYY-MM-DD')`;
export async function fetchHeaders(access, since=null){
 const modified=since ? ` AND lastmodifieddate >= TO_DATE('${since}','YYYY-MM-DD HH24:MI:SS')` : '';
 return fetchAll(access, HEADER_SQL+modified+' ORDER BY id');
}
export async function fetchLines(access,ids){
 const result=[];
 for(let i=0;i<ids.length;i+=25){
  const group=ids.slice(i,i+25);
  if(!group.length)continue;
  const sql=`SELECT transaction, id AS line_id, uniquekey AS line_unique_key, linesequencenumber AS line_number, item AS item_id, quantity, rate, foreignamount, netamount, location AS location_id, units AS units_id, mainline, taxline, iscogs, accountinglinetype FROM TransactionLine WHERE transaction IN (${group.map(x=>Number(x)).join(',')}) ORDER BY transaction, id`;
  result.push(...await fetchAll(access,sql));
 }
 return result;
}
function id(n){const x=Number(n);if(!Number.isSafeInteger(x)||x<=0)throw Error(`Invalid ID: ${n}`);return String(x);}
function dec(v){if(v==null||v==='')return null;const n=Number(v);if(!Number.isFinite(n))throw Error(`Invalid decimal: ${v}`);return n.toFixed(6);}
// Exact arithmetic at NUMERIC's six fractional digits used by this module.
function decimalMicros(v){
 if(v==null||v==='')return 0n;
 const match=String(v).match(/^(-?)(\d+)(?:\.(\d{1,6}))?$/);
 if(!match)throw Error('Invalid six-decimal amount: '+v);
 const n=BigInt(match[2])*1000000n+BigInt((match[3]??'').padEnd(6,'0'));
 return match[1] ? -n : n;
}
function microsToDecimal(v){
 const negative=v<0n;const n=negative?-v:v;
 return (negative?'-':'')+(n/1000000n).toString()+'.'+(n%1000000n).toString().padStart(6,'0');
}
export function mapSource(headers,rawLines){
 const h=[],l=[],seen=new Set(),headerIds=new Set();
 for(const r of headers){const k=id(r.internal_id);if(headerIds.has(k))throw Error('Duplicate header '+k);headerIds.add(k);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(r.transaction_date)))throw Error('Invalid transaction date '+k);
  h.push({internal_id:k,receipt_number:r.receipt_number??null,transaction_date:r.transaction_date,last_modified:r.last_modified??null,created_from_id:r.created_from_id==null?null:String(r.created_from_id),status:r.status??null,total_amount:null});
 }
 for(const r of rawLines){
  const parent=id(r.transaction);if(!headerIds.has(parent))throw Error('Orphan source line '+parent);
  if(String(r.mainline).toUpperCase()!=='F'||String(r.taxline).toUpperCase()==='T'||String(r.iscogs).toUpperCase()==='T')continue;
  const key=r.line_unique_key==null?null:String(r.line_unique_key);if(!key)throw Error('Missing line uniquekey '+parent);
  const composite=parent+':'+key;if(seen.has(composite))throw Error('Duplicate source line '+composite);seen.add(composite);
  l.push({receipt_internal_id:parent,line_unique_key:key,line_id:r.line_id==null?null:String(r.line_id),line_number:r.line_number==null?null:String(r.line_number),item_id:r.item_id==null?null:String(r.item_id),quantity:dec(r.quantity),rate:dec(r.rate),foreign_amount:dec(r.foreignamount),net_amount:dec(r.netamount),location_id:r.location_id==null?null:String(r.location_id),units_id:r.units_id==null?null:String(r.units_id),accounting_line_type:r.accountinglinetype??null});
 }
 if(h.length&&!l.length)throw Error('No non-mainline receipt details found. Investigate SuiteQL before loading');
 const lineSet=new Set(l.map(x=>x.receipt_internal_id));const empty=h.filter(x=>!lineSet.has(x.internal_id));if(empty.length)throw Error(`Receipts without detail lines: ${empty.slice(0,10).map(x=>x.internal_id).join(', ')}`);
 // total_amount is a DERIVED sum of mapped detail net_amount, NOT the native NetSuite header total.
 // NULL net_amount lines contribute zero to this specifically named derived KPI.
 const totals=new Map(h.map(x=>[x.internal_id,0n]));
 for(const row of l)totals.set(row.receipt_internal_id,totals.get(row.receipt_internal_id)+decimalMicros(row.net_amount));
 for(const row of h)row.total_amount=microsToDecimal(totals.get(row.internal_id));
 return {headers:h,lines:l,rawLineCount:rawLines.length};
}
```

### `modules/item-receipt/presence.mjs`

**Reconstructed SHA-256:** `14267302aa543af89851a51d7f3091dbbc683417293585ec19f95a2d67809b21`.

```javascript
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,FROM,TO} from './mapping.mjs';
async function main(){const ns=new Set((await fetchHeaders(await token())).map(x=>String(x.internal_id)));const rows=await query(`SELECT internal_id FROM ${T('item_receipt_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);const bq=new Set(rows.map(x=>String(x.internal_id)));const onlyNS=[...ns].filter(x=>!bq.has(x)),onlyBQ=[...bq].filter(x=>!ns.has(x));console.log('NETSUITE',ns.size,'BIGQUERY',bq.size,'ONLY NETSUITE',onlyNS.length,'ONLY BIGQUERY',onlyBQ.length);console.log('ONLY NETSUITE IDs:',onlyNS);console.log('ONLY BIGQUERY IDs:',onlyBQ);if(onlyNS.length||onlyBQ.length)process.exitCode=3;else console.log('PRESENCE PASS');}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
```

### `modules/item-receipt/probe.mjs`

**Reconstructed SHA-256:** `b4a7387898785cb9d20af0d5b7e4be81c1d6f594ca834577b43c93f2f1ada98a`.

```javascript
import {token,fetchAll} from '../../common/netsuite-client.mjs';
import {fetchHeaders,fetchLines,mapSource,FROM,TO,TYPE} from './mapping.mjs';
try {
 console.log(`ITEM RECEIPT PROBE | READ ONLY | ${FROM} to ${TO} | expected type ${TYPE}`);
 const access=await token();
 const headers=await fetchHeaders(access);
 console.log('Header count:',headers.length);
 console.log('Header samples:',JSON.stringify(headers.slice(0,3),null,2));
 if(!headers.length){console.log('NO RECEIPTS: confirm NetSuite permissions and transaction type.');process.exit(2);}
 const lines=await fetchLines(access,headers.slice(0,3).map(h=>h.internal_id));
 console.log('Raw line sample:',JSON.stringify(lines.slice(0,9),null,2));
 const mapped=mapSource(headers.slice(0,3),lines);
 console.log('Mapped header count:',mapped.headers.length,'mapped item line count:',mapped.lines.length);
 const candidates=await fetchAll(access,`SELECT transaction,transactionline,accountingbook,account,debit,credit,posting FROM TransactionAccountingLine WHERE transaction IN (${headers.slice(0,3).map(h=>Number(h.internal_id)).join(',')})`);
 console.log('GL samples:',JSON.stringify(candidates.slice(0,15),null,2));
 console.log('PROBE PASS; amount KPI NOT YET CERTIFIED');
} catch(e){console.error('ITEM RECEIPT PROBE ERROR:',e.message);process.exitCode=1;}
```

### `modules/item-receipt/recover.mjs`

**Reconstructed SHA-256:** `22594f5d9db566968b40e8b833b05533b5544fb43dd75d7afd51520f6049bf31`.

```javascript
console.error('Item Receipt targeted recovery is not enabled; implement and test source-validated recovery before workflow integration.');
process.exitCode=3;
```

### `modules/item-receipt/sync.mjs`

**Reconstructed SHA-256:** `ef91aa7a15642dd9ecf0432076b94522761388536ef1ed04ae6268bb5c68fe3e`.

```javascript
import { validateNumericRows } from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {bq, dataset, DATASET, LOCATION, T, query} from '../../common/bigquery-client.mjs';
import {token, fetchHeaders, fetchLines, mapSource} from './mapping.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const SYNC = process.argv.includes('--sync');
if (DRY_RUN === SYNC) throw Error('Specify exactly one: --dry-run OR --sync');
const H='item_receipt_headers', L='item_receipt_lines', C='sync_checkpoints';
const HC='item_receipt_headers', LC='item_receipt_lines';
const headerFields=[['internal_id','STRING'],['receipt_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],['created_from_id','STRING'],['status','STRING'],['total_amount','NUMERIC']];
const lineFields=[['receipt_internal_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],['line_number','STRING'],['item_id','STRING'],['quantity','NUMERIC'],['rate','NUMERIC'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC'],['location_id','STRING'],['units_id','STRING'],['accounting_line_type','STRING']];
const columns = f => f.map(x=>x[0]);
function afterOverlap(value){const d=new Date(value.replace(' ','T')+'Z');if(Number.isNaN(+d))throw Error('Invalid checkpoint '+value);return new Date(+d-300000).toISOString().slice(0,19).replace('T',' ');}
async function ensureTables(){
 await query(`CREATE TABLE IF NOT EXISTS ${T(H)} (internal_id STRING NOT NULL,receipt_number STRING,transaction_date DATE,last_modified DATETIME,created_from_id STRING,status STRING,total_amount NUMERIC,synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP) PARTITION BY transaction_date CLUSTER BY internal_id`);
 await query(`CREATE TABLE IF NOT EXISTS ${T(L)} (receipt_internal_id STRING NOT NULL,line_unique_key STRING NOT NULL,line_id STRING,line_number STRING,item_id STRING,quantity NUMERIC,rate NUMERIC,foreign_amount NUMERIC,net_amount NUMERIC,location_id STRING,units_id STRING,accounting_line_type STRING,synced_at TIMESTAMP) CLUSTER BY receipt_internal_id,line_unique_key`);
 const [ok]=await dataset.table(C).exists();if(!ok)throw Error('Existing shared sync_checkpoints not found; refusing to create/alter it');
}
async function checkpoints(){
 const [ok]=await dataset.table(C).exists();if(!ok) return [];
 return query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS modified FROM ${T(C)} WHERE record_type IN ('${HC}','${LC}')`);
}
async function stage(name,rows,fields){
 validateNumericRows(rows, fields, { module: 'item-receipt' });
 if(!rows.length){await query(`CREATE TABLE ${T(name)} AS SELECT ${fields.map(([k,t])=>`CAST(NULL AS ${t}) AS ${k}`).join(',')} WHERE FALSE`);return;}
 const filename=path.join(os.tmpdir(),`netsuite-ir-${crypto.randomUUID()}.ndjson`);
 await fs.writeFile(filename,rows.map(x=>JSON.stringify(x)).join('\n')+'\n',{mode:0o600});
 try{await dataset.table(name).load(filename,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:fields.map(([name,type])=>({name,type}))},location:LOCATION});}
 finally{await fs.rm(filename,{force:true});}
 const got=await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);if(Number(got[0].n)!==rows.length)throw Error('Stage count mismatch '+name);
}
async function main(){
 console.log(`ITEM RECEIPT | ${DRY_RUN?'DRY RUN':'PRODUCTION SYNC'} | ${DATASET} | ${LOCATION}`);
 if(SYNC)await ensureTables();
 const cp=await checkpoints();if(cp.length>2||new Set(cp.map(x=>x.record_type)).size!==cp.length)throw Error('Duplicate checkpoint');
 const a=cp.find(x=>x.record_type===HC)?.modified,b=cp.find(x=>x.record_type===LC)?.modified;
 if(Boolean(a)!==Boolean(b)||a!==b)throw Error('Header/line checkpoint mismatch; review before sync');
 const since=a?afterOverlap(a):null;
 const access=await token();
 const headers=await fetchHeaders(access,since);
 const raw=headers.length?await fetchLines(access,headers.map(x=>x.internal_id)):[];
 const mapped=mapSource(headers,raw);
 console.log(`Source: headers=${mapped.headers.length} lines=${mapped.lines.length}; checkpoint=${a??'INITIAL'}; fetchFrom=${since??'FULL OCTOBER'}`);
 if(!a&&!headers.length)throw Error('Initial fetch empty; verify permission/type before creating checkpoint');
 if(DRY_RUN){console.log('DRY RUN PASS: no BigQuery write. AMOUNT KPI UNVERIFIED.');return;}
 if(a&&!headers.length){console.log('NO CHANGES; no checkpoint movement');console.log('ITEM RECEIPT NO CHANGES: SUCCESS');return;}
 // Never infer a deletion from a missing SuiteQL row. Historical records remain intact.
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20),hs=`_stage_ir_h_${suffix}`,ls=`_stage_ir_l_${suffix}`;
 const all=[hs,ls];
 try{
  await stage(hs,mapped.headers,headerFields);await stage(ls,mapped.lines,lineFields);
  const wm=mapped.headers.map(x=>x.last_modified).filter(Boolean).sort().at(-1);
  if(!wm || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(wm))throw Error('Missing/invalid source watermark');
  const hcols=columns(headerFields),lcols=columns(lineFields);
  const sql=`BEGIN
    BEGIN TRANSACTION;
    ASSERT (SELECT COUNT(*) FROM ${T(hs)})=@hc AS 'Staging header mismatch';
    ASSERT (SELECT COUNT(*) FROM ${T(ls)})=@lc AS 'Staging line mismatch';
    ASSERT (SELECT COUNT(*) FROM (SELECT internal_id FROM ${T(hs)} GROUP BY 1 HAVING COUNT(*)>1))=0 AS 'Duplicate headers';
    ASSERT (SELECT COUNT(*) FROM (SELECT receipt_internal_id,line_unique_key FROM ${T(ls)} GROUP BY 1,2 HAVING COUNT(*)>1))=0 AS 'Duplicate lines';
    MERGE ${T(H)} d USING ${T(hs)} s ON d.internal_id=s.internal_id
    WHEN MATCHED AND COALESCE(d.is_deleted,FALSE)=FALSE THEN UPDATE SET ${hcols.filter(x=>x!=='internal_id').map(x=>`${x}=s.${x}`).join(',')},synced_at=CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN INSERT(${hcols.join(',')},synced_at,is_deleted,deleted_at) VALUES(${hcols.map(x=>`s.${x}`).join(',')},CURRENT_TIMESTAMP(),FALSE,NULL);
    DELETE FROM ${T(L)} WHERE receipt_internal_id IN (SELECT internal_id FROM ${T(hs)});
    INSERT INTO ${T(L)}(${lcols.join(',')},synced_at) SELECT ${lcols.join(',')},CURRENT_TIMESTAMP() FROM ${T(ls)};
    MERGE ${T(C)} d USING (SELECT '${HC}' AS record_type UNION ALL SELECT '${LC}' AS record_type) s ON d.record_type=s.record_type
    WHEN MATCHED THEN UPDATE SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());
    ASSERT (SELECT COUNT(*) FROM ${T(L)} l LEFT JOIN ${T(H)} h ON h.internal_id=l.receipt_internal_id WHERE h.internal_id IS NULL)=0 AS 'Orphan lines';
    COMMIT TRANSACTION;
    EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
    END;`;
  await query(sql,{hc:mapped.headers.length,lc:mapped.lines.length,wm});
  console.log('ATOMIC MERGE + LINE REPLACE + CHECKPOINT: SUCCESS');
  console.log('ITEM RECEIPT SYNC SUCCESS; AMOUNT KPI UNVERIFIED; NOT YET V5.3 FINAL_PASS');
 }finally{for(const name of all){try{await dataset.table(name).delete({ignoreNotFound:true});}catch(e){console.error('Stage cleanup warning:',name,e.message);}}}
}
main().catch(e=>{console.error('ITEM RECEIPT ERROR:',e.stack??e);process.exitCode=1;});
```

### `modules/purchase-invoice/check.mjs`

**Reconstructed SHA-256:** `bfa96d7e28c48b21a2ed75bbc7eb345d46a23e654e0ddf6dd798c8fa96126035`.

```javascript
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPriorLinks,mapSource,FROM,TO} from './mapping.mjs';
const defs=[
 {table:'purchase_invoice_headers',source:'headers',keys:['internal_id'],fields:['internal_id','document_number','transaction_date','last_modified','status','vendor_id','vendor_name','currency_id','currency_name','exchange_rate','signed_foreign_total','signed_base_total','posting_period_id','subsidiary_id'],numbers:['exchange_rate','signed_foreign_total','signed_base_total']},
 {table:'purchase_invoice_lines',source:'transactionLines',keys:['bill_internal_id','line_unique_key'],fields:['bill_internal_id','line_unique_key','line_id','line_number','line_type','item_id','quantity','rate','foreign_amount','net_amount','accounting_line_type','is_mainline','is_tax_line'],numbers:['quantity','rate','foreign_amount','net_amount']},
 {table:'purchase_invoice_accounting_lines',source:'accountingLines',keys:['bill_internal_id','accounting_book_id','line_id','account_id'],fields:['bill_internal_id','accounting_book_id','line_id','account_id','debit','credit','posting'],numbers:['debit','credit']},
 {table:'purchase_invoice_prior_links',source:'priorLinks',keys:['bill_internal_id','previous_document_id','link_type'],fields:['bill_internal_id','previous_document_id','link_type'],numbers:[]}
];
function dec(v){
 const s=String(v).trim(),m=s.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
 if(!m)throw Error('Invalid decimal: '+s);
 const whole=m[2]??'',fraction=m[3]??m[4]??'',exp=Number(m[5]??0);
 if(!Number.isSafeInteger(exp)||Math.abs(exp)>100)throw Error('Invalid decimal exponent '+s);
 let digits=(whole+fraction).replace(/^0+/,'')||'0';if(digits==='0')return '0';
 const shift=exp-fraction.length;
 if(shift>=0)digits+='0'.repeat(shift);
 else{const point=digits.length+shift;digits=point>0?digits.slice(0,point)+'.'+digits.slice(point):'0.'+'0'.repeat(-point)+digits;digits=digits.replace(/0+$/,'').replace(/\.$/,'');}
 return (m[1]==='-'?'-':'')+digits;
}
function norm(field,value,d){
 if(value===null||value===undefined)return null;
 if(d.numbers.includes(field))return dec(value);
 if(['is_mainline','is_tax_line','posting'].includes(field))return value===true||String(value).toLowerCase()==='true'||String(value)==='1'?'true':'false';
 return String(value);
}
function key(row,fields){return fields.map(x=>String(row[x]??'NULL')).join('\u001f');}
async function main(){
 console.log('PURCHASE INVOICE FULL OCT 2026 CHECK | READ ONLY');
 const access=await token(),headers=await fetchHeaders(access),ids=headers.map(h=>h.internal_id);
 if(!headers.length)throw Error('Empty NetSuite source');
 const [lines,gl,links]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchPriorLinks(access,ids)]);
 const mapped=mapSource(headers,lines,gl,links);
 const report={};let failed=false;const failures=[];
 for(const d of defs){
  const fieldsSql=d.fields.map(f=>f==='transaction_date'?`CAST(transaction_date AS STRING) AS transaction_date`:f==='last_modified'?`FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_modified) AS last_modified`:d.numbers.includes(f)?`CAST(${f} AS STRING) AS ${f}`:f).join(',');
  const sql=d.source==='headers'?`SELECT ${fieldsSql} FROM ${T(d.table)} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`:`SELECT ${d.fields.map(f=>f==='last_modified'?`FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',l.last_modified) AS last_modified`:d.numbers.includes(f)?`CAST(l.${f} AS STRING) AS ${f}`:`l.${f}`).join(',')} FROM ${T(d.table)} l JOIN ${T('purchase_invoice_headers')} h ON h.internal_id=l.bill_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`;
  const stored=await query(sql),source=mapped[d.source];
  const srcMap=new Map(),dstMap=new Map();let duplicates=0,mismatch=0,onlySource=0,onlyBq=0;
  for(const r of source){const k=key(r,d.keys);if(srcMap.has(k))duplicates++;srcMap.set(k,r);}
  for(const r of stored){const k=key(r,d.keys);if(dstMap.has(k))duplicates++;dstMap.set(k,r);}
  for(const [k,r] of srcMap){const b=dstMap.get(k);if(!b){onlySource++;if(failures.length<12)failures.push({table:d.table,key:k,issue:'MISSING_IN_BQ'});continue;}
   const differences=d.fields.filter(f=>norm(f,r[f],d)!==norm(f,b[f],d));
   if(differences.length){mismatch++;if(failures.length<12)failures.push({table:d.table,key:k,fields:differences.slice(0,8),source:Object.fromEntries(differences.slice(0,4).map(f=>[f,r[f]])),bq:Object.fromEntries(differences.slice(0,4).map(f=>[f,b[f]]))});}
  }
  for(const k of dstMap.keys())if(!srcMap.has(k))onlyBq++;
  const ok=source.length===stored.length&&!duplicates&&!mismatch&&!onlySource&&!onlyBq;
  report[d.table]={source:source.length,bigQuery:stored.length,duplicates,mismatch,onlySource,onlyBq,status:ok?'PASS':'FAIL'};
  if(!ok)failed=true;
 }
 // Check integrity across all persisted rows, not just October.
 const checks=await query(`SELECT
 (SELECT COUNT(*) FROM (SELECT internal_id FROM ${T('purchase_invoice_headers')} GROUP BY 1 HAVING COUNT(*)>1)) AS duplicate_headers,
 (SELECT COUNT(*) FROM (SELECT bill_internal_id,line_unique_key FROM ${T('purchase_invoice_lines')} GROUP BY 1,2 HAVING COUNT(*)>1)) AS duplicate_lines,
 (SELECT COUNT(*) FROM (SELECT bill_internal_id,accounting_book_id,line_id,account_id FROM ${T('purchase_invoice_accounting_lines')} GROUP BY 1,2,3,4 HAVING COUNT(*)>1)) AS duplicate_gl,
 (SELECT COUNT(*) FROM (SELECT bill_internal_id,previous_document_id,link_type FROM ${T('purchase_invoice_prior_links')} GROUP BY 1,2,3 HAVING COUNT(*)>1)) AS duplicate_links,
 (SELECT COUNT(*) FROM ${T('purchase_invoice_lines')} l LEFT JOIN ${T('purchase_invoice_headers')} h ON h.internal_id=l.bill_internal_id WHERE h.internal_id IS NULL) AS orphan_lines,
 (SELECT COUNT(*) FROM ${T('purchase_invoice_accounting_lines')} l LEFT JOIN ${T('purchase_invoice_headers')} h ON h.internal_id=l.bill_internal_id WHERE h.internal_id IS NULL) AS orphan_gl,
 (SELECT COUNT(*) FROM ${T('purchase_invoice_prior_links')} l LEFT JOIN ${T('purchase_invoice_headers')} h ON h.internal_id=l.bill_internal_id WHERE h.internal_id IS NULL) AS orphan_links`);
 if(Object.values(checks[0]).some(x=>Number(x)!==0))failed=true;
 console.log(JSON.stringify({tables:report,integrity:checks[0],samples:failures},null,2));
 if(failed)throw Error('PURCHASE INVOICE CHECK FAILED');
 console.log('PURCHASE INVOICE CHECK PASS (four-table field-by-field, source financial invariants, and integrity)');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
```

### `modules/purchase-invoice/mapping.mjs`

**Reconstructed SHA-256:** `811cbb723643d01601d47efadf196719a05a460c93198bcb1f17b7d603992dfb`.

```javascript
import { normalizeNumericRate } from '../../common/decimal-precision.mjs';
import {token,fetchAll} from '../../common/netsuite-client.mjs';
export {token};
export const TYPE='VendBill', FROM='2026-10-01', TO='2026-11-01';
const dateWhere=`t.type='${TYPE}' AND t.trandate>=TO_DATE('${FROM}','YYYY-MM-DD') AND t.trandate<TO_DATE('${TO}','YYYY-MM-DD')`;
const numberId=x=>{const n=Number(x);if(!Number.isSafeInteger(n)||n<=0)throw Error(`Invalid NetSuite ID: ${x}`);return String(n);};
const txt=x=>x==null?null:String(x);
const flag=x=>String(x??'F').toUpperCase()==='T';
const decimal=x=>{if(x==null||x==='')return null;const v=String(x).trim();if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v))throw Error('Invalid decimal '+v);return v;};
// Normalize money into exact 1e-6 units without IEEE-754 rounding, including scientific notation.
function scaled(v){if(v==null||v==='')return 0n;const s=decimal(v);const m=s.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);const digits=(m[2]??'')+(m[3]??m[4]??'');const shift=Number(m[5]??0)-(m[3]??m[4]??'').length+6;if(!Number.isSafeInteger(shift)||Math.abs(shift)>100)throw Error('Unsupported precision '+s);let n=BigInt(digits||'0');if(shift>=0)n*=10n**BigInt(shift);else{const div=10n**BigInt(-shift);if(n%div!==0n)throw Error('Precision > 6 decimal places: '+s);n/=div;}return m[1]==='-'?-n:n;}
const grouped=async(access,ids,sqlFor)=>{const rows=[];for(let i=0;i<ids.length;i+=25){const group=ids.slice(i,i+25).map(numberId);rows.push(...await fetchAll(access,sqlFor(group.join(','))));}return rows;};
export async function fetchHeaders(access,since=null){
 if(since!==null && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(since))throw Error('Invalid incremental watermark');
 const modifiedWhere=since?` AND t.lastmodifieddate >= TO_DATE('${since}','YYYY-MM-DD HH24:MI:SS')`:'';
 return fetchAll(access,`SELECT t.id AS internal_id,t.tranid AS document_number,TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,BUILTIN.DF(t.status) AS status,t.entity AS vendor_id,BUILTIN.DF(t.entity) AS vendor_name,t.currency AS currency_id,BUILTIN.DF(t.currency) AS currency_name,t.exchangerate,t.foreigntotal,t.total,t.postingperiod AS posting_period_id,t.subsidiary AS subsidiary_id FROM Transaction t WHERE ${dateWhere}${modifiedWhere} ORDER BY t.id`);}
export async function fetchLines(access,ids){return grouped(access,ids,inIds=>`SELECT transaction AS transaction_id,id AS line_id,uniquekey AS line_unique_key,linesequencenumber AS line_number,item AS item_id,quantity,rate,foreignamount,netamount,mainline,taxline,iscogs,accountinglinetype FROM TransactionLine WHERE transaction IN (${inIds}) ORDER BY transaction,id`);}
export async function fetchGL(access,ids){return grouped(access,ids,inIds=>`SELECT transaction AS transaction_id,transactionline AS line_id,account AS account_id,accountingbook AS accounting_book_id,debit,credit,posting FROM TransactionAccountingLine WHERE transaction IN (${inIds}) ORDER BY transaction,transactionline,account`);}
export async function fetchPriorLinks(access,ids){return grouped(access,ids,inIds=>`SELECT nextdoc AS bill_id,previousdoc AS previous_document_id,linktype AS link_type FROM PreviousTransactionLineLink WHERE nextdoc IN (${inIds}) AND linktype IN ('OrdBill','BillRcpt') ORDER BY nextdoc,previousdoc`);}
export function mapSource(headers,lines,gl,links){
 const hs=[],ls=[],gs=[],rels=[];const headerIds=new Set(),lineKeys=new Set(),glCounts=new Map(),lineCounts=new Map(),mainCounts=new Map(),lineBalance=new Map(),debits=new Map(),credits=new Map(),apNetCredits=new Map();
 for(const r of headers){const id=numberId(r.internal_id);if(headerIds.has(id))throw Error('Duplicate header '+id);headerIds.add(id);if(!/^\d{4}-\d{2}-\d{2}$/.test(r.transaction_date??''))throw Error('Invalid date '+id);if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.last_modified??''))throw Error('Invalid watermark '+id);if(r.foreigntotal==null||r.total==null)throw Error('Missing amount '+id);hs.push({internal_id:id,document_number:txt(r.document_number),transaction_date:r.transaction_date,last_modified:r.last_modified,status:txt(r.status),vendor_id:txt(r.vendor_id),vendor_name:txt(r.vendor_name),currency_id:txt(r.currency_id),currency_name:txt(r.currency_name),exchange_rate:normalizeNumericRate(r.exchangerate,{module:"purchase-invoice",recordId:id,field:"exchange_rate"}),signed_foreign_total:decimal(r.foreigntotal),signed_base_total:decimal(r.total),posting_period_id:txt(r.posting_period_id),subsidiary_id:txt(r.subsidiary_id)});glCounts.set(id,0);lineCounts.set(id,0);mainCounts.set(id,0);lineBalance.set(id,0n);debits.set(id,0n);credits.set(id,0n);apNetCredits.set(id,0n);}
 for(const r of lines){const id=numberId(r.transaction_id);if(!headerIds.has(id))throw Error('Orphan transaction line '+id);const key=txt(r.line_unique_key);if(!key)throw Error('Missing line key '+id);if(lineKeys.has(key))throw Error('Duplicate line key '+key);lineKeys.add(key);const main=flag(r.mainline),tax=flag(r.taxline);if(flag(r.iscogs))throw Error('Unexpected COGS line '+id);lineBalance.set(id,lineBalance.get(id)+scaled(r.foreignamount));lineCounts.set(id,lineCounts.get(id)+1);if(main)mainCounts.set(id,mainCounts.get(id)+1);ls.push({bill_internal_id:id,line_unique_key:key,line_id:txt(r.line_id),line_number:txt(r.line_number),line_type:main?'AP_MAINLINE':tax?'TAX':r.accountinglinetype==='EXPENSE'?'EXPENSE':'ITEM_OR_OTHER',item_id:txt(r.item_id),quantity:decimal(r.quantity),rate:normalizeNumericRate(r.rate,{module:"purchase-invoice",recordId:id,field:"rate"}),foreign_amount:decimal(r.foreignamount),net_amount:decimal(r.netamount),accounting_line_type:txt(r.accountinglinetype),is_mainline:main,is_tax_line:tax});}
 const glKeys=new Set();for(const r of gl){const id=numberId(r.transaction_id);if(!headerIds.has(id))throw Error('Orphan GL '+id);if(!flag(r.posting))continue;const key=[id,r.accounting_book_id,r.line_id,r.account_id].map(txt).join(':');if(glKeys.has(key))throw Error('Duplicate GL key (check actual accounting-row grain) '+key);glKeys.add(key);const debit=scaled(r.debit),credit=scaled(r.credit);debits.set(id,debits.get(id)+debit);credits.set(id,credits.get(id)+credit);if(String(r.accounting_book_id)==='1' && String(r.line_id)==='0')apNetCredits.set(id,apNetCredits.get(id)+credit-debit);glCounts.set(id,glCounts.get(id)+1);gs.push({bill_internal_id:id,accounting_book_id:txt(r.accounting_book_id),line_id:txt(r.line_id),account_id:txt(r.account_id),debit:decimal(r.debit),credit:decimal(r.credit),posting:true});}
 const uniqueLinks=new Set();for(const r of links){const id=numberId(r.bill_id),prev=numberId(r.previous_document_id);if(!headerIds.has(id))throw Error('Orphan prior link '+id);const typ=txt(r.link_type);if(!['OrdBill','BillRcpt'].includes(typ))throw Error('Unexpected link type '+typ);const key=[id,prev,typ].join(':');if(!uniqueLinks.has(key)){uniqueLinks.add(key);rels.push({bill_internal_id:id,previous_document_id:prev,link_type:typ});}}
 for(const h of hs){const id=h.internal_id;if(mainCounts.get(id)!==1||lineCounts.get(id)<2)throw Error('Invalid transaction line structure '+id);if(!glCounts.get(id))throw Error('Missing GL '+id);if(lineBalance.get(id)!==0n)throw Error('Foreign line amount imbalance '+id);if(debits.get(id)!==credits.get(id))throw Error('GL imbalance '+id);if(apNetCredits.get(id)!==-scaled(h.signed_base_total))throw Error('AP mainline/header base mismatch '+id+' AP='+apNetCredits.get(id)+' expected='+(-scaled(h.signed_base_total)));}
 return {headers:hs,transactionLines:ls,accountingLines:gs,priorLinks:rels,counts:{headers:hs.length,transaction_lines:ls.length,accounting_lines:gs.length,distinct_prior_links:rels.length,mainlines:[...mainCounts.values()].reduce((a,b)=>a+b,0)}};
}
```

### `modules/purchase-invoice/presence.mjs`

**Reconstructed SHA-256:** `7f5aa4ddcc5c9bc6f7b02a90c216809b21a64b6d0a8908db8d4d55b7ceebc592`.

```javascript
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,FROM,TO} from './mapping.mjs';
async function main(){
 console.log('PURCHASE INVOICE PRESENCE | READ ONLY');
 const source=await fetchHeaders(await token());
 const ns=new Set(source.map(x=>String(x.internal_id)));
 const rows=await query(`SELECT internal_id FROM ${T('purchase_invoice_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 const bq=new Set(rows.map(x=>String(x.internal_id)));
 const onlyNetSuite=[...ns].filter(x=>!bq.has(x));
 const onlyBigQuery=[...bq].filter(x=>!ns.has(x));
 console.log(JSON.stringify({netSuite:ns.size,bigQuery:bq.size,onlyNetSuite,onlyBigQuery,sourceDuplicate:ns.size!==source.length,bigQueryDuplicate:bq.size!==rows.length},null,2));
 if(!source.length||ns.size!==source.length||bq.size!==rows.length)
  throw Error('PURCHASE INVOICE PRESENCE INTEGRITY FAILED');
if(onlyNetSuite.length||onlyBigQuery.length){
  console.log('PURCHASE INVOICE PRESENCE NEEDS_REVIEW');
  process.exitCode=3;
  return;
}
 console.log('PURCHASE INVOICE PRESENCE PASS');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
```

### `modules/purchase-invoice/probe.mjs`

**Reconstructed SHA-256:** `2238f598d575f742767b5f298463c92347f359109adeb92e11aa808603899dad`.

```javascript
// Vendor Bill / Purchase Invoice discovery. READ ONLY; no BigQuery writes/checkpoint.
// Reuse existing NetSuite OAuth2 M2M client and role.
import { token, fetchAll } from '../../common/netsuite-client.mjs';

const FROM = '2026-10-01';
const TO = '2026-11-01';
const TYPE = 'VendBill'; // Candidate; must verify before implementing mapping.
const dateFilter = `trandate >= TO_DATE('${FROM}','YYYY-MM-DD') AND trandate < TO_DATE('${TO}','YYYY-MM-DD')`;
const validId = x => /^\d+$/.test(String(x)) && Number.isSafeInteger(Number(x)) && Number(x) > 0;

async function inspect(access, title, sql, limit = 12) {
  console.log(`\n=== ${title} ===`);
  try {
    const rows = await fetchAll(access, sql);
    console.log('Rows:', rows.length);
    console.log('Sample:', JSON.stringify(rows.slice(0, limit), null, 2));
    return { ok: true, rows };
  } catch (error) {
    console.error('QUERY FAILED:', error.message);
    return { ok: false, rows: [] };
  }
}

try {
  console.log(`PURCHASE INVOICE / VENDOR BILL PROBE | READ ONLY | ${FROM} to ${TO}`);
  const access = await token();
  const types = await inspect(access, 'OCTOBER TRANSACTION TYPES',
    `SELECT type, COUNT(*) AS transaction_count FROM Transaction WHERE ${dateFilter} GROUP BY type ORDER BY type`, 100);
  const headers = await inspect(access, 'VENDOR BILL HEADERS',
    `SELECT id AS internal_id, tranid AS document_number, ` +
    `TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date, ` +
    `TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified, ` +
    `BUILTIN.DF(status) AS status FROM Transaction ` +
    `WHERE type='${TYPE}' AND ${dateFilter} ORDER BY id`, 8);

  if (!headers.ok) {
    console.error('Vendor Bill header query unavailable. Check role Vendor Bill=View / supported fields.');
    process.exitCode = 1;
  } else if (headers.rows.length === 0) {
    console.warn('No accessible October Vendor Bills. This does not prove there are no bills.');
    process.exitCode = 2;
  } else {
    const ids = headers.rows.slice(0, 5).map(row => row.internal_id);
    if (!ids.every(validId)) throw new Error('Unexpected nonnumeric transaction ID');
    const selected = ids.map(Number).join(',');

    await inspect(access, 'HEADER FINANCIAL FIELDS',
      `SELECT id, entity AS vendor_id, currency AS currency_id, foreigntotal AS foreign_total, ` +
      `exchangerate, postingperiod FROM Transaction WHERE id IN (${selected}) ORDER BY id`);
    await inspect(access, 'HEADER VENDOR / STATUS DISPLAY',
      `SELECT id, BUILTIN.DF(entity) AS vendor_name, BUILTIN.DF(status) AS status, ` +
      `BUILTIN.DF(currency) AS currency_name FROM Transaction WHERE id IN (${selected}) ORDER BY id`);
    await inspect(access, 'RAW TRANSACTION LINES',
      `SELECT transaction, id AS line_id, uniquekey AS line_unique_key, ` +
      `linesequencenumber AS line_number, item, quantity, rate, foreignamount, netamount, ` +
      `mainline, taxline, iscogs, accountinglinetype, location ` +
      `FROM TransactionLine WHERE transaction IN (${selected}) ORDER BY transaction,id`, 35);
    await inspect(access, 'LINE CLASSIFICATION',
      `SELECT mainline,taxline,iscogs,accountinglinetype,COUNT(*) AS line_count, ` +
      `SUM(foreignamount) AS foreign_amount_sum,SUM(netamount) AS net_amount_sum ` +
      `FROM TransactionLine WHERE transaction IN (${selected}) ` +
      `GROUP BY mainline,taxline,iscogs,accountinglinetype`, 25);
    await inspect(access, 'GENERAL LEDGER ACCOUNTING LINES',
      `SELECT transaction,transactionline,accountingbook,account,debit,credit,posting ` +
      `FROM TransactionAccountingLine WHERE transaction IN (${selected})`, 30);
    await inspect(access, 'PREVIOUS TRANSACTION LINKS (PO / RECEIPT)',
      `SELECT previousdoc,nextdoc,linktype FROM NextTransactionLineLink ` +
      `WHERE nextdoc IN (${selected})`, 20);
  }
  if (!types.ok) console.warn('Type list unavailable: check permissions; do not infer record absence.');
  console.log('\nPROBE FINISHED: READ ONLY. Business definition, totals, GL signs, voids, and data mapping NOT YET CERTIFIED.');
} catch (error) {
  console.error('PURCHASE INVOICE PROBE ERROR:', error.message);
  process.exitCode = 1;
}
```

### `modules/purchase-invoice/sync.mjs`

**Reconstructed SHA-256:** `98b82a6f70b0c528532a661b3cf8d5f324d76a59d9f38344fbf5623f5e614945`.

```javascript
import { validateNumericRows } from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {dataset, DATASET, LOCATION, T, query} from '../../common/bigquery-client.mjs';
import {token, fetchHeaders, fetchLines, fetchGL, fetchPriorLinks, mapSource} from './mapping.mjs';

const DRY_RUN=process.argv.includes('--dry-run');
const SYNC=process.argv.includes('--sync');
if(DRY_RUN===SYNC)throw Error('Specify exactly one: --dry-run OR --sync');
const C='sync_checkpoints';
const groups=[
 {table:'purchase_invoice_headers',fields:[['internal_id','STRING'],['document_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],['status','STRING'],['vendor_id','STRING'],['vendor_name','STRING'],['currency_id','STRING'],['currency_name','STRING'],['exchange_rate','NUMERIC'],['signed_foreign_total','NUMERIC'],['signed_base_total','NUMERIC'],['posting_period_id','STRING'],['subsidiary_id','STRING']],source:'headers',key:['internal_id']},
 {table:'purchase_invoice_lines',fields:[['bill_internal_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],['line_number','STRING'],['line_type','STRING'],['item_id','STRING'],['quantity','NUMERIC'],['rate','NUMERIC'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC'],['accounting_line_type','STRING'],['is_mainline','BOOL'],['is_tax_line','BOOL']],source:'transactionLines',key:['bill_internal_id','line_unique_key']},
 {table:'purchase_invoice_accounting_lines',fields:[['bill_internal_id','STRING'],['accounting_book_id','STRING'],['line_id','STRING'],['account_id','STRING'],['debit','NUMERIC'],['credit','NUMERIC'],['posting','BOOL']],source:'accountingLines',key:['bill_internal_id','accounting_book_id','line_id','account_id']},
 {table:'purchase_invoice_prior_links',fields:[['bill_internal_id','STRING'],['previous_document_id','STRING'],['link_type','STRING']],source:'priorLinks',key:['bill_internal_id','previous_document_id','link_type']}
];
const names=groups.map(x=>x.table);
const cols=g=>g.fields.map(([name])=>name);
const cpList=names.map(x=>`'${x}'`).join(',');
const yes=id=>/^\d+$/.test(String(id)) && Number.isSafeInteger(Number(id));
function overlap(date){const d=new Date(date.replace(' ','T')+'Z');if(Number.isNaN(+d))throw Error('Invalid checkpoint date '+date);return new Date(+d-300000).toISOString().slice(0,19).replace('T',' ');}
async function checkpoints(){return query(`SELECT record_type, FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS modified FROM ${T(C)} WHERE record_type IN (${cpList})`);}
// Same bounded conflict strategy as purchase-order. Never retry unknown commit outcomes.
const RETRY_DELAYS_MS = [1500, 3500, 7000];
function isCheckpointConflict(error){
 const message=String(error?.message??error);
 return /transaction is aborted due to concurrent update against table/i.test(message)
   && /netsuite_backup[.:]sync_checkpoints/i.test(message);
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function atomicCommitWithGuard(sql,params,originalCheckpoint){
 for(let attempt=0;;attempt++){
  try{return await query(sql,params);}
  catch(error){
   if(!isCheckpointConflict(error) || attempt>=RETRY_DELAYS_MS.length)throw error;
   // BigQuery explicitly aborted the full transaction. Confirm all four PI checkpoints
   // are still at the original watermark before replaying the same staged data.
   const latest=await checkpoints();
   if(latest.length!==(originalCheckpoint?4:0)
     || new Set(latest.map(row=>row.record_type)).size!==latest.length
     || latest.some(row=>!names.includes(row.record_type) || row.modified!==originalCheckpoint)){
    throw new Error(`Vendor Bill checkpoint changed after aborted transaction (before=${originalCheckpoint??'INITIAL'}). Refusing replay; run fresh --dry-run and --sync.`,{cause:error});
   }
   const wait=RETRY_DELAYS_MS[attempt];
   console.warn(`Vendor Bill checkpoint write conflict; transaction aborted. Retry ${attempt+1}/${RETRY_DELAYS_MS.length} after ${wait}ms (staging retained).`);
   await sleep(wait);
  }
 }
}
async function ensureTables(){
 const [ok]=await dataset.table(C).exists();if(!ok)throw Error('Shared checkpoint table missing; refusing to create');
 for(const g of groups){
  const defs=g.fields.map(([k,t])=>`${k} ${t}${g.key.includes(k)?' NOT NULL':''}`).join(',');
  const extra=g===groups[0]?',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP':',synced_at TIMESTAMP';
  const partition=g===groups[0]?' PARTITION BY transaction_date':'';
  const cluster=g===groups[0]?' CLUSTER BY internal_id':` CLUSTER BY ${g.key.slice(0,4).join(',')}`;
  await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${defs}${extra})${partition}${cluster}`);
 }
}
async function stage(name,rows,fields){
 validateNumericRows(rows, fields, { module: 'purchase-invoice' });
 if(!rows.length){await query(`CREATE TABLE ${T(name)} AS SELECT ${fields.map(([k,t])=>`CAST(NULL AS ${t}) AS ${k}`).join(',')} FROM UNNEST([1]) AS dummy WHERE FALSE`);return;}
 const filename=path.join(os.tmpdir(),`netsuite-vb-${crypto.randomUUID()}.ndjson`);
 await fs.writeFile(filename,rows.map(x=>JSON.stringify(x)).join('\n')+'\n',{mode:0o600});
 try{await dataset.table(name).load(filename,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:fields.map(([name,type])=>({name,type}))},location:LOCATION});}
 finally{await fs.rm(filename,{force:true});}
 const [v]=await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);if(Number(v.n)!==rows.length)throw Error('Stage count mismatch '+name);
}
async function main(){
 console.log(`PURCHASE INVOICE / VENDOR BILL | ${DRY_RUN?'DRY RUN':'PRODUCTION SYNC'} | ${DATASET} | ${LOCATION}`);
 const [hasCP]=await dataset.table(C).exists();if(!hasCP)throw Error('Shared sync_checkpoints missing');
 const cp=await checkpoints();
 if(cp.length!==0&&cp.length!==4)throw Error('Partial Vendor Bill checkpoints; refuse to continue');
 if(new Set(cp.map(x=>x.record_type)).size!==cp.length)throw Error('Duplicate Vendor Bill checkpoints');
 const baseline=cp.length?cp[0].modified:null;
 if(cp.some(x=>x.modified!==baseline))throw Error('Vendor Bill checkpoints diverged');
 const since=baseline?overlap(baseline):null;
 const access=await token();
 // For first version, fetch full October headers then select changed headers locally.
 // The source mapping's fetchHeaders() remains unchanged and validated.
 const headers=await fetchHeaders(access,since);
 if(!baseline&&!headers.length)throw Error('Initial VendBill fetch empty');
 if(headers.some(h=>!yes(h.internal_id)))throw Error('Invalid header id');
 const ids=headers.map(h=>h.internal_id);
 const [lines,gl,links]=await Promise.all([
  ids.length?fetchLines(access,ids):[],ids.length?fetchGL(access,ids):[],ids.length?fetchPriorLinks(access,ids):[]
 ]);
 const mapped=mapSource(headers,lines,gl,links);
 const totals=Object.fromEntries(groups.map(g=>[g.table,mapped[g.source].length]));
 console.log('Source mapped:',JSON.stringify(totals));
 console.log(`Checkpoint=${baseline??'INITIAL'}; overlap from=${since??'FULL OCTOBER'}`);
 if(DRY_RUN){console.log('DRY RUN PASS: source validated; BigQuery and checkpoints unchanged.');return;}
 if(baseline&&!headers.length){console.log('VENDOR BILL NO CHANGES: SUCCESS; checkpoint not moved');return;}
 await ensureTables();
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);
 const stages=groups.map((g,i)=>({...g,stageName:`_stage_vb_${i}_${suffix}`}));
 try{
  for(const g of stages)await stage(g.stageName,mapped[g.source],g.fields);
  const watermark= [...headers.map(h=>h.last_modified)].sort().at(-1);
  if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(watermark??''))throw Error('Invalid source watermark');
  const checks=stages.map(g=>{
   const count=mapped[g.source].length;
   const unique=g.key.join(',');
   return `ASSERT (SELECT COUNT(*) FROM ${T(g.stageName)})=${count} AS 'Stage row count mismatch ${g.table}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${unique} FROM ${T(g.stageName)} GROUP BY ${unique} HAVING COUNT(*)>1))=0 AS 'Duplicate stage key ${g.table}';`;
  }).join('\n');
  const merges=stages.map((g,i)=>{
   const fields=cols(g);
   if(i===0){return `MERGE ${T(g.table)} d USING ${T(g.stageName)} s ON d.internal_id=s.internal_id
WHEN MATCHED AND COALESCE(d.is_deleted,FALSE)=FALSE THEN UPDATE SET ${fields.filter(x=>x!=='internal_id').map(x=>`${x}=s.${x}`).join(',')},synced_at=CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT(${fields.join(',')},synced_at,is_deleted,deleted_at) VALUES(${fields.map(x=>`s.${x}`).join(',')},CURRENT_TIMESTAMP(),FALSE,NULL);`}
   return `DELETE FROM ${T(g.table)} WHERE bill_internal_id IN (SELECT internal_id FROM ${T(stages[0].stageName)});
INSERT INTO ${T(g.table)} (${fields.join(',')},synced_at) SELECT ${fields.join(',')},CURRENT_TIMESTAMP() FROM ${T(g.stageName)};`;
  }).join('\n');
  const guard=baseline?`ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN (${cpList}) AND last_successful_modified_at=DATETIME('${baseline}'))=4 AS 'Vendor Bill checkpoint advanced';`:'';
  const cpSql=`MERGE ${T(C)} d USING (SELECT record_type FROM UNNEST([${cpList}]) AS record_type) s ON d.record_type=s.record_type
WHEN MATCHED THEN UPDATE SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());`;
  const orphans=stages.slice(1).map(g=>`ASSERT (SELECT COUNT(*) FROM ${T(g.table)} l LEFT JOIN ${T(stages[0].table)} h ON h.internal_id=l.bill_internal_id WHERE h.internal_id IS NULL)=0 AS 'Orphan ${g.table}';`).join('\n');
  const sql=`BEGIN
BEGIN TRANSACTION;
${checks}
ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN (${cpList}))=${baseline?4:0} AS 'Vendor Bill checkpoint row count changed';
${guard}
${merges}
${cpSql}
${orphans}
COMMIT TRANSACTION;
EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
END;`;
  await atomicCommitWithGuard(sql,{wm:watermark},baseline);
  console.log('ATOMIC MERGE + DETAIL REPLACE + FOUR CHECKPOINTS: SUCCESS');
  console.log('VENDOR BILL SYNC SUCCESS; RUN reconciliation checks; NOT FINAL_PASS');
 } finally {for(const g of stages){try{await dataset.table(g.stageName).delete({ignoreNotFound:true});}catch(err){console.error('Stage cleanup warning',g.stageName,err.message);}}}
}
main().catch(err=>{console.error('VENDOR BILL ERROR:',err.stack??err);process.exitCode=1;});
```

### `modules/purchase-order/check.mjs`

**Reconstructed SHA-256:** `47ba6e19921be59c6c8613c56121e967067aa56e8c015b922c2850ea6b1f6776`.

```javascript
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,mapSource,FROM,TO} from './mapping.mjs';

const fieldsH=['po_number','transaction_date','last_modified','status','vendor_id','vendor_name','currency_id','exchange_rate','foreign_total','base_total','posting_period_id'];
const fieldsL=['line_id','line_number','line_type','item_id','quantity','rate','foreign_amount','net_amount','location_id','units_id','accounting_line_type','is_tax_line'];
const numericFields=new Set(['exchange_rate','foreign_total','base_total','quantity','rate','foreign_amount','net_amount']);

// Compare decimal values by mathematical value (no floating-point conversion).
// SuiteQL may return scientific notation, and BigQuery may omit trailing zeroes.
function decimalKey(value){
 if(value==null)return null;
 const s=String(value).trim();
 const m=s.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
 if(!m)throw Error('Invalid decimal in reconciliation: '+s);
 const intPart=m[2]??'';
 const fracPart=m[3]??m[4]??'';
 const exp=Number(m[5]??'0');
 if(!Number.isSafeInteger(exp)||Math.abs(exp)>1000)throw Error('Invalid exponent: '+s);
 let digits=(intPart+fracPart).replace(/^0+/,'')||'0';
 if(digits==='0')return '0';
 const shift=exp-fracPart.length;
 if(shift>=0)digits+='0'.repeat(shift);
 else{
  const point=digits.length+shift;
  digits=point>0 ? digits.slice(0,point)+'.'+digits.slice(point) : '0.'+'0'.repeat(-point)+digits;
  digits=digits.replace(/0+$/,'').replace(/\.$/,'');
 }
 return (m[1]==='-'?'-':'')+digits;
}
function canonical(field,value){
 if(value==null)return null;
 if(numericFields.has(field))return decimalKey(value);
 if(field==='is_tax_line'){
  if(value===true||String(value).toLowerCase()==='true'||String(value)==='1')return 'true';
  if(value===false||String(value).toLowerCase()==='false'||String(value)==='0')return 'false';
 }
 return String(value);
}
function differences(source,stored,columns){
 if(!stored)return [{field:'__missing_row',source:'present',bigquery:'missing'}];
 return columns.filter(k=>canonical(k,source[k])!==canonical(k,stored[k]))
  .map(k=>({field:k,source:source[k]??null,bigquery:stored[k]??null}));
}
async function main(){
 console.log('PURCHASE ORDER FULL OCT 2026 CHECK | READ ONLY');
 const access=await token();
 const headers=await fetchHeaders(access);
 const source=mapSource(headers,headers.length?await fetchLines(access,headers.map(x=>x.internal_id)):[]);
 const bqH=await query(`SELECT internal_id,po_number,CAST(transaction_date AS STRING) AS transaction_date,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_modified) AS last_modified,status,vendor_id,vendor_name,currency_id,CAST(exchange_rate AS STRING) AS exchange_rate,CAST(foreign_total AS STRING) AS foreign_total,CAST(base_total AS STRING) AS base_total,posting_period_id FROM ${T('purchase_order_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 const bqL=await query(`SELECT l.po_internal_id,l.line_unique_key,l.line_id,l.line_number,l.line_type,l.item_id,CAST(l.quantity AS STRING) AS quantity,CAST(l.rate AS STRING) AS rate,CAST(l.foreign_amount AS STRING) AS foreign_amount,CAST(l.net_amount AS STRING) AS net_amount,l.location_id,l.units_id,l.accounting_line_type,l.is_tax_line FROM ${T('purchase_order_lines')} l JOIN ${T('purchase_order_headers')} h ON h.internal_id=l.po_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`);
 const head=new Map(bqH.map(x=>[String(x.internal_id),x]));
 const lines=new Map(bqL.map(x=>[`${x.po_internal_id}:${x.line_unique_key}`,x]));
 let hfail=0,lfail=0;
 const samples=[];
 for(const h of source.headers){
  const diff=differences(h,head.get(h.internal_id),fieldsH);
  if(diff.length){hfail++;if(samples.length<8)samples.push({kind:'HEADER',id:h.internal_id,differences:diff.slice(0,5)});}
 }
 for(const l of source.lines){
  const key=`${l.po_internal_id}:${l.line_unique_key}`;
  const diff=differences(l,lines.get(key),fieldsL);
  if(diff.length){lfail++;if(samples.length<8)samples.push({kind:'LINE',id:key,differences:diff.slice(0,5)});}
 }
 const integrity=await query(`SELECT (SELECT COUNT(*) FROM (SELECT internal_id FROM ${T('purchase_order_headers')} GROUP BY 1 HAVING COUNT(*)>1)) AS dh,(SELECT COUNT(*) FROM (SELECT po_internal_id,line_unique_key FROM ${T('purchase_order_lines')} GROUP BY 1,2 HAVING COUNT(*)>1)) AS dl,(SELECT COUNT(*) FROM ${T('purchase_order_lines')} l LEFT JOIN ${T('purchase_order_headers')} h ON h.internal_id=l.po_internal_id WHERE h.internal_id IS NULL) AS orphan`);
 const ok=source.headers.length===bqH.length&&source.lines.length===bqL.length&&head.size===bqH.length&&lines.size===bqL.length&&hfail===0&&lfail===0&&Object.values(integrity[0]).every(v=>Number(v)===0);
 console.log(JSON.stringify({source_headers:source.headers.length,bq_headers:bqH.length,source_lines:source.lines.length,bq_lines:bqL.length,header_mismatch:hfail,line_mismatch:lfail,integrity:integrity[0],sample_errors:samples},null,2));
 if(!ok)throw Error('PURCHASE ORDER CHECK FAILED');
 console.log('PURCHASE ORDER CHECK PASS (snapshot field-by-field and integrity); scheduler/recovery NOT enabled');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
```

### `modules/purchase-order/mapping.mjs`

**Reconstructed SHA-256:** `2a19b818efe19bf42f9ff8876fc0c13be1774b44018b1bc041d20cdb2cbc4a88`.

```javascript
import {token,fetchAll} from '../../common/netsuite-client.mjs';
export {token};
export const TYPE='PurchOrd';
export const FROM='2026-10-01';
export const TO='2026-11-01';
const base=`FROM Transaction WHERE type='${TYPE}' AND trandate>=TO_DATE('${FROM}','YYYY-MM-DD') AND trandate<TO_DATE('${TO}','YYYY-MM-DD')`;
export async function fetchHeaders(access,since=null){
 const changed=since?` AND lastmodifieddate>=TO_DATE('${since}','YYYY-MM-DD HH24:MI:SS')`:'';
 const sql=`SELECT id AS internal_id,tranid AS po_number,TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date,TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,BUILTIN.DF(status) AS status,entity AS vendor_id,BUILTIN.DF(entity) AS vendor_name,currency AS currency_id,exchangerate,foreigntotal,total,postingperiod ${base}${changed} ORDER BY id`;
 return fetchAll(access,sql);
}
export async function fetchLines(access,ids){
 const results=[];
 for(let i=0;i<ids.length;i+=25){
  const group=ids.slice(i,i+25).map(validId);
  const sql=`SELECT transaction,id AS line_id,uniquekey AS line_unique_key,linesequencenumber AS line_number,item AS item_id,quantity,rate,foreignamount,netamount,location AS location_id,units AS units_id,mainline,taxline,iscogs,accountinglinetype FROM TransactionLine WHERE transaction IN (${group.join(',')}) ORDER BY transaction,id`;
  results.push(...await fetchAll(access,sql));
 }
 return results;
}
function validId(x){const n=Number(x);if(!Number.isSafeInteger(n)||n<=0)throw Error('Invalid source ID '+x);return String(n);}
function str(v){return v==null?null:String(v);}
function decimal(v){if(v==null||v==='')return null;const s=String(v);const n=Number(s);if(!Number.isFinite(n))throw Error('Invalid decimal '+s);return n.toFixed(6);}
function cents(v){
 if(v==null||v==='')return 0n;
 const s=String(v).trim();
 const m=s.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
 if(!m)throw Error('Invalid decimal: '+s);
 const digits=(m[2]??'')+(m[3]??m[4]??'');
 const fractional=(m[3]??m[4]??'').length;
 const exponent=Number(m[5]??'0');
 if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>1000)throw Error('Invalid exponent: '+s);
 const shift=exponent-fractional+6;
 let scaled=BigInt(digits);
 if(shift>=0){
  scaled*=10n**BigInt(shift);
 }else{
  const divisor=10n**BigInt(-shift);
  if(scaled%divisor!==0n)throw Error('More than 6 significant decimal places: '+s);
  scaled/=divisor;
 }
 return m[1]==='-'?-scaled:scaled;
}
function display(n){return `${n<0n?'-':''}${(n<0n?-n:n)/1000000n}.${((n<0n?-n:n)%1000000n).toString().padStart(6,'0')}`;}
const yes=v=>String(v??'F').toUpperCase()==='T';
export function mapSource(headers,rawLines){
 const outH=[],outL=[],ids=new Set(),keys=new Set(),balance=new Map(),mainCount=new Map(),detailCount=new Map();
 for(const r of headers){
  const id=validId(r.internal_id);if(ids.has(id))throw Error('Duplicate PO header '+id);ids.add(id);
  if(!/^\d{4}-\d\d-\d\d$/.test(r.transaction_date??''))throw Error('Invalid PO date '+id);
  if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(r.last_modified??''))throw Error('Missing PO modified date '+id);
  if(r.foreigntotal==null||r.total==null)throw Error('Missing financial header '+id);
  outH.push({internal_id:id,po_number:str(r.po_number),transaction_date:r.transaction_date,last_modified:r.last_modified,status:str(r.status),vendor_id:str(r.vendor_id),vendor_name:str(r.vendor_name),currency_id:str(r.currency_id),exchange_rate:decimal(r.exchangerate),foreign_total:decimal(r.foreigntotal),base_total:decimal(r.total),posting_period_id:str(r.postingperiod)});
  balance.set(id,0n);mainCount.set(id,0);detailCount.set(id,0);
 }
 for(const r of rawLines){
  const parent=validId(r.transaction);if(!ids.has(parent))throw Error('Orphan source PO line '+parent);
  const main=yes(r.mainline),tax=yes(r.taxline),cogs=yes(r.iscogs);
  if(cogs)throw Error('Unexpected COGS line: '+parent+':'+r.line_id);
  balance.set(parent,balance.get(parent)+cents(r.foreignamount));
  if(main){mainCount.set(parent,mainCount.get(parent)+1);continue;}
  detailCount.set(parent,detailCount.get(parent)+1);
  const key=str(r.line_unique_key);if(!key)throw Error('Missing unique key '+parent);
  const composite=parent+':'+key;if(keys.has(composite))throw Error('Duplicate PO line '+composite);keys.add(composite);
  const lineType=tax?'TAX':r.accountinglinetype==='ASSET'?'ASSET':r.accountinglinetype==='EXPENSE'?'EXPENSE':'OTHER';
  outL.push({po_internal_id:parent,line_unique_key:key,line_id:str(r.line_id),line_number:str(r.line_number),line_type:lineType,item_id:str(r.item_id),quantity:decimal(r.quantity),rate:decimal(r.rate),foreign_amount:decimal(r.foreignamount),net_amount:decimal(r.netamount),location_id:str(r.location_id),units_id:str(r.units_id),accounting_line_type:str(r.accountinglinetype),is_tax_line:tax});
 }
 for(const h of outH){
  const id=h.internal_id;
  if(mainCount.get(id)!==1||!detailCount.get(id))throw Error('PO structural count mismatch '+id);
  if(balance.get(id)!==0n)throw Error('PO foreign line imbalance '+id+': '+display(balance.get(id)));
 }
 if(!outH.length&&rawLines.length)throw Error('Lines present without PO headers');
 return {headers:outH,lines:outL,rawLineCount:rawLines.length,counts:{headers:outH.length,detail:outL.length,mainline:[...mainCount.values()].reduce((a,b)=>a+b,0)}};
}
```

### `modules/purchase-order/presence.mjs`

**Reconstructed SHA-256:** `81c542894e1f492d4055a3f4b7e3ccf411cd6f76c82e76f13edab96da19a3370`.

```javascript
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,FROM,TO} from './mapping.mjs';
async function main(){
 const ns=new Set((await fetchHeaders(await token())).map(x=>String(x.internal_id)));
 const rows=await query(`SELECT internal_id FROM ${T('purchase_order_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 const bq=new Set(rows.map(x=>String(x.internal_id)));
 const onlyNS=[...ns].filter(x=>!bq.has(x)),onlyBQ=[...bq].filter(x=>!ns.has(x));
 console.log(JSON.stringify({netSuite:ns.size,bigQuery:bq.size,onlyNetSuite:onlyNS,onlyBigQuery:onlyBQ},null,2));
 if(onlyNS.length||onlyBQ.length||rows.length!==bq.size)process.exitCode=3;else console.log('PURCHASE ORDER PRESENCE PASS');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
```

### `modules/purchase-order/probe.mjs`

**Reconstructed SHA-256:** `ec3f55920f413dce4ffa396cbce425211f04ac91de45eee472783dc97b067909`.

```javascript
// Purchase Order discovery probe - READ ONLY. October 2026 baseline.
// Uses existing shared OAuth/SuiteQL client. No BigQuery writes or checkpoints.
import { token, fetchAll } from '../../common/netsuite-client.mjs';

const FROM = '2026-10-01';
const TO = '2026-11-01';
const TYPE = 'PurchOrd';
const dateFilter = `trandate >= TO_DATE('${FROM}','YYYY-MM-DD') AND trandate < TO_DATE('${TO}','YYYY-MM-DD')`;
const isPositiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const quoteIds = values => values.map(Number).join(',');

async function section(access, name, sql, sampleSize = 5) {
  console.log(`\n=== ${name} ===`);
  try {
    const rows = await fetchAll(access, sql);
    console.log('Rows:', rows.length);
    console.log('Sample:', JSON.stringify(rows.slice(0, sampleSize), null, 2));
    return { ok: true, rows };
  } catch (error) {
    // An optional unsupported SuiteQL column should not hide other useful discoveries.
    console.error('QUERY FAILED:', error.message);
    return { ok: false, rows: [] };
  }
}

try {
  console.log(`PURCHASE ORDER PROBE | READ ONLY | ${FROM} to ${TO} | expected type ${TYPE}`);
  const access = await token();

  const types = await section(access, 'TRANSACTION TYPES (OCT 2026)',
    `SELECT type, COUNT(*) AS transaction_count FROM Transaction WHERE ${dateFilter} GROUP BY type ORDER BY type`, 100);

  const headers = await section(access, 'PURCHASE ORDER HEADERS',
    `SELECT id AS internal_id, tranid AS po_number, TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date, ` +
    `TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified, ` +
    `BUILTIN.DF(status) AS status FROM Transaction ` +
    `WHERE type = '${TYPE}' AND ${dateFilter} ORDER BY id`, 5);

  if (!headers.ok) {
    console.error('HEADER QUERY FAILED: Check Purchase Order = View and field availability. No conclusions about absence/deletion.');
    process.exitCode = 1;
  } else if (!headers.rows.length) {
    console.warn('NO PO HEADERS RETURNED. Verify permissions, PO activity for October, and transaction type.');
    process.exitCode = 2;
  } else {
    const ids = headers.rows.slice(0, 5).map(r => r.internal_id);
    if (!ids.every(isPositiveId)) throw new Error('Unsafe internal IDs from source');
    const inIds = quoteIds(ids);

    await section(access, 'HEADER FINANCIAL / ENTITY FIELDS',
      `SELECT id, entity AS vendor_id, currency AS currency_id, foreigntotal AS foreign_total, ` +
      `exchangerate, subsidiary, postingperiod, createdfrom ` +
      `FROM Transaction WHERE id IN (${inIds}) ORDER BY id`);

    await section(access, 'HEADER EXTENDED FIELDS',
      `SELECT id, subsidiary, postingperiod, createdfrom, exchangerate, ` +
      `BUILTIN.DF(status) AS status, BUILTIN.DF(entity) AS vendor_name ` +
      `FROM Transaction WHERE id IN (${inIds}) ORDER BY id`);

    await section(access, 'RAW LINES (INCLUDES MAINLINE/TAX/COGS)',
      `SELECT transaction, id AS line_id, uniquekey AS line_unique_key, ` +
      `linesequencenumber AS line_number, item, quantity, rate, foreignamount, ` +
      `netamount, location, units, mainline, taxline, iscogs, ` +
      `accountinglinetype FROM TransactionLine WHERE transaction IN (${inIds}) ` +
      `ORDER BY transaction, id`, 30);

    await section(access, 'LINE CLASSIFICATION SUMMARY (SAMPLED POS)',
      `SELECT mainline, taxline, iscogs, accountinglinetype, ` +
      `COUNT(*) AS line_count, SUM(foreignamount) AS sum_foreignamount, ` +
      `SUM(netamount) AS sum_netamount FROM TransactionLine ` +
      `WHERE transaction IN (${inIds}) ` +
      `GROUP BY mainline, taxline, iscogs, accountinglinetype ` +
      `ORDER BY mainline, taxline, iscogs, accountinglinetype`, 30);

    await section(access, 'ACCOUNTING LINES (MAY BE EMPTY FOR NONPOSTING PO)',
      `SELECT transaction, transactionline, accountingbook, account, debit, credit, posting ` +
      `FROM TransactionAccountingLine WHERE transaction IN (${inIds})`, 20);

    await section(access, 'RELATED TRANSACTIONS (PO -> RECEIPT/BILL)',
      `SELECT previousdoc, nextdoc, linktype FROM NextTransactionLineLink ` +
      `WHERE previousdoc IN (${inIds})`, 20);
  }
  console.log('\nPROBE COMPLETE: READ ONLY. No amounts, line classes, or links certified yet.');
  if (!types.ok) console.warn('Transaction type discovery failed; check role scope.');
} catch (error) {
  console.error('PURCHASE ORDER PROBE ERROR:', error.message);
  process.exitCode = 1;
}
```

### `modules/purchase-order/recover.mjs`

**Reconstructed SHA-256:** `18d4cc147fa9befe2b3438128a04fba0a92d01687cce052dc693429a94ce6c21`.

```javascript
console.error('Purchase Order targeted recovery is not enabled. Validate recovery safeguards before workflow integration.');
process.exitCode=3;
```

### `modules/purchase-order/sync.mjs`

**Reconstructed SHA-256:** `f9eb2a4395b2eb5859dc2b3afff8c7c4e53cc41dca1667d91ee849f5039165de`.

```javascript
import { validateNumericRows } from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {bq, dataset, DATASET, LOCATION, T, query} from '../../common/bigquery-client.mjs';
import {token, fetchHeaders, fetchLines, mapSource} from './mapping.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const SYNC = process.argv.includes('--sync');
if (DRY_RUN === SYNC) throw Error('Specify exactly one: --dry-run OR --sync');
const H='purchase_order_headers', L='purchase_order_lines', C='sync_checkpoints';
const HC='purchase_order_headers', LC='purchase_order_lines';
const headerFields=[['internal_id','STRING'],['po_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],['status','STRING'],['vendor_id','STRING'],['vendor_name','STRING'],['currency_id','STRING'],['exchange_rate','NUMERIC'],['foreign_total','NUMERIC'],['base_total','NUMERIC'],['posting_period_id','STRING']];
const lineFields=[['po_internal_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],['line_number','STRING'],['line_type','STRING'],['item_id','STRING'],['quantity','NUMERIC'],['rate','NUMERIC'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC'],['location_id','STRING'],['units_id','STRING'],['accounting_line_type','STRING'],['is_tax_line','BOOL']];
const columns = f => f.map(x=>x[0]);
function afterOverlap(value){const d=new Date(value.replace(' ','T')+'Z');if(Number.isNaN(+d))throw Error('Invalid checkpoint '+value);return new Date(+d-300000).toISOString().slice(0,19).replace('T',' ');}
async function ensureTables(){
 await query(`CREATE TABLE IF NOT EXISTS ${T(H)} (internal_id STRING NOT NULL,po_number STRING,transaction_date DATE,last_modified DATETIME,status STRING,vendor_id STRING,vendor_name STRING,currency_id STRING,exchange_rate NUMERIC,foreign_total NUMERIC,base_total NUMERIC,posting_period_id STRING,synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP) PARTITION BY transaction_date CLUSTER BY internal_id`);
 await query(`CREATE TABLE IF NOT EXISTS ${T(L)} (po_internal_id STRING NOT NULL,line_unique_key STRING NOT NULL,line_id STRING,line_number STRING,line_type STRING,item_id STRING,quantity NUMERIC,rate NUMERIC,foreign_amount NUMERIC,net_amount NUMERIC,location_id STRING,units_id STRING,accounting_line_type STRING,is_tax_line BOOL,synced_at TIMESTAMP) CLUSTER BY po_internal_id,line_unique_key`);
 const [ok]=await dataset.table(C).exists();if(!ok)throw Error('Shared sync_checkpoints missing; refusing to create/alter it');
}
async function checkpoints(){
 const [ok]=await dataset.table(C).exists();if(!ok) return [];
 return query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS modified FROM ${T(C)} WHERE record_type IN ('${HC}','${LC}')`);
}
async function stage(name,rows,fields){
 validateNumericRows(rows, fields, { module: 'purchase-order' });
 if(!rows.length){await query(`CREATE TABLE ${T(name)} AS SELECT ${fields.map(([k,t])=>`CAST(NULL AS ${t}) AS ${k}`).join(',')} WHERE FALSE`);return;}
 const filename=path.join(os.tmpdir(),`netsuite-po-${crypto.randomUUID()}.ndjson`);
 await fs.writeFile(filename,rows.map(x=>JSON.stringify(x)).join('\n')+'\n',{mode:0o600});
 try{await dataset.table(name).load(filename,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:fields.map(([name,type])=>({name,type}))},location:LOCATION});}
 finally{await fs.rm(filename,{force:true});}
 const got=await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);if(Number(got[0].n)!==rows.length)throw Error('Stage count mismatch '+name);
}
// Retry only BigQuery's explicit transaction-aborted concurrency failure.
// Do not retry a generic timeout/network failure: commit outcome may be unknown.
const RETRY_DELAYS_MS = [1500, 3500, 7000];
function isCheckpointConflict(error){
 const message=String(error?.message??error);
 return /transaction is aborted due to concurrent update against table/i.test(message)
   && /netsuite_backup[.:]sync_checkpoints/i.test(message);
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function atomicCommitWithGuard(sql, params, originalCheckpoint){
 for(let attempt=0;;attempt++){
  try { return await query(sql,params); }
  catch(error){
   if(!isCheckpointConflict(error) || attempt>=RETRY_DELAYS_MS.length) throw error;
   // The entire BigQuery transaction has been explicitly aborted. Before a new
   // attempt, ensure no other writer has advanced the PO checkpoint.
   const latest=await checkpoints();
   const h=latest.find(row=>row.record_type===HC)?.modified??null;
   const l=latest.find(row=>row.record_type===LC)?.modified??null;
   if(latest.length>2 || h!==l || h!==originalCheckpoint){
    throw new Error(`PO checkpoint changed after transaction abort (before=${originalCheckpoint??'INITIAL'}, headers=${h??'INITIAL'}, lines=${l??'INITIAL'}). Refusing replay; run a fresh --dry-run and --sync.`,{cause:error});
   }
   const wait=RETRY_DELAYS_MS[attempt];
   console.warn(`PO checkpoint write conflict; atomic transaction aborted. Retry ${attempt+1}/${RETRY_DELAYS_MS.length} after ${wait}ms (staging retained).`);
   await sleep(wait);
  }
 }
}
async function main(){
 console.log(`PURCHASE ORDER | ${DRY_RUN?'DRY RUN':'PRODUCTION SYNC'} | ${DATASET} | ${LOCATION}`);
 if(SYNC)await ensureTables();
 const cp=await checkpoints();if(cp.length>2||new Set(cp.map(x=>x.record_type)).size!==cp.length)throw Error('Duplicate checkpoint');
 const a=cp.find(x=>x.record_type===HC)?.modified,b=cp.find(x=>x.record_type===LC)?.modified;
 if(Boolean(a)!==Boolean(b)||a!==b)throw Error('Header/line checkpoint mismatch; review before sync');
 const since=a?afterOverlap(a):null;
 const access=await token();
 const headers=await fetchHeaders(access,since);
 const raw=headers.length?await fetchLines(access,headers.map(x=>x.internal_id)):[];
 const mapped=mapSource(headers,raw);
 console.log(`Source: headers=${mapped.headers.length} lines=${mapped.lines.length}; checkpoint=${a??'INITIAL'}; fetchFrom=${since??'FULL OCTOBER'}`);
 if(!a&&!headers.length)throw Error('Initial fetch empty; verify permission/type before creating checkpoint');
 if(DRY_RUN){console.log('DRY RUN PASS: no BigQuery write. SOURCE BALANCE VERIFIED; BQ NOT CERTIFIED.');return;}
 if(a&&!headers.length){console.log('NO CHANGES; no checkpoint movement');console.log('PURCHASE ORDER NO CHANGES: SUCCESS');return;}
 // Never infer a deletion from a missing SuiteQL row. Historical records remain intact.
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20),hs=`_stage_po_h_${suffix}`,ls=`_stage_po_l_${suffix}`;
 const all=[hs,ls];
 try{
  await stage(hs,mapped.headers,headerFields);await stage(ls,mapped.lines,lineFields);
  const wm=mapped.headers.map(x=>x.last_modified).filter(Boolean).sort().at(-1);
  if(!wm || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(wm))throw Error('Missing/invalid source watermark');
  const hcols=columns(headerFields),lcols=columns(lineFields);
  const sql=`BEGIN
    BEGIN TRANSACTION;
    ASSERT (SELECT COUNT(*) FROM ${T(hs)})=@hc AS 'Staging header mismatch';
    ASSERT (SELECT COUNT(*) FROM ${T(ls)})=@lc AS 'Staging line mismatch';
    ASSERT (SELECT COUNT(*) FROM (SELECT internal_id FROM ${T(hs)} GROUP BY 1 HAVING COUNT(*)>1))=0 AS 'Duplicate headers';
    ASSERT (SELECT COUNT(*) FROM (SELECT po_internal_id,line_unique_key FROM ${T(ls)} GROUP BY 1,2 HAVING COUNT(*)>1))=0 AS 'Duplicate lines';
    ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN ('${HC}','${LC}'))=${a?2:0} AS 'PO checkpoint row count changed';
    ${a?`ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN ('${HC}','${LC}') AND last_successful_modified_at=DATETIME('${a}'))=2 AS 'PO checkpoint advanced during sync';`:''}
    MERGE ${T(H)} d USING ${T(hs)} s ON d.internal_id=s.internal_id
    WHEN MATCHED AND COALESCE(d.is_deleted,FALSE)=FALSE THEN UPDATE SET ${hcols.filter(x=>x!=='internal_id').map(x=>`${x}=s.${x}`).join(',')},synced_at=CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN INSERT(${hcols.join(',')},synced_at,is_deleted,deleted_at) VALUES(${hcols.map(x=>`s.${x}`).join(',')},CURRENT_TIMESTAMP(),FALSE,NULL);
    DELETE FROM ${T(L)} WHERE po_internal_id IN (SELECT internal_id FROM ${T(hs)});
    INSERT INTO ${T(L)}(${lcols.join(',')},synced_at) SELECT ${lcols.join(',')},CURRENT_TIMESTAMP() FROM ${T(ls)};
    MERGE ${T(C)} d USING (SELECT '${HC}' AS record_type UNION ALL SELECT '${LC}' AS record_type) s ON d.record_type=s.record_type
    WHEN MATCHED THEN UPDATE SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());
    ASSERT (SELECT COUNT(*) FROM ${T(L)} l LEFT JOIN ${T(H)} h ON h.internal_id=l.po_internal_id WHERE h.internal_id IS NULL)=0 AS 'Orphan lines';
    COMMIT TRANSACTION;
    EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
    END;`;
  await atomicCommitWithGuard(sql,{hc:mapped.headers.length,lc:mapped.lines.length,wm},a??null);
  console.log('ATOMIC MERGE + LINE REPLACE + CHECKPOINT: SUCCESS');
  console.log('PURCHASE ORDER SYNC SUCCESS; RUN check.mjs + presence.mjs; NOT FINAL_PASS');
 }finally{for(const name of all){try{await dataset.table(name).delete({ignoreNotFound:true});}catch(e){console.error('Stage cleanup warning:',name,e.message);}}}
}
main().catch(e=>{console.error('PURCHASE ORDER ERROR:',e.stack??e);process.exitCode=1;});
```

### `modules/purchase-return/audit-common.mjs`

**Reconstructed SHA-256:** `7bb4ffc45a2ee72b9ccfdd95b36d41016d3fb100063979a302dd5d391616a334`.

```javascript
import { dataset, query, T, DATASET, LOCATION } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, fetchLines, fetchGL, fetchPreviousLinks, fetchNextLinks, mapSource, FROM, TO } from './mapping.mjs';

export const defs = [
 {table:'purchase_return_headers', group:'headers', keys:['internal_id']},
 {table:'purchase_return_lines', group:'transactionLines', keys:['authorization_internal_id','line_unique_key']},
 {table:'purchase_return_accounting_lines', group:'accountingLines', keys:['authorization_internal_id','accounting_book_id','line_id','account_id']},
 {table:'purchase_return_source_links', group:'sourceLinks', keys:['authorization_internal_id','source_internal_id','link_type']},
 {table:'purchase_return_downstream_links', group:'downstreamLinks', keys:['authorization_internal_id','related_internal_id','link_type']}
];
export const source = async () => {
 const access = await token();
 const h = await fetchHeaders(access);
 const ids = h.map(x=>x.internal_id);
 const [l,g,p,n] = ids.length ? await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchPreviousLinks(access,ids),fetchNextLinks(access,ids)]) : [[],[],[],[]];
 return mapSource(h,l,g,p,n);
};
export async function state() {
 const existence = await Promise.all(defs.map(async d => ({table:d.table, exists:(await dataset.table(d.table).exists())[0]})));
 const total=existence.filter(x=>x.exists).length;
 const cp=(await query(`SELECT record_type, FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS watermark FROM ${T('sync_checkpoints')} WHERE record_type IN (${defs.map(d=>`'${d.table}'`).join(',')})`));
 if ((total!==0 && total!==defs.length) || (cp.length!==0 && cp.length!==defs.length) || (total===0 && cp.length!==0) || (total===defs.length && cp.length!==0 && cp.length!==defs.length)) {
  throw Error(`PARTIAL INITIALIZATION: ${total}/${defs.length} tables, ${cp.length}/${defs.length} checkpoints`);
 }
 if(cp.length && new Set(cp.map(x=>x.watermark)).size!==1) throw Error('DIVERGENT CHECKPOINTS');
 return {mode:total===0?'NOT_INITIALIZED':cp.length===0?'SCHEMA_ONLY':'INITIALIZED',existence,checkpointRows:cp.length,watermark:cp[0]?.watermark??null};
}
export const key = (row,keys) => keys.map(k=>String(row[k]??'<NULL>')).join('\u001f');
export async function stored(def) {
 const isHeader=def.group==='headers';
 const join=isHeader?'':` JOIN ${T('purchase_return_headers')} h ON h.internal_id=d.authorization_internal_id`;
 const where=isHeader?`transaction_date >= DATE '${FROM}' AND transaction_date < DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`:`h.transaction_date >= DATE '${FROM}' AND h.transaction_date < DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`;
 return query(`SELECT ${isHeader?'*':'d.*'} FROM ${T(def.table)}${isHeader?'':' d'}${join} WHERE ${where}`);
}
export function compareIds(a,b,keys){
 const as=new Set(a.map(x=>key(x,keys))), bs=new Set(b.map(x=>key(x,keys)));
 return {source:a.length,target:b.length,sourceDuplicates:a.length-as.size,targetDuplicates:b.length-bs.size,onlySource:[...as].filter(x=>!bs.has(x)).slice(0,10),onlyTarget:[...bs].filter(x=>!as.has(x)).slice(0,10)};
}
export function status(r){return !r.sourceDuplicates&&!r.targetDuplicates&&!r.onlySource.length&&!r.onlyTarget.length?'PASS':'FAIL';}
export function intro(name,s){console.log(`PURCHASE RETURN ${name} | READ ONLY | ${DATASET} | ${LOCATION} | ${FROM} to ${TO}`);console.log('STATE:',JSON.stringify(s));}
export function finish(name,s){if(s.mode==='SCHEMA_ONLY'){console.log(`${name} SCHEMA_ONLY: five empty tables, zero checkpoints; NOT FINAL_PASS`);return;}if(s.mode==='NOT_INITIALIZED'){console.log(`${name} NOT_INITIALIZED: zero source and no tables/checkpoint; NOT FINAL_PASS`);return;}console.log(`${name} PASS: initialized target reconciled`);}
```

### `modules/purchase-return/check-financial.mjs`

**Reconstructed SHA-256:** `fae57f00b436d58ef3ee8a16c9cf47450612af14ea7839bd072cd5c0735efd73`.

```javascript
import { defs, source, state, stored, intro, finish } from './audit-common.mjs';
import { query,T } from '../../common/bigquery-client.mjs';
async function main(){
 const m=await source(),s=await state();intro('FINANCIAL',s);
 const nonPosting=m.accountingLines.filter(r=>r.posting===true);
 if(nonPosting.length)throw Error('VendAuth unexpectedly has posting GL');
 if(s.mode==='SCHEMA_ONLY'){
  if(defs.some(d=>m[d.group].length))throw Error('SCHEMA_ONLY but source records exist: NEEDS_SYNC');
  for(const d of defs){const rows=await stored(d);if(rows.length)throw Error('SCHEMA_ONLY has unexpected target rows: '+d.table);}
  finish('FINANCIAL',s);return;
 }
 if(s.mode==='NOT_INITIALIZED'){
  if(defs.some(d=>m[d.group].length))throw Error('Missing target with nonzero source');
  console.log('SOURCE FINANCIAL',JSON.stringify({headers:0,lines:0,gl:0,postingGL:0}));finish('FINANCIAL',s);return;
 }
 const h=await stored(defs[0]),l=await stored(defs[1]),g=await stored(defs[2]);
 const glPosting=g.filter(r=>r.posting===true||r.posting==='T');
 const orphans=await query(`SELECT (SELECT COUNT(*) FROM ${T('purchase_return_lines')} l LEFT JOIN ${T('purchase_return_headers')} h ON h.internal_id=l.authorization_internal_id WHERE h.internal_id IS NULL) AS orphan_lines,(SELECT COUNT(*) FROM ${T('purchase_return_accounting_lines')} a LEFT JOIN ${T('purchase_return_headers')} h ON h.internal_id=a.authorization_internal_id WHERE h.internal_id IS NULL) AS orphan_gl,(SELECT COUNT(*) FROM ${T('purchase_return_source_links')} a LEFT JOIN ${T('purchase_return_headers')} h ON h.internal_id=a.authorization_internal_id WHERE h.internal_id IS NULL) AS orphan_sources,(SELECT COUNT(*) FROM ${T('purchase_return_downstream_links')} a LEFT JOIN ${T('purchase_return_headers')} h ON h.internal_id=a.authorization_internal_id WHERE h.internal_id IS NULL) AS orphan_downstream`);
 const fail=glPosting.length!==0||h.length!==m.headers.length||l.length!==m.transactionLines.length||g.length!==m.accountingLines.length||Object.values(orphans[0]).some(v=>Number(v)!==0);
 console.log(JSON.stringify({source:{headers:m.headers.length,lines:m.transactionLines.length,gl:m.accountingLines.length},target:{headers:h.length,lines:l.length,gl:g.length,postingGL:glPosting.length},orphans:orphans[0],status:fail?'FAIL':'PASS'},null,2));
 if(fail)throw Error('FINANCIAL CHECK FAILED');finish('FINANCIAL',s);
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1});
```

### `modules/purchase-return/check.mjs`

**Reconstructed SHA-256:** `818c1c5af5cf051b3bc48e8ab4bc5e504321f7046f9d09f5e60a1945fa9c5240`.

```javascript
import { defs, source, state, compareIds, stored, status, intro, finish, key } from './audit-common.mjs';
const trim = x => x===null||x===undefined||x===''?null:String(x);
// Compare invariant fields only where BQ client may serialize dates/NUMERIC differently.
function canonical(v){const x=trim(v);if(x===null)return null;if(typeof v==='boolean')return v?'true':'false';if(x==='T')return 'true';if(x==='F')return 'false';if(/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(x)){
 const z=x.match(/^([-+]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
 if(z){const digits=(z[2]+(z[3]??'')).replace(/^0+/,'')||'0';const shift=Number(z[4]??0)-(z[3]??'').length;if(Math.abs(shift)>100)return x;const pt=digits.length+shift;const n=pt<=0?'0.'+'0'.repeat(-pt)+digits:pt>=digits.length?digits+'0'.repeat(pt-digits.length):digits.slice(0,pt)+'.'+digits.slice(pt);const [a,b='']=n.split('.');const out=a.replace(/^0+(?=\d)/,'')+(b.replace(/0+$/,'')?'.'+b.replace(/0+$/,''):'');return (z[1]==='-'&&out!=='0'?'-':'')+out;}
 }return x.replace('T',' ');}
async function main(){
 const m=await source(),s=await state();intro('CHECK',s);
 if(s.mode==='SCHEMA_ONLY'){
  if(defs.some(d=>m[d.group].length))throw Error('SCHEMA_ONLY but source records exist: NEEDS_SYNC');
  for(const d of defs){const rows=await stored(d);if(rows.length)throw Error('SCHEMA_ONLY has unexpected target rows: '+d.table);}
  finish('CHECK',s);return;
 }
 if(s.mode==='NOT_INITIALIZED'){
  if(defs.some(d=>m[d.group].length))throw Error('Source present but target missing: NEEDS_SYNC');finish('CHECK',s);return;
 }
 let fail=false;
 for(const d of defs){
  const src=m[d.group],dst=await stored(d),count=compareIds(src,dst,d.keys),byKey=new Map(dst.map(r=>[key(r,d.keys),r]));let mismatch=0;const sample=[];
  for(const r of src){const t=byKey.get(key(r,d.keys));if(!t)continue;const fields=Object.keys(r).filter(f=>f in t);const diff=fields.filter(f=>canonical(r[f])!==canonical(t[f]));if(diff.length){mismatch++;if(sample.length<5)sample.push({key:key(r,d.keys),fields:diff});}}
  const ok=status(count)==='PASS'&&mismatch===0;console.log(d.table,JSON.stringify({...count,fieldMismatch:mismatch,samples:sample,status:ok?'PASS':'FAIL'}));if(!ok)fail=true;
 }
 if(fail)throw Error('CHECK FAILED');finish('CHECK',s);
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1});
```

### `modules/purchase-return/deletion-inventory.mjs`

**Reconstructed SHA-256:** `e2db8d0ad96b70f53b9c6c2c45a67ab2d4a5a8a74472e56c434715f990ff6c7f`.

```javascript
// Pure, read-only inventory contract for the existing bounded deletion helper.
// Never interprets "only BigQuery" as deletion evidence.
function id(value) {
  const s = String(value ?? '');
  if (!/^[1-9][0-9]{0,14}$/.test(s)) throw Error(`Invalid transaction ID ${s}`);
  return s;
}
export function buildInventory(sourceRows, targetRows) {
  if (!Array.isArray(sourceRows) || !Array.isArray(targetRows)) throw Error('Missing inventory rows');
  const nsIds=sourceRows.map(x=>id(x.internal_id));
  const bqIds=targetRows.map(x=>id(x.internal_id));
  const ns=new Set(nsIds), bq=new Set(bqIds);
  const sourceDuplicate=ns.size!==nsIds.length;
  const bigQueryDuplicate=bq.size!==bqIds.length;
  return {
    netSuite:nsIds.length,
    bigQuery:bqIds.length,
    onlyNetSuite:[...ns].filter(x=>!bq.has(x)).sort((a,b)=>Number(a)-Number(b)),
    onlyBigQuery:[...bq].filter(x=>!ns.has(x)).sort((a,b)=>Number(a)-Number(b)),
    sourceDuplicate,
    bigQueryDuplicate
  };
}
```

### `modules/purchase-return/initialize-schema.mjs`

**Reconstructed SHA-256:** `81f025e26d9286df6adfd83e9633c0cd2e19b9ef0b450dfb4dfd159c232d3e40`.

```javascript
import { dataset, query, T, DATASET, LOCATION } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders } from './mapping.mjs';

// Exact schema copied from the validated Phase B sync.mjs; no sync/checkpoint mutations.
const groups = [
  { table:'purchase_return_headers', source:'headers', key:['internal_id'], parent:null, fields:[
    ['internal_id','STRING'],['authorization_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],
    ['status','STRING'],['vendor_id','STRING'],['vendor_name','STRING'],['currency_id','STRING'],
    ['exchange_rate','NUMERIC'],['foreign_total','NUMERIC'],['total_amount','NUMERIC'],['memo','STRING'],['subsidiary_id','STRING']
  ]},
  { table:'purchase_return_lines', source:'transactionLines', key:['authorization_internal_id','line_unique_key'], parent:'authorization_internal_id', fields:[
    ['authorization_internal_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],['line_number','STRING'],
    ['item_id','STRING'],['quantity','NUMERIC'],['rate_raw','STRING'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC'],
    ['location_id','STRING'],['units_id','STRING'],['is_cogs','BOOL'],['accounting_line_type','STRING']
  ]},
  { table:'purchase_return_accounting_lines', source:'accountingLines', key:['authorization_internal_id','accounting_book_id','line_id','account_id'], parent:'authorization_internal_id', fields:[
    ['authorization_internal_id','STRING'],['accounting_book_id','STRING'],['line_id','STRING'],['account_id','STRING'],
    ['debit','NUMERIC'],['credit','NUMERIC'],['posting','BOOL']
  ]},
  { table:'purchase_return_source_links', source:'sourceLinks', key:['authorization_internal_id','source_internal_id','link_type'], parent:'authorization_internal_id', fields:[
    ['authorization_internal_id','STRING'],['source_internal_id','STRING'],['source_type','STRING'],['source_number','STRING'],
    ['source_date','DATE'],['link_type','STRING']
  ]},
  { table:'purchase_return_downstream_links', source:'downstreamLinks', key:['authorization_internal_id','related_internal_id','link_type'], parent:'authorization_internal_id', fields:[
    ['authorization_internal_id','STRING'],['related_internal_id','STRING'],['related_type','STRING'],['related_number','STRING'],
    ['related_date','DATE'],['link_type','STRING']
  ]}
];
const APPLY = process.argv.includes('--apply-schema');
const DRY = process.argv.includes('--dry-run');
if (APPLY === DRY || process.argv.length !== 3) throw Error('Choose exactly one --dry-run or --apply-schema');
const cpNames=groups.map(g=>`'${g.table}'`).join(',');
async function main() {
  console.log(`PURCHASE RETURN SCHEMA-ONLY | ${APPLY?'APPLY':'DRY RUN'} | ${DATASET} | ${LOCATION}`);
  const [cpExists]=await dataset.table('sync_checkpoints').exists();
  if (!cpExists) throw Error('BLOCKED: shared sync_checkpoints missing');
  const cp=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames})`);
  if (cp.length) throw Error('BLOCKED: Purchase Return checkpoints already exist; schema-only init is forbidden');
  const access=await token();
  const headers=await fetchHeaders(access);
  if (headers.length) throw Error(`BLOCKED: ${headers.length} source headers exist; use normal production sync after validation, not empty schema initialization`);
  const states=[];
  for(const g of groups) {
    const [exists]=await dataset.table(g.table).exists();
    let rows=null;
    if(exists) {
      const result=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);
      rows=Number(result[0].n);
      if(rows!==0) throw Error(`BLOCKED: ${g.table} contains ${rows} rows`);
    }
    states.push({table:g.table,exists,rows});
  }
  console.log('BEFORE',JSON.stringify(states));
  if(DRY) { console.log('SCHEMA DRY RUN PASS: no DDL, no checkpoint writes, no source mutations');return; }
  // If interrupted after some CREATE TABLE calls, rerun is safe ONLY with existing empty tables.
  for(const g of groups) {
    const defs=g.fields.map(([name,type])=>`${name} ${type}${g.key.includes(name)?' NOT NULL':''}`).join(',');
    const header=g===groups[0];
    const extra=header?',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP':',synced_at TIMESTAMP';
    const partition=header?' PARTITION BY transaction_date':'';
    const cluster=header?' CLUSTER BY internal_id':` CLUSTER BY ${g.key.slice(0,4).join(',')}`;
    await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${defs}${extra})${partition}${cluster}`);
  }
  for(const g of groups) {
    const [exists]=await dataset.table(g.table).exists();
    if(!exists) throw Error(`Schema missing after init: ${g.table}`);
    const rows=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);
    if(Number(rows[0].n)!==0) throw Error(`Unexpected rows after init: ${g.table}`);
  }
  const cpAfter=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames})`);
  if(cpAfter.length) throw Error('Checkpoint changed during schema-only init; investigate concurrency');
  console.log('SCHEMA_ONLY PASS: five empty tables, zero Purchase Return checkpoint rows; NOT FINAL_PASS');
}
main().catch(e=>{console.error('PURCHASE RETURN SCHEMA ERROR:',e.stack??e);process.exitCode=1;});
```

### `modules/purchase-return/mapping.mjs`

**Reconstructed SHA-256:** `3b7e90d13cc53d5f10c26005d360638981ba0beeceb08a0d17f121ac9ae67072`.

```javascript
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { validateNumeric } from '../../common/decimal-precision.mjs';

export { token };
export const TYPE = 'VendAuth';
export const FROM = '2026-10-01';
export const TO = '2027-01-01';
const date = s => `TO_DATE('${s}','YYYY-MM-DD')`;
const id = v => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw Error(`Invalid NetSuite id ${v}`); return String(n); };
const str = v => v == null ? null : String(v);
const bool = v => String(v ?? 'F').toUpperCase() === 'T';
const dec = (v, recordId, field) => v == null || v === '' ? null : validateNumeric(String(v), {module:'purchase-return', recordId, field});
// Rates on historical VendAuth can exceed NUMERIC scale 9. Keep exact raw text in a STRING field; no rounding.
const rawRate = (v, recordId) => {
  if (v == null || v === '') return null;
  const raw=String(v).trim();
  if (!/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(raw)) throw Error(`Invalid raw rate ${recordId}: ${raw}`);
  return raw;
};
async function batched(access, ids, sql) {
  const results=[];
  for(let i=0;i<ids.length;i+=25) {
    const group=ids.slice(i,i+25).map(id);
    results.push(...await fetchAll(access, sql(group.join(','))));
  }
  return results;
}
export async function fetchHeaders(access, since=null, {from=FROM,to=TO}={}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw Error('Invalid date window');
  if(since!==null && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(since)) throw Error('Invalid modified watermark');
  const mod=since ? ` AND r.lastmodifieddate >= TO_DATE('${since}','YYYY-MM-DD HH24:MI:SS')` : '';
  return fetchAll(access, `SELECT r.id AS internal_id, r.tranid AS authorization_number, TO_CHAR(r.trandate,'YYYY-MM-DD') AS transaction_date, TO_CHAR(r.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified, BUILTIN.DF(r.status) AS status, r.entity AS vendor_id, BUILTIN.DF(r.entity) AS vendor_name, r.currency AS currency_id, r.exchangerate, r.foreigntotal, r.total, r.memo, r.subsidiary AS subsidiary_id FROM Transaction r WHERE r.type='VendAuth' AND r.trandate >= ${date(from)} AND r.trandate < ${date(to)}${mod} ORDER BY r.id`);
}
export async function fetchLines(access, ids) { return batched(access,ids, q=> `SELECT transaction AS transaction_id,id AS line_id,uniquekey AS line_unique_key,linesequencenumber AS line_number,item AS item_id,quantity,rate,foreignamount,netamount,location AS location_id,units AS units_id,mainline,taxline,iscogs,accountinglinetype FROM TransactionLine WHERE transaction IN (${q}) ORDER BY transaction,id`); }
export async function fetchGL(access, ids) { return batched(access,ids, q=> `SELECT transaction AS transaction_id,transactionline AS line_id,accountingbook AS accounting_book_id,account AS account_id,debit,credit,posting FROM TransactionAccountingLine WHERE transaction IN (${q}) ORDER BY transaction,accountingbook,transactionline,account`); }
export async function fetchPreviousLinks(access, ids) { return batched(access,ids, q=> `SELECT l.nextdoc AS authorization_id,l.previousdoc AS related_id,l.linktype AS link_type,t.type AS related_type,t.tranid AS related_number,TO_CHAR(t.trandate,'YYYY-MM-DD') AS related_date FROM PreviousTransactionLineLink l JOIN Transaction t ON t.id=l.previousdoc WHERE l.nextdoc IN (${q}) AND l.linktype='PurchRet' AND t.type='PurchOrd' ORDER BY l.nextdoc,l.previousdoc`); }
export async function fetchNextLinks(access, ids) { return batched(access,ids, q=> `SELECT l.previousdoc AS authorization_id,l.nextdoc AS related_id,l.linktype AS link_type,t.type AS related_type,t.tranid AS related_number,TO_CHAR(t.trandate,'YYYY-MM-DD') AS related_date FROM NextTransactionLineLink l JOIN Transaction t ON t.id=l.nextdoc WHERE l.previousdoc IN (${q}) AND ((l.linktype='ShipRcpt' AND t.type='ItemShip') OR (l.linktype='OrdBill' AND t.type='VendCred')) ORDER BY l.previousdoc,l.nextdoc`); }
export function mapSource(headers,lines,gl,previous,next) {
  const result={ headers:[],transactionLines:[],accountingLines:[],sourceLinks:[],downstreamLinks:[] };
  const ids=new Set(); const seenLines=new Set(); const seenGL=new Set(); const seenPrev=new Set(); const seenNext=new Set();
  const physicalCounts=new Map(); const prevCounts=new Map();
  for(const x of headers){
    const key=id(x.internal_id); if(ids.has(key)) throw Error(`Duplicate VendAuth ${key}`); ids.add(key);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(x.transaction_date??''))) throw Error(`Invalid date ${key}`);
    if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(x.last_modified??''))) throw Error(`Invalid watermark ${key}`);
    physicalCounts.set(key,0); prevCounts.set(key,0);
    result.headers.push({ internal_id:key,authorization_number:str(x.authorization_number), transaction_date:x.transaction_date,last_modified:x.last_modified,status:str(x.status),vendor_id:str(x.vendor_id),vendor_name:str(x.vendor_name),currency_id:str(x.currency_id), exchange_rate:dec(x.exchangerate,key,'exchange_rate'), foreign_total:dec(x.foreigntotal,key,'foreign_total'),total_amount:dec(x.total,key,'total_amount'),memo:str(x.memo),subsidiary_id:str(x.subsidiary_id) });
  }
  for(const x of lines){const key=id(x.transaction_id);if(!ids.has(key))throw Error(`Orphan return line ${key}`);if(bool(x.mainline)||bool(x.taxline))continue;
    const unique=str(x.line_unique_key);if(!unique)throw Error(`Missing uniquekey ${key}`);const compound=`${key}:${unique}`;if(seenLines.has(compound))throw Error(`Duplicate line ${compound}`);seenLines.add(compound);
    const quantity=dec(x.quantity,key,'quantity');const rate=rawRate(x.rate,key);
    if(x.item_id!=null && quantity!=null && quantity!=='0')physicalCounts.set(key,physicalCounts.get(key)+1);
    result.transactionLines.push({authorization_internal_id:key,line_unique_key:unique,line_id:str(x.line_id),line_number:str(x.line_number),item_id:str(x.item_id),quantity,rate_raw:rate,foreign_amount:dec(x.foreignamount,key,'foreign_amount'),net_amount:dec(x.netamount,key,'net_amount'),location_id:str(x.location_id),units_id:str(x.units_id),is_cogs:bool(x.iscogs),accounting_line_type:str(x.accountinglinetype)});
  }
  for(const x of gl){const key=id(x.transaction_id);if(!ids.has(key))throw Error(`Orphan GL ${key}`);const compound=[key,x.accounting_book_id,x.line_id,x.account_id].join(':');if(seenGL.has(compound))throw Error(`Duplicate GL ${compound}`);seenGL.add(compound);
    if(bool(x.posting))throw Error(`Unexpected posting GL for VendAuth ${key}`);
    result.accountingLines.push({authorization_internal_id:key,accounting_book_id:str(x.accounting_book_id),line_id:str(x.line_id),account_id:str(x.account_id),debit:dec(x.debit,key,'debit'),credit:dec(x.credit,key,'credit'),posting:false});
  }
  for(const x of previous){const key=id(x.authorization_id);if(!ids.has(key))throw Error(`Orphan source link ${key}`);if(x.link_type!=='PurchRet'||x.related_type!=='PurchOrd')throw Error(`Unexpected previous link ${key}`);
    const uniq=`${key}:${id(x.related_id)}:PurchRet`;if(seenPrev.has(uniq))continue;seenPrev.add(uniq);prevCounts.set(key,prevCounts.get(key)+1);
    result.sourceLinks.push({authorization_internal_id:key,source_internal_id:id(x.related_id),source_type:'PurchOrd',source_number:str(x.related_number),source_date:str(x.related_date),link_type:'PurchRet'});
  }
  for(const x of next){const key=id(x.authorization_id);if(!ids.has(key))throw Error(`Orphan downstream link ${key}`);if(!((x.link_type==='ShipRcpt'&&x.related_type==='ItemShip')||(x.link_type==='OrdBill'&&x.related_type==='VendCred')))throw Error(`Unexpected downstream link ${key}`);
    const uniq=`${key}:${id(x.related_id)}:${x.link_type}`;if(seenNext.has(uniq))continue;seenNext.add(uniq);
    result.downstreamLinks.push({authorization_internal_id:key,related_internal_id:id(x.related_id),related_type:x.related_type,related_number:str(x.related_number),related_date:str(x.related_date),link_type:x.link_type});
  }
  // Not all authorizations are completed: cancelled and closed records must remain eligible.
  for(const key of ids){if(physicalCounts.get(key)===0)throw Error(`VendAuth ${key} missing item lines`);}
  result.counts=Object.fromEntries(Object.entries(result).filter(([k])=>k!=='counts').map(([k,v])=>[k,v.length]));
  return result;
}
```

### `modules/purchase-return/presence.mjs`

**Reconstructed SHA-256:** `8126fac59f901542d549be0bcd8f00e4ce02d7bf67fbd5e257c4658969da15a6`.

```javascript
import { defs, source, state, compareIds, stored, status, intro, finish } from './audit-common.mjs';
import { buildInventory } from './deletion-inventory.mjs';

async function main(){
 if(process.argv.includes('--deletion-inventory')) {
  if(process.argv.length !== 3) throw Error('Unsupported deletion inventory arguments');
  const s=await state();
  if(s.mode!=='INITIALIZED') throw Error(`BLOCKED: Purchase Return is ${s.mode}; deletion inventory unavailable until INITIALIZED`);
  const m=await source();
  const rows=await stored(defs[0]);
  const inventory=buildInventory(m.headers,rows);
  console.log(JSON.stringify(inventory));
  if(inventory.sourceDuplicate || inventory.bigQueryDuplicate) {process.exitCode=1;return;}
  if(inventory.onlyNetSuite.length || inventory.onlyBigQuery.length) process.exitCode=3;
  return;
 }
 if(process.argv.length!==2) throw Error('Unsupported presence arguments');
 const m=await source(), s=await state();intro('PRESENCE',s);
 if(s.mode==='SCHEMA_ONLY'){
  if(defs.some(d=>m[d.group].length))throw Error('SCHEMA_ONLY but source records exist: NEEDS_SYNC');
  for(const d of defs){const rows=await stored(d);if(rows.length)throw Error('SCHEMA_ONLY has unexpected target rows: '+d.table);}
  finish('PRESENCE',s);return;
 }
 if(s.mode==='NOT_INITIALIZED'){
  if(defs.some(d=>m[d.group].length))throw Error('Source records exist but target not initialized: NEEDS_SYNC');
  finish('PRESENCE',s);return;
 }
 let failed=false;
 for(const d of defs){const c=compareIds(m[d.group],await stored(d),d.keys);c.status=status(c);console.log(d.table,JSON.stringify(c));if(c.status!=='PASS')failed=true;}
 if(failed)throw Error('PRESENCE FAILED');finish('PRESENCE',s);
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1});
```

### `modules/purchase-return/scheduler-gate.mjs`

**Reconstructed SHA-256:** `9add7efc0f89cbf9f5d08059e53a5802e80ef0bb7dec437de86fe8978b7c5250`.

```javascript
// Purchase Return scheduler gate: read only, no DDL, no checkpoint, no deletion.
// NO_SOURCE is operationally healthy but NEVER FINAL_PASS/SYNC_OK.
import { state } from './audit-common.mjs';
import { token, fetchHeaders } from './mapping.mjs';

async function main() {
  if (process.argv.length !== 2) throw Error('Usage: node modules/purchase-return/scheduler-gate.mjs');
  const s = await state();
  const h = await fetchHeaders(await token());
  const n = h.length;
  console.log(`PURCHASE RETURN SCHEDULER PRECHECK: state=${s.mode}; sourceHeaders=${n}; checkpoints=${s.checkpointRows}`);
  if ((s.mode === 'SCHEMA_ONLY' || s.mode === 'NOT_INITIALIZED') && n === 0) {
    console.log('PURCHASE RETURN GATE: NO_SOURCE');
    return;
  }
  if ((s.mode === 'SCHEMA_ONLY' || s.mode === 'NOT_INITIALIZED') && n > 0) {
    console.log('PURCHASE RETURN GATE: SOURCE_PENDING_INITIAL_SYNC');
    return;
  }
  if (s.mode === 'INITIALIZED') {
    if (s.checkpointRows !== 5 || !s.watermark) throw Error('INVALID_PURCHASE_RETURN_CHECKPOINT');
    console.log('PURCHASE RETURN GATE: READY');
    return;
  }
  throw Error('UNKNOWN_PURCHASE_RETURN_STATE');
}
main().catch(e => {console.error('PURCHASE RETURN GATE ERROR:', e.stack ?? e);process.exitCode=1;});
```

### `modules/purchase-return/sync.mjs`

**Reconstructed SHA-256:** `3743dce169b686aa560ec5e3b1bf7b9f021148bdeb99b086af01cda7a53614b3`.

```javascript
import { validateNumericRows } from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataset, DATASET, LOCATION, T, query } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, fetchLines, fetchGL, fetchPreviousLinks, fetchNextLinks, mapSource } from './mapping.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const SYNC = process.argv.includes('--sync');
const TIMING = process.argv.includes('--timing');
const PERF_START = process.hrtime.bigint();
function elapsedMs(start) { return Number(process.hrtime.bigint() - start) / 1e6; }
function perf(label, value) {
  if (TIMING) console.log(`[PR-PERF] ${label} ${value.toFixed(1)}ms since_start=${elapsedMs(PERF_START).toFixed(1)}ms`);
}
async function timed(label, run) {
  const start = process.hrtime.bigint();
  try {
    return await run();
  } finally {
    perf(label, elapsedMs(start));
  }
}

if (DRY_RUN === SYNC) throw Error('Specify exactly one: --dry-run OR --sync');

const C = 'sync_checkpoints';
const groups = [
  { table:'purchase_return_headers', source:'headers', key:['internal_id'], parent:null, fields:[
    ['internal_id','STRING'],['authorization_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],
    ['status','STRING'],['vendor_id','STRING'],['vendor_name','STRING'],['currency_id','STRING'],
    ['exchange_rate','NUMERIC'],['foreign_total','NUMERIC'],['total_amount','NUMERIC'],['memo','STRING'],['subsidiary_id','STRING']
  ]},
  { table:'purchase_return_lines', source:'transactionLines', key:['authorization_internal_id','line_unique_key'], parent:'authorization_internal_id', fields:[
    ['authorization_internal_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],['line_number','STRING'],
    ['item_id','STRING'],['quantity','NUMERIC'],['rate_raw','STRING'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC'],
    ['location_id','STRING'],['units_id','STRING'],['is_cogs','BOOL'],['accounting_line_type','STRING']
  ]},
  { table:'purchase_return_accounting_lines', source:'accountingLines', key:['authorization_internal_id','accounting_book_id','line_id','account_id'], parent:'authorization_internal_id', fields:[
    ['authorization_internal_id','STRING'],['accounting_book_id','STRING'],['line_id','STRING'],['account_id','STRING'],
    ['debit','NUMERIC'],['credit','NUMERIC'],['posting','BOOL']
  ]},
  { table:'purchase_return_source_links', source:'sourceLinks', key:['authorization_internal_id','source_internal_id','link_type'], parent:'authorization_internal_id', fields:[
    ['authorization_internal_id','STRING'],['source_internal_id','STRING'],['source_type','STRING'],['source_number','STRING'],
    ['source_date','DATE'],['link_type','STRING']
  ]},
  { table:'purchase_return_downstream_links', source:'downstreamLinks', key:['authorization_internal_id','related_internal_id','link_type'], parent:'authorization_internal_id', fields:[
    ['authorization_internal_id','STRING'],['related_internal_id','STRING'],['related_type','STRING'],['related_number','STRING'],
    ['related_date','DATE'],['link_type','STRING']
  ]}
];

const names = groups.map(g => g.table);
const cpList = names.map(name => `'${name}'`).join(',');
const columns = g => g.fields.map(([name]) => name);

function overlap(value) {
  const d = new Date(value.replace(' ','T') + 'Z');
  if (Number.isNaN(+d)) throw Error(`Invalid checkpoint ${value}`);
  return new Date(+d - 300000).toISOString().slice(0,19).replace('T',' ');
}

async function checkpoints() {
  return query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS modified FROM ${T(C)} WHERE record_type IN (${cpList})`);
}

const RETRY_DELAYS_MS = [1500, 3500, 7000];
function isCheckpointConflict(error) {
  const message = String(error?.message ?? error);
  return /transaction is aborted due to concurrent update against table/i.test(message) && /netsuite_backup[.:]sync_checkpoints/i.test(message);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function atomicCommitWithGuard(sql, params, originalCheckpoint) {
  for (let attempt = 0; ; attempt++) {
    try { return await query(sql, params); }
    catch (error) {
      if (!isCheckpointConflict(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
      const latest = await checkpoints();
      const expected = originalCheckpoint ? groups.length : 0;
      if (latest.length !== expected || new Set(latest.map(r => r.record_type)).size !== latest.length || latest.some(r => !names.includes(r.record_type) || r.modified !== originalCheckpoint)) {
        throw new Error(`Purchase Return checkpoint changed after aborted transaction (before=${originalCheckpoint ?? 'INITIAL'}). Refusing replay; run fresh --dry-run and --sync.`, { cause: error });
      }
      const wait = RETRY_DELAYS_MS[attempt];
      console.warn(`Purchase Return checkpoint write conflict; transaction aborted. Retry ${attempt + 1}/${RETRY_DELAYS_MS.length} after ${wait}ms (staging retained).`);
      await sleep(wait);
    }
  }
}

async function ensureTables() {
  const [hasCP] = await dataset.table(C).exists();
  if (!hasCP) throw Error('Shared sync_checkpoints missing; refusing to create it');

  for (const g of groups) {
    const defs = g.fields.map(([name,type]) => `${name} ${type}${g.key.includes(name) ? ' NOT NULL' : ''}`).join(',');
    const extra = g === groups[0]
      ? ',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP'
      : ',synced_at TIMESTAMP';
    const partition = g === groups[0] ? ' PARTITION BY transaction_date' : '';
    const cluster = g === groups[0] ? ' CLUSTER BY internal_id' : ` CLUSTER BY ${g.key.slice(0,4).join(',')}`;
    await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${defs}${extra})${partition}${cluster}`);
  }
}

async function stage(name, rows, fields) {
  validateNumericRows(rows, fields, { module: 'purchase-return' });
  if (!rows.length) {
    await query(`CREATE TABLE ${T(name)} AS SELECT ${fields.map(([k,t]) => `CAST(NULL AS ${t}) AS ${k}`).join(',')} FROM UNNEST([1]) AS dummy WHERE FALSE`);
    return;
  }
  const filename = path.join(os.tmpdir(), `netsuite-purchase-return-${crypto.randomUUID()}.ndjson`);
  await fs.writeFile(filename, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
  try {
    await dataset.table(name).load(filename, {
      sourceFormat: 'NEWLINE_DELIMITED_JSON',
      writeDisposition: 'WRITE_TRUNCATE',
      schema: { fields: fields.map(([fieldName,type]) => ({ name: fieldName, type })) },
      location: LOCATION
    });
  } finally {
    await fs.rm(filename, { force: true });
  }
  const [count] = await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);
  if (Number(count.n) !== rows.length) throw Error(`Stage count mismatch ${name}`);
}

async function main() {
  console.log(`PURCHASE RETURN | ${DRY_RUN ? 'DRY RUN' : 'PRODUCTION SYNC'} | ${DATASET} | ${LOCATION}`);

  const [hasCP] = await timed('checkpoint_table_exists', () => dataset.table(C).exists());
  if (!hasCP) throw Error('Shared sync_checkpoints missing');
  const cp = await timed('checkpoint_read', () => checkpoints());
  if (cp.length !== 0 && cp.length !== groups.length) throw Error('Partial Purchase Return checkpoints; refuse to continue');
  if (new Set(cp.map(row => row.record_type)).size !== cp.length) throw Error('Duplicate Purchase Return checkpoints');
  const baseline = cp.length ? cp[0].modified : null;
  if (cp.some(row => row.modified !== baseline)) throw Error('Purchase Return checkpoints diverged');
  const since = baseline ? overlap(baseline) : null;

  const access = await timed('netsuite_oauth', () => token());
  const headers = await timed('netsuite_headers', () => fetchHeaders(access, since));
  const ids = headers.map(row => row.internal_id);
  const [lines, gl, previous, next] = ids.length
    ? await Promise.all([
        timed('netsuite_lines', () => fetchLines(access, ids)),
        timed('netsuite_gl', () => fetchGL(access, ids)),
        timed('netsuite_source_links', () => fetchPreviousLinks(access, ids)),
        timed('netsuite_downstream_links', () => fetchNextLinks(access, ids))
      ])
    : [[], [], [], []];
  const mapStart = process.hrtime.bigint();
  const mapped = mapSource(headers, lines, gl, previous, next);
  perf('map_and_decimal', elapsedMs(mapStart));
  const counts = Object.fromEntries(groups.map(g => [g.table, mapped[g.source].length]));
  console.log('Source mapped:', JSON.stringify(counts));
  console.log(`Checkpoint=${baseline ?? 'INITIAL'}; overlap from=${since ?? 'FULL OCTOBER'}`);

  // Phase A proved zero October authorizations; never initialize tables/checkpoints from an empty first sync.
  if (!baseline && !headers.length && SYNC) throw Error('Initial Purchase Return source October=0: refusing DDL/checkpoint/sync. Read-only October source=0 was certified by Phase A.');
  if (DRY_RUN) {
    console.log('DRY RUN PASS: source validated; exact numeric fields checked, rate_raw retained as STRING; no BigQuery writes/checkpoint changes.');
    perf('dry_run_total', elapsedMs(PERF_START));
    return;
  }
  if (baseline && !headers.length) {
    console.log('PURCHASE RETURN NO CHANGES: SUCCESS; checkpoint not moved');
    return;
  }

  await timed('ensure_tables', () => ensureTables());
  const suffix = crypto.randomUUID().replaceAll('-','').slice(0,20);
  const stages = groups.map((g,index) => ({ ...g, stageName: `_stage_pr_${index}_${suffix}` }));

  try {
    for (const g of stages) await timed(`stage_${g.table}`, () => stage(g.stageName, mapped[g.source], g.fields));
    const watermark = headers.map(row => row.last_modified).filter(Boolean).sort().at(-1);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(watermark ?? '')) throw Error('Invalid Purchase Return source watermark');

    const stageChecks = stages.map(g => {
      const key = g.key.join(',');
      const count = mapped[g.source].length;
      return `ASSERT (SELECT COUNT(*) FROM ${T(g.stageName)})=${count} AS 'Stage row count mismatch ${g.table}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${key} FROM ${T(g.stageName)} GROUP BY ${key} HAVING COUNT(*)>1))=0 AS 'Duplicate stage key ${g.table}';`;
    }).join('\n');

    const mutations = stages.map((g,index) => {
      const fields = columns(g);
      if (index === 0) {
        return `MERGE ${T(g.table)} d USING ${T(g.stageName)} s ON d.internal_id=s.internal_id
WHEN MATCHED AND COALESCE(d.is_deleted,FALSE)=FALSE THEN UPDATE SET ${fields.filter(f => f !== 'internal_id').map(f => `${f}=s.${f}`).join(',')},synced_at=CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT(${fields.join(',')},synced_at,is_deleted,deleted_at) VALUES(${fields.map(f => `s.${f}`).join(',')},CURRENT_TIMESTAMP(),FALSE,NULL);`;
      }
      return `DELETE FROM ${T(g.table)} WHERE ${g.parent} IN (SELECT internal_id FROM ${T(stages[0].stageName)});
INSERT INTO ${T(g.table)} (${fields.join(',')},synced_at) SELECT ${fields.join(',')},CURRENT_TIMESTAMP() FROM ${T(g.stageName)};`;
    }).join('\n');

    const checkpointGuard = baseline
      ? `ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN (${cpList}) AND last_successful_modified_at=DATETIME('${baseline}'))=${groups.length} AS 'Purchase Return checkpoint advanced';`
      : '';

    const checkpointSql = `MERGE ${T(C)} d USING (SELECT record_type FROM UNNEST([${cpList}]) AS record_type) s ON d.record_type=s.record_type
WHEN MATCHED THEN UPDATE SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());`;

    const orphanChecks = stages.slice(1).map(g => `ASSERT (SELECT COUNT(*) FROM ${T(g.table)} d LEFT JOIN ${T(stages[0].table)} h ON h.internal_id=d.${g.parent} WHERE h.internal_id IS NULL)=0 AS 'Orphan ${g.table}';`).join('\n');

    const sql = `BEGIN
BEGIN TRANSACTION;
${stageChecks}
ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN (${cpList}))=${baseline ? groups.length : 0} AS 'Purchase Return checkpoint row count changed';
${checkpointGuard}
${mutations}
${checkpointSql}
${orphanChecks}
COMMIT TRANSACTION;
EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
END;`;

    await timed('atomic_commit_with_retry', () => atomicCommitWithGuard(sql, { wm: watermark }, baseline));
    console.log('ATOMIC MERGE + DETAIL REPLACE + FIVE CHECKPOINTS: SUCCESS');
    console.log('PURCHASE RETURN SYNC SUCCESS; RUN presence/check/check-financial; NOT FINAL_PASS');
  } finally {
    for (const g of stages) {
      try { await timed(`cleanup_${g.table}`, () => dataset.table(g.stageName).delete({ ignoreNotFound: true })); }
      catch (error) { console.error('Stage cleanup warning', g.stageName, error.message); }
    }
  }
  perf('sync_total', elapsedMs(PERF_START));
}

main().catch(error => {
  console.error('PURCHASE RETURN ERROR:', error.stack ?? error);
  process.exitCode = 1;
});
```

### `modules/sales-invoice/check.mjs`

**Reconstructed SHA-256:** `3f9628ce5a86dc6266c2afa9877212a7cf15330b48c0c6e2cd52820c2a91295e`.

```javascript
import { bq as sharedBQ } from '../../common/bigquery-client.mjs';
import { token as sharedToken } from '../../common/netsuite-client.mjs';
import { CLIENT_ID, CERTIFICATE_ID } from '../../credentials/netsuite-secrets.mjs';
import fs from 'fs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

/*
|--------------------------------------------------------------------------
| CONFIG - NETSUITE
|--------------------------------------------------------------------------
|
| Isi credential yang sama dari script yang sudah berhasil.
|
*/

;

;

const NETSUITE_BASE_URL =
  'https://6930902.suitetalk.api.netsuite.com';

const PRIVATE_KEY_PATH =
  'C:\\netsuite-backup-cert\\private.pem';

const TOKEN_URL =
  `${NETSUITE_BASE_URL}/services/rest/auth/oauth2/v1/token`;

/*
|--------------------------------------------------------------------------
| CONFIG - BIGQUERY
|--------------------------------------------------------------------------
*/

const PROJECT_ID =
  'even-gearbox-255203';

const DATASET_ID =
  'netsuite_backup';

const HEADER_TABLE =
  'sales_invoice_headers';

const LINE_TABLE =
  'sales_invoice_lines';

const BQ_LOCATION =
  'asia-southeast1';

const POSTING_PERIOD =
  'Oct 2026';

/*
|--------------------------------------------------------------------------
| BIGQUERY CLIENT
|--------------------------------------------------------------------------
*/

const bigquery = sharedBQ;

/*
|--------------------------------------------------------------------------
| NETSUITE OAUTH
|--------------------------------------------------------------------------
*/

const getNetSuiteAccessToken = sharedToken;

async function runSuiteQL(
  accessToken,
  query,
  limit = 10
) {
  const url =
    `${NETSUITE_BASE_URL}` +
    `/services/rest/query/v1/suiteql` +
    `?limit=${limit}`;

  const response =
    await fetch(
      url,
      {
        method:
          'POST',

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          'Content-Type':
            'application/json',

          Prefer:
            'transient'
        },

        body:
          JSON.stringify({
            q: query
          })
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `SuiteQL failed. HTTP ${response.status}: ${text}`
    );
  }

  return JSON.parse(text);
}

/*
|--------------------------------------------------------------------------
| NETSUITE HEADER KPI
|--------------------------------------------------------------------------
*/

async function getNetSuiteHeaderKpi(
  accessToken
) {
  const query = `
    SELECT
      COUNT(*) AS transaction_count,

      SUM(
        foreigntotal
      ) AS total_amount

    FROM
      Transaction

    WHERE
      type = 'CustInvc'

      AND BUILTIN.DF(
        postingperiod
      ) = '${POSTING_PERIOD}'
  `;

  const result =
    await runSuiteQL(
      accessToken,
      query
    );

  if (
    !result.items ||
    result.items.length === 0
  ) {
    throw new Error(
      'NetSuite header KPI returned no rows.'
    );
  }

  return result.items[0];
}

/*
|--------------------------------------------------------------------------
| NETSUITE LINE KPI
|--------------------------------------------------------------------------
|
| Filter harus sama dengan loader:
|
| mainline = F
| taxline  = F
| item     != NULL
| iscogs   = F
|
| foreignamount di Sales Invoice accounting sign-nya negatif.
| Kita balik sign-nya agar sama dengan BigQuery.
|
*/

async function getNetSuiteLineKpi(
  accessToken
) {
  const query = `
    SELECT
      COUNT(*)
        AS line_count,

      COUNT(
        DISTINCT t.id
      )
        AS invoice_count,

      SUM(
        0 - tl.foreignamount
      )
        AS total_line_amount

    FROM
      TransactionLine tl

    INNER JOIN
      Transaction t
        ON t.id =
           tl.transaction

    WHERE
      t.type =
        'CustInvc'

      AND BUILTIN.DF(
        t.postingperiod
      ) = '${POSTING_PERIOD}'

      AND tl.mainline =
        'F'

      AND tl.taxline =
        'F'

      AND tl.item
        IS NOT NULL

      AND NVL(
        tl.iscogs,
        'F'
      ) = 'F'
  `;

  const result =
    await runSuiteQL(
      accessToken,
      query
    );

  if (
    !result.items ||
    result.items.length === 0
  ) {
    throw new Error(
      'NetSuite line KPI returned no rows.'
    );
  }

  return result.items[0];
}

/*
|--------------------------------------------------------------------------
| BIGQUERY HEADER KPI
|--------------------------------------------------------------------------
*/

async function getBigQueryHeaderKpi() {
  const query = `
    SELECT
      COUNT(*)
        AS transaction_count,

      SUM(total_amount)
        AS total_amount

    FROM
      \`${PROJECT_ID}.${DATASET_ID}.${HEADER_TABLE}\`

    WHERE
      posting_period =
        @postingPeriod

      AND is_deleted =
        FALSE
  `;

  const [rows] =
    await bigquery.query({
      query,

      params: {
        postingPeriod:
          POSTING_PERIOD
      },

      location:
        BQ_LOCATION
    });

  return rows[0];
}

/*
|--------------------------------------------------------------------------
| BIGQUERY LINE KPI
|--------------------------------------------------------------------------
*/

async function getBigQueryLineKpi() {
  const query = `
    SELECT
      COUNT(*)
        AS line_count,

      COUNT(
        DISTINCT l.invoice_internal_id
      )
        AS invoice_count,

      SUM(l.amount)
        AS total_line_amount

    FROM
      \`${PROJECT_ID}.${DATASET_ID}.${LINE_TABLE}\` l

    INNER JOIN
      \`${PROJECT_ID}.${DATASET_ID}.${HEADER_TABLE}\` h
      ON h.internal_id = l.invoice_internal_id

    WHERE
      l.posting_period = @postingPeriod
      AND h.posting_period = @postingPeriod
      AND h.is_deleted = FALSE
  `;

  const [rows] =
    await bigquery.query({
      query,

      params: {
        postingPeriod:
          POSTING_PERIOD
      },

      location:
        BQ_LOCATION
    });

  return rows[0];
}

/*
|--------------------------------------------------------------------------
| DUPLICATE CHECK
|--------------------------------------------------------------------------
|
| Key:
|
| invoice_internal_id + line_number
|
*/

async function getDuplicateCount() {
  const query = `
    SELECT
      COUNT(*) AS duplicate_keys

    FROM
    (
      SELECT
        invoice_internal_id,
        line_number

      FROM
        \`${PROJECT_ID}.${DATASET_ID}.${LINE_TABLE}\`

      WHERE
        posting_period =
          @postingPeriod

      GROUP BY
        invoice_internal_id,
        line_number

      HAVING
        COUNT(*) > 1
    )
  `;

  const [rows] =
    await bigquery.query({
      query,

      params: {
        postingPeriod:
          POSTING_PERIOD
      },

      location:
        BQ_LOCATION
    });

  return Number(
    rows[0]?.duplicate_keys ||
    0
  );
}

/*
|--------------------------------------------------------------------------
| ORPHAN LINE CHECK
|--------------------------------------------------------------------------
|
| Line ada tetapi header fisiknya tidak ditemukan.
| Historical lines milik soft-deleted header bukan orphan.
|
*/

async function getOrphanLineCount() {
  const query = `
    SELECT
      COUNT(*) AS orphan_lines

    FROM
      \`${PROJECT_ID}.${DATASET_ID}.${LINE_TABLE}\` l

    LEFT JOIN
      \`${PROJECT_ID}.${DATASET_ID}.${HEADER_TABLE}\` h

      ON h.internal_id =
         l.invoice_internal_id


    WHERE
      l.posting_period =
        @postingPeriod

      AND h.internal_id
        IS NULL
  `;

  const [rows] =
    await bigquery.query({
      query,

      params: {
        postingPeriod:
          POSTING_PERIOD
      },

      location:
        BQ_LOCATION
    });

  return Number(
    rows[0]?.orphan_lines ||
    0
  );
}

/*
|--------------------------------------------------------------------------
| HEADER WITHOUT ITEM LINE
|--------------------------------------------------------------------------
|
| Ini bukan otomatis error.
|
| Kita tampilkan sebagai diagnostic.
|
| Yang menentukan correctness adalah:
|
| NetSuite invoices-with-lines
| vs
| BigQuery invoices-with-lines
|
*/

async function getHeadersWithoutLines() {
  const query = `
    SELECT
      COUNT(*) AS header_without_lines

    FROM
      \`${PROJECT_ID}.${DATASET_ID}.${HEADER_TABLE}\` h

    LEFT JOIN
    (
      SELECT DISTINCT
        invoice_internal_id

      FROM
        \`${PROJECT_ID}.${DATASET_ID}.${LINE_TABLE}\`

      WHERE
        posting_period =
          @postingPeriod

    ) l

      ON l.invoice_internal_id =
         h.internal_id

    WHERE
      h.posting_period =
        @postingPeriod

      AND h.is_deleted =
        FALSE

      AND l.invoice_internal_id
        IS NULL
  `;

  const [rows] =
    await bigquery.query({
      query,

      params: {
        postingPeriod:
          POSTING_PERIOD
      },

      location:
        BQ_LOCATION
    });

  return Number(
    rows[0]?.header_without_lines ||
    0
  );
}

/*
|--------------------------------------------------------------------------
| VALUE HELPERS
|--------------------------------------------------------------------------
*/

function normalizeValue(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return '0';
  }

  if (
    typeof value === 'object' &&
    value.value !== undefined
  ) {
    return String(
      value.value
    );
  }

  return String(value);
}

/*
|--------------------------------------------------------------------------
| SCIENTIFIC NOTATION -> PLAIN DECIMAL
|--------------------------------------------------------------------------
*/

function toPlainDecimal(
  value
) {
  let text =
    normalizeValue(
      value
    ).trim();

  if (
    !text.includes('e') &&
    !text.includes('E')
  ) {
    return text;
  }

  let negative =
    false;

  if (
    text.startsWith('-')
  ) {
    negative =
      true;

    text =
      text.substring(1);

  } else if (
    text.startsWith('+')
  ) {
    text =
      text.substring(1);
  }

  const parts =
    text
      .toLowerCase()
      .split('e');

  if (
    parts.length !== 2
  ) {
    throw new Error(
      `Invalid decimal: ${value}`
    );
  }

  const coefficient =
    parts[0];

  const exponent =
    Number(
      parts[1]
    );

  let [
    whole,
    decimal = ''
  ] =
    coefficient.split('.');

  whole =
    whole || '0';

  const digits =
    `${whole}${decimal}`;

  const position =
    whole.length +
    exponent;

  let result;

  if (
    position <= 0
  ) {
    result =
      '0.' +
      '0'.repeat(
        Math.abs(
          position
        )
      ) +
      digits;

  } else if (
    position >=
    digits.length
  ) {
    result =
      digits +
      '0'.repeat(
        position -
        digits.length
      );

  } else {
    result =
      digits.substring(
        0,
        position
      ) +
      '.' +
      digits.substring(
        position
      );
  }

  return negative
    ? `-${result}`
    : result;
}

/*
|--------------------------------------------------------------------------
| DECIMAL -> CENTS
|--------------------------------------------------------------------------
*/

function decimalToCents(
  value
) {
  let text =
    toPlainDecimal(
      value
    );

  const negative =
    text.startsWith('-');

  if (negative) {
    text =
      text.substring(1);
  }

  let [
    whole,
    decimal = ''
  ] =
    text.split('.');

  decimal =
    (decimal + '00')
      .substring(
        0,
        2
      );

  const cents =
    BigInt(
      whole || '0'
    ) *
      100n +
    BigInt(decimal);

  return negative
    ? -cents
    : cents;
}

function centsToDisplay(
  cents
) {
  const negative =
    cents < 0n;

  const value =
    negative
      ? -cents
      : cents;

  const whole =
    value / 100n;

  const decimal =
    String(
      value % 100n
    ).padStart(
      2,
      '0'
    );

  return (
    (negative ? '-' : '') +
    `${whole}.${decimal}`
  );
}

/*
|--------------------------------------------------------------------------
| MAIN
|--------------------------------------------------------------------------
*/

async function main() {
  try {
    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      'SALES INVOICE FINAL RECONCILIATION'
    );

    console.log(
      `Period: ${POSTING_PERIOD}`
    );

    console.log(
      '=========================================='
    );

    console.log('');

    /*
     * NetSuite
     */

    const accessToken =
      await getNetSuiteAccessToken();

    console.log('');

    console.log(
      'Checking NetSuite header KPI...'
    );

    const nsHeader =
      await getNetSuiteHeaderKpi(
        accessToken
      );

    console.log(
      'Checking NetSuite line KPI...'
    );

    const nsLines =
      await getNetSuiteLineKpi(
        accessToken
      );

    /*
     * BigQuery
     */

    console.log(
      'Checking BigQuery header KPI...'
    );

    const bqHeader =
      await getBigQueryHeaderKpi();

    console.log(
      'Checking BigQuery line KPI...'
    );

    const bqLines =
      await getBigQueryLineKpi();

    console.log(
      'Checking duplicate lines...'
    );

    const duplicateKeys =
      await getDuplicateCount();

    console.log(
      'Checking orphan lines...'
    );

    const orphanLines =
      await getOrphanLineCount();

    console.log(
      'Checking headers without lines...'
    );

    const headersWithoutLines =
      await getHeadersWithoutLines();

    /*
     * Normalize Header
     */

    const nsHeaderCount =
      Number(
        normalizeValue(
          nsHeader.transaction_count
        )
      );

    const bqHeaderCount =
      Number(
        normalizeValue(
          bqHeader.transaction_count
        )
      );

    const nsHeaderAmount =
      decimalToCents(
        nsHeader.total_amount
      );

    const bqHeaderAmount =
      decimalToCents(
        bqHeader.total_amount
      );

    /*
     * Normalize Lines
     */

    const nsLineCount =
      Number(
        normalizeValue(
          nsLines.line_count
        )
      );

    const bqLineCount =
      Number(
        normalizeValue(
          bqLines.line_count
        )
      );

    const nsLineInvoiceCount =
      Number(
        normalizeValue(
          nsLines.invoice_count
        )
      );

    const bqLineInvoiceCount =
      Number(
        normalizeValue(
          bqLines.invoice_count
        )
      );

    const nsLineAmount =
      decimalToCents(
        nsLines.total_line_amount
      );

    const bqLineAmount =
      decimalToCents(
        bqLines.total_line_amount
      );

    /*
     * Comparisons
     */

    const headerCountMatch =
      nsHeaderCount ===
      bqHeaderCount;

    const headerAmountMatch =
      nsHeaderAmount ===
      bqHeaderAmount;

    const lineCountMatch =
      nsLineCount ===
      bqLineCount;

    const lineInvoiceMatch =
      nsLineInvoiceCount ===
      bqLineInvoiceCount;

    const lineAmountMatch =
      nsLineAmount ===
      bqLineAmount;

    const duplicateCheck =
      duplicateKeys === 0;

    const orphanCheck =
      orphanLines === 0;

    /*
     * Output
     */

    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      'HEADER RECONCILIATION'
    );

    console.log(
      '=========================================='
    );

    console.log('');

    console.log(
      `NetSuite COUNT : ${nsHeaderCount}`
    );

    console.log(
      `BigQuery COUNT : ${bqHeaderCount}`
    );

    console.log('');

    console.log(
      `NetSuite TOTAL : ${centsToDisplay(nsHeaderAmount)}`
    );

    console.log(
      `BigQuery TOTAL : ${centsToDisplay(bqHeaderAmount)}`
    );

    console.log('');

    console.log(
      `HEADER COUNT MATCH  : ${
        headerCountMatch
          ? 'YES'
          : 'NO'
      }`
    );

    console.log(
      `HEADER AMOUNT MATCH : ${
        headerAmountMatch
          ? 'YES'
          : 'NO'
      }`
    );

    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      'LINE RECONCILIATION'
    );

    console.log(
      '=========================================='
    );

    console.log('');

    console.log(
      `NetSuite LINE COUNT : ${nsLineCount}`
    );

    console.log(
      `BigQuery LINE COUNT : ${bqLineCount}`
    );

    console.log('');

    console.log(
      `NetSuite INVOICES WITH LINES : ${nsLineInvoiceCount}`
    );

    console.log(
      `BigQuery INVOICES WITH LINES : ${bqLineInvoiceCount}`
    );

    console.log('');

    console.log(
      `NetSuite LINE AMOUNT : ${centsToDisplay(nsLineAmount)}`
    );

    console.log(
      `BigQuery LINE AMOUNT : ${centsToDisplay(bqLineAmount)}`
    );

    console.log('');

    console.log(
      `LINE COUNT MATCH   : ${
        lineCountMatch
          ? 'YES'
          : 'NO'
      }`
    );

    console.log(
      `LINE INVOICE MATCH : ${
        lineInvoiceMatch
          ? 'YES'
          : 'NO'
      }`
    );

    console.log(
      `LINE AMOUNT MATCH  : ${
        lineAmountMatch
          ? 'YES'
          : 'NO'
      }`
    );

    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      'INTEGRITY CHECK'
    );

    console.log(
      '=========================================='
    );

    console.log('');

    console.log(
      `Duplicate line keys   : ${duplicateKeys}`
    );

    console.log(
      `Orphan lines          : ${orphanLines}`
    );

    console.log(
      `Headers without lines : ${headersWithoutLines}`
    );

    console.log('');

    console.log(
      `DUPLICATE CHECK : ${
        duplicateCheck
          ? 'YES'
          : 'NO'
      }`
    );

    console.log(
      `ORPHAN CHECK    : ${
        orphanCheck
          ? 'YES'
          : 'NO'
      }`
    );

    /*
     * Final
     */

    const allPassed =
      headerCountMatch &&
      headerAmountMatch &&
      lineCountMatch &&
      lineInvoiceMatch &&
      lineAmountMatch &&
      duplicateCheck &&
      orphanCheck;

    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      'FINAL RESULT'
    );

    console.log(
      '=========================================='
    );

    console.log('');

    if (allPassed) {
      console.log(
        'SALES INVOICE CHECK: PASS'
      );

      console.log(
        'NetSuite and BigQuery are synchronized.'
      );

      console.log(
        'Header, lines, duplicates, and orphan checks are OK.'
      );

    } else {
      console.log(
        'SALES INVOICE CHECK: FAIL'
      );

      console.log('');

      console.log(
        'Run sync scripts again:'
      );

      console.log(
        'node .\\sync-sales-invoice.mjs'
      );

      console.log(
        'node .\\sync-sales-invoice-lines.mjs'
      );

      console.log('');

      console.log(
        'Then run this checker again.'
      );

      process.exitCode =
        1;
    }

  } catch (error) {
    console.error('');

    console.error(
      'SALES INVOICE CHECK ERROR'
    );

    console.error(
      error?.message ||
      error
    );

    process.exitCode =
      1;
  }
}

main();
```

### `modules/sales-invoice/mapping.mjs`

**Reconstructed SHA-256:** `ad79bc4a48462081e6c437b173d9906162512531f9c97d48c4f53e96367122b0`.

```javascript
function asNumericRate(value) {
  const s = asDecimal(value);
  if (s == null) return null;

  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Invalid rate: ${s}`);

  const sign = m[1] === '-' ? '-' : '';
  const whole = m[2];
  const frac = m[3] ?? '';

  if (frac.length <= 9) return s;

  let scaled = BigInt(whole + frac.slice(0, 9));

  if (frac[9] >= '5') scaled += 1n;

  const digits = scaled.toString().padStart(10, '0');
  const result = digits.slice(0, -9) + '.' + digits.slice(-9);

  return scaled === 0n ? result : sign + result;
}
export function asDecimal(value) {
  if (value == null || value === '') return null;
  let s = String(value).trim();
  if (!/[eE]/.test(s)) return s;
  let negative = false;
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  const [coefficient, exponentText] = s.toLowerCase().split('e');
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw new Error('Invalid decimal exponent');
  const [whole, frac = ''] = coefficient.split('.');
  const digits = whole + frac;
  const point = whole.length + exponent;
  const out = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` :
    point >= digits.length ? digits + '0'.repeat(point - digits.length) :
      digits.slice(0, point) + '.' + digits.slice(point);
  return (negative ? '-' : '') + out;
}
export function negate(value) {
  const s = asDecimal(value);
  if (s == null) return null;
  if (Number(s) === 0) return '0';
  return s.startsWith('-') ? s.slice(1) : '-' + s;
}
export function safeInt(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Invalid ID: ${value}`);
  return n;
}
export function strTime(value) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) throw new Error(`Invalid datetime: ${s}`);
  return s;
}
export function normalize(headers, rawLines) {
  const now = new Date().toISOString();
  const seenHeaders = new Set();
  const seenLines = new Set();
  const h = headers.map(r => {
    const id = safeInt(r.internal_id);
    if (seenHeaders.has(id)) throw new Error(`Duplicate source header ${id}`);
    seenHeaders.add(id);
    return {
      internal_id: id,
      invoice_number: String(r.invoice_number),
      transaction_date: r.transaction_date,
      posting_period: r.posting_period ?? null,
      status: r.status ?? null,
      total_amount: asDecimal(r.total_amount),
      netsuite_last_modified_at: strTime(r.netsuite_last_modified_at),
      synced_at: now,
      first_synced_at: now,
      is_deleted: false,
      deleted_at: null
    };
  });
  const l = rawLines.map(r => {
    const id = safeInt(r.invoice_internal_id);
    const line = safeInt(r.line_number);
    const key = `${id}:${line}`;
    if (seenLines.has(key)) throw new Error(`Duplicate source line ${key}`);
    if (!seenHeaders.has(id)) throw new Error(`Orphan source line ${key}`);
    seenLines.add(key);
    return {
      invoice_internal_id: id,
      invoice_number: String(r.invoice_number),
      line_number: line,
      item_internal_id: r.item_internal_id == null ? null : safeInt(r.item_internal_id),
      item_name: r.item_name ?? null,
      description: r.description ?? null,
      quantity: negate(r.raw_quantity),
      unit: r.unit ?? null,
      rate: asNumericRate(r.rate),
      amount: negate(r.raw_amount),
      transaction_date: r.transaction_date,
      posting_period: r.posting_period ?? null,
      netsuite_last_modified_at: strTime(r.netsuite_last_modified_at),
      synced_at: now
    };
  });
  return { headers: h, lines: l };
}
```

### `modules/sales-invoice/presence.mjs`

**Reconstructed SHA-256:** `2bd8d0d07b35e7dfc2f62da18d9855c79c7b6351722395407de71417bc7735c2`.

```javascript
import { reconcilePresence } from '../../common/presence-reconcile.mjs';
reconcilePresence('sales-invoice',{ apply:process.argv.includes('--apply') }).catch(e=>{console.error('PRESENCE CHECK ERROR:',e.stack??e);process.exitCode=1;});
```

### `modules/sales-invoice/recover.mjs`

**Reconstructed SHA-256:** `05878b66a3e55fc5c9c1c8433bffabfb0e8ba1121dcbb9bbcd330b777f91e308`.

```javascript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { bq } from '../../common/bigquery-client.mjs';
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { normalize } from './mapping.mjs';

// Targeted SI recovery. Only missing or soft-deleted headers may be written.
// Deliberately NEVER updates sync_checkpoints.
const PROJECT = 'even-gearbox-255203';
const DATASET = 'netsuite_backup';
const LOCATION = 'asia-southeast1';
const HEADER = 'sales_invoice_headers';
const LINES = 'sales_invoice_lines';
const fq = name => `\`${PROJECT}.${DATASET}.${name}\``;
const dataset = bq.dataset(DATASET);

const args = process.argv.slice(2);
const idFlag = args.indexOf('--id');
const rawId = idFlag >= 0 ? args[idFlag + 1] : undefined;
const apply = args.includes('--apply');
const dryRun = args.includes('--dry-run');
const accepted = new Set(['--id', '--apply', '--dry-run']);
if (!rawId || !/^[1-9][0-9]{0,14}$/.test(rawId) || (apply && dryRun) ||
    args.some((arg, index) => !accepted.has(arg) && index !== idFlag + 1) ||
    idFlag === -1 || args.filter(a => a === '--id').length !== 1) {
  console.error('Usage: node modules/sales-invoice/recover.mjs --id 3152063 [--dry-run|--apply]');
  process.exit(2);
}
const id = Number(rawId);
if (!Number.isSafeInteger(id)) throw new Error('Unsafe internal ID');

async function query(sql, params = {}) {
  const [rows] = await bq.query({ query: sql, params, location: LOCATION });
  return rows;
}
async function state() {
  const rows = await query(`SELECT internal_id, is_deleted,
    FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', netsuite_last_modified_at) AS modified
    FROM ${fq(HEADER)} WHERE internal_id = @id`, { id });
  if (rows.length > 1) throw new Error('Duplicate existing headers; refusing recovery');
  return rows[0] ?? null;
}
function assertSource(header, lines) {
  if (header.length !== 1 || Number(header[0].internal_id) !== id) {
    throw new Error('Source invoice missing or duplicated; recovery refused');
  }
  if (header[0].transaction_date < '2026-10-01' || header[0].transaction_date >= '2026-11-01') {
    throw new Error(`Invoice outside October 2026: ${header[0].transaction_date}`);
  }
  if (header[0].total_amount == null) throw new Error('Source invoice total is NULL');
  if (!lines.length) throw new Error('Source invoice has zero detail lines; review manually');
  const normalized = normalize(header, lines);
  if (normalized.lines.length !== lines.length) throw new Error('Source line mismatch');
  return normalized;
}
async function source(access) {
  const headers = await fetchAll(access, `
    SELECT t.id AS internal_id, t.tranid AS invoice_number,
      TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date,
      BUILTIN.DF(t.postingperiod) AS posting_period,
      BUILTIN.DF(t.status) AS status,
      t.foreigntotal AS total_amount,
      TO_CHAR(t.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS netsuite_last_modified_at
    FROM Transaction t WHERE t.type = 'CustInvc' AND t.id = ${id}`);
  if (headers.length !== 1) return { headers, lines: [] };
  const lines = await fetchAll(access, `
    SELECT t.id AS invoice_internal_id, t.tranid AS invoice_number,
      tl.linesequencenumber AS line_number, tl.item AS item_internal_id,
      BUILTIN.DF(tl.item) AS item_name, tl.memo AS description,
      tl.quantity AS raw_quantity, BUILTIN.DF(tl.units) AS unit,
      tl.rate AS rate, tl.foreignamount AS raw_amount,
      TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date,
      BUILTIN.DF(t.postingperiod) AS posting_period,
      TO_CHAR(t.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS netsuite_last_modified_at
    FROM TransactionLine tl JOIN Transaction t ON t.id = tl.transaction
    WHERE t.id = ${id} AND t.type = 'CustInvc'
      AND tl.mainline = 'F' AND tl.taxline = 'F'
      AND tl.item IS NOT NULL AND NVL(tl.iscogs, 'F') = 'F'
    ORDER BY t.id, tl.linesequencenumber, tl.uniquekey`);
  return { headers, lines };
}
function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}
async function stage(name, tableName, file, count) {
  await query(`CREATE TABLE ${fq(name)} AS SELECT * FROM ${fq(tableName)} WHERE FALSE`);
  await dataset.table(name).load(file, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON', writeDisposition: 'WRITE_TRUNCATE',
    ignoreUnknownValues: false, maxBadRecords: 0, location: LOCATION
  });
  const [r] = await query(`SELECT COUNT(*) n FROM ${fq(name)}`);
  if (Number(r.n) !== count) throw new Error(`Staging count mismatch: ${name}`);
}
async function writeRecovery(hStage, lStage, count, expectedState) {
  // Recheck state inside the transaction to avoid turning a concurrent successful
  // sync of an active invoice into an unintended recovery write.
  const predicate = expectedState === 'MISSING'
    ? `(SELECT COUNT(*) FROM ${fq(HEADER)} WHERE internal_id = @id) = 0`
    : `(SELECT COUNT(*) FROM ${fq(HEADER)} WHERE internal_id = @id AND is_deleted = TRUE) = 1`;
  const sql = `
    BEGIN TRANSACTION;
    ASSERT ${predicate} AS 'Header state changed after audit; recovery cancelled';
    MERGE ${fq(HEADER)} target USING ${fq(hStage)} source
    ON target.internal_id = source.internal_id
    WHEN MATCHED THEN UPDATE SET
      invoice_number = source.invoice_number,
      transaction_date = source.transaction_date,
      posting_period = source.posting_period,
      status = source.status,
      total_amount = source.total_amount,
      netsuite_last_modified_at = source.netsuite_last_modified_at,
      synced_at = CURRENT_TIMESTAMP(), is_deleted = FALSE, deleted_at = NULL
    WHEN NOT MATCHED THEN INSERT (
      internal_id, invoice_number, transaction_date, posting_period,
      status, total_amount, netsuite_last_modified_at, synced_at,
      first_synced_at, is_deleted, deleted_at
    ) VALUES (
      source.internal_id, source.invoice_number, source.transaction_date,
      source.posting_period, source.status, source.total_amount,
      source.netsuite_last_modified_at, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), FALSE, NULL
    );
    DELETE FROM ${fq(LINES)} WHERE invoice_internal_id = @id;
    INSERT INTO ${fq(LINES)} (
      invoice_internal_id, invoice_number, line_number, item_internal_id,
      item_name, description, quantity, unit, rate, amount,
      transaction_date, posting_period, netsuite_last_modified_at, synced_at
    ) SELECT invoice_internal_id, invoice_number, line_number, item_internal_id,
      item_name, description, quantity, unit, rate, amount,
      transaction_date, posting_period, netsuite_last_modified_at, CURRENT_TIMESTAMP()
    FROM ${fq(lStage)};
    ASSERT (SELECT COUNT(*) FROM ${fq(HEADER)} WHERE internal_id = @id AND is_deleted = FALSE) = 1
      AS 'Recovered header validation failed';
    ASSERT (SELECT COUNT(*) FROM ${fq(LINES)} WHERE invoice_internal_id = @id) = @count
      AS 'Recovered line count mismatch';
    ASSERT (SELECT COUNT(*) FROM (
      SELECT line_number FROM ${fq(LINES)} WHERE invoice_internal_id = @id
      GROUP BY line_number HAVING COUNT(*) > 1)) = 0 AS 'Duplicate recovered lines';
    COMMIT TRANSACTION;`;
  await query(sql, { id, count });
}
async function main() {
  console.log(`SI TARGETED RECOVERY | ID ${id} | ${apply ? 'APPLY' : 'READ ONLY'}`);
  console.log('Checkpoint: NEVER MODIFIED');
  const access = await token();
  console.log('NetSuite OAuth: SUCCESS');
  const previous = await state();
  console.log(`BigQuery header: ${previous ? (previous.is_deleted ? 'SOFT_DELETED' : 'ACTIVE') : 'MISSING'}`);
  if (previous && !previous.is_deleted) {
    console.log('ALREADY ACTIVE: NO-OP. Header/line equivalence not asserted; use check.mjs.');
    return;
  }
  const fetched = await source(access);
  if (fetched.headers.length !== 1) {
    throw new Error('NOT_VISIBLE_IN_NETSUITE: no recovery allowed');
  }
  const mapped = assertSource(fetched.headers, fetched.lines);
  const action = previous ? 'RESTORE' : 'RECOVER';
  console.log(`SOURCE VALIDATION: PASS | ${mapped.headers.length} header | ${mapped.lines.length} lines`);
  console.log(`ACTION: ${action}`);
  if (!apply) {
    console.log('DRY RUN PASS: BigQuery and checkpoint unchanged');
    return;
  }
  // Re-fetch immediately prior to write to catch source edits during preparation.
  const reloaded = await source(access);
  const fresh = assertSource(reloaded.headers, reloaded.lines);
  if (JSON.stringify(mapped.headers.map(({synced_at,first_synced_at,...v}) => v)) !==
      JSON.stringify(fresh.headers.map(({synced_at,first_synced_at,...v}) => v)) ||
      JSON.stringify(mapped.lines.map(({synced_at,...v}) => v)) !==
      JSON.stringify(fresh.lines.map(({synced_at,...v}) => v))) {
    throw new Error('NetSuite data changed during recovery; retry later');
  }
  const suffix = crypto.randomUUID().replace(/-/g, '');
  const hStage = `_si_rec_h_${suffix}`;
  const lStage = `_si_rec_l_${suffix}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-recovery-'));
  const created = [];
  try {
    const hp = path.join(temp, 'header.jsonl');
    const lp = path.join(temp, 'lines.jsonl');
    writeJsonl(hp, fresh.headers);
    writeJsonl(lp, fresh.lines);
    created.push(hStage);
    await stage(hStage, HEADER, hp, 1);
    created.push(lStage);
    await stage(lStage, LINES, lp, fresh.lines.length);
    console.log('STAGING VALIDATION: PASS');
    await writeRecovery(hStage, lStage, fresh.lines.length, previous ? 'SOFT_DELETED' : 'MISSING');
    console.log(`ATOMIC ${action}: SUCCESS (${fresh.lines.length} lines; checkpoint unchanged)`);
  } finally {
    for (const name of created) {
      try { await dataset.table(name).delete({ ignoreNotFound: true }); }
      catch (err) { console.error(`Cleanup warning ${name}: ${err.message}`); }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => {
  console.error('SI TARGETED RECOVERY ERROR:', error.stack ?? error.message);
  process.exitCode = 1;
});
```

### `modules/sales-invoice/sync.mjs`

**Reconstructed SHA-256:** `1e0fc570584b7a3f397eadb5b1ab210422d15cf388ca4b6b6edbd54b2a12f437`.

```javascript
import { validateNumericRows } from '../../common/decimal-precision.mjs';
import { bq as sharedBQ } from '../../common/bigquery-client.mjs';
import { token as sharedToken } from '../../common/netsuite-client.mjs';
import { asDecimal, negate, safeInt, strTime, normalize } from './mapping.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// Keep this file named sync-sales-invoice.mjs after migration.
// Replace these two placeholders with your EXISTING integration identifiers.
import { CLIENT_ID, CERTIFICATE_ID, PRIVATE_KEY_PATH } from '../../credentials/netsuite-secrets.mjs';
const BASE_URL = 'https://6930902.suitetalk.api.netsuite.com';
const PROJECT = 'even-gearbox-255203';
const DATASET = 'netsuite_backup';
const LOCATION = 'asia-southeast1';
const HEADERS = 'sales_invoice_headers';
const LINES = 'sales_invoice_lines';
const CHECKPOINT = 'sync_checkpoints';
const OVERLAP_MINUTES = 5;
const DRY_RUN = process.argv.includes('--dry-run');
const CHUNK_SIZE = 25;
const bq = sharedBQ;
const dataset = bq.dataset(DATASET);
const fq = name => `\`${PROJECT}.${DATASET}.${name}\``;

async function query(sql, params = {}) {
  const [rows] = await bq.query({ query: sql, params, location: LOCATION });
  return rows;
}

const token = sharedToken;

async function suiteql(accessToken, sql, limit = 1000, offset = 0) {
  const url = `${BASE_URL}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Prefer: 'transient' },
      body: JSON.stringify({ q: sql })
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if (attempt === 3 || ![429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`SuiteQL HTTP ${res.status}: ${text}\nSQL: ${sql}`);
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
  }
}
async function allRows(accessToken, sql) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await suiteql(accessToken, sql, 1000, offset);
    const items = page.items ?? [];
    rows.push(...items);
    if (!page.hasMore) return rows;
    if (!items.length || offset >= 999000) throw new Error('SuiteQL pagination problem');
  }
}
async function checkpoints() {
  const rows = await query(`
    SELECT record_type,
      FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', last_successful_modified_at) AS modified
    FROM ${fq(CHECKPOINT)}
    WHERE record_type IN ('sales_invoice', 'sales_invoice_lines')
  `);
  const map = new Map(rows.map(r => [r.record_type, r.modified]));
  if (!map.has('sales_invoice') || !map.has('sales_invoice_lines') ||
      !map.get('sales_invoice') || !map.get('sales_invoice_lines')) {
    throw new Error('Both Sales Invoice checkpoints must already exist; no automatic reset');
  }
  const earliest = [map.get('sales_invoice'), map.get('sales_invoice_lines')].sort()[0];
  const overlap = await query(`
    SELECT FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',
      DATETIME_SUB(CAST(@modified AS DATETIME), INTERVAL ${OVERLAP_MINUTES} MINUTE)) AS fetch_from
  `, { modified: earliest });
  return { header: map.get('sales_invoice'), lines: map.get('sales_invoice_lines'), fetchFrom: overlap[0].fetch_from };
}
async function changedInvoices(accessToken, fetchFrom) {
  strTime(fetchFrom);
  return allRows(accessToken, `
    SELECT t.id AS internal_id, t.tranid AS invoice_number,
      TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date,
      BUILTIN.DF(t.postingperiod) AS posting_period,
      BUILTIN.DF(t.status) AS status,
      t.foreigntotal AS total_amount,
      TO_CHAR(t.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS netsuite_last_modified_at
    FROM Transaction t
    WHERE t.type = 'CustInvc'
      AND t.lastmodifieddate >= TO_DATE('${fetchFrom}', 'YYYY-MM-DD HH24:MI:SS')
    ORDER BY t.lastmodifieddate, t.id
  `);
}
async function invoiceLines(accessToken, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const slice = ids.slice(i, i + CHUNK_SIZE);
    const sql = `
      SELECT t.id AS invoice_internal_id,
        t.tranid AS invoice_number,
        tl.linesequencenumber AS line_number,
        tl.item AS item_internal_id,
        BUILTIN.DF(tl.item) AS item_name,
        tl.memo AS description,
        tl.quantity AS raw_quantity,
        BUILTIN.DF(tl.units) AS unit,
        tl.rate AS rate,
        tl.foreignamount AS raw_amount,
        TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date,
        BUILTIN.DF(t.postingperiod) AS posting_period,
        TO_CHAR(t.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS netsuite_last_modified_at
      FROM TransactionLine tl
      INNER JOIN Transaction t ON t.id = tl.transaction
      WHERE tl.transaction IN (${slice.join(',')})
        AND t.type = 'CustInvc'
        AND tl.mainline = 'F' AND tl.taxline = 'F'
        AND tl.item IS NOT NULL AND NVL(tl.iscogs, 'F') = 'F'
      ORDER BY t.id, tl.linesequencenumber, tl.uniquekey
    `;
    const rows = await allRows(accessToken, sql);
    out.push(...rows);
    console.log(`Line batch ${Math.floor(i / CHUNK_SIZE) + 1}: ${rows.length} rows`);
  }
  return out;
}
function jsonl(file, rows) {
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}
async function stage(name, target, file, expected) {
  await query(`CREATE TABLE ${fq(name)} AS SELECT * FROM ${fq(target)} WHERE FALSE`);
  await dataset.table(name).load(file, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON',
    writeDisposition: 'WRITE_TRUNCATE',
    ignoreUnknownValues: false,
    maxBadRecords: 0,
    location: LOCATION
  });
  const check = await query(`SELECT COUNT(*) AS n FROM ${fq(name)}`);
  if (Number(check[0].n) !== expected) throw new Error(`Stage ${name} count mismatch`);
}
async function commit(headerStage, lineStage, maxModified, expectedHeaders, expectedLines) {
  const sql = `
    BEGIN TRANSACTION;

    MERGE ${fq(HEADERS)} target
    USING ${fq(headerStage)} source
    ON target.internal_id = source.internal_id
    WHEN MATCHED THEN UPDATE SET
      invoice_number = source.invoice_number,
      transaction_date = source.transaction_date,
      posting_period = source.posting_period,
      status = source.status,
      total_amount = source.total_amount,
      netsuite_last_modified_at = source.netsuite_last_modified_at,
      synced_at = CURRENT_TIMESTAMP(),
      is_deleted = FALSE,
      deleted_at = NULL
    WHEN NOT MATCHED THEN INSERT (
      internal_id, invoice_number, transaction_date, posting_period, status,
      total_amount, netsuite_last_modified_at, synced_at, first_synced_at,
      is_deleted, deleted_at
    ) VALUES (
      source.internal_id, source.invoice_number, source.transaction_date,
      source.posting_period, source.status, source.total_amount,
      source.netsuite_last_modified_at, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(),
      FALSE, NULL
    );

    DELETE FROM ${fq(LINES)}
    WHERE invoice_internal_id IN (SELECT internal_id FROM ${fq(headerStage)});

    INSERT INTO ${fq(LINES)} (
      invoice_internal_id, invoice_number, line_number, item_internal_id,
      item_name, description, quantity, unit, rate, amount,
      transaction_date, posting_period, netsuite_last_modified_at, synced_at
    )
    SELECT invoice_internal_id, invoice_number, line_number, item_internal_id,
      item_name, description, quantity, unit, rate, amount,
      transaction_date, posting_period, netsuite_last_modified_at, CURRENT_TIMESTAMP()
    FROM ${fq(lineStage)};

    ASSERT (
      (SELECT COUNT(*) FROM ${fq(HEADERS)}
       WHERE internal_id IN (SELECT internal_id FROM ${fq(headerStage)})) = @expectedHeaders
    ) AS 'Header count mismatch';
    ASSERT (
      (SELECT COUNT(*) FROM ${fq(LINES)}
       WHERE invoice_internal_id IN (SELECT internal_id FROM ${fq(headerStage)})) = @expectedLines
    ) AS 'Line count mismatch';
    ASSERT (
      (SELECT COUNT(*) FROM (
        SELECT invoice_internal_id, line_number FROM ${fq(LINES)}
        WHERE invoice_internal_id IN (SELECT internal_id FROM ${fq(headerStage)})
        GROUP BY invoice_internal_id, line_number HAVING COUNT(*) > 1
      )) = 0
    ) AS 'Duplicate lines';
    ASSERT (
      (SELECT COUNT(*) FROM ${fq(LINES)} l
       LEFT JOIN ${fq(HEADERS)} h ON h.internal_id = l.invoice_internal_id
       WHERE l.invoice_internal_id IN (SELECT internal_id FROM ${fq(headerStage)})
         AND h.internal_id IS NULL) = 0
    ) AS 'Orphan lines';

    UPDATE ${fq(CHECKPOINT)}
    SET last_successful_modified_at = GREATEST(
          COALESCE(last_successful_modified_at, CAST(@maxModified AS DATETIME)),
          CAST(@maxModified AS DATETIME)),
        last_successful_sync_at = CURRENT_TIMESTAMP(),
        updated_at = CURRENT_TIMESTAMP()
    WHERE record_type IN ('sales_invoice', 'sales_invoice_lines');

    ASSERT (
      (SELECT COUNT(*) FROM ${fq(CHECKPOINT)}
       WHERE record_type IN ('sales_invoice', 'sales_invoice_lines')) = 2
    ) AS 'Checkpoint rows missing';

    COMMIT TRANSACTION;
  `;
  await query(sql, { maxModified, expectedHeaders, expectedLines });
}
async function markNoChange() {
  await query(`
    UPDATE ${fq(CHECKPOINT)}
    SET last_successful_sync_at = CURRENT_TIMESTAMP(), updated_at = CURRENT_TIMESTAMP()
    WHERE record_type IN ('sales_invoice', 'sales_invoice_lines')
  `);
}
async function reconcile(stageName, expectedHeaders, expectedLines) {
  const [r] = await query(`
    SELECT
      (SELECT COUNT(*) FROM ${fq(HEADERS)}
       WHERE internal_id IN (SELECT internal_id FROM ${fq(stageName)})) AS headers,
      (SELECT COUNT(*) FROM ${fq(LINES)}
       WHERE invoice_internal_id IN (SELECT internal_id FROM ${fq(stageName)})) AS lines,
      (SELECT COALESCE(SUM(total_amount), 0) FROM ${fq(HEADERS)}
       WHERE internal_id IN (SELECT internal_id FROM ${fq(stageName)})) AS header_amount,
      (SELECT COUNT(*) FROM (
         SELECT invoice_internal_id, line_number FROM ${fq(LINES)}
         WHERE invoice_internal_id IN (SELECT internal_id FROM ${fq(stageName)})
         GROUP BY invoice_internal_id, line_number HAVING COUNT(*) > 1
       )) AS duplicates,
      (SELECT COUNT(*) FROM ${fq(LINES)} l
       LEFT JOIN ${fq(HEADERS)} h ON h.internal_id = l.invoice_internal_id
       WHERE l.invoice_internal_id IN (SELECT internal_id FROM ${fq(stageName)})
         AND h.internal_id IS NULL) AS orphans
  `);
  const good = Number(r.headers) === expectedHeaders && Number(r.lines) === expectedLines &&
    Number(r.duplicates) === 0 && Number(r.orphans) === 0;
  console.log(`Reconcile headers=${r.headers}, lines=${r.lines}, header amount=${r.header_amount}, duplicates=${r.duplicates}, orphans=${r.orphans}`);
  if (!good) throw new Error('Post-commit reconciliation FAILED');
  console.log('DELTA RECONCILIATION: PASS');
}
async function main() {
  console.log('NETSUITE SALES INVOICE COMBINED DELTA SYNC');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'SYNC'}`);
  const cp = await checkpoints();
  console.log(`Header checkpoint: ${cp.header}`);
  console.log(`Lines checkpoint : ${cp.lines}`);
  console.log(`Fetch from       : ${cp.fetchFrom} (5-minute overlap)`);
  const accessToken = await token();
  console.log('OAuth: SUCCESS');
  const changed = await changedInvoices(accessToken, cp.fetchFrom);
  console.log(`Changed invoices: ${changed.length}`);
  if (!changed.length) {
    if (!DRY_RUN) await markNoChange();
    console.log('NO CHANGES: SUCCESS');
    return;
  }
  const ids = [...new Set(changed.map(r => safeInt(r.internal_id)))];
  const rawLines = await invoiceLines(accessToken, ids);
  const source = normalize(changed, rawLines);
  const maxModified = source.headers.reduce((max, r) =>
    !max || r.netsuite_last_modified_at > max ? r.netsuite_last_modified_at : max, null);
  console.log(`Source validation: PASS (${source.headers.length} headers, ${source.lines.length} lines)`);
  if (DRY_RUN) {
    console.log('DRY RUN PASS: BigQuery unchanged');
    return;
  }
  const suffix = crypto.randomUUID().replace(/-/g, '');
  const headerStage = `_stage_si_h_${suffix}`;
  const lineStage = `_stage_si_l_${suffix}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-si-'));
  const stages = [];
  try {
    const hf = path.join(temp, 'headers.jsonl');
    const lf = path.join(temp, 'lines.jsonl');
    validateNumericRows(source.headers, [
      ['exchange_rate', 'NUMERIC'],
      ['subtotal', 'NUMERIC'],
      ['discount_total', 'NUMERIC'],
      ['tax_total', 'NUMERIC'],
      ['total_amount', 'NUMERIC']
    ], { module: 'sales-invoice-headers' });

    validateNumericRows(source.lines, [
      ['quantity', 'NUMERIC'],
      ['rate', 'NUMERIC'],
      ['amount', 'NUMERIC']
    ], { module: 'sales-invoice-lines' });
    jsonl(hf, source.headers);
    jsonl(lf, source.lines);
    await stage(headerStage, HEADERS, hf, source.headers.length);
    stages.push(headerStage);
    if (source.lines.length) {
      await stage(lineStage, LINES, lf, source.lines.length);
    } else {
      await query(`CREATE TABLE ${fq(lineStage)} AS SELECT * FROM ${fq(LINES)} WHERE FALSE`);
    }
    stages.push(lineStage);
    console.log('STAGING VALIDATION: PASS');
    await commit(headerStage, lineStage, maxModified, source.headers.length, source.lines.length);
    console.log('ATOMIC MERGE + REPLACE + CHECKPOINT: SUCCESS');
    await reconcile(headerStage, source.headers.length, source.lines.length);
    console.log('SALES INVOICE DELTA SYNC SUCCESS');
  } finally {
    for (const name of stages) {
      try { await dataset.table(name).delete({ ignoreNotFound: true }); }
      catch (error) { console.error(`Stage cleanup warning ${name}: ${error.message}`); }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('SYNC ERROR:', error.stack ?? error.message); process.exitCode = 1; });
```

### `modules/sales-order/check.mjs`

**Reconstructed SHA-256:** `0dace30a9f3b8306f50c6970eca43969cb62f80eb6781d726c784333635ec56b`.

```javascript
import {FROM,TO,T,N,token,fetchHeaders,fetchLines,mapSource,query} from './mapping.mjs';
const cents = x => Math.round((N(x)+Number.EPSILON)*100);
const qty = x => x==null?null:Number(x).toFixed(6);
const k=l=>`${l.sales_order_internal_id}:${l.line_unique_key}`;
const fail=[];
function check(label,ok,note='') {console.log(`${label.padEnd(32)}: ${ok?'PASS':'FAIL'}${note?' | '+note:''}`);if(!ok)fail.push(label);}
async function main(){
 console.log('==========================================');console.log('SALES ORDER FINAL RECONCILIATION');console.log('==========================================');
 console.log(`Period ${FROM} .. ${TO} (READ ONLY)`);
 const access=await token();console.log('NetSuite OAuth: SUCCESS');
 const sourceHeaders=await fetchHeaders(access);const rawLines=await fetchLines(access,sourceHeaders.map(h=>h.id));const source=mapSource(sourceHeaders,rawLines);
 console.log(`NetSuite: headers=${source.headers.length}, lines=${source.lines.length}`);
 const bqHeaders=await query(`SELECT internal_id,tranid,CAST(transaction_date AS STRING) AS transaction_date,status,customer_id,subsidiary_id,currency_id,CAST(total_amount AS STRING) AS total_amount,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_modified) AS last_modified FROM ${T('sales_order_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 const bqLines=await query(`SELECT l.sales_order_internal_id,l.line_unique_key,l.line_id,l.line_type,l.item_id,l.item_type,l.accounting_line_type,CAST(l.quantity AS STRING) AS quantity,CAST(l.rate AS STRING) AS rate,CAST(l.foreign_amount AS STRING) AS foreign_amount,CAST(l.net_amount AS STRING) AS net_amount,CAST(l.tax_amount AS STRING) AS tax_amount,l.location_id,l.units_id,l.memo,l.is_closed,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',l.last_modified) AS last_modified FROM ${T('sales_order_lines')} l INNER JOIN ${T('sales_order_headers')} h ON h.internal_id=l.sales_order_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`);
 console.log(`BigQuery: headers=${bqHeaders.length}, lines=${bqLines.length}`);
 check('HEADER COUNT',source.headers.length===bqHeaders.length);
 check('DETAIL LINE COUNT',source.lines.length===bqLines.length);
 const sourceTotal=source.headers.reduce((s,h)=>s+cents(h.total_amount),0);
 const bigqueryTotal=bqHeaders.reduce((s,h)=>s+cents(h.total_amount),0);
 check('HEADER TOTAL EXACT CENTS',sourceTotal===bigqueryTotal,`NetSuite=${(sourceTotal/100).toFixed(2)} BigQuery=${(bigqueryTotal/100).toFixed(2)}`);
 const sourceHeadMap=new Map(source.headers.map(h=>[h.internal_id,h]));const targetHeadMap=new Map(bqHeaders.map(h=>[h.internal_id,h]));
 check('UNIQUE HEADER IDs',sourceHeadMap.size===source.headers.length&&targetHeadMap.size===bqHeaders.length);
 let headerMismatch=0;const examples=[];
 for(const [id,a] of sourceHeadMap){const b=targetHeadMap.get(id); if(!b||a.tranid!==b.tranid||a.transaction_date!==b.transaction_date||a.status!==b.status||a.customer_id!==b.customer_id||a.subsidiary_id!==b.subsidiary_id||a.currency_id!==b.currency_id||cents(a.total_amount)!==cents(b.total_amount)||a.last_modified!==b.last_modified){headerMismatch++;if(examples.length<8)examples.push(`HEADER ${id}`);}}
 for(const id of targetHeadMap.keys())if(!sourceHeadMap.has(id)){headerMismatch++;if(examples.length<8)examples.push(`EXTRA HEADER ${id}`);}
 check('HEADER FIELD-BY-FIELD MATCH',headerMismatch===0,`mismatch=${headerMismatch}`);
 const sourceLineMap=new Map(source.lines.map(l=>[k(l),l]));const targetLineMap=new Map(bqLines.map(l=>[k(l),l]));
 check('UNIQUE LINE KEYS',sourceLineMap.size===source.lines.length&&targetLineMap.size===bqLines.length);
 const stringCols=['line_id','line_type','item_id','item_type','accounting_line_type','location_id','units_id','memo','last_modified'];
 const decimalCols=['quantity','rate','foreign_amount','net_amount','tax_amount'];
 let lineMismatch=0;
 for(const [key,a] of sourceLineMap){const b=targetLineMap.get(key);let equal=Boolean(b);if(b){for(const c of stringCols){if((a[c]??null)!==(b[c]??null)){equal=false;break;}}if(equal)for(const c of decimalCols){if((a[c]==null)!==(b[c]==null)||a[c]!=null&& (c==='quantity'?qty(a[c])!==qty(b[c]):cents(a[c])!==cents(b[c]))){equal=false;break;}}if(Boolean(a.is_closed)!==Boolean(b.is_closed))equal=false;}
 if(!equal){lineMismatch++;if(examples.length<8)examples.push(`LINE ${key}`);}}
 for(const key of targetLineMap.keys())if(!sourceLineMap.has(key)){lineMismatch++;if(examples.length<8)examples.push(`EXTRA LINE ${key}`);}
 check('LINE FIELD-BY-FIELD MATCH',lineMismatch===0,`mismatch=${lineMismatch}`);
 const lineAmountSource=source.lines.reduce((s,l)=>s+cents(l.foreign_amount),0);
 const lineAmountTarget=bqLines.reduce((s,l)=>s+cents(l.foreign_amount),0);
 check('RAW LINE AMOUNT MATCH',lineAmountSource===lineAmountTarget,`NS signed=${(lineAmountSource/100).toFixed(2)} BQ signed=${(lineAmountTarget/100).toFixed(2)}`);
 const categories=[...new Set([...source.lines.map(l=>l.line_type),...bqLines.map(l=>l.line_type)])].sort();
 for(const c of categories)check(`CLASS ${c}`,source.lines.filter(l=>l.line_type===c).length===bqLines.filter(l=>l.line_type===c).length);
 const [integrity]=await query(`SELECT (SELECT COUNT(*) FROM (SELECT internal_id,COUNT(*) n FROM ${T('sales_order_headers')} GROUP BY 1 HAVING n>1)) AS dh,(SELECT COUNT(*) FROM (SELECT sales_order_internal_id,line_unique_key,COUNT(*) n FROM ${T('sales_order_lines')} GROUP BY 1,2 HAVING n>1)) AS dl,(SELECT COUNT(*) FROM ${T('sales_order_lines')} l LEFT JOIN ${T('sales_order_headers')} h ON l.sales_order_internal_id=h.internal_id WHERE h.internal_id IS NULL) AS orphans,(SELECT COUNT(*) FROM ${T('sales_order_headers')} h WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE AND NOT EXISTS(SELECT 1 FROM ${T('sales_order_lines')} l WHERE l.sales_order_internal_id=h.internal_id)) AS no_lines`);
 check('DUPLICATE HEADERS',N(integrity.dh)===0);
 check('DUPLICATE LINES',N(integrity.dl)===0);
 check('ORPHAN LINES',N(integrity.orphans)===0);
 check('HEADERS WITHOUT LINES',N(integrity.no_lines)===0);
 // Source mismatch between header and sum of lines is INFORMATIONAL, not a backup discrepancy.
 console.log('NOTE: SO rounding discounts can make sum(detail foreignamount) differ from foreigntotal by < 0.50 per order. This is preserved, not corrected.');
 if(examples.length)console.log('Mismatch examples:',examples.join(', '));
 console.log('\n==========================================');
 console.log(fail.length?'SALES ORDER CHECK: FAIL':'SALES ORDER CHECK: PASS');
 if(fail.length){console.log('Failed:',fail.join(', '));process.exitCode=1;}
 else console.log('NetSuite and BigQuery October SO snapshots match.');
}
main().catch(e=>{console.error('SALES ORDER FINAL CHECK ERROR:',e.stack??e);process.exitCode=1;});
```

### `modules/sales-order/mapping.mjs`

**Reconstructed SHA-256:** `4dce3c3a329839509f066ad65a0f912e20a8b2ebe99e8f0b90978ae3f4737f25`.

```javascript
import { normalizeNumericRate } from '../../common/decimal-precision.mjs';
import { token as sharedToken, BASE_URL as BASE } from '../../common/netsuite-client.mjs';



import { PROJECT, DATASET, LOCATION, bq, T, query } from '../../common/bigquery-client.mjs';
export { PROJECT, DATASET, LOCATION, bq, T, query };
export const FROM = '2026-10-01';
export const TO = '2026-11-01';

export function N(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return n;
}

export const flag = value =>
  String(value ?? 'F').toUpperCase() === 'T';

export function chunk(array, size) {
  const results = [];
  for (let i = 0; i < array.length; i += size) {
    results.push(array.slice(i, i + size));
  }
  return results;
}

export function cleanDateTime(value) {
  if (value == null) return null;
  const text = String(value);

  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    throw new Error(`Invalid datetime: ${text}`);
  }

  return text;
}

// =====================================================
// LINE CLASSIFICATION
// =====================================================

export function classify(l) {
  if (flag(l.mainline)) return 'MAINLINE';

  if (flag(l.taxline) || l.itemtype === 'TaxItem') {
    return 'TAX';
  }

  if (flag(l.iscogs)) return 'COGS';

  if (
    l.accountinglinetype === 'INCOME' &&
    l.item != null
  ) {
    return 'PRODUCT_INCOME';
  }

  if (l.itemtype === 'Discount') {
    return 'DISCOUNT';
  }

  if (l.item != null) return 'OTHER_ITEM';

  return 'OTHER_NON_ITEM';
}

// =====================================================
// NETSUITE OAUTH
// =====================================================

export const token = sharedToken;

export async function suiteql(
  access,
  sql,
  limit = 1000,
  offset = 0
) {
  const url =
    `${BASE}/services/rest/query/v1/suiteql` +
    `?limit=${limit}&offset=${offset}`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': 'application/json',
        Prefer: 'transient'
      },
      body: JSON.stringify({ q: sql })
    });

    const body = await response.text();

    if (response.ok) {
      return JSON.parse(body);
    }

    if (
      attempt === 4 ||
      ![429, 500, 502, 503, 504].includes(response.status)
    ) {
      throw new Error(
        `SuiteQL HTTP ${response.status}: ${body}\nSQL: ${sql}`
      );
    }

    await sleep(attempt * 1000);
  }
}

export async function fetchAll(access, sql) {
  const rows = [];
  let offset = 0;

  while (true) {
    const page = await suiteql(
      access,
      sql,
      1000,
      offset
    );

    const items = page.items ?? [];
    rows.push(...items);

    if (!page.hasMore) break;

    if (items.length === 0) {
      throw new Error('SuiteQL pagination stalled');
    }

    offset += 1000;

    if (offset > 1000000) {
      throw new Error('SuiteQL pagination limit exceeded');
    }
  }

  return rows;
}

// =====================================================
// SALES ORDER HEADERS
// =====================================================

export async function fetchHeaders(
  access,
  changedAfter = null
) {
  const modified = changedAfter
    ? `AND lastmodifieddate >= TO_DATE(
         '${changedAfter}',
         'YYYY-MM-DD HH24:MI:SS'
       )`
    : '';

  // Transaction.subsidiary is not available in
  // this NetSuite account's SuiteQL Transaction table.

  const sql = `
    SELECT
      id,
      tranid,
      status,
      entity,
      currency,
      foreigntotal,
      TO_CHAR(
        trandate,
        'YYYY-MM-DD'
      ) AS transaction_date,
      TO_CHAR(
        lastmodifieddate,
        'YYYY-MM-DD HH24:MI:SS'
      ) AS last_modified
    FROM Transaction
    WHERE type = 'SalesOrd'
      AND trandate >= TO_DATE(
        '${FROM}', 'YYYY-MM-DD'
      )
      AND trandate < TO_DATE(
        '${TO}', 'YYYY-MM-DD'
      )
      ${modified}
    ORDER BY id
  `;

  return fetchAll(access, sql);
}

// =====================================================
// SALES ORDER LINES
// =====================================================

export async function fetchLines(access, ids) {
  const rows = [];
  const batches = chunk(ids, 20);

  for (let i = 0; i < batches.length; i++) {
    const idList = batches[i]
      .map(id => {
        const n = Number(id);
        if (!Number.isSafeInteger(n) || n <= 0) {
          throw new Error(`Invalid Sales Order ID: ${id}`);
        }
        return n;
      })
      .join(',');

    const sql = `
      SELECT
        transaction,
        id,
        uniquekey,
        item,
        itemtype,
        accountinglinetype,
        mainline,
        taxline,
        iscogs,
        quantity,
        rate,
        foreignamount,
        netamount,
        tax1amt,
        location,
        units,
        memo,
        isclosed
      FROM TransactionLine
      WHERE transaction IN (${idList})
      ORDER BY transaction, id
    `;

    const result = await fetchAll(access, sql);
    rows.push(...result);

    console.log(
      `SO line batch ${i + 1}/${batches.length}: ${result.length}`
    );
  }

  return rows;
}

// =====================================================
// SOURCE MAPPING
// =====================================================

export function mapSource(headers, rawLines) {
  const mappedHeaders = headers.map(h => ({
    internal_id: String(h.id),
    tranid: h.tranid ?? null,
    transaction_date: h.transaction_date,
    status: h.status ?? null,
    customer_id:
      h.entity == null ? null : String(h.entity),

    // Not available from Transaction header.
    subsidiary_id: null,

    currency_id:
      h.currency == null ? null : String(h.currency),

    total_amount: N(h.foreigntotal).toFixed(2),
    last_modified: cleanDateTime(h.last_modified)
  }));

  const headerMap = new Map(
    mappedHeaders.map(h => [h.internal_id, h])
  );

  if (headerMap.size !== mappedHeaders.length) {
    throw new Error('Duplicate Sales Order header IDs');
  }

  const mappedLines = [];
  const uniqueKeys = new Set();

  let mainlineCount = 0;

  for (const l of rawLines) {
    const documentId = String(l.transaction);
    const header = headerMap.get(documentId);

    if (!header) {
      throw new Error(
        `Source orphan line: ${documentId}:${l.id}`
      );
    }

    if (flag(l.mainline)) {
      mainlineCount++;
      continue;
    }

    if (l.uniquekey == null) {
      throw new Error(
        `Missing line unique key: ${documentId}:${l.id}`
      );
    }

    const key = `${documentId}:${l.uniquekey}`;

    if (uniqueKeys.has(key)) {
      throw new Error(`Duplicate line key: ${key}`);
    }

    uniqueKeys.add(key);

    mappedLines.push({
      sales_order_internal_id: documentId,
      line_unique_key: String(l.uniquekey),
      line_id: l.id == null ? null : String(l.id),
      line_type: classify(l),
      item_id: l.item == null ? null : String(l.item),
      item_type: l.itemtype ?? null,
      accounting_line_type:
        l.accountinglinetype ?? null,
      quantity:
        l.quantity == null ? null : String(l.quantity),
      rate:
        l.rate == null ? null : normalizeNumericRate(l.rate, { module: "sales-order", recordId: l.transaction, field: "rate" }),
      foreign_amount:
        l.foreignamount == null
          ? null
          : String(l.foreignamount),
      net_amount:
        l.netamount == null
          ? null
          : String(l.netamount),
      tax_amount:
        l.tax1amt == null ? null : String(l.tax1amt),
      location_id:
        l.location == null ? null : String(l.location),
      units_id:
        l.units == null ? null : String(l.units),
      memo: l.memo ?? null,
      is_closed: flag(l.isclosed),
      last_modified: header.last_modified
    });
  }

  if (mainlineCount !== mappedHeaders.length) {
    throw new Error(
      `MAINLINE mismatch: ${mainlineCount} vs ` +
      `${mappedHeaders.length} headers`
    );
  }

  return {
    headers: mappedHeaders,
    lines: mappedLines,
    rawLineCount: rawLines.length
  };
}
```

### `modules/sales-order/presence.mjs`

**Reconstructed SHA-256:** `d45897b4fc03df8a6bb2a5f09cb322ce41e58dfa194b6c5c7faa1ce16aed476a`.

```javascript
import { reconcilePresence } from '../../common/presence-reconcile.mjs';
reconcilePresence('sales-order',{ apply:process.argv.includes('--apply') }).catch(e=>{console.error('PRESENCE CHECK ERROR:',e.stack??e);process.exitCode=1;});
```

### `modules/sales-order/recover.mjs`

**Reconstructed SHA-256:** `0020d557b03240eaddf2762a19ea760e0defae826b8dc8904ef9d3f39653d101`.

```javascript
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { bq, DATASET, LOCATION, FROM, TO, T, N, token, fetchAll, fetchLines, mapSource, query } from './mapping.mjs';

// Targeted October SO recovery. No checkpoint writes. Apply only for missing/soft-deleted headers.
const args = process.argv.slice(2);
const at = args.indexOf('--id');
const rawId = at >= 0 ? args[at + 1] : undefined;
const apply = args.includes('--apply');
const dry = args.includes('--dry-run');
if (at < 0 || args.filter(x => x === '--id').length !== 1 || !/^[1-9][0-9]{0,14}$/.test(rawId ?? '') ||
    (apply && dry) || args.some((x, i) => i !== at + 1 && !['--id','--apply','--dry-run'].includes(x))) {
  console.error('Usage: node modules/sales-order/recover.mjs --id 3152083 [--dry-run|--apply]');
  process.exit(2);
}
const id = String(rawId);
if (!Number.isSafeInteger(Number(id))) throw new Error('Unsafe ID');
const H = T('sales_order_headers');
const L = T('sales_order_lines');
const dataset = bq.dataset(DATASET);
const HEADER_FIELDS = ['internal_id','tranid','transaction_date','status','customer_id','subsidiary_id','currency_id','total_amount','last_modified'];
const LINE_FIELDS = ['sales_order_internal_id','line_unique_key','line_id','line_type','item_id','item_type','accounting_line_type','quantity','rate','foreign_amount','net_amount','tax_amount','location_id','units_id','memo','is_closed','last_modified'];
const HEADER_SCHEMA = [
  ['internal_id','STRING'],['tranid','STRING'],['transaction_date','DATE'],['status','STRING'],
  ['customer_id','STRING'],['subsidiary_id','STRING'],['currency_id','STRING'],
  ['total_amount','NUMERIC'],['last_modified','DATETIME']
];
const LINE_SCHEMA = [
  ['sales_order_internal_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],
  ['line_type','STRING'],['item_id','STRING'],['item_type','STRING'],['accounting_line_type','STRING'],
  ['quantity','NUMERIC'],['rate','NUMERIC'],['foreign_amount','NUMERIC'],
  ['net_amount','NUMERIC'],['tax_amount','NUMERIC'],['location_id','STRING'],
  ['units_id','STRING'],['memo','STRING'],['is_closed','BOOLEAN'],['last_modified','DATETIME']
];

async function state() {
  const rows = await query(`SELECT internal_id, is_deleted, FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', last_modified) AS modified
    FROM ${H} WHERE internal_id = '${id}'`);
  if (rows.length > 1) throw new Error('Duplicate SO headers; abort');
  return rows[0] ?? null;
}
async function source(access) {
  const headers = await fetchAll(access, `SELECT id, tranid, status, entity, currency, foreigntotal,
    TO_CHAR(trandate, 'YYYY-MM-DD') AS transaction_date,
    TO_CHAR(lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS last_modified
    FROM Transaction WHERE type = 'SalesOrd' AND id = ${id}`);
  if (headers.length !== 1) throw new Error('SO NOT_VISIBLE_IN_NETSUITE: recovery forbidden');
  if (headers[0].transaction_date < FROM || headers[0].transaction_date >= TO) {
    throw new Error(`SO outside October window (${headers[0].transaction_date}); review manually`);
  }
  const rawLines = await fetchLines(access, [id]);
  const data = mapSource(headers, rawLines);
  if (data.headers.length !== 1 || data.headers[0].internal_id !== id || data.lines.length === 0) {
    throw new Error('SO source has invalid/empty details');
  }
  for (const row of data.lines) {
    if (row.sales_order_internal_id !== id) throw new Error('Foreign SO line');
  }
  return data;
}
function stable(data) {
  return JSON.stringify({ headers: data.headers, lines: [...data.lines].sort((a,b) =>
    a.line_unique_key.localeCompare(b.line_unique_key, 'en', {numeric:true})) });
}
async function stage(name, rows, schema, dir) {
  const local = path.join(dir, `${name}.ndjson`);
  await fs.writeFile(local, rows.map(x => JSON.stringify(x)).join('\n') + '\n', { mode: 0o600 });
  await dataset.table(name).load(local, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON', writeDisposition: 'WRITE_TRUNCATE',
    schema: { fields: schema.map(([field,type]) => ({name:field,type})) },
    location: LOCATION, ignoreUnknownValues:false, maxBadRecords:0
  });
  const [r] = await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);
  if (N(r.n) !== rows.length) throw new Error('Staging row count mismatch');
}
async function commit(hs, ls, expectedState, lineCount) {
  const predicate = expectedState === 'MISSING'
    ? `(SELECT COUNT(*) FROM ${H} WHERE internal_id = '${id}') = 0`
    : `(SELECT COUNT(*) FROM ${H} WHERE internal_id = '${id}' AND is_deleted = TRUE) = 1`;
  const changes = HEADER_FIELDS.filter(x => x !== 'internal_id').map(x => `d.${x} = s.${x}`);
  changes.push('d.synced_at = CURRENT_TIMESTAMP()', 'd.is_deleted = FALSE', 'd.deleted_at = NULL');
  const sql = `BEGIN
    BEGIN TRANSACTION;
    ASSERT ${predicate} AS 'Header state changed; abort recovery';
    ASSERT (SELECT COUNT(*) FROM ${T(hs)}) = 1 AS 'Staging header count changed';
    ASSERT (SELECT COUNT(*) FROM ${T(ls)}) = ${lineCount} AS 'Staging line count changed';
    ASSERT (SELECT COUNT(*) FROM (SELECT line_unique_key FROM ${T(ls)} GROUP BY 1 HAVING COUNT(*) > 1)) = 0 AS 'Duplicate staged line';
    MERGE ${H} d USING ${T(hs)} s ON d.internal_id = s.internal_id
    WHEN MATCHED THEN UPDATE SET ${changes.join(', ')}
    WHEN NOT MATCHED THEN INSERT (${HEADER_FIELDS.join(', ')}, synced_at, is_deleted, deleted_at)
    VALUES (${HEADER_FIELDS.map(x => `s.${x}`).join(', ')}, CURRENT_TIMESTAMP(), FALSE, NULL);
    DELETE FROM ${L} WHERE sales_order_internal_id = '${id}';
    INSERT INTO ${L} (${LINE_FIELDS.join(', ')}, synced_at)
    SELECT ${LINE_FIELDS.join(', ')}, CURRENT_TIMESTAMP() FROM ${T(ls)};
    ASSERT (SELECT COUNT(*) FROM ${H} WHERE internal_id = '${id}' AND is_deleted = FALSE) = 1 AS 'Header restore failed';
    ASSERT (SELECT COUNT(*) FROM ${L} WHERE sales_order_internal_id = '${id}') = ${lineCount} AS 'Line count mismatch';
    COMMIT TRANSACTION;
  EXCEPTION WHEN ERROR THEN
    ROLLBACK TRANSACTION;
    RAISE;
  END;`;
  await query(sql);
}
async function main() {
  console.log(`SO TARGETED RECOVERY | ID ${id} | ${apply ? 'APPLY' : 'READ ONLY'}`);
  console.log('Checkpoint: NEVER MODIFIED');
  const access = await token();
  console.log('NetSuite OAuth: SUCCESS');
  const previous = await state();
  console.log(`BigQuery header: ${previous ? (previous.is_deleted === true ? 'SOFT_DELETED' : 'ACTIVE') : 'MISSING'}`);
  if (previous && previous.is_deleted !== true) {
    console.log('ALREADY ACTIVE: NO-OP. Header/line equivalence not asserted; run check.mjs.');
    return;
  }
  const data = await source(access);
  const action = previous ? 'RESTORE' : 'RECOVER';
  console.log(`SOURCE VALIDATION: PASS | 1 header | ${data.lines.length} lines`);
  console.log(`ACTION: ${action}`);
  if (!apply) {
    console.log('DRY RUN PASS: BigQuery unchanged');
    return;
  }
  const fresh = await source(access);
  if (stable(data) !== stable(fresh)) throw new Error('Source changed during recovery; retry');
  const tag = crypto.randomUUID().replaceAll('-','').slice(0,20);
  const hs = `_so_rec_h_${tag}`, ls = `_so_rec_l_${tag}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'so-recovery-'));
  const staged = [];
  try {
    staged.push(hs);
    await stage(hs, fresh.headers, HEADER_SCHEMA, temp);
    staged.push(ls);
    await stage(ls, fresh.lines, LINE_SCHEMA, temp);
    console.log('STAGING VALIDATION: PASS');
    await commit(hs, ls, previous ? 'SOFT_DELETED' : 'MISSING', fresh.lines.length);
    console.log(`ATOMIC ${action}: SUCCESS | header + ${fresh.lines.length} lines | checkpoint unchanged`);
  } finally {
    for (const name of staged) {
      try { await dataset.table(name).delete({ignoreNotFound:true}); }
      catch (e) { console.error(`Cleanup warning: ${name}: ${e.message}`); }
    }
    await fs.rm(temp,{recursive:true,force:true});
  }
}
main().catch(err => { console.error('SO TARGETED RECOVERY ERROR:',err); process.exitCode=1; });
```

### `modules/sales-order/repair-active.mjs`

**Reconstructed SHA-256:** `9abbc30424d5fad0cb733708f8a2cf1535db49b2fee679d944ea06672ab6f109`.

```javascript
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { bq, DATASET, LOCATION, FROM, TO, T, N, token, fetchAll, fetchLines, mapSource, query } from './mapping.mjs';

// V5.2.2 targeted ACTIVE SO revalidation/repair. No checkpoint updates. Guarded independent source checks.
const args = process.argv.slice(2);
const at = args.indexOf('--id');
const rawId = at >= 0 ? args[at + 1] : undefined;
const apply = args.includes('--apply');
const dry = args.includes('--dry-run');
if (at < 0 || args.filter(x => x === '--id').length !== 1 || !/^[1-9][0-9]{0,14}$/.test(rawId ?? '') ||
    (apply && dry) || args.some((x, i) => i !== at + 1 && !['--id','--apply','--dry-run'].includes(x))) {
  console.error('Usage: node modules/sales-order/repair-active.mjs --id 3152083 [--dry-run|--apply]');
  process.exit(2);
}
const id = String(rawId);
if (!Number.isSafeInteger(Number(id))) throw new Error('Unsafe ID');
const H = T('sales_order_headers');
const L = T('sales_order_lines');
const dataset = bq.dataset(DATASET);
const HEADER_FIELDS = ['internal_id','tranid','transaction_date','status','customer_id','subsidiary_id','currency_id','total_amount','last_modified'];
const LINE_FIELDS = ['sales_order_internal_id','line_unique_key','line_id','line_type','item_id','item_type','accounting_line_type','quantity','rate','foreign_amount','net_amount','tax_amount','location_id','units_id','memo','is_closed','last_modified'];
const HEADER_SCHEMA = [
  ['internal_id','STRING'],['tranid','STRING'],['transaction_date','DATE'],['status','STRING'],
  ['customer_id','STRING'],['subsidiary_id','STRING'],['currency_id','STRING'],
  ['total_amount','NUMERIC'],['last_modified','DATETIME']
];
const LINE_SCHEMA = [
  ['sales_order_internal_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],
  ['line_type','STRING'],['item_id','STRING'],['item_type','STRING'],['accounting_line_type','STRING'],
  ['quantity','NUMERIC'],['rate','NUMERIC'],['foreign_amount','NUMERIC'],
  ['net_amount','NUMERIC'],['tax_amount','NUMERIC'],['location_id','STRING'],
  ['units_id','STRING'],['memo','STRING'],['is_closed','BOOLEAN'],['last_modified','DATETIME']
];

async function state() {
  const rows = await query(`SELECT internal_id, is_deleted, FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', last_modified) AS modified
    FROM ${H} WHERE internal_id = '${id}'`);
  if (rows.length > 1) throw new Error('Duplicate SO headers; abort');
  return rows[0] ?? null;
}
async function source(access) {
  const headers = await fetchAll(access, `SELECT id, tranid, status, entity, currency, foreigntotal,
    TO_CHAR(trandate, 'YYYY-MM-DD') AS transaction_date,
    TO_CHAR(lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS last_modified
    FROM Transaction WHERE type = 'SalesOrd' AND id = ${id}`);
  if (headers.length !== 1) throw new Error('SO NOT_VISIBLE_IN_NETSUITE: recovery forbidden');
  if (headers[0].transaction_date < FROM || headers[0].transaction_date >= TO) {
    throw new Error(`SO outside October window (${headers[0].transaction_date}); review manually`);
  }
  const rawLines = await fetchLines(access, [id]);
  const data = mapSource(headers, rawLines);
  if (data.headers.length !== 1 || data.headers[0].internal_id !== id || data.lines.length === 0) {
    throw new Error('SO source has invalid/empty details');
  }
  for (const row of data.lines) {
    if (row.sales_order_internal_id !== id) throw new Error('Foreign SO line');
  }
  return data;
}
function stable(data) {
  return JSON.stringify({ headers: data.headers, lines: [...data.lines].sort((a,b) =>
    a.line_unique_key.localeCompare(b.line_unique_key, 'en', {numeric:true})) });
}
async function stage(name, rows, schema, dir) {
  const local = path.join(dir, `${name}.ndjson`);
  await fs.writeFile(local, rows.map(x => JSON.stringify(x)).join('\n') + '\n', { mode: 0o600 });
  await dataset.table(name).load(local, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON', writeDisposition: 'WRITE_TRUNCATE',
    schema: { fields: schema.map(([field,type]) => ({name:field,type})) },
    location: LOCATION, ignoreUnknownValues:false, maxBadRecords:0
  });
  const [r] = await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);
  if (N(r.n) !== rows.length) throw new Error('Staging row count mismatch');
}
async function commit(hs, ls, expectedState, lineCount) {
  const predicate = `(SELECT COUNT(*) FROM ${H} WHERE internal_id = '${id}' AND COALESCE(is_deleted,FALSE)=FALSE AND FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_modified) = '${expectedState}')=1`;
  const changes = HEADER_FIELDS.filter(x => x !== 'internal_id').map(x => `d.${x} = s.${x}`);
  changes.push('d.synced_at = CURRENT_TIMESTAMP()', 'd.is_deleted = FALSE', 'd.deleted_at = NULL');
  const sql = `BEGIN
    BEGIN TRANSACTION;
    ASSERT ${predicate} AS 'Header state changed; abort recovery';
    ASSERT (SELECT COUNT(*) FROM ${T(hs)}) = 1 AS 'Staging header count changed';
    ASSERT (SELECT COUNT(*) FROM ${T(ls)}) = ${lineCount} AS 'Staging line count changed';
    ASSERT (SELECT COUNT(*) FROM (SELECT line_unique_key FROM ${T(ls)} GROUP BY 1 HAVING COUNT(*) > 1)) = 0 AS 'Duplicate staged line';
    MERGE ${H} d USING ${T(hs)} s ON d.internal_id = s.internal_id
    WHEN MATCHED THEN UPDATE SET ${changes.join(', ')}
    WHEN NOT MATCHED THEN INSERT (${HEADER_FIELDS.join(', ')}, synced_at, is_deleted, deleted_at)
    VALUES (${HEADER_FIELDS.map(x => `s.${x}`).join(', ')}, CURRENT_TIMESTAMP(), FALSE, NULL);
    DELETE FROM ${L} WHERE sales_order_internal_id = '${id}';
    INSERT INTO ${L} (${LINE_FIELDS.join(', ')}, synced_at)
    SELECT ${LINE_FIELDS.join(', ')}, CURRENT_TIMESTAMP() FROM ${T(ls)};
    ASSERT (SELECT COUNT(*) FROM ${H} WHERE internal_id = '${id}' AND is_deleted = FALSE) = 1 AS 'Header restore failed';
    ASSERT (SELECT COUNT(*) FROM ${L} WHERE sales_order_internal_id = '${id}') = ${lineCount} AS 'Line count mismatch';
    COMMIT TRANSACTION;
  EXCEPTION WHEN ERROR THEN
    ROLLBACK TRANSACTION;
    RAISE;
  END;`;
  await query(sql);
}
async function main() {
  console.log(`SO ACTIVE REFRESH | ID ${id} | ${apply ? 'APPLY' : 'READ ONLY'}`);
  console.log('Checkpoint: NEVER MODIFIED');
  const access = await token();
  console.log('NetSuite OAuth: SUCCESS');
  const previous = await state();
  console.log(`BigQuery header: ${previous ? (previous.is_deleted === true ? 'SOFT_DELETED' : 'ACTIVE') : 'MISSING'}`);
  if (!previous || previous.is_deleted === true) throw new Error('Expected exactly one ACTIVE BQ header; use original recover.mjs for missing/deleted');
  const data = await source(access);
  const action = 'REFRESH';
  console.log(`SOURCE VALIDATION: PASS | 1 header | ${data.lines.length} lines`);
  console.log(`ACTION: ${action}`);
  if (!apply) {
    console.log('DRY RUN PASS: BigQuery unchanged');
    return;
  }
  const fresh = await source(access);
  if (stable(data) !== stable(fresh)) throw new Error('Source changed during recovery; retry');
  const tag = crypto.randomUUID().replaceAll('-','').slice(0,20);
  const hs = `_so_rec_h_${tag}`, ls = `_so_rec_l_${tag}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'so-recovery-'));
  const staged = [];
  try {
    staged.push(hs);
    await stage(hs, fresh.headers, HEADER_SCHEMA, temp);
    staged.push(ls);
    await stage(ls, fresh.lines, LINE_SCHEMA, temp);
    console.log('STAGING VALIDATION: PASS');
    await commit(hs, ls, previous.modified, fresh.lines.length);
    console.log(`ATOMIC ${action}: SUCCESS | header + ${fresh.lines.length} lines | checkpoint unchanged`);
  } finally {
    for (const name of staged) {
      try { await dataset.table(name).delete({ignoreNotFound:true}); }
      catch (e) { console.error(`Cleanup warning: ${name}: ${e.message}`); }
    }
    await fs.rm(temp,{recursive:true,force:true});
  }
}
main().catch(err => { console.error('SO ACTIVE REFRESH ERROR:',err); process.exitCode=1; });
```

### `modules/sales-order/sync.mjs`

**Reconstructed SHA-256:** `024344ce8f773ba63f5b64a1ec2dc75fba384f8e1aa56492c126d6e7c0c2c3ec`.

```javascript
import { validateNumericRows } from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  bq,
  DATASET,
  LOCATION,
  FROM,
  TO,
  T,
  N,
  token,
  fetchHeaders,
  fetchLines,
  mapSource,
  query
} from './mapping.mjs';

// =====================================================
// CONFIGURATION
// =====================================================

const DRY_RUN = process.argv.includes('--dry-run');

const HEADER_TABLE = 'sales_order_headers';
const LINE_TABLE = 'sales_order_lines';
const CHECKPOINT_TABLE = 'sync_checkpoints';

const HEADER_CHECKPOINT = 'sales_order_headers';
const LINE_CHECKPOINT = 'sales_order_lines';

const OVERLAP_MINUTES = 5;

const HEADER_SCHEMA = [
  ['internal_id', 'STRING'],
  ['tranid', 'STRING'],
  ['transaction_date', 'DATE'],
  ['status', 'STRING'],
  ['customer_id', 'STRING'],
  ['subsidiary_id', 'STRING'],
  ['currency_id', 'STRING'],
  ['total_amount', 'NUMERIC'],
  ['last_modified', 'DATETIME']
];

const LINE_SCHEMA = [
  ['sales_order_internal_id', 'STRING'],
  ['line_unique_key', 'STRING'],
  ['line_id', 'STRING'],
  ['line_type', 'STRING'],
  ['item_id', 'STRING'],
  ['item_type', 'STRING'],
  ['accounting_line_type', 'STRING'],
  ['quantity', 'NUMERIC'],
  ['rate', 'NUMERIC'],
  ['foreign_amount', 'NUMERIC'],
  ['net_amount', 'NUMERIC'],
  ['tax_amount', 'NUMERIC'],
  ['location_id', 'STRING'],
  ['units_id', 'STRING'],
  ['memo', 'STRING'],
  ['is_closed', 'BOOLEAN'],
  ['last_modified', 'DATETIME']
];

// =====================================================
// HELPERS
// =====================================================

function log(message = '') {
  console.log(message);
}

function schemaFields(schema) {
  return schema.map(([name, type]) => ({
    name,
    type
  }));
}

function subtractMinutes(dateTime, minutes) {
  const date = new Date(
    dateTime.replace(' ', 'T') + 'Z'
  );

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid checkpoint: ${dateTime}`);
  }

  date.setUTCMinutes(date.getUTCMinutes() - minutes);

  return date
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

function getMaxModified(headers) {
  return headers
    .map(row => row.last_modified)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

// =====================================================
// INITIALIZE TABLES
// =====================================================

async function ensureTables() {
  log('Checking BigQuery tables...');

  await query(`
    CREATE TABLE IF NOT EXISTS ${T(HEADER_TABLE)} (
      internal_id STRING NOT NULL,
      tranid STRING,
      transaction_date DATE,
      status STRING,
      customer_id STRING,
      subsidiary_id STRING,
      currency_id STRING,
      total_amount NUMERIC,
      last_modified DATETIME,
      synced_at TIMESTAMP
    )
    PARTITION BY transaction_date
    CLUSTER BY internal_id
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS ${T(LINE_TABLE)} (
      sales_order_internal_id STRING NOT NULL,
      line_unique_key STRING NOT NULL,
      line_id STRING,
      line_type STRING,
      item_id STRING,
      item_type STRING,
      accounting_line_type STRING,
      quantity NUMERIC,
      rate NUMERIC,
      foreign_amount NUMERIC,
      net_amount NUMERIC,
      tax_amount NUMERIC,
      location_id STRING,
      units_id STRING,
      memo STRING,
      is_closed BOOL,
      last_modified DATETIME,
      synced_at TIMESTAMP
    )
    CLUSTER BY sales_order_internal_id, line_unique_key
  `);

  const [checkpointExists] = await bq
    .dataset(DATASET)
    .table(CHECKPOINT_TABLE)
    .exists();

  if (!checkpointExists) {
    throw new Error(
      `Checkpoint table ${CHECKPOINT_TABLE} does not exist`
    );
  }

  log('BigQuery tables: READY');
}

// =====================================================
// CHECKPOINT
// =====================================================

async function loadCheckpoints() {
  const [exists] = await bq
    .dataset(DATASET)
    .table(CHECKPOINT_TABLE)
    .exists();

  if (!exists) {
    return new Map();
  }

  const rows = await query(`
    SELECT
      record_type,
      FORMAT_DATETIME(
        '%Y-%m-%d %H:%M:%S',
        last_successful_modified_at
      ) AS modified
    FROM ${T(CHECKPOINT_TABLE)}
    WHERE record_type IN (
      '${HEADER_CHECKPOINT}',
      '${LINE_CHECKPOINT}'
    )
  `);

  const result = new Map();

  for (const row of rows) {
    if (result.has(row.record_type)) {
      throw new Error(
        `Duplicate checkpoint: ${row.record_type}`
      );
    }

    result.set(row.record_type, row.modified);
  }

  return result;
}

// =====================================================
// STAGING TABLE
// =====================================================

async function createStageTable(tableName, rows, schema) {
  // Create empty staging table when no rows exist
  if (rows.length === 0) {
    const columns = schema.map(([name, type]) => {
      return `CAST(NULL AS ${type}) AS ${name}`;
    });

    await query(`
      CREATE TABLE ${T(tableName)} AS
      SELECT
        ${columns.join(',\n        ')}
      WHERE FALSE
    `);

    console.log(`EMPTY STAGING CREATED: ${tableName}`);
    return;
  }

  // Generate temporary NDJSON file
  const fileName = path.join(
    os.tmpdir(),
    `netsuite-so-${crypto.randomUUID()}.ndjson`
  );

  validateNumericRows(rows, schemaFields(schema).map(f => [f.name, f.type]), { module: 'sales-order' });

  const content =
    rows.map(row => JSON.stringify(row)).join('\n') + '\n';

  await fs.writeFile(fileName, content, {
    mode: 0o600
  });

  try {
    // Upload NDJSON to BigQuery staging table
    await bq
      .dataset(DATASET)
      .table(tableName)
      .load(fileName, {
        sourceFormat: 'NEWLINE_DELIMITED_JSON',
        writeDisposition: 'WRITE_TRUNCATE',
        schema: {
          fields: schemaFields(schema)
        },
        location: LOCATION
      });

    console.log(
      `STAGING LOAD SUCCESS: ${tableName} (${rows.length} rows)`
    );

  } finally {
    // Delete temporary local file
    await fs.rm(fileName, {
      force: true
    });
  }
}
// =====================================================
// STAGING VALIDATION
// =====================================================

async function validateStaging(
  stageHeaders,
  stageLines,
  expectedHeaders,
  expectedLines
) {
  const [result] = await query(`
    SELECT
      (
        SELECT COUNT(*)
        FROM ${T(stageHeaders)}
      ) AS header_count,

      (
        SELECT COUNT(*)
        FROM ${T(stageLines)}
      ) AS line_count,

      (
        SELECT COUNT(*)
        FROM (
          SELECT internal_id
          FROM ${T(stageHeaders)}
          GROUP BY internal_id
          HAVING COUNT(*) > 1
        )
      ) AS duplicate_headers,

      (
        SELECT COUNT(*)
        FROM (
          SELECT
            sales_order_internal_id,
            line_unique_key
          FROM ${T(stageLines)}
          GROUP BY
            sales_order_internal_id,
            line_unique_key
          HAVING COUNT(*) > 1
        )
      ) AS duplicate_lines,

      (
        SELECT COUNT(*)
        FROM ${T(stageLines)} l
        LEFT JOIN ${T(stageHeaders)} h
          ON h.internal_id = l.sales_order_internal_id
        WHERE h.internal_id IS NULL
      ) AS orphan_lines
  `);

  const valid =
    N(result.header_count) === expectedHeaders &&
    N(result.line_count) === expectedLines &&
    N(result.duplicate_headers) === 0 &&
    N(result.duplicate_lines) === 0 &&
    N(result.orphan_lines) === 0;

  if (!valid) {
    log(JSON.stringify(result, null, 2));
    throw new Error('STAGING VALIDATION: FAIL');
  }

  log('STAGING VALIDATION: PASS');
}

// =====================================================
// ATOMIC HEADER + LINES + CHECKPOINT
// =====================================================

async function atomicCommit({
  stageHeaders,
  stageLines,
  watermark,
  initial
}) {
  const headerColumns = HEADER_SCHEMA.map(
    ([name]) => name
  );

  const lineColumns = LINE_SCHEMA.map(
    ([name]) => name
  );

  const headerUpdates = headerColumns
    .filter(name => name !== 'internal_id')
    .map(name => `d.${name} = s.${name}`);

  headerUpdates.push(
    'd.synced_at = CURRENT_TIMESTAMP()'
  );
  // Restore a previously soft-deleted SO when a changed source record reappears.
  headerUpdates.push('d.is_deleted = FALSE', 'd.deleted_at = NULL');

  // During initial load, reconcile existing October
  // records against the complete source snapshot.
  // During delta, only changed documents are replaced.

  const initialCleanup = initial
    ? `
      DELETE FROM ${T(LINE_TABLE)}
      WHERE sales_order_internal_id IN (
        SELECT internal_id
        FROM ${T(HEADER_TABLE)}
        WHERE transaction_date >= DATE '${FROM}'
          AND transaction_date < DATE '${TO}'
          AND internal_id NOT IN (
            SELECT internal_id
            FROM ${T(stageHeaders)}
          )
      );

      DELETE FROM ${T(HEADER_TABLE)}
      WHERE transaction_date >= DATE '${FROM}'
        AND transaction_date < DATE '${TO}'
        AND internal_id NOT IN (
          SELECT internal_id
          FROM ${T(stageHeaders)}
        );
    `
    : '';

  const sql = `
    BEGIN
      BEGIN TRANSACTION;

      MERGE ${T(HEADER_TABLE)} d
      USING ${T(stageHeaders)} s
      ON d.internal_id = s.internal_id

      WHEN MATCHED THEN
        UPDATE SET
          ${headerUpdates.join(',\n          ')}

      WHEN NOT MATCHED THEN
        INSERT (
          ${headerColumns.join(', ')},
          synced_at, is_deleted, deleted_at
        )
        VALUES (
          ${headerColumns.map(name => `s.${name}`).join(', ')},
          CURRENT_TIMESTAMP(), FALSE, NULL
        );

      ${initialCleanup}

      DELETE FROM ${T(LINE_TABLE)}
      WHERE sales_order_internal_id IN (
        SELECT internal_id
        FROM ${T(stageHeaders)}
      );

      INSERT INTO ${T(LINE_TABLE)} (
        ${lineColumns.join(', ')},
        synced_at
      )
      SELECT
        ${lineColumns.join(', ')},
        CURRENT_TIMESTAMP()
      FROM ${T(stageLines)};

      MERGE ${T(CHECKPOINT_TABLE)} d
      USING (
        SELECT '${HEADER_CHECKPOINT}' AS record_type
        UNION ALL
        SELECT '${LINE_CHECKPOINT}' AS record_type
      ) s
      ON d.record_type = s.record_type

      WHEN MATCHED THEN
        UPDATE SET
          last_successful_modified_at =
            DATETIME('${watermark}'),
          last_successful_sync_at =
            CURRENT_TIMESTAMP(),
          updated_at =
            CURRENT_TIMESTAMP()

      WHEN NOT MATCHED THEN
        INSERT (
          record_type,
          last_successful_modified_at,
          last_successful_sync_at,
          updated_at
        )
        VALUES (
          s.record_type,
          DATETIME('${watermark}'),
          CURRENT_TIMESTAMP(),
          CURRENT_TIMESTAMP()
        );

      COMMIT TRANSACTION;

    EXCEPTION WHEN ERROR THEN
      ROLLBACK TRANSACTION;
      RAISE;
    END;
  `;

  await query(sql);

  log(
    'ATOMIC MERGE + LINE REPLACE + CHECKPOINT: SUCCESS'
  );
}

// =====================================================
// POST SYNC VALIDATION
// =====================================================

async function validateBigQuery(
  stageHeaders,
  stageLines
) {
  const [result] = await query(`
    SELECT
      (
        SELECT COUNT(*)
        FROM ${T(HEADER_TABLE)} h
        JOIN ${T(stageHeaders)} s
          ON s.internal_id = h.internal_id
      ) AS headers,

      (
        SELECT COUNT(*)
        FROM ${T(LINE_TABLE)} l
        JOIN ${T(stageHeaders)} s
          ON s.internal_id = l.sales_order_internal_id
      ) AS lines,

      (
        SELECT COUNT(*)
        FROM ${T(stageLines)}
      ) AS expected_lines,

      (
        SELECT COUNT(*)
        FROM (
          SELECT internal_id
          FROM ${T(HEADER_TABLE)}
          GROUP BY internal_id
          HAVING COUNT(*) > 1
        )
      ) AS duplicate_headers,

      (
        SELECT COUNT(*)
        FROM (
          SELECT
            sales_order_internal_id,
            line_unique_key
          FROM ${T(LINE_TABLE)}
          GROUP BY 1, 2
          HAVING COUNT(*) > 1
        )
      ) AS duplicate_lines,

      (
        SELECT COUNT(*)
        FROM ${T(LINE_TABLE)} l
        LEFT JOIN ${T(HEADER_TABLE)} h
          ON h.internal_id = l.sales_order_internal_id
        WHERE h.internal_id IS NULL
      ) AS orphan_lines
  `);

  log('');
  log('BIGQUERY DELTA RECONCILIATION');
  log(`Headers          : ${result.headers}`);
  log(`Lines            : ${result.lines}`);
  log(`Expected lines   : ${result.expected_lines}`);
  log(`Duplicate header : ${result.duplicate_headers}`);
  log(`Duplicate lines  : ${result.duplicate_lines}`);
  log(`Orphan lines     : ${result.orphan_lines}`);

  const passed =
    N(result.lines) === N(result.expected_lines) &&
    N(result.duplicate_headers) === 0 &&
    N(result.duplicate_lines) === 0 &&
    N(result.orphan_lines) === 0;

  if (!passed) {
    throw new Error('BIGQUERY DELTA RECONCILIATION: FAIL');
  }

  log('BIGQUERY DELTA RECONCILIATION: PASS');
}

// =====================================================
// MAIN
// =====================================================

async function run() {
  log('==========================================');
  log('NETSUITE SALES ORDER COMBINED SYNC');
  log('==========================================');

  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'SYNC'}`);

  let checkpoints;

  if (DRY_RUN) {
    checkpoints = await loadCheckpoints();
  } else {
    await ensureTables();
    checkpoints = await loadCheckpoints();
  }

  const headerCheckpoint =
    checkpoints.get(HEADER_CHECKPOINT) ?? null;

  const lineCheckpoint =
    checkpoints.get(LINE_CHECKPOINT) ?? null;

  if (Boolean(headerCheckpoint) !== Boolean(lineCheckpoint)) {
    throw new Error(
      'Header and lines checkpoints are inconsistent'
    );
  }

  const initial =
    !headerCheckpoint && !lineCheckpoint;

  const fetchFrom = initial
    ? null
    : subtractMinutes(
        headerCheckpoint < lineCheckpoint
          ? headerCheckpoint
          : lineCheckpoint,
        OVERLAP_MINUTES
      );

  log(`Header checkpoint: ${headerCheckpoint ?? 'NONE'}`);
  log(`Lines checkpoint : ${lineCheckpoint ?? 'NONE'}`);
  log(`Fetch from       : ${fetchFrom ?? 'FULL PERIOD'}`);

  const accessToken = await token();

  log('OAuth: SUCCESS');

  // ===================================================
  // FETCH SALES ORDER HEADERS
  // ===================================================

  const sourceHeaders = await fetchHeaders(
    accessToken,
    fetchFrom
  );

  log(`Changed Sales Orders: ${sourceHeaders.length}`);

  // ===================================================
  // FETCH SALES ORDER LINES
  // ===================================================

  const ids = sourceHeaders.map(row => row.id);

  const sourceLines = ids.length
    ? await fetchLines(accessToken, ids)
    : [];

  // ===================================================
  // SOURCE VALIDATION
  // ===================================================

  const mapped = mapSource(
    sourceHeaders,
    sourceLines
  );

  log('');
  log('SOURCE VALIDATION');
  log(`Headers : ${mapped.headers.length}`);
  log(`Lines   : ${mapped.lines.length}`);

  const headerIds = new Set(
    mapped.headers.map(row => row.internal_id)
  );

  if (headerIds.size !== mapped.headers.length) {
    throw new Error('Duplicate source headers');
  }

  if (initial && mapped.headers.length === 0) {
    throw new Error(
      'Initial load returned zero Sales Orders'
    );
  }

  log('SOURCE VALIDATION: PASS');

  // ===================================================
  // DRY RUN
  // ===================================================

  if (DRY_RUN) {
    log('');
    log('DRY RUN PASS: BigQuery unchanged');
    return;
  }

  // ===================================================
  // EMPTY DELTA
  // ===================================================

  if (!initial && sourceHeaders.length === 0) {
    log('No changed Sales Orders');
    log('SALES ORDER SYNC SUCCESS');
    return;
  }

  // ===================================================
  // WATERMARK
  // ===================================================

  const maxModified = getMaxModified(sourceHeaders);

  if (!maxModified) {
    throw new Error('Source lastmodifieddate missing');
  }

  const watermark = initial
    ? maxModified
    : maxModified > headerCheckpoint
      ? maxModified
      : headerCheckpoint;

  log(`New checkpoint: ${watermark}`);

  // ===================================================
  // STAGING NAMES
  // ===================================================

  const suffix = crypto
    .randomUUID()
    .replaceAll('-', '')
    .slice(0, 20);

  const stageHeaders = `_so_h_${suffix}`;
  const stageLines = `_so_l_${suffix}`;

  try {
    // =================================================
    // STAGE HEADERS
    // =================================================

    log('');
    log('Loading header staging...');

    await createStageTable(
      stageHeaders,
      mapped.headers,
      HEADER_SCHEMA
    );

    // =================================================
    // STAGE LINES
    // =================================================

    log('Loading line staging...');

    await createStageTable(
      stageLines,
      mapped.lines,
      LINE_SCHEMA
    );

    // =================================================
    // VALIDATE STAGING
    // =================================================

    await validateStaging(
      stageHeaders,
      stageLines,
      mapped.headers.length,
      mapped.lines.length
    );

    // =================================================
    // ATOMIC COMMIT
    // =================================================

    await atomicCommit({
      stageHeaders,
      stageLines,
      watermark,
      initial
    });

    // =================================================
    // POST SYNC VALIDATION
    // =================================================

    await validateBigQuery(
      stageHeaders,
      stageLines
    );

    log('');
    log('==========================================');
    log('SALES ORDER SYNC SUCCESS');
    log('==========================================');
  } finally {
    // =================================================
    // CLEANUP STAGING
    // =================================================

    for (const tableName of [
      stageHeaders,
      stageLines
    ]) {
      try {
        await bq
          .dataset(DATASET)
          .table(tableName)
          .delete({
            ignoreNotFound: true
          });
      } catch (error) {
        console.error(
          `Staging cleanup warning: ${tableName}`,
          error.message
        );
      }
    }
  }
}

// =====================================================
// ENTRY POINT
// =====================================================

run().catch(error => {
  console.error('');
  console.error(
    'SALES ORDER SYNC ERROR:',
    error.stack ?? error.message
  );

  process.exitCode = 1;
});
```

### `modules/sales-payment/audit-source.mjs`

**Reconstructed SHA-256:** `a131f0e7db21aeaf24da06bf5e569b3f10e672d200ccb7aab0d9d1ccd718ae0b`.

```javascript
// Module 9 Sales Payment - Phase B1 source-wide financial & application discovery.
// READ ONLY. No BigQuery, deletion apply, checkpoints, scheduler, DDL or DML.
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { validateNumeric } from '../../common/decimal-precision.mjs';

const START = '2026-10-01';
const END = '2027-01-01';
const WINDOW = `t.trandate >= TO_DATE('${START}', 'YYYY-MM-DD') AND t.trandate < TO_DATE('${END}', 'YYYY-MM-DD')`;
const slices = [
  ['Oct', '2026-10-01', '2026-11-01'],
  ['Nov', '2026-11-01', '2026-12-01'],
  ['Dec', '2026-12-01', '2027-01-01']
];
const decimalFields = ['total', 'foreigntotal', 'exchangerate', 'foreignpaymentamountused', 'foreignpaymentamountunused'];
function assertNumeric(value, recordId, field) {
  if (value === null || value === undefined || value === '') return;
  validateNumeric(value, { module: 'sales-payment', recordId, field });
}
async function read(access, name, sql) {
  console.log(`\n=== ${name} ===`);
  const rows = await fetchAll(access, sql);
  console.log(`Rows=${rows.length}`);
  return rows;
}
function sumDecimal(values) {
  // Exact decimal sum using fixed-scale BigInt; no JS Number financial arithmetic.
  let sum = 0n;
  for (const val of values) {
    if (val === null || val === undefined || val === '') continue;
    const canonical = validateNumeric(val, { module: 'sales-payment', field: 'aggregate-source' });
    const neg = canonical.startsWith('-');
    const s = neg ? canonical.slice(1) : canonical;
    const [whole, fraction = ''] = s.split('.');
    const unit = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
    sum += neg ? -unit : unit;
  }
  const neg = sum < 0n;
  const a = neg ? -sum : sum;
  return `${neg ? '-' : ''}${a / 1000000000n}.${(a % 1000000000n).toString().padStart(9, '0')}`.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
async function main() {
  console.log('NETSUITE BACKUP - SALES PAYMENT PHASE B1 FULL-SOURCE AUDIT');
  console.log('READ ONLY - NO BQ WRITES - NO DELETION REGISTRY OR APPLY');
  const access = await token();
  console.log('OAuth: SUCCESS');
  const headers = await read(access, 'ALL OCT-DEC PAYMENT HEADERS', `
    SELECT t.id AS internal_id, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date, t.tranid AS document_number,
      t.lastmodifieddate AS last_modified, t.entity AS customer_id,
      t.currency AS currency_id, t.status AS status_id, t.exchangerate,
      t.total, t.foreigntotal, t.foreignpaymentamountused,
      t.foreignpaymentamountunused, t.posting, t.voided
    FROM Transaction t WHERE t.type = 'CustPymt' AND ${WINDOW} ORDER BY t.id`);
  if (!headers.length) throw new Error('No source rows visible; abort rather than certify empty payments');
  const ids = new Set(headers.map(r => String(r.internal_id)));
  let failedDecimal = 0;
  for (const r of headers) for (const field of decimalFields) {
    try { assertNumeric(r[field], r.internal_id, field); }
    catch (error) { failedDecimal++; console.error('DECIMAL_FAIL:', error.message); }
  }
  for (const [label, from, to] of slices) {
    const set = headers.filter(r => String(r.transaction_date).slice(0, 10) >= from && String(r.transaction_date).slice(0, 10) < to);
    console.log(`${label} headers=${set.length} total=${sumDecimal(set.map(r => r.total))} foreign_total=${sumDecimal(set.map(r => r.foreigntotal))}`);
  }
  const status = {};
  const currencies = {};
  for (const r of headers) {
    status[String(r.status_id)] = (status[String(r.status_id)] ?? 0) + 1;
    currencies[String(r.currency_id)] = (currencies[String(r.currency_id)] ?? 0) + 1;
  }
  console.log('Status distribution:', JSON.stringify(status));
  console.log('Currency distribution:', JSON.stringify(currencies));
  console.log('Void count:', headers.filter(r => r.voided === 'T').length);
  console.log('Decimal failures:', failedDecimal);
  // Payment application links are NOT line items; read all links for the payment ID set.
  const links = await read(access, 'ALL PAYMENT APPLICATION LINKS', `
    SELECT p.previousdoc AS invoice_id, p.previousline AS invoice_line,
      p.nextdoc AS payment_id, p.nextline AS payment_line,
      p.previoustype AS invoice_type, p.nexttype AS payment_type,
      p.linktype, p.foreignamount AS applied_foreign_amount,
      p.lastmodifieddate AS last_modified
    FROM PreviousTransactionLineLink p
    JOIN Transaction t ON t.id = p.nextdoc
    WHERE t.type = 'CustPymt' AND ${WINDOW}
    ORDER BY p.nextdoc, p.previousdoc, p.previousline, p.nextline`);
  const perPayment = new Map();
  const linkTypes = {};
  const priorTypes = {};
  let orphan = 0;
  for (const r of links) {
    if (!ids.has(String(r.payment_id))) orphan++;
    assertNumeric(r.applied_foreign_amount, r.payment_id, 'applied_foreign_amount');
    perPayment.set(String(r.payment_id), (perPayment.get(String(r.payment_id)) ?? 0) + 1);
    linkTypes[String(r.linktype)] = (linkTypes[String(r.linktype)] ?? 0) + 1;
    priorTypes[String(r.invoice_type)] = (priorTypes[String(r.invoice_type)] ?? 0) + 1;
  }
  console.log('Application links:', links.length, '| Payments with applications:', perPayment.size,
    '| Payments without applications:', headers.length - perPayment.size, '| Orphan links:', orphan);
  console.log('Link types:', JSON.stringify(linkTypes), '| Previous document types:', JSON.stringify(priorTypes));
  console.log('Maximum applications per payment:', Math.max(0, ...perPayment.values()));
  const lineStats = await read(access, 'PAYMENT TRANSACTIONLINE GROUPING', `
    SELECT tl.mainline, tl.accountinglinetype, COUNT(*) AS line_count,
      SUM(tl.foreignamount) AS foreign_amount_sum, SUM(tl.netamount) AS net_amount_sum
    FROM TransactionLine tl JOIN Transaction t ON t.id = tl.transaction
    WHERE t.type = 'CustPymt' AND ${WINDOW}
    GROUP BY tl.mainline, tl.accountinglinetype ORDER BY tl.mainline, tl.accountinglinetype`);
  for (const r of lineStats) {
    assertNumeric(r.foreign_amount_sum, 'group', 'foreign_amount_sum');
    assertNumeric(r.net_amount_sum, 'group', 'net_amount_sum');
    console.log(JSON.stringify(r));
  }
  const accounting = await read(access, 'PAYMENT ACCOUNTING BOOK DISTRIBUTION', `
    SELECT tal.accountingbook, tal.posting, COUNT(*) AS gl_line_count,
      SUM(tal.debit) AS debit_sum, SUM(tal.credit) AS credit_sum
    FROM TransactionAccountingLine tal JOIN Transaction t ON t.id = tal.transaction
    WHERE t.type = 'CustPymt' AND ${WINDOW}
    GROUP BY tal.accountingbook, tal.posting ORDER BY tal.accountingbook, tal.posting`);
  for (const r of accounting) {
    assertNumeric(r.debit_sum, 'accounting-group', 'debit_sum');
    assertNumeric(r.credit_sum, 'accounting-group', 'credit_sum');
    console.log(JSON.stringify(r));
  }
  console.log('\nPHASE B1 RESULT', JSON.stringify({ headers: headers.length, applicationLinks: links.length,
    transactionLineGroups: lineStats.length, accountingGroups: accounting.length, decimalFailures: failedDecimal,
    orphanLinks: orphan }));
  if (failedDecimal || orphan) process.exitCode = 2;
}
main().catch(error => { console.error('PHASE B1 BLOCKED:', error.message); process.exitCode = 2; });
```

### `modules/sales-payment/check-financial.mjs`

**Reconstructed SHA-256:** `c57293d5b5eab1ea28174446668f420d56802ab7f2e5e5c09ac8e9b4356ff5c2`.

```javascript
import {query,T} from '../../common/bigquery-client.mjs';
import {FROM,TO} from './mapping.mjs';
// Financial verification uses decimal strings and 9-place scaled BigInt: never JS Number for money.
function units(v){if(v==null)return 0n;const s=String(typeof v==='object'&&v.value!==undefined?v.value:v).trim();const m=s.match(/^(-?)(\d+)(?:\.(\d{0,9}))?$/);if(!m)throw Error(`Invalid persisted NUMERIC ${s}`);return (m[1]? -1n:1n)*(BigInt(m[2])*1000000000n+BigInt((m[3]??'').padEnd(9,'0')));}
function formatted(n){const sign=n<0n?'-':'';const a=n<0n?-n:n;return sign+(a/1000000000n)+'.'+String(a%1000000000n).padStart(9,'0').replace(/0+$/,'').padEnd(2,'0');}
async function main(){
 console.log('SALES PAYMENT FINANCIAL CHECK | READ ONLY');
 const header=await query(`SELECT payment_id,CAST(foreign_total AS STRING) AS foreign_total,CAST(base_total AS STRING) AS base_total,CAST(amount_used AS STRING) AS amount_used,CAST(amount_unused AS STRING) AS amount_unused,is_void FROM ${T('sales_payment_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 if(!header.length)throw Error('No active payment headers');
 const [apps,gl,lines]=await Promise.all([
  query(`SELECT a.payment_id,CAST(a.applied_amount AS STRING) AS amount FROM ${T('sales_payment_applications')} a JOIN ${T('sales_payment_headers')} h USING(payment_id) WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`),
  query(`SELECT g.payment_id,g.accounting_book_id,CAST(g.debit AS STRING) AS debit,CAST(g.credit AS STRING) AS credit FROM ${T('sales_payment_accounting_lines')} g JOIN ${T('sales_payment_headers')} h USING(payment_id) WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`),
  query(`SELECT l.payment_id,l.is_mainline,CAST(l.foreign_amount AS STRING) AS amount FROM ${T('sales_payment_lines')} l JOIN ${T('sales_payment_headers')} h USING(payment_id) WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`)
 ]);
 const state=new Map(header.map(h=>[h.payment_id,{header:h,apps:0n,appCount:0,books:new Map(),lineBalance:0n,mainline:0,lines:0}]));
 for(const a of apps){const s=state.get(a.payment_id);if(!s)throw Error('Orphan app '+a.payment_id);s.apps+=units(a.amount);s.appCount++;}
 for(const g of gl){const s=state.get(g.payment_id);if(!s)throw Error('Orphan GL '+g.payment_id);const b=s.books.get(g.accounting_book_id)||{debit:0n,credit:0n,count:0};b.debit+=units(g.debit);b.credit+=units(g.credit);b.count++;s.books.set(g.accounting_book_id,b);}
 for(const l of lines){const s=state.get(l.payment_id);if(!s)throw Error('Orphan line '+l.payment_id);s.lineBalance+=units(l.amount);s.lines++;if(l.is_mainline)s.mainline++;}
 const problems=[],totals={foreign:0n,used:0n,applied:0n,debit:0n,credit:0n};
 for(const [id,s] of state){const h=s.header,foreign=units(h.foreign_total),used=units(h.amount_used),unused=units(h.amount_unused),base=units(h.base_total),book=s.books.get('1');const reasons=[];
  if(used+unused!==foreign)reasons.push('used+unused != foreign total');
  if(s.apps!==used)reasons.push('applications != used');
  if(s.lines<2||s.mainline!==1||s.lineBalance!==0n)reasons.push('transaction line imbalance');
  if(!book)reasons.push('missing book 1');else if(book.debit!==book.credit||(!h.is_void&&(book.debit!==base||book.credit!==base)))reasons.push('book 1/header mismatch');
  for(const [name,b] of s.books)if(b.debit!==b.credit)reasons.push('unbalanced book '+name);
  totals.foreign+=foreign;totals.used+=used;totals.applied+=s.apps;if(book){totals.debit+=book.debit;totals.credit+=book.credit;}
  if(reasons.length&&problems.length<25)problems.push({payment_id:id,reasons});
 }
 const result={headers:header.length,applications:apps.length,glLines:gl.length,transactionLines:lines.length,foreignTotal:formatted(totals.foreign),amountUsed:formatted(totals.used),applicationsTotal:formatted(totals.applied),book1Debit:formatted(totals.debit),book1Credit:formatted(totals.credit),problems};
 console.log(JSON.stringify(result,null,2));
 if(problems.length){console.error('SALES PAYMENT FINANCIAL CHECK FAIL');process.exitCode=3;return;}
 console.log('SALES PAYMENT FINANCIAL CHECK PASS (BQ internal invariants; run check.mjs for live NetSuite parity)');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
```

### `modules/sales-payment/check.mjs`

**Reconstructed SHA-256:** `232cba049914f11ce3cc0303927e27c1be1a1831a1947bb9792d469c40927d9e`.

```javascript
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchApplications,mapSource,FROM,TO} from './mapping.mjs';
const definitions=[
 {table:'sales_payment_headers',source:'headers',keys:['payment_id'],fields:['payment_id','document_number','transaction_date','last_modified','status_id','customer_id','customer_name','currency_id','currency_name','exchange_rate','foreign_total','base_total','amount_used','amount_unused','posting_period_id','subsidiary_id','is_void'],numbers:['exchange_rate','foreign_total','base_total','amount_used','amount_unused'],booleans:['is_void']},
 {table:'sales_payment_lines',source:'transactionLines',keys:['payment_id','line_unique_key'],fields:['payment_id','line_unique_key','line_id','line_number','is_mainline','is_tax_line','accounting_line_type','account_id','foreign_amount','net_amount'],numbers:['foreign_amount','net_amount'],booleans:['is_mainline','is_tax_line']},
 {table:'sales_payment_accounting_lines',source:'accountingLines',keys:['payment_id','accounting_book_id','line_id','account_id'],fields:['payment_id','accounting_book_id','line_id','account_id','posting','debit','credit'],numbers:['debit','credit'],booleans:['posting']},
 {table:'sales_payment_applications',source:'applications',keys:['payment_id','invoice_id','payment_line_id','invoice_line_id'],fields:['payment_id','invoice_id','payment_line_id','invoice_line_id','link_type','applied_amount'],numbers:['applied_amount'],booleans:[]}
];
function decimal(v){
 if(v===null||v===undefined)return null;
 const s=String(typeof v==='object'&&v.value!==undefined?v.value:v).trim();
 const m=s.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
 if(!m)throw Error('Invalid decimal '+s);
 const frac=m[3]??m[4]??'', exponent=Number(m[5]??0);
 if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>100)throw Error('Invalid exponent '+s);
 let digits=((m[2]??'')+frac).replace(/^0+/,'')||'0';if(digits==='0')return '0';
 const offset=exponent-frac.length;
 if(offset>=0)digits+='0'.repeat(offset);
 else{const pos=digits.length+offset;digits=pos>0?digits.slice(0,pos)+'.'+digits.slice(pos):'0.'+'0'.repeat(-pos)+digits;digits=digits.replace(/0+$/,'').replace(/\.$/,'');}
 return (m[1]==='-'?'-':'')+digits;
}
function norm(d,f,v){
 if(v===null||v===undefined)return null;
 if(d.numbers.includes(f))return decimal(v);
 if(d.booleans.includes(f))return v===true||String(v).toLowerCase()==='true'||String(v)==='1'?'true':'false';
 return String(v);
}
function key(r,fields){return fields.map(x=>String(r[x]??'NULL')).join('\u001f');}
async function main(){
 console.log('SALES PAYMENT FULL FIELD RECONCILIATION | READ ONLY');
 const access=await token(),headers=await fetchHeaders(access),ids=headers.map(h=>h.payment_id);
 if(!headers.length)throw Error('Empty NetSuite source');
 const [lines,gl,apps]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchApplications(access,ids)]);
 const mapped=mapSource(headers,lines,gl,apps);
 const report={},samples=[];let failed=false;
 for(const d of definitions){
  const alias=d.source==='headers'?'h':'l';
  const cols=d.fields.map(f=>f==='transaction_date'?`CAST(${alias}.transaction_date AS STRING) AS transaction_date`:f==='last_modified'?`FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',${alias}.last_modified) AS last_modified`:d.numbers.includes(f)?`CAST(${alias}.${f} AS STRING) AS ${f}`:`${alias}.${f} AS ${f}`).join(',');
  const sql=d.source==='headers'?`SELECT ${cols} FROM ${T(d.table)} h WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`:`SELECT ${cols} FROM ${T(d.table)} l JOIN ${T('sales_payment_headers')} h ON h.payment_id=l.payment_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`;
  const stored=await query(sql),source=mapped[d.source];let duplicates=0,mismatch=0,onlySource=0,onlyBigQuery=0;
  const a=new Map(),b=new Map();
  for(const r of source){const k=key(r,d.keys);if(a.has(k))duplicates++;a.set(k,r);}
  for(const r of stored){const k=key(r,d.keys);if(b.has(k))duplicates++;b.set(k,r);}
  for(const [k,r] of a){const target=b.get(k);if(!target){onlySource++;if(samples.length<12)samples.push({table:d.table,key:k,issue:'MISSING_IN_BIGQUERY'});continue;}
   const different=d.fields.filter(f=>norm(d,f,r[f])!==norm(d,f,target[f]));
   if(different.length){mismatch++;if(samples.length<12)samples.push({table:d.table,key:k,fields:different.slice(0,6),source:Object.fromEntries(different.slice(0,3).map(f=>[f,r[f]])),bigQuery:Object.fromEntries(different.slice(0,3).map(f=>[f,target[f]]))});}
  }
  for(const k of b.keys())if(!a.has(k))onlyBigQuery++;
  const ok=source.length===stored.length&&!duplicates&&!mismatch&&!onlySource&&!onlyBigQuery;
  report[d.table]={source:source.length,bigQuery:stored.length,duplicates,mismatch,onlySource,onlyBigQuery,status:ok?'PASS':'FAIL'};
  if(!ok)failed=true;
 }
 const integrity=(await query(`SELECT
 (SELECT COUNT(*) FROM (SELECT payment_id FROM ${T('sales_payment_headers')} GROUP BY 1 HAVING COUNT(*)>1)) AS duplicate_headers,
 (SELECT COUNT(*) FROM (SELECT payment_id,line_unique_key FROM ${T('sales_payment_lines')} GROUP BY 1,2 HAVING COUNT(*)>1)) AS duplicate_lines,
 (SELECT COUNT(*) FROM (SELECT payment_id,accounting_book_id,line_id,account_id FROM ${T('sales_payment_accounting_lines')} GROUP BY 1,2,3,4 HAVING COUNT(*)>1)) AS duplicate_gl,
 (SELECT COUNT(*) FROM (SELECT payment_id,invoice_id,payment_line_id,invoice_line_id FROM ${T('sales_payment_applications')} GROUP BY 1,2,3,4 HAVING COUNT(*)>1)) AS duplicate_applications,
 (SELECT COUNT(*) FROM ${T('sales_payment_lines')} l LEFT JOIN ${T('sales_payment_headers')} h USING(payment_id) WHERE h.payment_id IS NULL) AS orphan_lines,
 (SELECT COUNT(*) FROM ${T('sales_payment_accounting_lines')} l LEFT JOIN ${T('sales_payment_headers')} h USING(payment_id) WHERE h.payment_id IS NULL) AS orphan_gl,
 (SELECT COUNT(*) FROM ${T('sales_payment_applications')} l LEFT JOIN ${T('sales_payment_headers')} h USING(payment_id) WHERE h.payment_id IS NULL) AS orphan_applications`))[0];
 if(Object.values(integrity).some(x=>Number(x)!==0))failed=true;
 console.log(JSON.stringify({tables:report,integrity,samples},null,2));
 if(failed){console.error('SALES PAYMENT CHECK NEEDS_REVIEW (source may have changed since sync)');process.exitCode=3;return;}
 console.log('SALES PAYMENT CHECK PASS (four tables, exact decimal, unique keys and orphans)');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
```

### `modules/sales-payment/diagnose-financial.mjs`

**Reconstructed SHA-256:** `31c10861fe1ab105e1f776d7f3d64952d0067ecc1cf33c0ae07371eeb3b0faac`.

```javascript
// Sales Payment Phase B1.1: isolate GL vs header differences and verify applications.
// READ ONLY: does not touch BigQuery, checkpoints, deletion registry, or scheduler.
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { validateNumeric } from '../../common/decimal-precision.mjs';

const from = '2026-10-01';
const to = '2027-01-01';
const window = `t.trandate >= TO_DATE('${from}','YYYY-MM-DD') AND t.trandate < TO_DATE('${to}','YYYY-MM-DD')`;
const SCALE = 1000000000n;
function unit(value, id, field) {
  const s = validateNumeric(value, { module: 'sales-payment', recordId: id, field });
  if (s == null) return 0n;
  const minus = s[0] === '-';
  const [whole, frac = ''] = (minus ? s.slice(1) : s).split('.');
  const n = BigInt(whole) * SCALE + BigInt(frac.padEnd(9, '0'));
  return minus ? -n : n;
}
function fmt(value) {
  const abs = value < 0n ? -value : value;
  const frac = (abs % SCALE).toString().padStart(9,'0').replace(/0+$/,'');
  return `${value < 0n ? '-' : ''}${abs / SCALE}${frac ? '.' + frac : ''}`;
}
function add(map, key, value) { map.set(key, (map.get(key) ?? 0n) + value); }
const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
async function main() {
  console.log('SALES PAYMENT PHASE B1.1 — READ ONLY FINANCIAL VARIANCE DIAGNOSTIC');
  const access = await token();
  console.log('OAuth: SUCCESS');
  const headers = await fetchAll(access, `SELECT t.id AS payment_id, t.tranid AS document_number, t.total, t.foreigntotal, t.foreignpaymentamountused AS amount_used, t.foreignpaymentamountunused AS amount_unused, t.exchangerate, t.currency, t.status FROM Transaction t WHERE t.type='CustPymt' AND ${window} ORDER BY t.id`);
  if (!headers.length) throw new Error('No visible sales payments: abort');
  const byId = new Map(headers.map(x => [String(x.payment_id), x]));
  const gl = await fetchAll(access, `SELECT tal.transaction AS payment_id, tal.transactionline AS line_id, tal.accountingbook AS book_id, tal.account AS account_id, tal.posting, tal.debit, tal.credit FROM TransactionAccountingLine tal JOIN Transaction t ON t.id=tal.transaction WHERE t.type='CustPymt' AND ${window} ORDER BY tal.transaction, tal.accountingbook, tal.transactionline, tal.account`);
  const lines = await fetchAll(access, `SELECT tl.transaction AS payment_id, tl.id AS line_id, tl.mainline, tl.accountinglinetype, tl.foreignamount, tl.netamount FROM TransactionLine tl JOIN Transaction t ON t.id=tl.transaction WHERE t.type='CustPymt' AND ${window} ORDER BY tl.transaction, tl.id`);
  const links = await fetchAll(access, `SELECT p.nextdoc AS payment_id, p.nextline AS payment_line, p.previousdoc AS invoice_id, p.previousline AS invoice_line, p.linktype, p.previoustype, p.foreignamount AS applied_amount FROM PreviousTransactionLineLink p JOIN Transaction t ON t.id=p.nextdoc WHERE t.type='CustPymt' AND ${window} ORDER BY p.nextdoc, p.previousdoc, p.previousline, p.nextline`);
  console.log(`Counts: headers=${headers.length} transactionLines=${lines.length} GL=${gl.length} applicationLinks=${links.length}`);
  const glTotals = new Map(), glCounts = new Map(), glByBook = new Map(), totalsByBook = new Map();
  for (const g of gl) {
    const id = String(g.payment_id), book=String(g.book_id), key=`${id}|${book}`;
    if (!byId.has(id)) throw new Error(`Orphan GL ${id}`);
    count(glCounts,key); count(glByBook, book);
    const entry = glTotals.get(key) ?? { debit: 0n, credit: 0n };
    entry.debit += unit(g.debit,id,'gl_debit'); entry.credit += unit(g.credit,id,'gl_credit');
    glTotals.set(key,entry);
    const bt=totalsByBook.get(book) ?? {debit:0n,credit:0n};
    bt.debit += unit(g.debit,id,'gl_debit'); bt.credit += unit(g.credit,id,'gl_credit'); totalsByBook.set(book,bt);
  }
  const appById=new Map(), appCount=new Map();
  for (const a of links) {
    const id=String(a.payment_id);
    if(!byId.has(id)) throw new Error(`Orphan link ${id}`);
    add(appById,id,unit(a.applied_amount,id,'applied_amount'));
    count(appCount,id);
  }
  const lineCountById=new Map();
  for (const l of lines) {
    if(!byId.has(String(l.payment_id))) throw new Error(`Orphan line ${l.payment_id}`);
    count(lineCountById,String(l.payment_id));
    unit(l.foreignamount,l.payment_id,'line_foreignamount');
    unit(l.netamount,l.payment_id,'line_netamount');
  }
  let headerTotal=0n, headerUsed=0n, headerUnused=0n, applicationsTotal=0n;
  const anomalies=[]; const sampleLimit=25;
  const primaryBook='1';
  for (const h of headers) {
    const id=String(h.payment_id), total=unit(h.total,id,'total'), used=unit(h.amount_used,id,'amount_used'), unused=unit(h.amount_unused,id,'amount_unused'), application=appById.get(id)??0n;
    headerTotal+=total; headerUsed+=used; headerUnused+=unused; applicationsTotal+=application;
    const g=glTotals.get(`${id}|${primaryBook}`)??{debit:0n,credit:0n};
    const reasons=[];
    if(g.debit!==total || g.credit!==total) reasons.push('GL_VS_HEADER');
    if(g.debit!==g.credit) reasons.push('GL_UNBALANCED');
    if(application!==used) reasons.push('APPLICATION_VS_USED');
    if(used+unused!==unit(h.foreigntotal,id,'foreigntotal')) reasons.push('USED_PLUS_UNUSED_VS_FOREIGNTOTAL');
    if((lineCountById.get(id)??0)!==2) reasons.push('NONSTANDARD_TRANSACTION_LINES');
    if((glCounts.get(`${id}|${primaryBook}`)??0)!==2) reasons.push('NONSTANDARD_GL_LINE_COUNT');
    if(reasons.length) anomalies.push({id,doc:h.document_number,reasons,header:fmt(total),used:fmt(used),unused:fmt(unused),applications:fmt(application),glDebit:fmt(g.debit),glCredit:fmt(g.credit),glLines:glCounts.get(`${id}|${primaryBook}`)??0,applicationLines:appCount.get(id)??0});
  }
  console.log('\n=== TOTAL COMPARISON ===');
  console.log(JSON.stringify({headerTotal:fmt(headerTotal),headerUsed:fmt(headerUsed),headerUnused:fmt(headerUnused),applicationTotal:fmt(applicationsTotal),appMinusUsed:fmt(applicationsTotal-headerUsed),books:[...totalsByBook].map(([book,v])=>({book,glLineCount:glByBook.get(book),debit:fmt(v.debit),credit:fmt(v.credit),debitMinusHeader:fmt(v.debit-headerTotal),creditMinusHeader:fmt(v.credit-headerTotal)}))},null,2));
  console.log('\n=== ANOMALY SUMMARY ===');
  const reasonTotals={}; for(const a of anomalies)for(const r of a.reasons)reasonTotals[r]=(reasonTotals[r]??0)+1;
  console.log(JSON.stringify({anomalyPayments:anomalies.length,reasons:reasonTotals,first:anomalies.slice(0,sampleLimit)},null,2));
  const anomalousIds=new Set(anomalies.map(a=>a.id));
  console.log('\n=== GL DETAIL FOR ANOMALOUS PAYMENTS (up to 25 payments) ===');
  const selected=new Set(anomalies.slice(0,sampleLimit).map(a=>a.id));
  console.log(JSON.stringify(gl.filter(g=>selected.has(String(g.payment_id))),null,2));
  console.log('\n=== CONCLUSION ===');
  console.log('Source-only investigation complete; GL sums are NOT expected to equal payment header amounts unless accounting structure proves that invariant. No BigQuery or deletion changes.');
  console.log('Output is diagnostic, not mapping certification.');
}
main().catch(error=>{console.error('DIAGNOSTIC FAILED:',error.stack??error);process.exitCode=1;});
```

### `modules/sales-payment/mapping.mjs`

**Reconstructed SHA-256:** `97ace1d1a6a2fdd5b110900d3fb8a362d18c738f1767cca55ead98db08b542f5`.

```javascript
// Module 9: Customer Payment mapping. Uses the existing read-only SuiteQL client.
// No BigQuery writes or mutation of existing modules.
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { validateNumeric } from '../../common/decimal-precision.mjs';
export { token };
export const TYPE='CustPymt', FROM='2026-10-01', TO='2027-01-01';
const period=`t.type='${TYPE}' AND t.trandate>=TO_DATE('${FROM}','YYYY-MM-DD') AND t.trandate<TO_DATE('${TO}','YYYY-MM-DD')`;
const id=x=>{ const s=String(x??''); if(!/^[1-9]\d*$/.test(s)||!Number.isSafeInteger(Number(s))) throw Error(`Invalid NetSuite ID ${s}`);return s;};
const txt=x=>x==null?null:String(x);
const bool=x=>String(x??'F').toUpperCase()==='T';
const val=(x,i,f)=>validateNumeric(x,{module:'sales-payment',recordId:i,field:f});
const SCALE=1000000000n;
const unit=(x,i,f)=>{ const s=val(x,i,f); if(s==null)return 0n; const neg=s.startsWith('-'); const [a,b='']=(neg?s.slice(1):s).split('.'); const n=BigInt(a)*SCALE+BigInt(b.padEnd(9,'0')); return neg?-n:n;};
async function batch(access,ids,build){const out=[];for(let k=0;k<ids.length;k+=25)out.push(...await fetchAll(access,build(ids.slice(k,k+25).map(id).join(','))));return out;}
export async function fetchHeaders(access,since=null){if(since!=null&&!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(since))throw Error('Invalid incremental watermark');const extra=since?` AND t.lastmodifieddate>=TO_DATE('${since}','YYYY-MM-DD HH24:MI:SS')`:'';return fetchAll(access,`SELECT t.id AS payment_id,t.tranid AS document_number,TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,t.status AS status_id,t.entity AS customer_id,BUILTIN.DF(t.entity) AS customer_name,t.currency AS currency_id,BUILTIN.DF(t.currency) AS currency_name,t.exchangerate,t.foreigntotal,t.total,t.foreignpaymentamountused AS amount_used,t.foreignpaymentamountunused AS amount_unused,t.postingperiod AS posting_period_id,t.subsidiary AS subsidiary_id,t.void,t.voided FROM Transaction t WHERE ${period}${extra} ORDER BY t.id`);}
export async function fetchLines(access,ids){return batch(access,ids,s=>`SELECT transaction AS payment_id,id AS line_id,uniquekey AS line_unique_key,linesequencenumber AS line_number,mainline,taxline,iscogs,accountinglinetype,foreignamount,netamount,expenseaccount AS account_id FROM TransactionLine WHERE transaction IN (${s}) ORDER BY transaction,id`);}
export async function fetchGL(access,ids){return batch(access,ids,s=>`SELECT transaction AS payment_id,transactionline AS line_id,accountingbook AS book_id,account AS account_id,posting,debit,credit FROM TransactionAccountingLine WHERE transaction IN (${s}) ORDER BY transaction,accountingbook,transactionline,account`);}
export async function fetchApplications(access,ids){return batch(access,ids,s=>`SELECT nextdoc AS payment_id,nextline AS payment_line_id,previousdoc AS invoice_id,previousline AS invoice_line_id,linktype AS link_type,previoustype AS previous_type,foreignamount AS applied_amount,discount,lastmodifieddate FROM PreviousTransactionLineLink WHERE nextdoc IN (${s}) AND linktype='Payment' ORDER BY nextdoc,previousdoc,previousline,nextline`);}
export function mapSource(headers,lines,gl,applications){
 const result={headers:[],transactionLines:[],accountingLines:[],applications:[]}, ids=new Map(), lineCount=new Map(), mainCount=new Map(), lineBalance=new Map(), glBook=new Map(), applied=new Map(), appCount=new Map(), keys={line:new Set(),gl:new Set(),app:new Set()};
 for(const h of headers){const p=id(h.payment_id);if(ids.has(p))throw Error('Duplicate payment '+p);if(!/^\d{4}-\d\d-\d\d$/.test(h.transaction_date??'')||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(h.last_modified??''))throw Error('Invalid payment dates '+p);const r={payment_id:p,document_number:txt(h.document_number),transaction_date:h.transaction_date,last_modified:h.last_modified,status_id:txt(h.status_id),customer_id:txt(h.customer_id),customer_name:txt(h.customer_name),currency_id:txt(h.currency_id),currency_name:txt(h.currency_name),exchange_rate:val(h.exchangerate,p,'exchange_rate'),foreign_total:val(h.foreigntotal,p,'foreign_total'),base_total:val(h.total,p,'base_total'),amount_used:val(h.amount_used,p,'amount_used'),amount_unused:val(h.amount_unused,p,'amount_unused'),posting_period_id:txt(h.posting_period_id),subsidiary_id:txt(h.subsidiary_id),is_void:bool(h.void)||bool(h.voided)};for(const f of ['foreign_total','base_total','amount_used','amount_unused','exchange_rate'])if(r[f]==null)throw Error(`Missing ${f} for ${p}`);if(unit(r.amount_used,p,'amount_used')+unit(r.amount_unused,p,'amount_unused')!==unit(r.foreign_total,p,'foreign_total'))throw Error('Used + unused mismatch '+p);ids.set(p,r);result.headers.push(r);}
 const has=p=>{if(!ids.has(p))throw Error('Orphan payment detail '+p);};
 for(const l of lines){const p=id(l.payment_id);has(p);const u=id(l.line_unique_key),key=p+':'+u;if(keys.line.has(key))throw Error('Duplicate transaction line '+key);keys.line.add(key);lineCount.set(p,(lineCount.get(p)||0)+1);if(bool(l.mainline))mainCount.set(p,(mainCount.get(p)||0)+1);if(bool(l.iscogs))throw Error('Unexpected COGS '+p);lineBalance.set(p,(lineBalance.get(p)||0n)+unit(l.foreignamount,p,'line_foreignamount'));result.transactionLines.push({payment_id:p,line_unique_key:u,line_id:txt(l.line_id),line_number:txt(l.line_number),is_mainline:bool(l.mainline),is_tax_line:bool(l.taxline),accounting_line_type:txt(l.accountinglinetype),account_id:txt(l.account_id),foreign_amount:val(l.foreignamount,p,'line_foreignamount'),net_amount:val(l.netamount,p,'line_netamount')});}
 for(const g of gl){const p=id(g.payment_id);has(p);const b=id(g.book_id),key=[p,b,txt(g.line_id),txt(g.account_id)].join(':');if(keys.gl.has(key))throw Error('Duplicate GL identity '+key);keys.gl.add(key);const deb=unit(g.debit,p,'debit'),cre=unit(g.credit,p,'credit');const group=p+':'+b, agg=glBook.get(group)||{debit:0n,credit:0n,count:0};agg.debit+=deb;agg.credit+=cre;agg.count++;glBook.set(group,agg);result.accountingLines.push({payment_id:p,accounting_book_id:b,line_id:txt(g.line_id),account_id:txt(g.account_id),posting:bool(g.posting),debit:val(g.debit,p,'debit'),credit:val(g.credit,p,'credit')});}
 for(const a of applications){const p=id(a.payment_id);has(p);if(a.link_type!=='Payment'||a.previous_type!=='CustInvc')throw Error('Unexpected application type for '+p);const invoice=id(a.invoice_id),key=[p,invoice,txt(a.payment_line_id),txt(a.invoice_line_id)].join(':');if(keys.app.has(key))throw Error('Duplicate application identity '+key);keys.app.add(key);const amount=val(a.applied_amount,p,'applied_amount');if(amount==null)throw Error('Missing applied amount '+key);applied.set(p,(applied.get(p)||0n)+unit(amount,p,'applied_amount'));appCount.set(p,(appCount.get(p)||0)+1);result.applications.push({payment_id:p,invoice_id:invoice,payment_line_id:txt(a.payment_line_id),invoice_line_id:txt(a.invoice_line_id),link_type:'Payment',applied_amount:amount});}
 for(const [p,h] of ids){if((mainCount.get(p)||0)!==1||(lineCount.get(p)||0)<2)throw Error('Payment line grain mismatch '+p);if(lineBalance.get(p)!==0n)throw Error('Transaction lines unbalanced '+p);if((applied.get(p)||0n)!==unit(h.amount_used,p,'amount_used'))throw Error('Application mismatch '+p);if((appCount.get(p)||0)===0&&unit(h.amount_used,p,'amount_used')!==0n)throw Error('Missing applications '+p);const primary=glBook.get(p+':1');if(!primary)throw Error('Missing primary book '+p);if(primary.debit!==primary.credit)throw Error('GL not balanced '+p);if(!h.is_void && (primary.debit!==unit(h.base_total,p,'base_total')||primary.credit!==unit(h.base_total,p,'base_total')))throw Error('Primary GL versus header mismatch '+p);}
 result.counts={headers:result.headers.length,transaction_lines:result.transactionLines.length,accounting_lines:result.accountingLines.length,applications:result.applications.length};return result;
}
```

### `modules/sales-payment/presence.mjs`

**Reconstructed SHA-256:** `458d6a79695c1a12899a13a2301fbec2b94c04837aa7843edc34c3e4b6d902ce`.

```javascript
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,FROM,TO} from './mapping.mjs';

async function main(){
 console.log('SALES PAYMENT PRESENCE | OCT-DEC 2026 | READ ONLY');
 const source=await fetchHeaders(await token());
 const ns=new Set(source.map(x=>String(x.payment_id)));
 const rows=await query(`SELECT payment_id FROM ${T('sales_payment_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 const bq=new Set(rows.map(x=>String(x.payment_id)));
 const onlyNetSuite=[...ns].filter(x=>!bq.has(x));
 const onlyBigQuery=[...bq].filter(x=>!ns.has(x));
 const deletionInventory=process.argv.includes('--deletion-inventory');
 const report={source:source.length,bigQuery:rows.length,sourceDuplicates:source.length-ns.size,bigQueryDuplicates:rows.length-bq.size,onlyNetSuite:deletionInventory?onlyNetSuite:onlyNetSuite.slice(0,30),onlyBigQuery:deletionInventory?onlyBigQuery:onlyBigQuery.slice(0,30),onlyNetSuiteCount:onlyNetSuite.length,onlyBigQueryCount:onlyBigQuery.length};
 console.log(JSON.stringify(report,null,2));
 if(!source.length||report.sourceDuplicates||report.bigQueryDuplicates||onlyNetSuite.length||onlyBigQuery.length){console.error('SALES PAYMENT PRESENCE NEEDS_REVIEW - possible source movement; rerun dry-run/sync before certification');process.exitCode=3;return;}
 console.log('SALES PAYMENT PRESENCE PASS');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
```

### `modules/sales-payment/probe-deletion-identity.mjs`

**Reconstructed SHA-256:** `51d820364fca09a002b51cc118d881cbbc0594eee6f3098e8f00eda10f21341e`.

```javascript
// Phase B5: independent, read-only deletedrecord identity discovery.
// No BigQuery access, no soft deletes, no registry changes, no checkpoints.
import { token, fetchAll } from '../../common/netsuite-client.mjs';

const candidate = 'customerpayment'; // DISCOVERY FILTER ONLY: not a certified deletion registry entry.
const limit = 40;
const printable = (r) => ({
  recordid: String(r.recordid ?? ''),
  recordtypeid: String(r.recordtypeid ?? ''),
  type: String(r.type ?? ''),
  name: String(r.name ?? ''),
  deleteddate: String(r.deleteddate ?? ''),
  deletedby: String(r.deletedby ?? ''),
  context: String(r.context ?? '')
});
const isPaymentProof = (r, type) =>
  String(r.recordtypeid ?? '').toLowerCase() === candidate &&
  String(r.type ?? '').toUpperCase() === type &&
  Boolean(r.deleteddate);
const safeId = x => /^[1-9]\d{0,14}$/.test(String(x));

console.log('SALES PAYMENT B5 | DELETEDRECORD IDENTITY DISCOVERY | READ ONLY');
console.log('No BigQuery, checkpoint, scheduler, registry, or deletion mutations.');
try {
  const access = await token();
  console.log('OAuth: SUCCESS');
  // Both queries are bounded, each has native server-side filters.
  const queries = [
    ['EXACT RECORDTYPEID CANDIDATE', `SELECT recordid, recordtypeid, type, name, deleteddate, deletedby, context FROM deletedrecord WHERE LOWER(recordtypeid) = '${candidate}' AND ROWNUM <= ${limit}`],
    ['PAYMENT NAME DISCOVERY', `SELECT recordid, recordtypeid, type, name, deleteddate, deletedby, context FROM deletedrecord WHERE LOWER(name) LIKE '%payment%' AND ROWNUM <= ${limit}`]
  ];
  const unique = new Map();
  let queryFailures = 0;
  for (const [label, sql] of queries) {
    console.log(`\n=== ${label} ===`);
    try {
      const rows = await fetchAll(access, sql);
      console.log(`Rows=${rows.length}; bounded_limit=${limit}`);
      console.log(JSON.stringify(rows.slice(0, 20).map(printable), null, 2));
      for (const row of rows) {
        if (!safeId(row.recordid)) continue;
        unique.set(`${row.recordid}\u001f${row.recordtypeid}\u001f${row.type}`, row);
      }
    } catch (err) {
      queryFailures++;
      console.log(`QUERY BLOCKED: ${err.message}`);
    }
  }
  console.log('\n=== EXACT TYPE DISTRIBUTION FOR CANDIDATE RECORDTYPEID ===');
  const matches = [...unique.values()].filter(x => String(x.recordtypeid).toLowerCase() === candidate);
  const types = [...new Set(matches.map(x => String(x.type).toUpperCase()))];
  console.log(JSON.stringify({candidateRecordtypeid:candidate, types, records:matches.length, queryFailures}, null, 2));
  console.log('\n=== INDEPENDENT POSITIVE PROOF / SOURCE ABSENCE ===');
  let positive = 0;
  for (const r of matches.slice(0, 8)) {
    const id = String(r.recordid);
    const reProof = await fetchAll(access, `SELECT recordid, recordtypeid, type, name, deleteddate FROM deletedrecord WHERE recordid = ${id}`);
    const matchingProof = reProof.filter(x => String(x.recordid) === id && isPaymentProof(x, String(r.type).toUpperCase()));
    const strict = matchingProof.length === 1;
    const visible = await fetchAll(access, `SELECT id, type FROM Transaction WHERE id = ${id}`);
    if (strict && visible.length === 0) positive++;
    console.log(JSON.stringify({id,expectedType:String(r.type),deletedrecordRows:reProof.length,matchingProofRows:matchingProof.length,collisionRows:reProof.length-matchingProof.length,strictProof:strict,sourceVisible:visible.length,positive:strict && !visible.length,otherRecordTypes:reProof.filter(x=>!isPaymentProof(x,String(r.type).toUpperCase())).map(x=>({recordtypeid:x.recordtypeid,type:x.type}))}));
  }
  console.log('\n=== NEGATIVE GUARD: KNOWN VISIBLE CUSTOMER PAYMENT ===');
  const live = await fetchAll(access, `SELECT id, type FROM Transaction WHERE type = 'CustPymt' AND ROWNUM <= 1`);
  if (live.length !== 1 || !safeId(live[0].id)) throw Error('Cannot establish live negative control');
  const liveId = String(live[0].id);
  const collision = await fetchAll(access, `SELECT recordid, recordtypeid, type, deleteddate FROM deletedrecord WHERE recordid = ${liveId}`);
  const knownType = types.length === 1 ? types[0] : null;
  const negativePass = !knownType || !collision.some(x => isPaymentProof(x,knownType));
  console.log(JSON.stringify({livePaymentId:liveId,liveTransactionType:live[0].type,deletedrecordRows:collision.map(printable),candidateType:knownType,negativeGuardPass:negativePass},null,2));
  if (!negativePass) throw Error('Negative guard failed: visible customer payment has matching deletion proof');
  console.log('\n=== PHASE B5 RESULT ===');
  console.log(JSON.stringify({queryFailures,candidateTypes:types,positiveProven:positive,negativeGuardPass:true,registryEligible:queryFailures===0 && types.length===1 && positive>0},null,2));
  if (queryFailures || types.length !== 1 || !positive) {
    console.log('IDENTITY NOT CERTIFIED: no registry changes. Additional independent evidence required.');
    process.exitCode = 3;
  } else {
    console.log('IDENTITY EVIDENCE PASS; follow-up offline regression and controlled registry integration still required.');
  }
} catch (err) {
  console.error('B5 BLOCKED:',err.message);
  process.exitCode = 2;
}
```

### `modules/sales-payment/probe.mjs`

**Reconstructed SHA-256:** `4a96acf754b714fde14db292f974e01df6207635b239ee3e5fcd0686e5b6ef0b`.

```javascript
// Module 9 Sales Payment / Customer Payment source discovery.
// READ ONLY: no BigQuery, no DDL/DML, no checkpoints, no deletion apply.
// Candidate NetSuite Transaction.type = CustPymt; this probe must prove it in the live account.
import { token, fetchAll, suiteql } from '../../common/netsuite-client.mjs';
import { validateNumeric } from '../../common/decimal-precision.mjs';

const TYPE = 'CustPymt';
const RANGE_FROM = '2026-10-01';
const RANGE_TO = '2027-01-01';
const MONTHS = [
  ['2026-10', '2026-10-01', '2026-11-01'],
  ['2026-11', '2026-11-01', '2026-12-01'],
  ['2026-12', '2026-12-01', '2027-01-01']
];

const failures = { required: 0, optional: 0 };
const validId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const inList = ids => ids.filter(validId).map(Number).join(',');

function dateFilter(alias, from, to) {
  return `${alias}.trandate >= TO_DATE('${from}','YYYY-MM-DD') ` +
    `AND ${alias}.trandate < TO_DATE('${to}','YYYY-MM-DD')`;
}

async function query(access, label, sql, { required = true, sample = 12 } = {}) {
  console.log(`\n=== ${label} ===`);
  try {
    const rows = await fetchAll(access, sql);
    console.log('Rows:', rows.length);
    console.log('Sample:', JSON.stringify(rows.slice(0, sample), null, 2));
    return rows;
  } catch (error) {
    failures[required ? 'required' : 'optional']++;
    console.error(`${required ? 'QUERY FAILED' : 'OPTIONAL QUERY FAILED'}:`, error.message);
    return null;
  }
}

async function page(access, label, sql, { required = false, limit = 10 } = {}) {
  console.log(`\n=== ${label} ===`);
  try {
    const result = await suiteql(access, sql, limit, 0);
    const rows = result.items ?? [];
    console.log('Rows returned:', rows.length, '| hasMore:', Boolean(result.hasMore));
    console.log('Sample:', JSON.stringify(rows, null, 2));
    return rows;
  } catch (error) {
    failures[required ? 'required' : 'optional']++;
    console.error(`${required ? 'QUERY FAILED' : 'OPTIONAL QUERY FAILED'}:`, error.message);
    return null;
  }
}

function precision(value, context) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  let numericStatus = 'NUMERIC_OK';
  let numericValue = null;
  try {
    numericValue = validateNumeric(raw, context);
  } catch (error) {
    numericStatus = `NUMERIC_REJECT: ${error.message}`;
  }
  return { raw, numericStatus, numericValue };
}

function reportPrecision(label, rows, fields, idField = 'internal_id') {
  console.log(`\n=== DECIMAL PRECISION: ${label} ===`);
  if (!rows?.length) {
    console.log('No rows available for precision inspection.');
    return;
  }

  const report = [];
  for (const row of rows) {
    const recordId = row[idField] ?? row.transaction ?? row.transaction_id ?? 'unknown';
    for (const field of fields) {
      if (!(field in row)) continue;
      const result = precision(row[field], { module: 'sales-payment', recordId, field });
      if (result) report.push({ recordId: String(recordId), field, ...result });
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

function collectRelatedIds(linkSets, paymentIds) {
  const payment = new Set(paymentIds.map(String));
  const related = new Set();
  for (const rows of linkSets) {
    for (const row of rows ?? []) {
      for (const key of ['previousdoc', 'nextdoc']) {
        const value = row[key];
        if (validId(value) && !payment.has(String(value))) related.add(String(value));
      }
    }
  }
  return [...related].slice(0, 50);
}

console.log('NETSUITE BACKUP - MODULE 9 SALES PAYMENT SOURCE DISCOVERY');
console.log(`Candidate type: ${TYPE}`);
console.log(`KPI window: ${RANGE_FROM} .. ${RANGE_TO} (exclusive end)`);
console.log('MODE: LIVE READ-ONLY | NO BIGQUERY | NO CHECKPOINT | NO DELETION APPLY');

try {
  const access = await token();
  console.log('\nOAuth: SUCCESS');

  const octoberTypes = await query(
    access,
    'OCTOBER TRANSACTION TYPE INVENTORY',
    `SELECT t.type, COUNT(*) AS transaction_count ` +
      `FROM Transaction t ` +
      `WHERE ${dateFilter('t', '2026-10-01', '2026-11-01')} ` +
      `GROUP BY t.type ORDER BY t.type`,
    { required: true, sample: 200 }
  );

  const monthly = [];
  for (const [month, from, to] of MONTHS) {
    const rows = await query(
      access,
      `MONTHLY KPI ${month} - RAW NETSUITE TOTALS`,
      `SELECT COUNT(*) AS transaction_count, ` +
        `SUM(t.foreigntotal) AS foreign_total_sum, ` +
        `SUM(t.total) AS total_sum ` +
        `FROM Transaction t ` +
        `WHERE t.type='${TYPE}' AND ${dateFilter('t', from, to)}`,
      { required: true, sample: 5 }
    );
    monthly.push({ month, rows });
  }

  const headers = await query(
    access,
    'OCT-DEC CUSTOMER PAYMENT HEADERS',
    `SELECT t.id AS internal_id, t.type, t.tranid AS document_number, ` +
      `TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date, ` +
      `TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified, ` +
      `t.status AS status_id, t.entity AS customer_id, ` +
      `t.currency AS currency_id, ` +
      `t.exchangerate, t.foreigntotal, t.total ` +
      `FROM Transaction t ` +
      `WHERE t.type='${TYPE}' AND ${dateFilter('t', RANGE_FROM, RANGE_TO)} ` +
      `ORDER BY t.trandate, t.id`,
    { required: true, sample: 15 }
  );

  let workingHeaders = headers ?? [];
  if (!workingHeaders.length) {
    console.warn('\nNo Oct-Dec CustPymt rows accessible. Running historical fallback to prove type/shape only.');
    const historical = await query(
      access,
      'HISTORICAL CUSTPYMT FALLBACK - LATEST ACCESSIBLE ROWS',
      `SELECT t.id AS internal_id, t.type, t.tranid AS document_number, ` +
        `TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date, ` +
        `TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified, ` +
        `t.status AS status_id, t.entity AS customer_id, ` +
        `t.currency AS currency_id, ` +
        `t.exchangerate, t.foreigntotal, t.total ` +
        `FROM Transaction t WHERE t.type='${TYPE}' ` +
        `ORDER BY t.trandate DESC, t.id DESC`,
      { required: true, sample: 15 }
    );
    workingHeaders = historical ?? [];
  }

  const candidateVisible = (octoberTypes ?? []).some(row => String(row.type) === TYPE) || workingHeaders.length > 0;
  console.log(`\nTYPE EVIDENCE ${TYPE}:`, candidateVisible ? 'VISIBLE/CONFIRMED CANDIDATE' : 'NOT YET PROVEN');

  reportPrecision('HEADER FINANCIALS', workingHeaders.slice(0, 20), [
    'exchangerate', 'foreigntotal', 'total'
  ]);

  if (workingHeaders.length) {
    const displayIds = inList(workingHeaders.map(row => row.internal_id).slice(0, 12));
    if (displayIds) {
      await query(
        access,
        'PAYMENT DISPLAY FIELDS / CUSTOMER-CURRENCY PERMISSION CHECK',
        `SELECT t.id AS internal_id, BUILTIN.DF(t.status) AS status, ` +
          `BUILTIN.DF(t.entity) AS customer_name, BUILTIN.DF(t.currency) AS currency_name ` +
          `FROM Transaction t WHERE t.id IN (${displayIds}) ORDER BY t.id`,
        { required: false, sample: 20 }
      );
    }
  }

  const sampleIds = [...new Set(workingHeaders.map(row => String(row.internal_id)))]
    .filter(validId)
    .slice(0, 6);

  if (!sampleIds.length) {
    console.warn('\nNo accessible payment IDs for structural discovery. Do not create schema/mapping from assumptions.');
  } else {
    const selected = inList(sampleIds);
    const firstId = Number(sampleIds[0]);

    await page(
      access,
      `RAW TRANSACTION * FOR PAYMENT ${firstId}`,
      `SELECT * FROM Transaction WHERE id=${firstId}`,
      { required: false, limit: 3 }
    );

    const lines = await query(
      access,
      'PAYMENT TRANSACTION LINES - KNOWN BASELINE FIELDS',
      `SELECT transaction, id AS line_id, uniquekey AS line_unique_key, ` +
        `linesequencenumber AS line_number, item, quantity, rate, ` +
        `foreignamount, netamount, mainline, taxline, iscogs, ` +
        `accountinglinetype, location ` +
        `FROM TransactionLine WHERE transaction IN (${selected}) ` +
        `ORDER BY transaction,id`,
      { required: true, sample: 80 }
    );

    await page(
      access,
      `RAW TRANSACTIONLINE * FOR PAYMENT ${firstId}`,
      `SELECT * FROM TransactionLine WHERE transaction=${firstId}`,
      { required: false, limit: 20 }
    );

    const accounting = await query(
      access,
      'PAYMENT ACCOUNTING LINES',
      `SELECT transaction, transactionline, accountingbook, account, ` +
        `debit, credit, posting ` +
        `FROM TransactionAccountingLine WHERE transaction IN (${selected}) ` +
        `ORDER BY transaction, transactionline, account`,
      { required: true, sample: 100 }
    );

    reportPrecision('TRANSACTION LINES', lines, [
      'quantity', 'rate', 'foreignamount', 'netamount'
    ], 'transaction');
    reportPrecision('ACCOUNTING LINES', accounting, [
      'debit', 'credit'
    ], 'transaction');

    const previousAsNext = await query(
      access,
      'PREVIOUSTRANSACTIONLINELINK - PAYMENT AS NEXTDOC',
      `SELECT previousdoc,nextdoc,linktype FROM PreviousTransactionLineLink ` +
        `WHERE nextdoc IN (${selected})`,
      { required: true, sample: 100 }
    );

    const previousAsPrevious = await query(
      access,
      'PREVIOUSTRANSACTIONLINELINK - PAYMENT AS PREVIOUSDOC',
      `SELECT previousdoc,nextdoc,linktype FROM PreviousTransactionLineLink ` +
        `WHERE previousdoc IN (${selected})`,
      { required: false, sample: 100 }
    );

    const nextAsPrevious = await query(
      access,
      'NEXTTRANSACTIONLINELINK - PAYMENT AS PREVIOUSDOC',
      `SELECT previousdoc,nextdoc,linktype FROM NextTransactionLineLink ` +
        `WHERE previousdoc IN (${selected})`,
      { required: true, sample: 100 }
    );

    const nextAsNext = await query(
      access,
      'NEXTTRANSACTIONLINELINK - PAYMENT AS NEXTDOC',
      `SELECT previousdoc,nextdoc,linktype FROM NextTransactionLineLink ` +
        `WHERE nextdoc IN (${selected})`,
      { required: false, sample: 100 }
    );

    await page(
      access,
      `RAW PREVIOUS LINK * FOR PAYMENT ${firstId} AS NEXTDOC`,
      `SELECT * FROM PreviousTransactionLineLink WHERE nextdoc=${firstId}`,
      { required: false, limit: 20 }
    );

    await page(
      access,
      `RAW NEXT LINK * FOR PAYMENT ${firstId} AS PREVIOUSDOC`,
      `SELECT * FROM NextTransactionLineLink WHERE previousdoc=${firstId}`,
      { required: false, limit: 20 }
    );

    const relatedIds = collectRelatedIds(
      [previousAsNext, previousAsPrevious, nextAsPrevious, nextAsNext],
      sampleIds
    );

    if (relatedIds.length) {
      await query(
        access,
        'RELATED TRANSACTION HEADERS FROM PAYMENT LINKS',
        `SELECT t.id AS internal_id,t.type,t.tranid AS document_number,` +
          `TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,` +
          `t.status AS status_id,BUILTIN.DF(t.status) AS status,` +
          `t.entity AS entity_id,t.currency AS currency_id,` +
          `t.exchangerate,t.foreigntotal,t.total ` +
          `FROM Transaction t WHERE t.id IN (${inList(relatedIds)}) ` +
          `ORDER BY t.type,t.id`,
        { required: true, sample: 100 }
      );
    } else {
      console.warn('\nNo related transaction IDs discovered from tested link directions. Allocation model remains unresolved.');
    }
  }

  console.log('\n=== PHASE A RESULT ===');
  console.log('Required query failures:', failures.required);
  console.log('Optional discovery failures:', failures.optional);
  console.log('No BigQuery writes, DDL, checkpoints, deletion registry, or scheduler files were touched.');
  console.log('Do NOT build Sales Payment schema until this output proves source totals, line/accounting model, links, and decimal policy.');

  if (failures.required > 0) {
    console.error('PHASE A NEEDS REVIEW: one or more required source queries failed.');
    process.exitCode = 1;
  } else if (!workingHeaders.length) {
    console.warn('PHASE A SOURCE NOT PROVEN: no accessible CustPymt sample rows.');
    process.exitCode = 2;
  } else {
    console.log('PHASE A SOURCE DISCOVERY PASS: live CustPymt sample available for review; mapping is NOT certified yet.');
    process.exitCode = 0;
  }
} catch (error) {
  console.error('SALES PAYMENT PROBE FATAL:', error.stack ?? error);
  process.exitCode = 1;
}
```

### `modules/sales-payment/sync.mjs`

**Reconstructed SHA-256:** `aafd5b78a220a802ec9a21ce2362852705a6cd4cf79d416e82e243cb199cdf9c`.

```javascript
import { validateNumericRows } from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {dataset, DATASET, LOCATION, T, query} from '../../common/bigquery-client.mjs';
import {token, fetchHeaders, fetchLines, fetchGL, fetchApplications, mapSource} from './mapping.mjs';

const DRY_RUN=process.argv.includes('--dry-run');
const SYNC=process.argv.includes('--sync');
if(DRY_RUN===SYNC)throw Error('Specify exactly one: --dry-run OR --sync');
const C='sync_checkpoints';
const groups=[
 {table:'sales_payment_headers',fields:[['payment_id','STRING'],['document_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],['status_id','STRING'],['customer_id','STRING'],['customer_name','STRING'],['currency_id','STRING'],['currency_name','STRING'],['exchange_rate','NUMERIC'],['foreign_total','NUMERIC'],['base_total','NUMERIC'],['amount_used','NUMERIC'],['amount_unused','NUMERIC'],['posting_period_id','STRING'],['subsidiary_id','STRING'],['is_void','BOOL']],source:'headers',key:['payment_id']},
 {table:'sales_payment_lines',fields:[['payment_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],['line_number','STRING'],['is_mainline','BOOL'],['is_tax_line','BOOL'],['accounting_line_type','STRING'],['account_id','STRING'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC']],source:'transactionLines',key:['payment_id','line_unique_key']},
 {table:'sales_payment_accounting_lines',fields:[['payment_id','STRING'],['accounting_book_id','STRING'],['line_id','STRING'],['account_id','STRING'],['posting','BOOL'],['debit','NUMERIC'],['credit','NUMERIC']],source:'accountingLines',key:['payment_id','accounting_book_id','line_id','account_id']},
 {table:'sales_payment_applications',fields:[['payment_id','STRING'],['invoice_id','STRING'],['payment_line_id','STRING'],['invoice_line_id','STRING'],['link_type','STRING'],['applied_amount','NUMERIC']],source:'applications',key:['payment_id','invoice_id','payment_line_id','invoice_line_id']}
];
const names=groups.map(x=>x.table);
const cols=g=>g.fields.map(([name])=>name);
const cpList=names.map(x=>`'${x}'`).join(',');
const yes=id=>/^\d+$/.test(String(id)) && Number.isSafeInteger(Number(id));
function overlap(date){const d=new Date(date.replace(' ','T')+'Z');if(Number.isNaN(+d))throw Error('Invalid checkpoint date '+date);return new Date(+d-300000).toISOString().slice(0,19).replace('T',' ');}
async function checkpoints(){return query(`SELECT record_type, FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS modified FROM ${T(C)} WHERE record_type IN (${cpList})`);}
// Same bounded conflict strategy as purchase-order. Never retry unknown commit outcomes.
const RETRY_DELAYS_MS = [1500, 3500, 7000];
function isCheckpointConflict(error){
 const message=String(error?.message??error);
 return /transaction is aborted due to concurrent update against table/i.test(message)
   && /netsuite_backup[.:]sync_checkpoints/i.test(message);
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function atomicCommitWithGuard(sql,params,originalCheckpoint){
 for(let attempt=0;;attempt++){
  try{return await query(sql,params);}
  catch(error){
   if(!isCheckpointConflict(error) || attempt>=RETRY_DELAYS_MS.length)throw error;
   // BigQuery explicitly aborted the full transaction. Confirm all four PI checkpoints
   // are still at the original watermark before replaying the same staged data.
   const latest=await checkpoints();
   if(latest.length!==(originalCheckpoint?4:0)
     || new Set(latest.map(row=>row.record_type)).size!==latest.length
     || latest.some(row=>!names.includes(row.record_type) || row.modified!==originalCheckpoint)){
    throw new Error(`Sales Payment checkpoint changed after aborted transaction (before=${originalCheckpoint??'INITIAL'}). Refusing replay; run fresh --dry-run and --sync.`,{cause:error});
   }
   const wait=RETRY_DELAYS_MS[attempt];
   console.warn(`Sales Payment checkpoint write conflict; transaction aborted. Retry ${attempt+1}/${RETRY_DELAYS_MS.length} after ${wait}ms (staging retained).`);
   await sleep(wait);
  }
 }
}
async function ensureTables(){
 const [ok]=await dataset.table(C).exists();if(!ok)throw Error('Shared checkpoint table missing; refusing to create');
 for(const g of groups){
  const defs=g.fields.map(([k,t])=>`${k} ${t}${g.key.includes(k)?' NOT NULL':''}`).join(',');
  const extra=g===groups[0]?',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP':',synced_at TIMESTAMP';
  const partition=g===groups[0]?' PARTITION BY transaction_date':'';
  const cluster=g===groups[0]?' CLUSTER BY payment_id':` CLUSTER BY ${g.key.slice(0,4).join(',')}`;
  await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${defs}${extra})${partition}${cluster}`);
 }
}
async function stage(name,rows,fields){
 validateNumericRows(rows, fields, { module: 'sales-payment' });
 if(!rows.length){await query(`CREATE TABLE ${T(name)} AS SELECT ${fields.map(([k,t])=>`CAST(NULL AS ${t}) AS ${k}`).join(',')} FROM UNNEST([1]) AS dummy WHERE FALSE`);return;}
 const filename=path.join(os.tmpdir(),`netsuite-sp-${crypto.randomUUID()}.ndjson`);
 await fs.writeFile(filename,rows.map(x=>JSON.stringify(x)).join('\n')+'\n',{mode:0o600});
 try{await dataset.table(name).load(filename,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:fields.map(([name,type])=>({name,type}))},location:LOCATION});}
 finally{await fs.rm(filename,{force:true});}
 const [v]=await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);if(Number(v.n)!==rows.length)throw Error('Stage count mismatch '+name);
}
async function main(){
 console.log(`SALES PAYMENT | ${DRY_RUN?'DRY RUN':'PRODUCTION SYNC'} | ${DATASET} | ${LOCATION}`);
 const [hasCP]=await dataset.table(C).exists();if(!hasCP)throw Error('Shared sync_checkpoints missing');
 const cp=await checkpoints();
 if(cp.length!==0&&cp.length!==4)throw Error('Partial Sales Payment checkpoints; refuse to continue');
 if(new Set(cp.map(x=>x.record_type)).size!==cp.length)throw Error('Duplicate Sales Payment checkpoints');
 const baseline=cp.length?cp[0].modified:null;
 if(cp.some(x=>x.modified!==baseline))throw Error('Sales Payment checkpoints diverged');
 const since=baseline?overlap(baseline):null;
 const access=await token();
 // Fetch October-December headers using the source mapping with checkpoint overlap.
 // The source mapping's fetchHeaders() remains unchanged and validated.
 const headers=await fetchHeaders(access,since);
 if(!baseline&&!headers.length)throw Error('Initial CustPymt fetch empty');
 if(headers.some(h=>!yes(h.payment_id)))throw Error('Invalid header id');
 const ids=headers.map(h=>h.payment_id);
 const [lines,gl,links]=await Promise.all([
  ids.length?fetchLines(access,ids):[],ids.length?fetchGL(access,ids):[],ids.length?fetchApplications(access,ids):[]
 ]);
 const mapped=mapSource(headers,lines,gl,links);
 const totals=Object.fromEntries(groups.map(g=>[g.table,mapped[g.source].length]));
 console.log('Source mapped:',JSON.stringify(totals));
 console.log(`Checkpoint=${baseline??'INITIAL'}; overlap from=${since??'FULL OCTOBER'}`);
 if(DRY_RUN){console.log('DRY RUN PASS: source validated; BigQuery and checkpoints unchanged.');return;}
 if(baseline&&!headers.length){console.log('SALES PAYMENT NO CHANGES: SUCCESS; checkpoint not moved');return;}
 await ensureTables();
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);
 const stages=groups.map((g,i)=>({...g,stageName:`_stage_sp_${i}_${suffix}`}));
 try{
  for(const g of stages)await stage(g.stageName,mapped[g.source],g.fields);
  const watermark= [...headers.map(h=>h.last_modified)].sort().at(-1);
  if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(watermark??''))throw Error('Invalid source watermark');
  const checks=stages.map(g=>{
   const count=mapped[g.source].length;
   const unique=g.key.join(',');
   return `ASSERT (SELECT COUNT(*) FROM ${T(g.stageName)})=${count} AS 'Stage row count mismatch ${g.table}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${unique} FROM ${T(g.stageName)} GROUP BY ${unique} HAVING COUNT(*)>1))=0 AS 'Duplicate stage key ${g.table}';`;
  }).join('\n');
  const merges=stages.map((g,i)=>{
   const fields=cols(g);
   if(i===0){return `MERGE ${T(g.table)} d USING ${T(g.stageName)} s ON d.payment_id=s.payment_id
WHEN MATCHED AND COALESCE(d.is_deleted,FALSE)=FALSE THEN UPDATE SET ${fields.filter(x=>x!=='payment_id').map(x=>`${x}=s.${x}`).join(',')},synced_at=CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT(${fields.join(',')},synced_at,is_deleted,deleted_at) VALUES(${fields.map(x=>`s.${x}`).join(',')},CURRENT_TIMESTAMP(),FALSE,NULL);`}
   return `DELETE FROM ${T(g.table)} WHERE payment_id IN (SELECT payment_id FROM ${T(stages[0].stageName)});
INSERT INTO ${T(g.table)} (${fields.join(',')},synced_at) SELECT ${fields.join(',')},CURRENT_TIMESTAMP() FROM ${T(g.stageName)};`;
  }).join('\n');
  const guard=baseline?`ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN (${cpList}) AND last_successful_modified_at=DATETIME('${baseline}'))=4 AS 'Sales Payment checkpoint advanced';`:'';
  const cpSql=`MERGE ${T(C)} d USING (SELECT record_type FROM UNNEST([${cpList}]) AS record_type) s ON d.record_type=s.record_type
WHEN MATCHED THEN UPDATE SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());`;
  const orphans=stages.slice(1).map(g=>`ASSERT (SELECT COUNT(*) FROM ${T(g.table)} l LEFT JOIN ${T(stages[0].table)} h ON h.payment_id=l.payment_id WHERE h.payment_id IS NULL)=0 AS 'Orphan ${g.table}';`).join('\n');
  const sql=`BEGIN
BEGIN TRANSACTION;
${checks}
ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN (${cpList}))=${baseline?4:0} AS 'Sales Payment checkpoint row count changed';
${guard}
${merges}
${cpSql}
${orphans}
COMMIT TRANSACTION;
EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
END;`;
  await atomicCommitWithGuard(sql,{wm:watermark},baseline);
  console.log('ATOMIC MERGE + DETAIL REPLACE + FOUR CHECKPOINTS: SUCCESS');
  console.log('SALES PAYMENT SYNC SUCCESS; RUN reconciliation checks; NOT FINAL_PASS');
 } finally {for(const g of stages){try{await dataset.table(g.stageName).delete({ignoreNotFound:true});}catch(err){console.error('Stage cleanup warning',g.stageName,err.message);}}}
}
main().catch(err=>{console.error('SALES PAYMENT ERROR:',err.stack??err);process.exitCode=1;});
```

### `modules/sales-payment/test-mapping.mjs`

**Reconstructed SHA-256:** `c258d4f1adf0c5d517820bcdb6b039ecd8028e9eb896739c5ad300703a1a8fa5`.

```javascript
// Live read-only mapping validation; does not create tables or write checkpoints.
import {token,fetchHeaders,fetchLines,fetchGL,fetchApplications,mapSource} from './mapping.mjs';
async function run(){console.log('SALES PAYMENT PHASE B2 - MAPPING VALIDATION (READ ONLY)');const access=await token();console.log('OAuth: SUCCESS');const headers=await fetchHeaders(access);if(!headers.length)throw Error('No payment headers; mapping cannot be certified');const ids=headers.map(h=>h.payment_id);const [lines,gl,apps]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchApplications(access,ids)]);const mapped=mapSource(headers,lines,gl,apps);console.log('SOURCE:',JSON.stringify({headers:headers.length,lines:lines.length,gl:gl.length,apps:apps.length}));console.log('MAPPED:',JSON.stringify(mapped.counts));console.log('Amounts validated exactly at 9-decimal NUMERIC precision, per-payment mainline, GL and applications.');console.log('MAPPING VALIDATION PASS; NO BIGQUERY OR DELETION WRITES');}
run().catch(e=>{console.error('MAPPING VALIDATION FAIL:',e.stack||e);process.exitCode=1;});
```

### `modules/sales-return/check-financial.mjs`

**Reconstructed SHA-256:** `d57633ebe5193abfaaf88ca75a7aafb928fa197277a36dc9b301bec3945e9b92`.

```javascript
// Sales Return inventory/GL reconciliation. READ ONLY; no checkpoint or BigQuery mutation.
import { validateNumeric } from '../../common/decimal-precision.mjs';
import { query, T } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, fetchLines, fetchGL, fetchSourceLinks, mapSource, FROM, TO } from './mapping.mjs';

function units(value, context = {}) {
  const normalized = validateNumeric(value, context);
  if (normalized == null) return 0n;
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  const n = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
  return negative ? -n : n;
}
function formatUnits(value) {
  const negative = value < 0n;
  const n = negative ? -value : value;
  const whole = n / 1000000000n;
  const fraction = (n % 1000000000n).toString().padStart(9,'0').replace(/0+$/,'');
  return `${negative ? '-' : ''}${whole}${fraction ? '.' + fraction : ''}`;
}

async function main() {
  console.log(`SALES RETURN FINANCIAL CHECK | READ ONLY | ${FROM} to ${TO}`);
  const access = await token();
  const headers = await fetchHeaders(access);
  const ids = headers.map(row => row.internal_id);
  const [rawLines, rawGL, rawLinks] = ids.length
    ? await Promise.all([fetchLines(access, ids), fetchGL(access, ids), fetchSourceLinks(access, ids)])
    : [[], [], []];
  const source = mapSource(headers, rawLines, rawGL, rawLinks);

  const bqLines = await query(`SELECT d.return_internal_id,d.line_unique_key,d.line_type,CAST(d.quantity AS STRING) AS quantity,CAST(d.rate AS STRING) AS rate,d.is_cogs FROM ${T('sales_return_lines')} d JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`);
  const bqGL = await query(`SELECT d.return_internal_id,d.accounting_book_id,d.line_id,d.account_id,CAST(d.debit AS STRING) AS debit,CAST(d.credit AS STRING) AS credit FROM ${T('sales_return_accounting_lines')} d JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`);
  const bqLinks = await query(`SELECT d.return_internal_id,d.source_internal_id,d.link_type FROM ${T('sales_return_source_links')} d JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`);

  const aggregate = rows => {
    let quantity = 0n;
    for (const row of rows) {
      if (String(row.line_type) === 'RETURN_ITEM' && !row.is_cogs) {
        quantity += units(row.quantity, { module: 'sales-return', recordId: row.return_internal_id, field: 'quantity' });
      }
    }
    return quantity;
  };
  const glAggregate = rows => {
    let debit = 0n, credit = 0n;
    for (const row of rows) {
      debit += units(row.debit, { module: 'sales-return', recordId: row.return_internal_id, field: 'debit' });
      credit += units(row.credit, { module: 'sales-return', recordId: row.return_internal_id, field: 'credit' });
    }
    return { debit, credit };
  };

  const nsQuantity = aggregate(source.transactionLines);
  const bqQuantity = aggregate(bqLines);
  const nsGL = glAggregate(source.accountingLines);
  const bqGLTotals = glAggregate(bqGL);

  const sourceLinkKeys = new Set(source.sourceLinks.map(row => `${row.return_internal_id}:${row.source_internal_id}:${row.link_type}`));
  const bqLinkKeys = new Set(bqLinks.map(row => `${row.return_internal_id}:${row.source_internal_id}:${row.link_type}`));
  const missingLinks = [...sourceLinkKeys].filter(key => !bqLinkKeys.has(key));
  const extraLinks = [...bqLinkKeys].filter(key => !sourceLinkKeys.has(key));

  const report = {
    sourceHeaders: source.headers.length,
    sourceLines: source.transactionLines.length,
    bigQueryLines: bqLines.length,
    sourceAccountingLines: source.accountingLines.length,
    bigQueryAccountingLines: bqGL.length,
    sourceLinks: source.sourceLinks.length,
    bigQueryLinks: bqLinks.length,
    physicalReturnQuantity: { netSuite: formatUnits(nsQuantity), bigQuery: formatUnits(bqQuantity) },
    gl: {
      netSuiteDebit: formatUnits(nsGL.debit), netSuiteCredit: formatUnits(nsGL.credit),
      bigQueryDebit: formatUnits(bqGLTotals.debit), bigQueryCredit: formatUnits(bqGLTotals.credit)
    },
    missingLinks,
    extraLinks
  };
  console.log(JSON.stringify(report, null, 2));

  const failed = source.transactionLines.length !== bqLines.length ||
    source.accountingLines.length !== bqGL.length ||
    source.sourceLinks.length !== bqLinks.length ||
    nsQuantity !== bqQuantity ||
    nsGL.debit !== nsGL.credit ||
    bqGLTotals.debit !== bqGLTotals.credit ||
    nsGL.debit !== bqGLTotals.debit ||
    nsGL.credit !== bqGLTotals.credit ||
    missingLinks.length || extraLinks.length;

  if (failed) throw Error('SALES RETURN FINANCIAL CHECK FAILED');
  console.log('SALES RETURN FINANCIAL CHECK PASS (physical quantity + exact GL + CostRtrn links)');
}

main().catch(error => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
```

### `modules/sales-return/check.mjs`

**Reconstructed SHA-256:** `6939893c50c22c2190a9d94f3b3e3725bee0c6e833097bb8d1cc2e49d8695842`.

```javascript
import { query, T } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, fetchLines, fetchGL, fetchSourceLinks, mapSource, FROM, TO } from './mapping.mjs';

const defs = [
  {
    table: 'sales_return_headers', source: 'headers', keys: ['internal_id'],
    fields: ['internal_id','receipt_number','transaction_date','last_modified','status','customer_id','customer_name','memo','subsidiary_id'], numbers: []
  },
  {
    table: 'sales_return_lines', source: 'transactionLines', keys: ['return_internal_id','line_unique_key'],
    fields: ['return_internal_id','line_unique_key','line_id','line_number','line_type','item_id','quantity','rate','foreign_amount','net_amount','location_id','units_id','is_cogs','accounting_line_type'],
    numbers: ['quantity','rate','foreign_amount','net_amount']
  },
  {
    table: 'sales_return_accounting_lines', source: 'accountingLines', keys: ['return_internal_id','accounting_book_id','line_id','account_id'],
    fields: ['return_internal_id','accounting_book_id','line_id','account_id','debit','credit','posting'], numbers: ['debit','credit']
  },
  {
    table: 'sales_return_source_links', source: 'sourceLinks', keys: ['return_internal_id','source_internal_id','link_type'],
    fields: ['return_internal_id','source_internal_id','source_type','source_number','source_date','link_type'], numbers: []
  }
];

function canonicalDecimal(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) throw Error(`Invalid decimal ${raw}`);
  const negative = match[1] === '-';
  const whole = match[2] ?? '';
  const fraction = match[3] ?? match[4] ?? '';
  const exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw Error(`Unsupported decimal exponent ${raw}`);
  const digits = (whole + fraction).replace(/^0+/, '') || '0';
  const shift = exponent - fraction.length;
  let result;
  if (shift >= 0) result = digits + '0'.repeat(shift);
  else {
    const point = digits.length + shift;
    result = point > 0 ? digits.slice(0,point) + '.' + digits.slice(point) : '0.' + '0'.repeat(-point) + digits;
  }
  let [integer, frac = ''] = result.split('.');
  integer = integer.replace(/^0+(?=\d)/, '');
  frac = frac.replace(/0+$/, '');
  const normalized = integer + (frac ? '.' + frac : '');
  return negative && normalized !== '0' ? '-' + normalized : normalized;
}

function normalize(field, value, def) {
  if (value == null) return null;
  if (def.numbers.includes(field)) return canonicalDecimal(value);
  if (['is_cogs','posting'].includes(field)) return value === true || String(value).toLowerCase() === 'true' || String(value) === '1' ? 'true' : 'false';
  return String(value);
}
function key(row, fields) { return fields.map(field => String(row[field] ?? 'NULL')).join('\u001f'); }
function units(value) {
  const normalized = canonicalDecimal(value);
  if (normalized == null) return 0n;
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  if (fraction.length > 9) throw Error(`Unexpected >9 scale after source validation: ${normalized}`);
  const n = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9,'0'));
  return negative ? -n : n;
}
function formatUnits(value) {
  const negative = value < 0n;
  const n = negative ? -value : value;
  const whole = n / 1000000000n;
  const fraction = (n % 1000000000n).toString().padStart(9,'0').replace(/0+$/,'');
  return `${negative ? '-' : ''}${whole}${fraction ? '.' + fraction : ''}`;
}

async function main() {
  console.log('SALES RETURN FULL OCT 2026 CHECK | READ ONLY');
  const access = await token();
  const headers = await fetchHeaders(access);
  const ids = headers.map(row => row.internal_id);
  const [lines, gl, links] = ids.length
    ? await Promise.all([fetchLines(access, ids), fetchGL(access, ids), fetchSourceLinks(access, ids)])
    : [[], [], []];
  const mapped = mapSource(headers, lines, gl, links);

  const report = {};
  const samples = [];
  let failed = false;

  for (const def of defs) {
    const activeJoin = def.source === 'headers'
      ? ''
      : ` JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id`;
    const where = def.source === 'headers'
      ? ` WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`
      : ` WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`;
    const alias = def.source === 'headers' ? '' : 'd.';
    const fieldSql = def.fields.map(field => {
      if (field === 'transaction_date' || field === 'source_date') return `CAST(${alias}${field} AS STRING) AS ${field}`;
      if (field === 'last_modified') return `FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',${alias}${field}) AS ${field}`;
      if (def.numbers.includes(field)) return `CAST(${alias}${field} AS STRING) AS ${field}`;
      return `${alias}${field}`;
    }).join(',');
    const stored = await query(`SELECT ${fieldSql} FROM ${T(def.table)}${def.source === 'headers' ? '' : ' d'}${activeJoin}${where}`);
    const source = mapped[def.source];

    const srcMap = new Map();
    const dstMap = new Map();
    let duplicates = 0;
    let mismatch = 0;
    let onlySource = 0;
    let onlyBq = 0;

    for (const row of source) {
      const k = key(row, def.keys);
      if (srcMap.has(k)) duplicates++;
      srcMap.set(k, row);
    }
    for (const row of stored) {
      const k = key(row, def.keys);
      if (dstMap.has(k)) duplicates++;
      dstMap.set(k, row);
    }

    for (const [k, row] of srcMap) {
      const target = dstMap.get(k);
      if (!target) {
        onlySource++;
        if (samples.length < 12) samples.push({ table: def.table, key: k, issue: 'MISSING_IN_BQ' });
        continue;
      }
      const differences = def.fields.filter(field => normalize(field,row[field],def) !== normalize(field,target[field],def));
      if (differences.length) {
        mismatch++;
        if (samples.length < 12) samples.push({ table: def.table, key: k, fields: differences.slice(0,8) });
      }
    }
    for (const k of dstMap.keys()) if (!srcMap.has(k)) onlyBq++;

    const ok = source.length === stored.length && !duplicates && !mismatch && !onlySource && !onlyBq;
    report[def.table] = { source: source.length, bigQuery: stored.length, duplicates, mismatch, onlySource, onlyBq, status: ok ? 'PASS' : 'FAIL' };
    if (!ok) failed = true;
  }

  const integrity = (await query(`SELECT
    (SELECT COUNT(*) FROM (SELECT internal_id FROM ${T('sales_return_headers')} GROUP BY 1 HAVING COUNT(*)>1)) AS duplicate_headers,
    (SELECT COUNT(*) FROM (SELECT return_internal_id,line_unique_key FROM ${T('sales_return_lines')} GROUP BY 1,2 HAVING COUNT(*)>1)) AS duplicate_lines,
    (SELECT COUNT(*) FROM (SELECT return_internal_id,accounting_book_id,line_id,account_id FROM ${T('sales_return_accounting_lines')} GROUP BY 1,2,3,4 HAVING COUNT(*)>1)) AS duplicate_gl,
    (SELECT COUNT(*) FROM (SELECT return_internal_id,source_internal_id,link_type FROM ${T('sales_return_source_links')} GROUP BY 1,2,3 HAVING COUNT(*)>1)) AS duplicate_links,
    (SELECT COUNT(*) FROM ${T('sales_return_lines')} d LEFT JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id WHERE h.internal_id IS NULL) AS orphan_lines,
    (SELECT COUNT(*) FROM ${T('sales_return_accounting_lines')} d LEFT JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id WHERE h.internal_id IS NULL) AS orphan_gl,
    (SELECT COUNT(*) FROM ${T('sales_return_source_links')} d LEFT JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id WHERE h.internal_id IS NULL) AS orphan_links`))[0];

  if (Object.values(integrity).some(value => Number(value) !== 0)) failed = true;
  console.log(JSON.stringify({ tables: report, integrity, samples }, null, 2));
  const physicalQty = mapped.transactionLines
    .filter(row => row.line_type === 'RETURN_ITEM' && !row.is_cogs)
    .reduce((sum,row) => sum + units(row.quantity), 0n);
  const glDebit = mapped.accountingLines.reduce((sum,row) => sum + units(row.debit), 0n);
  const glCredit = mapped.accountingLines.reduce((sum,row) => sum + units(row.credit), 0n);
  console.log(`SALES RETURN SOURCE EVIDENCE headers=${mapped.headers.length} lines=${mapped.transactionLines.length} gl=${mapped.accountingLines.length} links=${mapped.sourceLinks.length} physical_qty=${formatUnits(physicalQty)} gl_debit=${formatUnits(glDebit)} gl_credit=${formatUnits(glCredit)}`);

  if (failed) throw Error('SALES RETURN CHECK FAILED');
  console.log('SALES RETURN CHECK PASS (four-table field-by-field + source invariants + integrity)');
}

main().catch(error => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
```

### `modules/sales-return/mapping.mjs`

**Reconstructed SHA-256:** `d7ad464d1996a1fda475b1ec0a9c5eb978d642cc33a3fe81e9669bff00a10a33`.

```javascript
import { validateNumeric } from '../../common/decimal-precision.mjs';
import { token, fetchAll } from '../../common/netsuite-client.mjs';

export { token };
export const TYPE = 'ItemRcpt';
export const LINK_TYPE = 'CostRtrn';
export const SOURCE_TYPE = 'ItemShip';
export const FROM = '2026-10-01';
export const TO = '2026-11-01';

const period = `r.trandate >= TO_DATE('${FROM}','YYYY-MM-DD') AND r.trandate < TO_DATE('${TO}','YYYY-MM-DD')`;

function numberId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw Error(`Invalid NetSuite ID: ${value}`);
  return String(n);
}

function text(value) {
  return value == null ? null : String(value);
}

function flag(value) {
  return String(value ?? 'F').toUpperCase() === 'T';
}

// Preserve NetSuite's decimal text. Do not round inventory cost, quantity, debit, or credit.
function decimal(value, context = {}) {
  if (value == null || value === '') return null;
  return validateNumeric(String(value).trim(), context);
}

function numericUnits(value, context = {}) {
  const normalized = decimal(value, context);
  if (normalized == null) return 0n;
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  const units = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
  return negative ? -units : units;
}

async function grouped(access, ids, sqlFor) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 25) {
    const group = ids.slice(i, i + 25).map(numberId);
    if (!group.length) continue;
    rows.push(...await fetchAll(access, sqlFor(group.join(','))));
  }
  return rows;
}

export async function fetchHeaders(access, since = null) {
  if (since !== null && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(since)) {
    throw Error('Invalid incremental watermark');
  }
  const modified = since
    ? ` AND r.lastmodifieddate >= TO_DATE('${since}','YYYY-MM-DD HH24:MI:SS')`
    : '';

  return fetchAll(access, `
    SELECT DISTINCT
      r.id AS internal_id,
      r.tranid AS receipt_number,
      TO_CHAR(r.trandate,'YYYY-MM-DD') AS transaction_date,
      TO_CHAR(r.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,
      BUILTIN.DF(r.status) AS status,
      r.entity AS customer_id,
      BUILTIN.DF(r.entity) AS customer_name,
      r.memo,
      r.subsidiary AS subsidiary_id
    FROM Transaction r
    JOIN PreviousTransactionLineLink l ON l.nextdoc = r.id
    JOIN Transaction s ON s.id = l.previousdoc
    WHERE ${period}
      AND r.type = '${TYPE}'
      AND l.linktype = '${LINK_TYPE}'
      AND s.type = '${SOURCE_TYPE}'${modified}
    ORDER BY r.id`);
}

export async function fetchLines(access, ids) {
  return grouped(access, ids, inIds => `
    SELECT
      transaction AS transaction_id,
      id AS line_id,
      uniquekey AS line_unique_key,
      linesequencenumber AS line_number,
      item AS item_id,
      quantity,
      rate,
      foreignamount,
      netamount,
      location AS location_id,
      units AS units_id,
      mainline,
      taxline,
      iscogs,
      accountinglinetype
    FROM TransactionLine
    WHERE transaction IN (${inIds})
    ORDER BY transaction,id`);
}

export async function fetchGL(access, ids) {
  return grouped(access, ids, inIds => `
    SELECT
      transaction AS transaction_id,
      transactionline AS line_id,
      accountingbook AS accounting_book_id,
      account AS account_id,
      debit,
      credit,
      posting
    FROM TransactionAccountingLine
    WHERE transaction IN (${inIds})
    ORDER BY transaction,accountingbook,transactionline,account`);
}

export async function fetchSourceLinks(access, ids) {
  return grouped(access, ids, inIds => `
    SELECT
      l.nextdoc AS return_id,
      l.previousdoc AS source_id,
      l.linktype AS link_type,
      s.type AS source_type,
      s.tranid AS source_number,
      TO_CHAR(s.trandate,'YYYY-MM-DD') AS source_date
    FROM PreviousTransactionLineLink l
    JOIN Transaction s ON s.id = l.previousdoc
    WHERE l.nextdoc IN (${inIds})
      AND ((l.linktype = 'CostRtrn' AND s.type = 'ItemShip')
        OR (l.linktype = 'ShipRcpt' AND s.type = 'RtnAuth'))
    ORDER BY l.nextdoc,l.previousdoc,l.linktype`);
}

export function mapSource(headers, rawLines, rawGL, rawLinks) {
  const mappedHeaders = [];
  const mappedLines = [];
  const mappedGL = [];
  const mappedLinks = [];

  const headerIds = new Set();
  const physicalLineCounts = new Map();
  const glCounts = new Map();
  const debitTotals = new Map();
  const creditTotals = new Map();
  const linkCounts = new Map();

  for (const row of headers) {
    const id = numberId(row.internal_id);
    if (headerIds.has(id)) throw Error(`Duplicate Sales Return header ${id}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.transaction_date ?? ''))) throw Error(`Invalid transaction date ${id}`);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(row.last_modified ?? ''))) throw Error(`Invalid last_modified ${id}`);
    headerIds.add(id);
    physicalLineCounts.set(id, 0);
    glCounts.set(id, 0);
    debitTotals.set(id, 0n);
    creditTotals.set(id, 0n);
    linkCounts.set(id, 0);
    mappedHeaders.push({
      internal_id: id,
      receipt_number: text(row.receipt_number),
      transaction_date: row.transaction_date,
      last_modified: row.last_modified,
      status: text(row.status),
      customer_id: text(row.customer_id),
      customer_name: text(row.customer_name),
      memo: text(row.memo),
      subsidiary_id: text(row.subsidiary_id)
    });
  }

  const lineKeys = new Set();
  for (const row of rawLines) {
    const id = numberId(row.transaction_id);
    if (!headerIds.has(id)) throw Error(`Orphan Sales Return line ${id}`);
    if (flag(row.mainline) || flag(row.taxline)) continue;

    const lineUniqueKey = text(row.line_unique_key);
    if (!lineUniqueKey) throw Error(`Missing Sales Return line uniquekey ${id}`);
    const key = `${id}:${lineUniqueKey}`;
    if (lineKeys.has(key)) throw Error(`Duplicate Sales Return line ${key}`);
    lineKeys.add(key);

    const isCogs = flag(row.iscogs);
    const quantity = decimal(row.quantity, { module: 'sales-return', recordId: id, field: 'quantity' });
    if (!isCogs && row.item_id != null && numericUnits(quantity, { module: 'sales-return', recordId: id, field: 'quantity' }) !== 0n) {
      physicalLineCounts.set(id, physicalLineCounts.get(id) + 1);
    }

    mappedLines.push({
      return_internal_id: id,
      line_unique_key: lineUniqueKey,
      line_id: text(row.line_id),
      line_number: text(row.line_number),
      line_type: isCogs ? (text(row.accountinglinetype) ?? 'COST') : 'RETURN_ITEM',
      item_id: text(row.item_id),
      quantity,
      rate: decimal(row.rate, { module: 'sales-return', recordId: id, field: 'rate' }),
      foreign_amount: decimal(row.foreignamount, { module: 'sales-return', recordId: id, field: 'foreign_amount' }),
      net_amount: decimal(row.netamount, { module: 'sales-return', recordId: id, field: 'net_amount' }),
      location_id: text(row.location_id),
      units_id: text(row.units_id),
      is_cogs: isCogs,
      accounting_line_type: text(row.accountinglinetype)
    });
  }

  const glKeys = new Set();
  for (const row of rawGL) {
    const id = numberId(row.transaction_id);
    if (!headerIds.has(id)) throw Error(`Orphan Sales Return GL ${id}`);
    if (!flag(row.posting)) continue;
    if (row.account_id == null) continue;
    if ((row.debit == null || row.debit === '') && (row.credit == null || row.credit === '')) continue;

    const accountingBookId = text(row.accounting_book_id);
    const lineId = text(row.line_id);
    const accountId = text(row.account_id);
    const key = [id, accountingBookId, lineId, accountId].join(':');
    if (glKeys.has(key)) throw Error(`Duplicate Sales Return GL key ${key}`);
    glKeys.add(key);

    const debit = decimal(row.debit, { module: 'sales-return', recordId: id, field: 'debit' });
    const credit = decimal(row.credit, { module: 'sales-return', recordId: id, field: 'credit' });
    debitTotals.set(id, debitTotals.get(id) + numericUnits(debit, { module: 'sales-return', recordId: id, field: 'debit' }));
    creditTotals.set(id, creditTotals.get(id) + numericUnits(credit, { module: 'sales-return', recordId: id, field: 'credit' }));
    glCounts.set(id, glCounts.get(id) + 1);

    mappedGL.push({
      return_internal_id: id,
      accounting_book_id: accountingBookId,
      line_id: lineId,
      account_id: accountId,
      debit,
      credit,
      posting: true
    });
  }

  const linkKeys = new Set();
  for (const row of rawLinks) {
    const returnId = numberId(row.return_id);
    const sourceId = numberId(row.source_id);
    if (!headerIds.has(returnId)) throw Error(`Orphan Sales Return source link ${returnId}`);
    const type = text(row.link_type);
    const sourceType = text(row.source_type);
    if (!((type === 'CostRtrn' && sourceType === 'ItemShip') || (type === 'ShipRcpt' && sourceType === 'RtnAuth'))) {
      throw Error(`Unexpected Sales Return link ${type}/${sourceType}`);
    }
    const key = `${returnId}:${sourceId}:${type}`;
    if (linkKeys.has(key)) continue;
    linkKeys.add(key);
    if (type === LINK_TYPE) linkCounts.set(returnId, linkCounts.get(returnId) + 1);
    mappedLinks.push({
      return_internal_id: returnId,
      source_internal_id: sourceId,
      source_type: sourceType,
      source_number: text(row.source_number),
      source_date: text(row.source_date),
      link_type: type
    });
  }

  for (const header of mappedHeaders) {
    const id = header.internal_id;
    if (physicalLineCounts.get(id) < 1) throw Error(`Sales Return ${id} has no physical RETURN_ITEM line`);
    if (linkCounts.get(id) < 1) throw Error(`Sales Return ${id} has no CostRtrn ItemShip link`);
    if (glCounts.get(id) < 1) throw Error(`Sales Return ${id} has no posting GL rows with accounts`);
    if (debitTotals.get(id) !== creditTotals.get(id)) {
      throw Error(`Sales Return GL imbalance ${id}: debit=${debitTotals.get(id)} credit=${creditTotals.get(id)}`);
    }
  }

  return {
    headers: mappedHeaders,
    transactionLines: mappedLines,
    accountingLines: mappedGL,
    sourceLinks: mappedLinks,
    counts: {
      headers: mappedHeaders.length,
      transaction_lines: mappedLines.length,
      accounting_lines: mappedGL.length,
      source_links: mappedLinks.length
    }
  };
}
```

### `modules/sales-return/presence.mjs`

**Reconstructed SHA-256:** `67851eca4df03b3b5a78c438f87035d4dfedb88ce91d19115dacd82f60ca9c0a`.

```javascript
import { query, T } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, FROM, TO } from './mapping.mjs';

async function main() {
  console.log('SALES RETURN PRESENCE | READ ONLY');
  const source = await fetchHeaders(await token());
  const ns = new Set(source.map(row => String(row.internal_id)));
  const rows = await query(`SELECT internal_id FROM ${T('sales_return_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
  const bq = new Set(rows.map(row => String(row.internal_id)));
  const onlyNetSuite = [...ns].filter(id => !bq.has(id));
  const onlyBigQuery = [...bq].filter(id => !ns.has(id));
  const sourceDuplicate = ns.size !== source.length;
  const bigQueryDuplicate = bq.size !== rows.length;

  console.log(JSON.stringify({
    netSuite: ns.size,
    bigQuery: bq.size,
    onlyNetSuite,
    onlyBigQuery,
    sourceDuplicate,
    bigQueryDuplicate
  }, null, 2));

  if (sourceDuplicate || bigQueryDuplicate) throw Error('SALES RETURN PRESENCE INTEGRITY FAILED');
  if (onlyNetSuite.length || onlyBigQuery.length) {
    console.log('SALES RETURN PRESENCE NEEDS_REVIEW');
    process.exitCode = 3;
    return;
  }
  console.log('SALES RETURN PRESENCE PASS');
}

main().catch(error => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
```

### `modules/sales-return/probe.mjs`

**Reconstructed SHA-256:** `c5cc9b6652c467e910d0590563f300983662321abac6a3517a5df02a970daa1f`.

```javascript
// Module 7 Sales Return discovery — READ ONLY, no BigQuery/DDL/checkpoints.
// Never infer absent transactions from permissions/query errors.
import { token, fetchAll } from '../../common/netsuite-client.mjs';

const FROM = '2026-10-01';
const TO = '2026-11-01';
const PERIOD = `t.trandate >= TO_DATE('${FROM}','YYYY-MM-DD') AND t.trandate < TO_DATE('${TO}','YYYY-MM-DD')`;
const TYPES = ['RtnAuth','CustCred','ItemRcpt']; // Candidates only; inspect raw type inventory first.
const validId = x => /^\d+$/.test(String(x)) && Number.isSafeInteger(Number(x)) && Number(x)>0;
const safeIds = rows => rows.map(r=>r.internal_id).filter(validId).slice(0,6).map(Number).join(',');
let failures = 0;
async function query(access,label,sql,limit=8) {
  console.log(`\n=== ${label} ===`);
  try {
    const rows = await fetchAll(access,sql);
    console.log('rows:',rows.length,'sample:',JSON.stringify(rows.slice(0,limit),null,2));
    return rows;
  } catch (error) {
    failures++;
    console.error('QUERY FAILED (do not infer empty results):',error.message);
    return null;
  }
}

console.log(`SALES RETURN | ${FROM} .. ${TO} | READ ONLY - NO WRITE`);
try {
  const access = await token();
  await query(access,'OCTOBER TRANSACTION TYPE INVENTORY',
    `SELECT t.type, COUNT(*) AS transaction_count FROM Transaction t WHERE ${PERIOD} GROUP BY t.type ORDER BY t.type`,200);
  const samples = new Map();
  for (const type of TYPES) {
    const rows = await query(access,`CANDIDATE HEADERS: ${type}`,
      `SELECT t.id AS internal_id,t.type,t.tranid AS document_number,`+
      `TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,`+
      `TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,`+
      `BUILTIN.DF(t.status) AS status,t.entity AS entity_id,`+
      `t.currency AS currency_id,t.exchangerate,t.foreigntotal,t.total `+
      `FROM Transaction t WHERE ${PERIOD} AND t.type='${type}' ORDER BY t.id`,6);
    if (rows) samples.set(type,rows);
  }
  const ids = [...samples.values()].flatMap(rows=>rows.slice(0,3)).map(r=>r.internal_id);
  const unique = [...new Set(ids)].filter(validId).slice(0,15);
  if (unique.length) {
    const list = unique.join(',');
    await query(access,'RAW TRANSACTION LINES (representative sample)',
      `SELECT transaction,id AS line_id,uniquekey AS line_unique_key,`+
      `linesequencenumber,item,quantity,rate,foreignamount,netamount,`+
      `mainline,taxline,iscogs,accountinglinetype,location `+
      `FROM TransactionLine WHERE transaction IN (${list}) ORDER BY transaction,id`,80);
    await query(access,'LINE CLASSIFICATION',
      `SELECT transaction,mainline,taxline,iscogs,accountinglinetype,`+
      `COUNT(*) AS n,SUM(foreignamount) AS foreign_sum,SUM(netamount) AS net_sum `+
      `FROM TransactionLine WHERE transaction IN (${list}) `+
      `GROUP BY transaction,mainline,taxline,iscogs,accountinglinetype`,80);
    await query(access,'POSTING GL SAMPLE',
      `SELECT transaction,transactionline,accountingbook,account,debit,credit,posting `+
      `FROM TransactionAccountingLine WHERE transaction IN (${list})`,80);
    await query(access,'PREVIOUS LINKS SAMPLE',
      `SELECT previousdoc,nextdoc,linktype FROM PreviousTransactionLineLink `+
      `WHERE nextdoc IN (${list})`,80);
    await query(access,'NEXT LINKS SAMPLE',
      `SELECT previousdoc,nextdoc,linktype FROM NextTransactionLineLink `+
      `WHERE previousdoc IN (${list})`,80);
  } else console.warn('No candidate rows accessible; verify roles / account workflow, not proof of no returns.');
  console.log('\nDISCOVERY COMPLETE; source mapping/financial rules NOT YET CERTIFIED.');
  if (failures) {console.error('PROBE FAILED QUERIES:',failures);process.exitCode=1;}
  else if (!unique.length) process.exitCode=2;
} catch(error) {console.error('PROBE FATAL:',error.stack??error);process.exitCode=1;}
```

### `modules/sales-return/sync.mjs`

**Reconstructed SHA-256:** `e31aeb4d0afd41e071305bef9c0095cc38e86b14ebcdaa3921bf57973cabb6e4`.

```javascript
import { validateNumericRows } from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataset, DATASET, LOCATION, T, query } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, fetchLines, fetchGL, fetchSourceLinks, mapSource } from './mapping.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const SYNC = process.argv.includes('--sync');
const TIMING = process.argv.includes('--timing');
const PERF_START = process.hrtime.bigint();
function elapsedMs(start) { return Number(process.hrtime.bigint() - start) / 1e6; }
function perf(label, value) {
  if (TIMING) console.log(`[SR-PERF] ${label} ${value.toFixed(1)}ms since_start=${elapsedMs(PERF_START).toFixed(1)}ms`);
}
async function timed(label, run) {
  const start = process.hrtime.bigint();
  try {
    return await run();
  } finally {
    perf(label, elapsedMs(start));
  }
}

if (DRY_RUN === SYNC) throw Error('Specify exactly one: --dry-run OR --sync');

const C = 'sync_checkpoints';
const groups = [
  {
    table: 'sales_return_headers',
    source: 'headers',
    key: ['internal_id'],
    parent: null,
    fields: [
      ['internal_id','STRING'],['receipt_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],
      ['status','STRING'],['customer_id','STRING'],['customer_name','STRING'],['memo','STRING'],['subsidiary_id','STRING']
    ]
  },
  {
    table: 'sales_return_lines',
    source: 'transactionLines',
    key: ['return_internal_id','line_unique_key'],
    parent: 'return_internal_id',
    fields: [
      ['return_internal_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],['line_number','STRING'],['line_type','STRING'],
      ['item_id','STRING'],['quantity','NUMERIC'],['rate','NUMERIC'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC'],
      ['location_id','STRING'],['units_id','STRING'],['is_cogs','BOOL'],['accounting_line_type','STRING']
    ]
  },
  {
    table: 'sales_return_accounting_lines',
    source: 'accountingLines',
    key: ['return_internal_id','accounting_book_id','line_id','account_id'],
    parent: 'return_internal_id',
    fields: [
      ['return_internal_id','STRING'],['accounting_book_id','STRING'],['line_id','STRING'],['account_id','STRING'],
      ['debit','NUMERIC'],['credit','NUMERIC'],['posting','BOOL']
    ]
  },
  {
    table: 'sales_return_source_links',
    source: 'sourceLinks',
    key: ['return_internal_id','source_internal_id','link_type'],
    parent: 'return_internal_id',
    fields: [
      ['return_internal_id','STRING'],['source_internal_id','STRING'],['source_type','STRING'],['source_number','STRING'],['source_date','DATE'],['link_type','STRING']
    ]
  }
];

const names = groups.map(g => g.table);
const cpList = names.map(name => `'${name}'`).join(',');
const columns = g => g.fields.map(([name]) => name);

function overlap(value) {
  const d = new Date(value.replace(' ','T') + 'Z');
  if (Number.isNaN(+d)) throw Error(`Invalid checkpoint ${value}`);
  return new Date(+d - 300000).toISOString().slice(0,19).replace('T',' ');
}

async function checkpoints() {
  return query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS modified FROM ${T(C)} WHERE record_type IN (${cpList})`);
}

const RETRY_DELAYS_MS = [1500, 3500, 7000];
function isCheckpointConflict(error) {
  const message = String(error?.message ?? error);
  return /transaction is aborted due to concurrent update against table/i.test(message) && /netsuite_backup[.:]sync_checkpoints/i.test(message);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function atomicCommitWithGuard(sql, params, originalCheckpoint) {
  for (let attempt = 0; ; attempt++) {
    try { return await query(sql, params); }
    catch (error) {
      if (!isCheckpointConflict(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
      const latest = await checkpoints();
      const expected = originalCheckpoint ? groups.length : 0;
      if (latest.length !== expected || new Set(latest.map(r => r.record_type)).size !== latest.length || latest.some(r => !names.includes(r.record_type) || r.modified !== originalCheckpoint)) {
        throw new Error(`Sales Return checkpoint changed after aborted transaction (before=${originalCheckpoint ?? 'INITIAL'}). Refusing replay; run fresh --dry-run and --sync.`, { cause: error });
      }
      const wait = RETRY_DELAYS_MS[attempt];
      console.warn(`Sales Return checkpoint write conflict; transaction aborted. Retry ${attempt + 1}/${RETRY_DELAYS_MS.length} after ${wait}ms (staging retained).`);
      await sleep(wait);
    }
  }
}

async function ensureTables() {
  const [hasCP] = await dataset.table(C).exists();
  if (!hasCP) throw Error('Shared sync_checkpoints missing; refusing to create it');

  for (const g of groups) {
    const defs = g.fields.map(([name,type]) => `${name} ${type}${g.key.includes(name) ? ' NOT NULL' : ''}`).join(',');
    const extra = g === groups[0]
      ? ',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP'
      : ',synced_at TIMESTAMP';
    const partition = g === groups[0] ? ' PARTITION BY transaction_date' : '';
    const cluster = g === groups[0] ? ' CLUSTER BY internal_id' : ` CLUSTER BY ${g.key.slice(0,4).join(',')}`;
    await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${defs}${extra})${partition}${cluster}`);
  }
}

async function stage(name, rows, fields) {
  validateNumericRows(rows, fields, { module: 'sales-return' });
  if (!rows.length) {
    await query(`CREATE TABLE ${T(name)} AS SELECT ${fields.map(([k,t]) => `CAST(NULL AS ${t}) AS ${k}`).join(',')} FROM UNNEST([1]) AS dummy WHERE FALSE`);
    return;
  }
  const filename = path.join(os.tmpdir(), `netsuite-sales-return-${crypto.randomUUID()}.ndjson`);
  await fs.writeFile(filename, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
  try {
    await dataset.table(name).load(filename, {
      sourceFormat: 'NEWLINE_DELIMITED_JSON',
      writeDisposition: 'WRITE_TRUNCATE',
      schema: { fields: fields.map(([fieldName,type]) => ({ name: fieldName, type })) },
      location: LOCATION
    });
  } finally {
    await fs.rm(filename, { force: true });
  }
  const [count] = await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);
  if (Number(count.n) !== rows.length) throw Error(`Stage count mismatch ${name}`);
}

async function main() {
  console.log(`SALES RETURN | ${DRY_RUN ? 'DRY RUN' : 'PRODUCTION SYNC'} | ${DATASET} | ${LOCATION}`);

  const [hasCP] = await timed('checkpoint_table_exists', () => dataset.table(C).exists());
  if (!hasCP) throw Error('Shared sync_checkpoints missing');
  const cp = await timed('checkpoint_read', () => checkpoints());
  if (cp.length !== 0 && cp.length !== groups.length) throw Error('Partial Sales Return checkpoints; refuse to continue');
  if (new Set(cp.map(row => row.record_type)).size !== cp.length) throw Error('Duplicate Sales Return checkpoints');
  const baseline = cp.length ? cp[0].modified : null;
  if (cp.some(row => row.modified !== baseline)) throw Error('Sales Return checkpoints diverged');
  const since = baseline ? overlap(baseline) : null;

  const access = await timed('netsuite_oauth', () => token());
  const headers = await timed('netsuite_headers', () => fetchHeaders(access, since));
  const ids = headers.map(row => row.internal_id);
  const [lines, gl, links] = ids.length
    ? await Promise.all([
        timed('netsuite_lines', () => fetchLines(access, ids)),
        timed('netsuite_gl', () => fetchGL(access, ids)),
        timed('netsuite_source_links', () => fetchSourceLinks(access, ids))
      ])
    : [[], [], []];
  const mapStart = process.hrtime.bigint();
  const mapped = mapSource(headers, lines, gl, links);
  perf('map_and_decimal', elapsedMs(mapStart));
  const counts = Object.fromEntries(groups.map(g => [g.table, mapped[g.source].length]));
  console.log('Source mapped:', JSON.stringify(counts));
  console.log(`Checkpoint=${baseline ?? 'INITIAL'}; overlap from=${since ?? 'FULL OCTOBER'}`);

  // October source was previously certified by read-only probe. Empty initial source is a permission/workflow regression.
  if (!baseline && !headers.length) throw Error('Initial Sales Return source empty; verify CostRtrn ItemRcpt workflow and permissions before DDL/checkpoint');
  if (DRY_RUN) {
    console.log('DRY RUN PASS: source validated; inventory-cost decimals preserved exactly; BigQuery/checkpoints unchanged.');
    perf('dry_run_total', elapsedMs(PERF_START));
    return;
  }
  if (baseline && !headers.length) {
    console.log('SALES RETURN NO CHANGES: SUCCESS; checkpoint not moved');
    return;
  }

  await timed('ensure_tables', () => ensureTables());
  const suffix = crypto.randomUUID().replaceAll('-','').slice(0,20);
  const stages = groups.map((g,index) => ({ ...g, stageName: `_stage_sr_${index}_${suffix}` }));

  try {
    for (const g of stages) await timed(`stage_${g.table}`, () => stage(g.stageName, mapped[g.source], g.fields));
    const watermark = headers.map(row => row.last_modified).filter(Boolean).sort().at(-1);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(watermark ?? '')) throw Error('Invalid Sales Return source watermark');

    const stageChecks = stages.map(g => {
      const key = g.key.join(',');
      const count = mapped[g.source].length;
      return `ASSERT (SELECT COUNT(*) FROM ${T(g.stageName)})=${count} AS 'Stage row count mismatch ${g.table}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${key} FROM ${T(g.stageName)} GROUP BY ${key} HAVING COUNT(*)>1))=0 AS 'Duplicate stage key ${g.table}';`;
    }).join('\n');

    const mutations = stages.map((g,index) => {
      const fields = columns(g);
      if (index === 0) {
        return `MERGE ${T(g.table)} d USING ${T(g.stageName)} s ON d.internal_id=s.internal_id
WHEN MATCHED AND COALESCE(d.is_deleted,FALSE)=FALSE THEN UPDATE SET ${fields.filter(f => f !== 'internal_id').map(f => `${f}=s.${f}`).join(',')},synced_at=CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT(${fields.join(',')},synced_at,is_deleted,deleted_at) VALUES(${fields.map(f => `s.${f}`).join(',')},CURRENT_TIMESTAMP(),FALSE,NULL);`;
      }
      return `DELETE FROM ${T(g.table)} WHERE ${g.parent} IN (SELECT internal_id FROM ${T(stages[0].stageName)});
INSERT INTO ${T(g.table)} (${fields.join(',')},synced_at) SELECT ${fields.join(',')},CURRENT_TIMESTAMP() FROM ${T(g.stageName)};`;
    }).join('\n');

    const checkpointGuard = baseline
      ? `ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN (${cpList}) AND last_successful_modified_at=DATETIME('${baseline}'))=${groups.length} AS 'Sales Return checkpoint advanced';`
      : '';

    const checkpointSql = `MERGE ${T(C)} d USING (SELECT record_type FROM UNNEST([${cpList}]) AS record_type) s ON d.record_type=s.record_type
WHEN MATCHED THEN UPDATE SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());`;

    const orphanChecks = stages.slice(1).map(g => `ASSERT (SELECT COUNT(*) FROM ${T(g.table)} d LEFT JOIN ${T(stages[0].table)} h ON h.internal_id=d.${g.parent} WHERE h.internal_id IS NULL)=0 AS 'Orphan ${g.table}';`).join('\n');

    const sql = `BEGIN
BEGIN TRANSACTION;
${stageChecks}
ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN (${cpList}))=${baseline ? groups.length : 0} AS 'Sales Return checkpoint row count changed';
${checkpointGuard}
${mutations}
${checkpointSql}
${orphanChecks}
COMMIT TRANSACTION;
EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
END;`;

    await timed('atomic_commit_with_retry', () => atomicCommitWithGuard(sql, { wm: watermark }, baseline));
    console.log('ATOMIC MERGE + DETAIL REPLACE + FOUR CHECKPOINTS: SUCCESS');
    console.log('SALES RETURN SYNC SUCCESS; RUN presence/check/check-financial; NOT FINAL_PASS');
  } finally {
    for (const g of stages) {
      try { await timed(`cleanup_${g.table}`, () => dataset.table(g.stageName).delete({ ignoreNotFound: true })); }
      catch (error) { console.error('Stage cleanup warning', g.stageName, error.message); }
    }
  }
  perf('sync_total', elapsedMs(PERF_START));
}

main().catch(error => {
  console.error('SALES RETURN ERROR:', error.stack ?? error);
  process.exitCode = 1;
});
```

### `modules/vendor-credit/incremental-sync.mjs`

**Reconstructed SHA-256:** `43c8e7c2c4bfc3fef7cdd8cbe0a39435237643a51ec4ae870fc95660a79e5e3d`.

```javascript
// Module 11: standalone scoped incremental; no production scheduler integration.
// Atomic MERGE + active-document detail key replacement; never delete headers or soft-deleted history.
import {dataset,query,T,LOCATION} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource,FROM} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
import {sourceRows,storedRows,compareKeys,compareFields} from './reconcile-common.mjs';
import {validateNumeric} from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const mode=process.argv[2];
if(process.argv.length!==3||!['--dry-run','--sync'].includes(mode)) throw Error('Usage: node modules/vendor-credit/incremental-sync.mjs --dry-run | --sync');
const must=(condition,reason)=>{if(!condition)throw Error('MODULE 11 INCREMENTAL BLOCKED: '+reason);};
const val=x=>x&&typeof x==='object'&&'value' in x?x.value:x;
const ct=x=>Number(val(x));
const names=GROUPS.map(g=>g.table);
const cpQuoted=names.map(n=>`'${n}'`).join(',');
const scale=1000000000n;
function units(value){if(value==null)return 0n;const v=validateNumeric(value,{module:'vendor-credit',field:'gl'});must(/^-?\d+(?:\.\d{1,9})?$/.test(v),'noncanonical GL amount');const neg=v[0]==='-';const [i,f='']=v.replace('-','').split('.');const z=BigInt(i)*scale+BigInt(f.padEnd(9,'0'));return neg?-z:z;}
function signature(r){return JSON.stringify([r.vendor_credit_id,r.previous_doc_id,r.previous_line_id,r.next_doc_id,r.next_line_id,r.previous_type,r.next_type,r.link_type,r.relationship_class,r.applied_amount,r.last_modified]);}
async function checkpoint(){const rows=await query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS watermark FROM ${T('sync_checkpoints')} WHERE record_type IN UNNEST(@names)`,{names});must(rows.length===5&&new Set(rows.map(r=>r.record_type)).size===5,'five checkpoints required');const s=new Set(rows.map(r=>r.watermark));must(s.size===1&&[...s][0],'divergent checkpoints');return [...s][0];}
async function checkSchema(){for(const g of GROUPS){const [exists]=await dataset.table(g.table).exists();must(exists,'missing target '+g.table);const [meta]=await dataset.table(g.table).getMetadata();const a=meta.schema?.fields??[],b=columnDefinitions(g);must(a.length===b.length,'schema field count '+g.table);for(const [name,type] of b){const f=a.find(x=>x.name.toLowerCase()===name.toLowerCase());must(f&&(f.type.toUpperCase()==='BOOLEAN'?'BOOL':f.type.toUpperCase())===type,'schema '+g.table+'.'+name);}}}
function assertRows(mapped){const headerIds=new Set(mapped.headers.map(r=>r.vendor_credit_id));must(headerIds.size===mapped.headers.length&&headerIds.size>0,'source headers empty/duplicate');const balances=new Map();for(const r of mapped.accountingLines){must(headerIds.has(r.vendor_credit_id),'orphan GL');must(r.posting,'nonposting GL');const k=r.vendor_credit_id+'|'+r.accounting_book_id;balances.set(k,(balances.get(k)??0n)+units(r.debit)-units(r.credit));}must(balances.size===headerIds.size,'missing GL groups');for(const [k,v] of balances)must(v===0n,'unbalanced GL '+k);const a=mapped.previousLinks.map(signature).sort(),b=mapped.nextLinks.map(signature).sort();must(a.length===b.length&&a.every((v,i)=>v===b[i]),'link mirror');for(const g of GROUPS){const rows=mapped[g.source];const keys=new Set();for(const r of rows){must(headerIds.has(r.vendor_credit_id),'orphan '+g.table);const k=JSON.stringify(g.key.map(f=>r[f]??null));must(!keys.has(k),'duplicate '+g.table+' '+k);keys.add(k);for(const [f,type] of g.fields){const v=r[f];if(v==null)continue;must(type==='BOOL'?typeof v==='boolean':typeof v==='string','field type '+g.table+'.'+f);if(type==='NUMERIC')must(validateNumeric(v,{module:'vendor-credit',recordId:r.vendor_credit_id,field:f})===v,'decimal '+f);}}}return {glGroups:balances.size,linkRows:a.length};}
async function sourceSnapshot(){const auth=await token();console.log('OAuth: SUCCESS');const h=await fetchHeaders(auth);const ids=h.map(x=>String(x.internal_id));must(ids.length===new Set(ids).size,'duplicate source ids');const [l,g,p,n]=await Promise.all([fetchLines(auth,ids),fetchGL(auth,ids),fetchPreviousLinks(auth,ids),fetchNextLinks(auth,ids)]);const mapped=mapSource(h,l,g,p,n);const stats=assertRows(mapped);const watermark=h.map(x=>x.last_modified).filter(Boolean).sort().at(-1);must(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(watermark??''),'invalid source watermark');return {mapped,stats,watermark};}
async function deletedIds(mapped){
 const rows=await query(`SELECT vendor_credit_id, is_deleted, deleted_at FROM ${T('vendor_credit_headers')} WHERE COALESCE(is_deleted,FALSE)=TRUE OR deleted_at IS NOT NULL`);
 const ids=new Set();
 for(const r of rows){
  must(r.is_deleted===true && r.deleted_at!=null,'inconsistent deletion marker '+r.vendor_credit_id);
  must(!ids.has(String(r.vendor_credit_id)),'duplicate deleted header '+r.vendor_credit_id);
  ids.add(String(r.vendor_credit_id));
 }
 for(const r of mapped.headers)must(!ids.has(r.vendor_credit_id),'verified-deleted record reappeared in source: '+r.vendor_credit_id+'; manual investigation required');
 return ids;
}
async function compare(mapped,deleted){
 let changed=false;
 for(const g of GROUPS){
  const a=sourceRows(mapped,g);
  const b=(await storedRows(g)).filter(r=>!deleted.has(String(r.vendor_credit_id)));
  const x=compareKeys(a,b,g);
  const f=compareFields(x.a,x.b,g);
  const report={table:g.table,source:a.length,targetActive:b.length,excludedVerifiedDeleted:deleted.size,missingInTarget:x.onlyNetSuite,missingInSource:x.onlyBigQuery,fieldMismatches:f.mismatches,samples:f.samples};
  console.log('COMPARE',JSON.stringify(report));
  // Missing headers are never inferred to be deleted: independent deletedrecord proof is mandatory.
  // Missing detail keys under an active source header can be normal line re-keying.
  // They are replaced atomically along with the fresh full document snapshot.
  if(g.table==='vendor_credit_headers')must(!x.onlyBigQuery,'target rows missing from source: '+g.table+'; deletion requires independent proof');
  if(x.onlyNetSuite||x.onlyBigQuery||f.mismatches)changed=true;
 }
 return changed;
}
async function stage(g,rows,suffix){const name=`_stage_vc_delta_${GROUPS.indexOf(g)}_${suffix}`;const file=path.join(os.tmpdir(),`vc-${crypto.randomUUID()}.ndjson`);if(rows.length){await fs.writeFile(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});try{await dataset.table(name).load(file,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:g.fields.map(([name,type])=>({name,type}))},location:LOCATION});}finally{await fs.rm(file,{force:true});}}else{await query(`CREATE TABLE ${T(name)} (${g.fields.map(([f,t])=>`\`${f}\` ${t}`).join(',')})`);}const [count]=await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);must(ct(count.n)===rows.length,'staging row mismatch '+g.table);return {g,name,rows};}
async function commit(stages,oldCp,newCp){
 const hStage=T(stages[0].name);
 const guards=stages.map(s=>`ASSERT (SELECT COUNT(*) FROM ${T(s.name)})=${s.rows.length} AS 'stage count ${s.g.table}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${s.g.key.map(k=>`\`${k}\``).join(',')} FROM ${T(s.name)} GROUP BY ${s.g.key.map(k=>`\`${k}\``).join(',')} HAVING COUNT(*)>1))=0 AS 'stage duplicate ${s.g.table}';`).join('\n');
 const updates=stages.map((s,i)=>{
  const fields=s.g.fields.map(([f])=>f);
  const key=s.g.key.map(f=>`d.\`${f}\` IS NOT DISTINCT FROM s.\`${f}\``).join(' AND ');
  const nonkeys=fields.filter(f=>!s.g.key.includes(f));
  const assignments=nonkeys.map(f=>`d.\`${f}\`=s.\`${f}\``).concat(['d.synced_at=CURRENT_TIMESTAMP()']).join(',');
  const dest=fields.map(f=>`\`${f}\``).concat(i===0?['synced_at','is_deleted','deleted_at']:['synced_at']);
  const vals=fields.map(f=>`s.\`${f}\``).concat(i===0?['CURRENT_TIMESTAMP()','FALSE','NULL']:['CURRENT_TIMESTAMP()']);
  return `MERGE ${T(s.g.table)} d USING ${T(s.name)} s ON ${key} WHEN MATCHED THEN UPDATE SET ${assignments} WHEN NOT MATCHED THEN INSERT (${dest.join(',')}) VALUES (${vals.join(',')});`;
 }).join('\n');
 // Only obsolete DETAIL keys of headers still present and active in the source snapshot.
 // Never touch historical children of soft-deleted headers; never delete a header.
 const staleDetails=stages.slice(1).map(s=>{
  const key=[`d.vendor_credit_id=s.vendor_credit_id`,...s.g.key.filter(f=>f!=='vendor_credit_id').map(f=>`d.\`${f}\` IS NOT DISTINCT FROM s.\`${f}\``)].join(' AND ');
  return `DELETE FROM ${T(s.g.table)} d WHERE EXISTS (SELECT 1 FROM ${hStage} h WHERE h.vendor_credit_id=d.vendor_credit_id) AND EXISTS (SELECT 1 FROM ${T('vendor_credit_headers')} active WHERE active.vendor_credit_id=d.vendor_credit_id AND COALESCE(active.is_deleted,FALSE)=FALSE AND active.deleted_at IS NULL) AND NOT EXISTS (SELECT 1 FROM ${T(s.name)} s WHERE ${key});`;
 }).join('\n');
 const postGuards=stages.map(s=>{
  const key=[`d.vendor_credit_id=s.vendor_credit_id`,...s.g.key.filter(f=>f!=='vendor_credit_id').map(f=>`d.\`${f}\` IS NOT DISTINCT FROM s.\`${f}\``)].join(' AND ');
  const activeScope=`EXISTS (SELECT 1 FROM ${hStage} h WHERE h.vendor_credit_id=d.vendor_credit_id)`;
  return `ASSERT (SELECT COUNT(*) FROM ${T(s.g.table)} d WHERE ${activeScope})=${s.rows.length} AS 'postcommit count ${s.g.table}';\nASSERT (SELECT COUNT(*) FROM ${T(s.name)} s WHERE NOT EXISTS (SELECT 1 FROM ${T(s.g.table)} d WHERE ${key}))=0 AS 'postcommit missing key ${s.g.table}';`;
 }).join('\n');
 const sql=`BEGIN\nBEGIN TRANSACTION;
${guards}
ASSERT (SELECT COUNT(*) FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpQuoted}) AND last_successful_modified_at=DATETIME(@oldCp))=5 AS 'checkpoint changed';
ASSERT (SELECT COUNT(*) FROM ${T('vendor_credit_headers')} d JOIN ${hStage} s ON d.vendor_credit_id=s.vendor_credit_id WHERE d.is_deleted OR d.deleted_at IS NOT NULL)=0 AS 'deleted header resurrection blocked';
ASSERT (SELECT COUNT(*) FROM ${T('vendor_credit_headers')} d WHERE COALESCE(d.is_deleted,FALSE)=FALSE AND d.deleted_at IS NULL AND d.transaction_date >= DATE(@from) AND NOT EXISTS (SELECT 1 FROM ${hStage} h WHERE h.vendor_credit_id=d.vendor_credit_id))=0 AS 'unverified missing header blocked';
${staleDetails}
${updates}
${postGuards}
UPDATE ${T('sync_checkpoints')} SET last_successful_modified_at=DATETIME(@newCp),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP() WHERE record_type IN (${cpQuoted});
COMMIT TRANSACTION;
EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
END;`;
 await query(sql,{oldCp,newCp,from:FROM});
}

// Ignore harmless NetSuite API row ordering, but never ignore changed values or keys.
function canonicalSnapshot(mapped){
 return JSON.stringify(GROUPS.map(g=>{
  const rows=mapped[g.source].map(r=>JSON.stringify(g.fields.map(([f])=>r[f]??null)));
  rows.sort();
  return [g.table,rows];
 }));
}
const MAX_SOURCE_STABILITY_ATTEMPTS=3;

async function main(){
 console.log('MODULE 11 SCOPED INCREMENTAL',mode,'SCOPE',FROM,'.. OPEN ENDED');
 const cp=await checkpoint();
 await checkSchema();
 let snapshot=await sourceSnapshot();
 let deleted=await deletedIds(snapshot.mapped);
 let stable=false;
 // A moving source is not a deletion. Retry only this new module, without writing.
 for(let attempt=1;attempt<=MAX_SOURCE_STABILITY_ATTEMPTS;attempt++){
  const changed=await compare(snapshot.mapped,deleted);
  const targetCheckpoint=snapshot.watermark>cp?snapshot.watermark:cp;
  console.log('PLAN',JSON.stringify({changed,checkpoint:cp,watermark:snapshot.watermark,targetCheckpoint,verifiedDeletedExcluded:deleted.size,counts:snapshot.mapped.counts,...snapshot.stats,scope:`${FROM}..open-ended`,schedulerChanges:0,deletionOperations:0,stabilityAttempt:attempt}));
  if(mode==='--dry-run'){console.log('PHASE B19 DRY RUN PASS: ZERO WRITES');return;}
  if(!changed){console.log('PHASE B19 PASS_NO_CHANGE: no writes; checkpoint unchanged');return;}
  must(await checkpoint()===cp,'checkpoint changed before staging');
  const again=await sourceSnapshot();
  const updatedDeleted=await deletedIds(again.mapped);
  must(updatedDeleted.size===deleted.size&&[...deleted].every(x=>updatedDeleted.has(x)),'verified deletion set changed before commit');
  if(again.watermark===snapshot.watermark && canonicalSnapshot(again.mapped)===canonicalSnapshot(snapshot.mapped)){
   stable=true;
   break;
  }
  console.log('SOURCE_MOVING_RETRY',JSON.stringify({attempt,maxAttempts:MAX_SOURCE_STABILITY_ATTEMPTS,oldWatermark:snapshot.watermark,newWatermark:again.watermark,writeOperations:0}));
  snapshot=again;
  deleted=updatedDeleted;
 }
 must(stable,'source continued changing during bounded validation; no writes, retry on next scheduled run');
 const {mapped,watermark}=snapshot;
 const newCp=watermark>cp?watermark:cp;
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);const stages=[];
 try{
  for(const g of GROUPS){stages.push(await stage(g,mapped[g.source],suffix));console.log('STAGED',g.table,mapped[g.source].length);}
  await commit(stages,cp,newCp);
  console.log('PHASE B19 ATOMIC COMMIT PASS',JSON.stringify({counts:mapped.counts,checkpoint:newCp,verifiedDeletedExcluded:deleted.size,schedulerChanges:0,deletionOperations:0}));
 }finally{
  for(const s of stages){try{await dataset.table(s.name).delete({ignoreNotFound:true});}catch(e){console.warn('STAGE CLEANUP WARNING',s.name,String(e));}}
 }
}
main().catch(e=>{console.error('PHASE B19 BLOCKED',e.stack??String(e));process.exitCode=1;});
```

### `modules/vendor-credit/test-incremental-writer-offline.mjs`

**Reconstructed SHA-256:** `eaa444b20d4fe1e77fea20645d234aaab48951c3e8e81145976088d327ef492d`.

```javascript
// Module 11 Phase B17: OFFLINE writer contract + deterministic transaction simulation.
// Zero NetSuite API, zero BigQuery API, zero checkpoint write, zero scheduler changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GROUPS} from './schema-contract.mjs';
import {validateNumeric} from '../../common/decimal-precision.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const src=fs.readFileSync(path.join(dir,'incremental-sync.mjs'),'utf8');
let tests=0;
function test(name,fn){fn();tests++;console.log('PASS',name);}
function match(pattern,reason){assert.match(src,pattern,reason);}
const tableNames=GROUPS.map(x=>x.table);
test('five Vendor Credit targets only',()=>assert.deepEqual(tableNames,['vendor_credit_headers','vendor_credit_lines','vendor_credit_accounting_lines','vendor_credit_previous_links','vendor_credit_next_links']));
test('no NetSuite mutation; active detail replacement only',()=>{assert.doesNotMatch(src,/\bTRUNCATE\s+TABLE\b/i);assert.doesNotMatch(src,/\bUPDATE\s+Transaction\b/i);match(/const staleDetails=stages\.slice\(1\)/);match(/deleted header resurrection blocked/);});
test('dry-run exits before staging',()=>{match(/if\(mode==='--dry-run'\)\{console\.log\('PHASE B19 DRY RUN PASS: ZERO WRITES'\);return;/,'dry-run early exit');assert.ok(src.indexOf("if(mode==='--dry-run')")<src.indexOf('const suffix=crypto.randomUUID()'));});
test('no-change returns before staging and checkpoint write',()=>{match(/if\(!changed\)\{console\.log\('PHASE B19 PASS_NO_CHANGE: no writes; checkpoint unchanged'\);return;/);});
test('missing source headers block, detail re-key eligible',()=>{match(/if\(g\.table==='vendor_credit_headers'\)must\(!x\.onlyBigQuery/);match(/if\(x\.onlyNetSuite\|\|x\.onlyBigQuery\|\|f\.mismatches\)changed=true/);match(/unverified missing header blocked/);});
test('verified deleted excluded and resurrection blocked',()=>{match(/async function deletedIds/);match(/deleted header resurrection blocked/);match(/verified-deleted record reappeared in source/);});
test('stage count and duplicate guards inside commit transaction',()=>{match(/BEGIN TRANSACTION;/);match(/stage count/);match(/stage duplicate/);match(/ASSERT \(SELECT COUNT\(\*\) FROM/);});
test('checkpoint five-row compare-and-swap guard',()=>{match(/last_successful_modified_at=DATETIME\(@oldCp\)/);match(/=5 AS 'checkpoint changed'/);});
test('rollback path and stage cleanup',()=>{match(/ROLLBACK TRANSACTION; RAISE;/);match(/finally\s*\{\s*for\(const s of stages\)/);});
test('staged atomic upsert uses source keys and not unconditional overwrite',()=>{match(/MERGE \$\{T\(s\.g\.table\)\} d USING/);match(/IS NOT DISTINCT FROM/);match(/WHEN MATCHED THEN UPDATE SET/);match(/WHEN NOT MATCHED THEN INSERT/);});
test('source snapshot revalidated before write',()=>{match(/again\.watermark===snapshot\.watermark/);match(/canonicalSnapshot\(again\.mapped\)===canonicalSnapshot\(snapshot\.mapped\)/);});
test('bounded source-moving retry and fail closed',()=>{match(/MAX_SOURCE_STABILITY_ATTEMPTS=3/);match(/SOURCE_MOVING_RETRY/);match(/must\(stable,'source continued changing/);});
test('BigQuery correlated anti-join uses explicit vendor id equality',()=>{const portion=src.slice(src.indexOf('const staleDetails='),src.indexOf('const sql=`BEGIN'));assert.equal((portion.match(/d\.vendor_credit_id=s\.vendor_credit_id/g)||[]).length,2);assert.doesNotMatch(portion,/const key=s\.g\.key\.map/);});
test('exact decimal rejects unsupported precision',()=>{assert.equal(validateNumeric('4.14191395221E9',{module:'vendor-credit',field:'base_total'}),'4141913952.21');assert.throws(()=>validateNumeric('0.1234567891',{module:'vendor-credit',field:'rate'}));});
// Model the operation mandated by the source MERGE contract. This is NOT BigQuery execution.
const group=GROUPS[0];
const pk=r=>group.key.map(k=>String(r[k]??'NULL')).join('|');
function simulateAtomicMerge(state,staged,{failAfterFirst=false}={}){
 const next=structuredClone(state); // isolation: never mutate caller state until commit
 assert.equal(next.checkpoints.length,5);
 assert.ok(next.checkpoints.every(x=>x.watermark===state.expectedCheckpoint));
 const ids=new Set(staged.map(pk));
 assert.equal(ids.size,staged.length,'duplicate staged keys');
 for(const [i,row] of staged.entries()){
  const at=next.headers.findIndex(x=>pk(x)===pk(row));
  if(at>=0)next.headers[at]={...next.headers[at],...row}; else next.headers.push({...row,is_deleted:false,deleted_at:null});
  if(failAfterFirst && i===0)throw Error('INJECTED_PRE_COMMIT_FAILURE');
 }
 next.checkpoints=next.checkpoints.map(x=>({...x,watermark:'2026-10-28 11:00:00'}));
 return next;
}
const original={headers:[{vendor_credit_id:'1',document_number:'OLD',is_deleted:false,deleted_at:null}],checkpoints:tableNames.map(record_type=>({record_type,watermark:'2026-10-28 09:23:44'})),expectedCheckpoint:'2026-10-28 09:23:44'};
const updated=[{vendor_credit_id:'1',document_number:'UPDATED'},{vendor_credit_id:'2',document_number:'NEW'}];
test('SIMULATED changed-source upsert updates old and adds new key',()=>{const result=simulateAtomicMerge(original,updated);assert.equal(result.headers.length,2);assert.equal(result.headers.find(x=>x.vendor_credit_id==='1').document_number,'UPDATED');assert.equal(result.headers.find(x=>x.vendor_credit_id==='2').is_deleted,false);});
test('SIMULATED rerun is idempotent by composite-key equality',()=>{const once=simulateAtomicMerge(original,updated);const input={...once,expectedCheckpoint:'2026-10-28 11:00:00'};const twice=simulateAtomicMerge(input,updated);assert.equal(twice.headers.length,2);assert.deepEqual(twice.headers,once.headers);});
test('SIMULATED pre-commit failure preserves previous state',()=>{const snap=JSON.stringify(original);assert.throws(()=>simulateAtomicMerge(original,updated,{failAfterFirst:true}),/INJECTED_PRE_COMMIT_FAILURE/);assert.equal(JSON.stringify(original),snap);});
test('SIMULATED duplicate stage rejected before write',()=>assert.throws(()=>simulateAtomicMerge(original,[updated[0],updated[0]]),/duplicate staged keys/));
test('SIMULATED checkpoint conflict rejects commit',()=>{const conflict=structuredClone(original);conflict.checkpoints[0].watermark='2026-10-28 11:11:11';assert.throws(()=>simulateAtomicMerge(conflict,updated));});
console.log('MODULE 11 B17 OFFLINE WRITER CONTRACT PASS',JSON.stringify({tests,mode:'OFFLINE_SIMULATION_NOT_LIVE_BIGQUERY_WRITE',writeOperations:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0,liveChangedSourceWriteProven:false}));
```

### `modules/vendor-credit/test-safety.mjs`

**Reconstructed SHA-256:** `011cc54ad6c9ceaa7d9f198195f3109e5f9b95536ce85fefc36bd50807077dff`.

```javascript
// Module 11 B16: offline negative-path & static safety verification. No credentials needed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {matchDeletedRecordProof} from '../../common/verified-deletion-proof.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const read=n=>fs.readFileSync(path.join(dir,n),'utf8');
const del=read('verified-deletion.mjs');
const inc=read('incremental-sync.mjs');
const identity=JSON.parse(read('deletion-identity.confirmed.json'));
let tests=0;
function check(name,fn){fn();tests++;console.log('PASS',name);}
const proof={recordtypeid:'vendorcredit',type:'VENDORCREDIT'};
const record={recordid:'999',recordtypeid:'vendorcredit',type:'VENDORCREDIT',deleteddate:'28/10/2026'};
check('exact deletedrecord tuple accepted',()=>assert.equal(matchDeletedRecordProof([record],'999',proof).length,1));
check('other ID rejected',()=>assert.equal(matchDeletedRecordProof([record],'998',proof).length,0));
check('wrong record type rejected',()=>assert.equal(matchDeletedRecordProof([{...record,recordtypeid:'customercredit'}],'999',proof).length,0));
check('wrong transaction type rejected',()=>assert.equal(matchDeletedRecordProof([{...record,type:'CUSTCREDIT'}],'999',proof).length,0));
check('missing deleteddate rejected',()=>assert.equal(matchDeletedRecordProof([{...record,deleteddate:null}],'999',proof).length,0));
check('duplicate exact proofs visible as nonunique',()=>assert.equal(matchDeletedRecordProof([record,record],'999',proof).length,2));
check('proof identity contract',()=>{assert.equal(identity.module,'vendor-credit');assert.equal(identity.recordtypeid,'vendorcredit');assert.equal(identity.type,'VENDORCREDIT');assert.equal(identity.scope,'2026-10-01..open-ended');assert.equal(new Set(identity.evidenceRecordIds).size,3);});
check('strict max 3 & candidate count blocked',()=>{assert.match(del,/MAX=3/);assert.match(del,/onlyBQ\.length>MAX/);});
check('fresh source global absence + proof',()=>{assert.match(del,/SELECT id,type FROM Transaction WHERE id=/);assert.match(del,/matches\.length!==1/);assert.match(del,/await exactProof\(live,x,c\)/);assert.match(del,/await absentGlobally\(live,x\)/);});
check('deletion apply requires explicit confirmation',()=>assert.match(del,/NETSUITE_VERIFIED_DELETE_CONFIRM/));
check('deletion writer limited to header',()=>{assert.match(del,/UPDATE \$\{table\} SET is_deleted=TRUE,deleted_at=CURRENT_TIMESTAMP\(\)/);assert.doesNotMatch(del,/(?:DELETE FROM|TRUNCATE TABLE|DROP TABLE)/i);assert.doesNotMatch(del,/UPDATE .*sync_checkpoints/);});
check('incremental prevents header hard-delete and scopes detail replacement',()=>{assert.doesNotMatch(inc,/\bTRUNCATE TABLE\b/);assert.match(inc,/const staleDetails=stages\.slice\(1\)/);assert.match(inc,/DELETE FROM \${T\(s\.g\.table\)}/);assert.match(inc,/active\.is_deleted,FALSE/);assert.match(inc,/target rows missing from source/);assert.match(inc,/deleted header resurrection blocked/);assert.match(inc,/verified-deleted record reappeared in source/);assert.doesNotMatch(inc,/from ['"].*modules\/(?!vendor-credit)/);});
check('incremental no-change exits before staging/commit',()=>{assert.match(inc,/if\(!changed\)\{console\.log\('PHASE B19 PASS_NO_CHANGE: no writes; checkpoint unchanged'\);return;\}/);assert.match(inc,/if\(mode==='--dry-run'\)/);});
console.log('MODULE 11 B16 OFFLINE SAFETY PASS',JSON.stringify({tests,writeOperations:0,checkpointChanges:0,schedulerChanges:0}));
```

### `scripts/diagnose-transaction.mjs`

**Reconstructed SHA-256:** `927a4350f0eacd73d6dd98041d17f583b7f5356c216bf6e44d26fa65b9b6c936`.

```javascript
// Read-only diagnostic for an apparent NetSuite-only/BigQuery-only transaction.
// Run from C:\netsuite-backup: node scripts/diagnose-transaction.mjs sales-invoice 3152379
import { token, BASE_URL } from '../common/netsuite-client.mjs';
import { query, T } from '../common/bigquery-client.mjs';

const MODULES = {
  'sales-invoice': { type: 'CustInvc', table: 'sales_invoice_headers' },
  'item-fulfillment': { type: 'ItemShip', table: 'item_fulfillment_headers' },
  'sales-order': { type: 'SalesOrd', table: 'sales_order_headers' },
};
const [moduleName, inputId] = process.argv.slice(2);
const config = MODULES[moduleName];
if (!config || !/^[1-9][0-9]{0,14}$/.test(inputId ?? '')) {
  console.error('Usage: node scripts/diagnose-transaction.mjs <sales-invoice|item-fulfillment|sales-order> <numeric-id>');
  process.exit(2);
}
const id = Number(inputId);
if (!Number.isSafeInteger(id)) throw new Error('ID must be a safe integer');

async function suiteql(access, statement) {
  const url = `${BASE_URL}/services/rest/query/v1/suiteql?limit=1000&offset=0`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Prefer: 'transient' },
      body: JSON.stringify({ q: statement }),
    });
    const body = await response.text();
    if (response.ok) return JSON.parse(body).items ?? [];
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error(`NetSuite SuiteQL HTTP ${response.status}: ${body}`);
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 1500));
  }
}

console.log('DIAGNOSTIC ONLY | NO BIGQUERY OR NETSUITE WRITES');
console.log(`Module=${moduleName} ID=${id}`);
const access = await token();
const allTypes = await suiteql(access, `SELECT id, type, tranid, TO_CHAR(trandate, 'YYYY-MM-DD') AS transaction_date FROM Transaction WHERE id = ${id}`);
const expectedType = await suiteql(access, `SELECT id FROM Transaction WHERE id = ${id} AND type = '${config.type}'`);
const [bq] = await query(`SELECT CAST(internal_id AS STRING) AS id, CAST(transaction_date AS STRING) AS transaction_date, COALESCE(is_deleted, FALSE) AS is_deleted FROM ${T(config.table)} WHERE CAST(internal_id AS STRING) = '${id}'`);

console.log('NETSUITE unfiltered:', JSON.stringify(allTypes));
console.log('NETSUITE expected type visible:', expectedType.length > 0);
console.log('BIGQUERY header:', JSON.stringify(bq ?? null));
if (allTypes.length > 1) {
  console.log('RESULT: INCONSISTENT SOURCE -- multiple transactions returned for same ID');
} else if (allTypes.length === 0) {
  console.log('RESULT: NOT VISIBLE THROUGH SUITEQL. This does NOT prove deletion (permissions/type/deletion remain possible).');
} else {
  const r = allTypes[0];
  console.log('RESULT:', r.type === config.type ? 'EXPECTED TYPE, CHECK DATE/PERIOD' : `TYPE CHANGED OR DIFFERENT: ${r.type}`);
}
console.log('No apply, no deletion, no checkpoint changes.');
```

### `scripts/fast-delta-freshness-alert.mjs`

**Reconstructed SHA-256:** `b1bb6951d048c5ed72315470532a9a2f2c3db9b354cb30ca3d61b4255d196015`.

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notify } from './monitor-alert.mjs';
import { classify, initialState, transition } from './freshness-incident-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'logs', 'fast-delta');
const healthFile = path.join(dir, 'health-v2.json');
const stateFile = path.join(dir, 'freshness-alert-state.json');
const args = process.argv.slice(2);
const test = args.includes('--test');
const thresholdArg = args.find(x => /^\d+$/.test(x));
const threshold = thresholdArg ? Number(thresholdArg) : 20;
if (!Number.isInteger(threshold) || threshold < 5 || threshold > 1440) {
  console.error('Threshold must be an integer between 5 and 1440 minutes');
  process.exit(1);
}
const now = Date.now();
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const health = test ? {
  version: 2,
  modules: {
    'sales-invoice': { lastSuccessAt: new Date(now - 25 * 60_000).toISOString() },
    'item-fulfillment': { lastSuccessAt: new Date(now - 2 * 60_000).toISOString() },
    'sales-order': { lastSuccessAt: new Date(now - 2 * 60_000).toISOString() },
  },
} : read(healthFile);
const result = classify(health, now, threshold);
console.log(`FRESHNESS ALERT STATUS: ${result.status}`);
for (const detail of result.details) console.log(detail);
if (test) {
  console.log('TEST MODE: no Telegram, no state changes');
  process.exit(0);
}

// Freshness Monitor task is configured IgnoreNew, so concurrent state writers
// are not expected. Do not run this file manually while its task is Running.
const oldState = read(stateFile) || initialState();
const moved = transition(oldState, result, new Date(now).toISOString(), notify, threshold);
for (const event of moved.events) console.log('TELEGRAM:', event);
fs.mkdirSync(dir, { recursive: true });
const temp = `${stateFile}.${process.pid}.tmp`;
fs.writeFileSync(temp, JSON.stringify(moved.state, null, 2));
fs.renameSync(temp, stateFile);
if (result.status === 'FRESH' && !moved.notificationFailure) console.log('FRESHNESS OK');
process.exitCode = moved.exitCode;
```

### `scripts/fast-delta-freshness.mjs`

**Reconstructed SHA-256:** `6986e5e063024ab75db7ec4431ffdff0f1b0ca15122a87c89cd6c514ec8b6a96`.

```javascript
// Read-only check: do not equate SKIPPED_LOCKED with a successful sync.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'logs','fast-delta','health-v2.json');
const limit=Number(process.argv[2]??20);
if(!Number.isFinite(limit)||limit<10||limit>1440){console.error('Usage: node scripts/fast-delta-freshness.mjs [max-age-minutes=20]');process.exit(2);}
let state;
try {state=JSON.parse(fs.readFileSync(file,'utf8'));} catch {console.error('FRESHNESS UNKNOWN: health-v2.json not found/invalid');process.exit(2);}
const now=Date.now();let stale=0;
for(const mod of ['sales-invoice','item-fulfillment','sales-order']){
  const rec=state.modules?.[mod]??{};
  const date=Date.parse(rec.lastSuccessAt??'');
  const age=Number.isFinite(date)?Math.round((now-date)/60000):null;
  const ok=age!==null&&age>=0&&age<=limit;
  console.log(`${mod}: ${ok?'FRESH':'STALE'} ageMinutes=${age??'UNKNOWN'} threshold=${limit} lastResult=${rec.lastResult??'UNKNOWN'} lastSuccessAt=${rec.lastSuccessAt??'NONE'}`);
  if(!ok)stale++;
}
console.log(`FRESHNESS SUMMARY: ${stale?'STALE modules='+stale:'OK'}`);
process.exitCode=stale?2:0;
```

### `scripts/fast-delta.mjs`

**Reconstructed SHA-256:** `8e7a0fcefefeaa0efa120c768d7fc62bff953663d1a0f515466ff0507f625ae8`.

```javascript
// Single Fast Delta controller: sequential, lock-protected, streaming subprocesses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSharedLock } from '../common/shared-lock.mjs';
import { runChild } from '../common/child-runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = process.argv.slice(2);
if (flags.length !== 1 || !['--sync', '--dry-run'].includes(flags[0])) {
  console.error('Usage: node scripts/fast-delta.mjs --sync|--dry-run');
  process.exit(2);
}
const write = flags[0] === '--sync';
const stateDir = path.join(root, 'logs', 'fast-delta');
const stateFile = path.join(stateDir, 'health-v2.json');
const shared = createSharedLock({ stateDir: path.join(root, 'logs', 'scheduler'), worker: 'fast-delta' });
const modules = ['sales-invoice', 'item-fulfillment', 'sales-order', 'item-receipt', 'purchase-order', 'purchase-invoice', 'sales-return', 'purchase-return', 'sales-payment', 'customer-credit-memo', 'vendor-credit'];
const markerMap = {
  'sales-invoice': ['SALES INVOICE DELTA SYNC SUCCESS', 'NO CHANGES: SUCCESS'],
  'item-fulfillment': ['ITEM FULFILLMENT DELTA SYNC SUCCESS', 'NO CHANGES. DELTA SYNC SUCCESS'],
  'sales-order': ['SALES ORDER SYNC SUCCESS'],
  'item-receipt': ['ITEM RECEIPT SYNC SUCCESS', 'ITEM RECEIPT NO CHANGES: SUCCESS'],
  'purchase-order': ['PURCHASE ORDER SYNC SUCCESS; RUN check.mjs + presence.mjs; NOT FINAL_PASS', 'PURCHASE ORDER NO CHANGES: SUCCESS'],
  'purchase-invoice': ['VENDOR BILL SYNC SUCCESS; RUN reconciliation checks; NOT FINAL_PASS', 'VENDOR BILL NO CHANGES: SUCCESS'],
  'sales-return': ['SALES RETURN SYNC SUCCESS; RUN presence/check/check-financial; NOT FINAL_PASS', 'SALES RETURN NO CHANGES: SUCCESS'],
  'purchase-return': ['PURCHASE RETURN SYNC SUCCESS; RUN presence/check/check-financial; NOT FINAL_PASS', 'PURCHASE RETURN NO CHANGES: SUCCESS'],
  'sales-payment': ['SALES PAYMENT SYNC SUCCESS; RUN reconciliation checks; NOT FINAL_PASS'],
  'customer-credit-memo': ['B6 INCREMENTAL NO_CHANGE:', 'B6 INCREMENTAL ATOMIC COMMIT PASS:'],
  'vendor-credit': ['PHASE B19 PASS_NO_CHANGE:', 'PHASE B19 ATOMIC COMMIT PASS']
};
// Per-module ceiling; timeout is reported explicitly and next scheduled run retries
// from the last committed checkpoint. Never mark a timed-out run successful.
const moduleTimeoutMs = 30 * 60 * 1000;
const startedAt = new Date().toISOString();
const token = `${process.pid}-${Date.now()}`;
let lockOwned = false;

function saveState(mutator) {
  if (!write) return;
  fs.mkdirSync(stateDir, { recursive: true });
  let state;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch { state = { version: 2, modules: {} }; }
  mutator(state);
  state.version = 2;
  state.updatedAt = new Date().toISOString();
  const tmp = `${stateFile}.${token}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, stateFile);
}

async function main() {
  const lock = shared.acquire();
  if (!lock.acquired) {
    console.log('FAST DELTA STATUS: SKIPPED_LOCKED; reason=' + lock.reason);
    return; // Not a successful sync; health state is deliberately unchanged.
  }
  lockOwned = true;
  console.log(`FAST DELTA | ${write ? 'PRODUCTION WRITE' : 'READ ONLY'} | modules=${modules.join(',')}`);
  if (write) saveState(s => {
    if (s.lastRunStatus === 'RUNNING') s.previousInterruptedRun = {lastAttemptAt:s.lastAttemptAt,detectedAt:startedAt};
    s.lastAttemptAt = startedAt;
    s.lastRunStatus = 'RUNNING';
  });
  const outcomes = [];
  for (const mod of modules) {
    const file = path.join(root, 'modules', mod, ['customer-credit-memo','vendor-credit'].includes(mod) ? 'incremental-sync.mjs' : 'sync.mjs');
    console.log(`\n=== ${mod} ===`);
    let r;
    if (!fs.existsSync(file)) {
      r = {ok:false,exit:null,detail:'MODULE_FILE_MISSING',timedOut:false,markerFound:false};
    } else if (mod === 'customer-credit-memo') {
      // B9: same shared lock and sequential execution; CCM uses B6 incremental, NEVER initial sync.
      r = await runChild(process.execPath, [file, write ? '--sync' : '--dry-run'], {
        cwd: root, timeoutMs: moduleTimeoutMs,
        markers: write ? markerMap[mod] : ['B6 INCREMENTAL NO_CHANGE:', 'B6 INCREMENTAL DRY RUN PASS:'],
        onOutput: (text, isErr) => (isErr ? process.stderr : process.stdout).write(text)
      });
    } else if (mod === 'vendor-credit') {
      // Standalone B19 writer; existing modules and scheduling are unchanged.
      r = await runChild(process.execPath, [file, write ? '--sync' : '--dry-run'], {
        cwd: root, timeoutMs: moduleTimeoutMs,
        markers: write ? markerMap[mod] : ['PHASE B19 DRY RUN PASS: ZERO WRITES'],
        onOutput: (text, isErr) => (isErr ? process.stderr : process.stdout).write(text)
      });
    } else if (mod === 'purchase-return') {
      // Independent, read-only gate. No initial sync until real-source validation.
      let gateText = '';
      const gate = await runChild(process.execPath, [path.join(root, 'modules', mod, 'scheduler-gate.mjs')], {
        cwd: root, timeoutMs: moduleTimeoutMs,
        markers: ['PURCHASE RETURN GATE:'],
        onOutput: (text, isErr) => { gateText += text; (isErr ? process.stderr : process.stdout).write(text); }
      });
      if (!gate.ok) r = { ...gate, prStatus: 'FAILED' };
      else if (gateText.includes('PURCHASE RETURN GATE: NO_SOURCE')) r = { ...gate, prStatus: 'NO_SOURCE' };
      else if (gateText.includes('PURCHASE RETURN GATE: SOURCE_PENDING_INITIAL_SYNC')) r = { ...gate, prStatus: 'NEEDS_REVIEW' };
      else if (gateText.includes('PURCHASE RETURN GATE: READY')) {
        r = await runChild(process.execPath, [file, write ? '--sync' : '--dry-run'], {
          cwd: root, timeoutMs: moduleTimeoutMs,
          markers: write ? markerMap[mod] : ['DRY RUN PASS'],
          onOutput: (text, isErr) => (isErr ? process.stderr : process.stdout).write(text)
        });
        r.prStatus = r.ok ? 'SYNC_OK' : 'FAILED';
      } else r = { ...gate, ok: false, detail: 'UNKNOWN_PURCHASE_RETURN_GATE', prStatus: 'FAILED' };
    } else {
      r = await runChild(process.execPath, [file, ...(write ? (['item-receipt','purchase-order','purchase-invoice','sales-return','sales-payment'].includes(mod) ? ['--sync'] : []) : ['--dry-run'])], {
        cwd: root,
        timeoutMs: moduleTimeoutMs,
        markers: write ? markerMap[mod] : ['DRY RUN PASS'],
        onOutput: (text, isErr) => (isErr ? process.stderr : process.stdout).write(text)
      });
    }
    const status = mod === 'purchase-return' ? r.prStatus : (r.ok ? 'SYNC_OK' : 'FAILED');
    outcomes.push({module:mod,status,exit:r.exit,error:r.detail ?? null});
    if (write) saveState(s => {
      s.modules ??= {};
      const rec = s.modules[mod] ?? {};
      rec.lastAttemptAt = new Date().toISOString();
      rec.lastResult = status;
      if (status === 'SYNC_OK') { rec.lastSuccessAt = rec.lastAttemptAt; delete rec.lastError; }
      else if (status === 'NO_SOURCE') { delete rec.lastError; }
      else rec.lastError = r.detail ?? 'UNKNOWN';
      s.modules[mod] = rec;
    });
    if (status === 'NEEDS_REVIEW') console.error('PURCHASE RETURN: real source detected before initial sync; manual production validation required');
    if (status === 'FAILED') console.error(`MODULE FAILURE (${mod}): ${r.detail ?? 'UNKNOWN'}; exit=${r.exit}; timedOut=${r.timedOut}; markerFound=${r.markerFound}`);
    // Continue to remaining independent modules; no failed module checkpoint is advanced here.
  }
  const allOk = outcomes.length === modules.length && outcomes.every(x => x.status === 'SYNC_OK' || (x.module === 'purchase-return' && x.status === 'NO_SOURCE'));
  if (write) saveState(s => {
    s.lastRunStatus = allOk ? 'SYNC_OK' : 'FAILED';
    s.lastFinishedAt = new Date().toISOString();
  });
  console.log('\nFAST DELTA SUMMARY:', JSON.stringify(outcomes));
  if (allOk) console.log(`FAST DELTA ${write ? 'SYNC' : 'DRY RUN'} PASS; FULL RECONCILIATION NOT PERFORMED`);
  else process.exitCode = 1;
}
try { await main(); }
catch (e) {
  console.error('FAST DELTA ERROR:', e.stack ?? e);
  if (lockOwned && write) {
    try { saveState(s => {s.lastRunStatus='FAILED';s.lastFinishedAt=new Date().toISOString();s.lastError=e.message;}); }
    catch (stateError) {console.error('HEALTH WRITE ERROR:', stateError.message);}
  }
  process.exitCode = 1;
} finally {
  if (lockOwned) {
    const r = shared.release();
    if (!r.released) {console.error('LOCK RELEASE NEEDS REVIEW:', r.reason);process.exitCode=1;}
  }
}
```

### `scripts/freshness-incident-core.mjs`

**Reconstructed SHA-256:** `9dcef1ed874f53a4fec7900ddb4d75460cf649756a0004e1249fed9d12f2b335`.

```javascript
export const MODULES = Object.freeze(['sales-invoice', 'item-fulfillment', 'sales-order']);

export function classify(health, nowMs, thresholdMinutes = 20) {
  if (!health || health.version !== 2 || !health.modules || typeof health.modules !== 'object') {
    return { status: 'UNKNOWN', details: ['health-v2.json missing or invalid'] };
  }
  const stale = [];
  const unknown = [];
  for (const name of MODULES) {
    const row = health.modules[name];
    const parsed = Date.parse(row?.lastSuccessAt ?? '');
    if (!Number.isFinite(parsed) || parsed > nowMs + 60_000) {
      unknown.push(`${name}: lastSuccessAt missing, invalid or in future`);
      continue;
    }
    const ageMinutes = Math.max(0, Math.floor((nowMs - parsed) / 60_000));
    if (ageMinutes >= thresholdMinutes) stale.push(`${name}: STALE ageMinutes=${ageMinutes}`);
  }
  if (unknown.length) return { status: 'UNKNOWN', details: [...unknown, ...stale] };
  if (stale.length) return { status: 'STALE', details: stale };
  return { status: 'FRESH', details: [] };
}

export function initialState() {
  return { version: 2, active: false, notified: false, incidentId: null, lastStatus: 'FRESH' };
}

// Pure state transition; caller supplies notify(kind, detail, identity).
export function transition(previous, result, nowIso, notify, thresholdMinutes = 20) {
  const state = { ...initialState(), ...(previous || {}) };
  const events = [];
  let notificationFailure = false;
  const call = (kind, detail, identity) => {
    const response = notify(kind, detail, identity);
    events.push(`${kind}: ${response}`);
    if (response !== 'SENT' && response !== 'DEDUPED') notificationFailure = true;
    return response === 'SENT' || response === 'DEDUPED';
  };

  if (result.status === 'FRESH') {
    if (state.active && state.notified) {
      const ok = call('RECOVERED', `Fast Delta freshness restored. Previous status: ${state.lastStatus}\nIncident: ${state.incidentId}`, `FRESHNESS_RECOVERED:${state.incidentId}`);
      if (!ok) return { state, events, notificationFailure, exitCode: 1 };
    }
    return { state: initialState(), events, notificationFailure, exitCode: 0 };
  }

  if (!state.active) {
    state.active = true;
    state.notified = false;
    state.incidentId = nowIso;
  }
  state.lastStatus = result.status;
  if (!state.notified) {
    const kind = result.status === 'UNKNOWN' ? 'FAILED' : 'NEEDS_REVIEW';
    const detail = `Fast Delta freshness ${result.status}\nThreshold: ${thresholdMinutes} minutes\n${result.details.join('\n')}\nIncident: ${state.incidentId}`;
    if (call(kind, detail, `FRESHNESS:${state.incidentId}`)) state.notified = true;
  } else {
    events.push('ALREADY_NOTIFIED');
  }
  return { state, events, notificationFailure, exitCode: notificationFailure ? 1 : 2 };
}
```

### `scripts/monitor-alert.mjs`

**Reconstructed SHA-256:** `25959ad6a633e1ad7ded89ecd9aaf9b4e81570ed56b1f2249735baa3f37ec2c3`.

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const state=path.join(root,'logs','scheduler');
const stateFile=path.join(state,'alerts.json');
const attemptsFile=path.join(state,'alerts-attempts.jsonl');
function writeAttempt(x){fs.mkdirSync(state,{recursive:true});fs.appendFileSync(attemptsFile,JSON.stringify({...x,at:new Date().toISOString()})+'\n');}
export function notify(kind, detail, identity=kind) {
  fs.mkdirSync(state,{recursive:true});
  let states={};try{states=JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{}
  const now=Date.now();
  // Throttle identical notifications to once per six hours. Failures are retried on next run.
  if(states[identity] && now-Date.parse(states[identity])<6*3600000)return 'DEDUPED';
  const message=`NetSuite Backup ${kind}\nHost: ${process.env.COMPUTERNAME||'Windows'}\n${detail}`;
  try {
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','monitor-notify.ps1'),'-Message',message],{cwd:root,timeout:35000,windowsHide:true,stdio:'pipe'});
    states[identity]=new Date().toISOString();
    const temp=stateFile+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(states,null,2));fs.renameSync(temp,stateFile);
    writeAttempt({kind,identity,result:'SENT'});
    return 'SENT';
  }catch(e){
    // Do not expose Telegram URLs/tokens; detailed failure stays local.
    const detail=(e.stderr?.toString()||e.message||'notification failed').slice(0,500).replace(/bot\d+:[A-Za-z0-9_-]+/g,'bot[REDACTED]');
    writeAttempt({kind,identity,result:'UNDELIVERED',detail});
    console.error('ALERT NOT DELIVERED; configure Telegram for scheduled-task account. See logs/scheduler/alerts-attempts.jsonl');
    return 'UNDELIVERED';
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [kind,...rest]=process.argv.slice(2);
  if(!['TEST','FAILED','NEEDS_REVIEW','MISSED','RECOVERED'].includes(kind))process.exit(2);
  const result=notify(kind,rest.join(' ')||'Manual notification test',kind==='TEST'?'MANUAL_TEST':kind);
  console.log('ALERT:',result);
  if(result==='UNDELIVERED')process.exitCode=1;
}
```

### `scripts/sales-payment-deletion-inventory.mjs`

**Reconstructed SHA-256:** `9b54c2f93bb3b7a9930e797a7e2d479135f49144dfbcb96b9115b457ed495416`.

```javascript
// Read-only inventory. Never runs --apply; proof remains mandatory for every candidate.
import { inspectDeletionInventory, processVerifiedDeletionBatch } from '../common/verified-deletion-batch.mjs';
const inventory = inspectDeletionInventory('sales-payment');
console.log('SALES PAYMENT VERIFIED DELETION INVENTORY | READ ONLY');
console.log(JSON.stringify({onlyNetSuiteCount:inventory.onlyNetSuite.length,onlyBigQueryCount:inventory.onlyBigQuery.length,onlyNetSuite:inventory.onlyNetSuite.slice(0,10),onlyBigQuery:inventory.onlyBigQuery.slice(0,10)},null,2));
if (inventory.onlyNetSuite.length) {
  console.log('SOURCE MOVEMENT: Only NetSuite rows exist; run incremental sync before final certification.');
}
if (inventory.onlyBigQuery.length) {
  console.log('PROOF DRY RUN: maximum three candidates; no apply.');
  processVerifiedDeletionBatch('sales-payment', inventory, {apply:false});
} else {
  console.log('NO DELETION CANDIDATES. No writes performed.');
}
```

### `scripts/scheduler-runner.mjs`

**Reconstructed SHA-256:** `bc34756f898f3e9a01d8776f4a460b3f21974afa3984e9161e7e30c4c4991331`.

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { notify } from './monitor-alert.mjs';
import { createSharedLock } from '../common/shared-lock.mjs';
import { classifyV3Recovery } from '../common/v3-status-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'config', 'scheduler.json');
const stateDir = path.join(root, 'logs', 'scheduler');
const shared = createSharedLock({stateDir,worker:'scheduler'});
const statusPath = path.join(stateDir, 'latest.json');
const historyPath = path.join(stateDir, 'history.jsonl');
const skipsPath = path.join(stateDir, 'skips.jsonl');
const args = new Set(process.argv.slice(2));
const showConfig = args.has('--show-config');

function readConfig() {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/,''));
  if (!['test', 'production'].includes(cfg.mode)) throw Error('Invalid mode');
  const settings = cfg.modes?.[cfg.mode];
  if (!settings || !Number.isInteger(settings.intervalMinutes) || settings.intervalMinutes < 10 || settings.intervalMinutes % 10 !== 0 || 60 % settings.intervalMinutes !== 0) throw Error('Interval must be 10, 20, 30 or 60 minutes');
  for (const t of [settings.start, settings.end]) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw Error('Invalid HH:mm: ' + t);
  if (!Array.isArray(settings.days) || settings.days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw Error('Invalid days');
  if (cfg.timezone !== 'Asia/Jakarta') throw Error('Only Asia/Jakarta is supported for now');
  if (!Number.isInteger(cfg.maxRunMinutes) || cfg.maxRunMinutes < 1) throw Error('Invalid maxRunMinutes');
  if (!Number.isInteger(cfg.maxLogDays) || cfg.maxLogDays < 1) throw Error('Invalid maxLogDays');
  const workflow = path.resolve(root, cfg.workflow);
  if (!workflow.startsWith(root + path.sep) || !workflow.endsWith('.mjs')) throw Error('Workflow path blocked');
  if (!fs.existsSync(workflow)) throw Error('Workflow not found: ' + workflow);
  return { cfg, settings, workflow };
}
function localTime(date, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { hhmm: `${parts.hour}:${parts.minute}`, minute: Number(parts.hour) * 60 + Number(parts.minute), day: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday), key: `${parts.year}-${parts.month}-${parts.day}` };
}
function due(now, cfg, settings) {
  const loc = localTime(now, cfg.timezone);
  const start = settings.start.split(':').map(Number), end = settings.end.split(':').map(Number);
  const s = start[0]*60+start[1], e = end[0]*60+end[1];
  if (s > e) throw Error('Overnight windows not supported');
  // Derive the most recent canonical 10-minute Windows task slot. Some Windows
  // firings arrive at :05/:15/:25/etc. They must not be rejected solely for
  // being more than two minutes late. Never advance to a future slot.
  const delay = loc.minute % 10;
  const nominalMinute = loc.minute - delay;
  const hh = String(Math.floor(nominalMinute / 60)).padStart(2,'0');
  const mm = String(nominalMinute % 60).padStart(2,'0');
  const slotLocal = {...loc, hhmm: `${hh}:${mm}`, minute: nominalMinute};
  if (!settings.days.includes(loc.day) || nominalMinute < s || nominalMinute > e) return {run:false,reason:'OUTSIDE_WINDOW',local:slotLocal,delay};
  if (nominalMinute % settings.intervalMinutes !== 0) return {run:false,reason:'NOT_INTERVAL_SLOT',local:slotLocal,delay};
  return {run:true,reason:'DUE',local:slotLocal,delay};
}
function ensureStateDir() { fs.mkdirSync(stateDir, {recursive:true}); }
function record(entry) {
  ensureStateDir();
  fs.appendFileSync(historyPath, JSON.stringify(entry) + '\n');
  const tmp = statusPath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entry,null,2)+'\n');
  fs.renameSync(tmp,statusPath);
}
function skip(reason, local, detail = {}) {
  ensureStateDir();
  const entry={at:new Date().toISOString(),localDate:local.key,slot:local.hhmm,reason,...detail};
  try { fs.appendFileSync(skipsPath,JSON.stringify(entry)+'\n'); }
  catch (error) { console.error('SKIP AUDIT ERROR:',error.message); }
  console.log('SKIP:',reason,local.hhmm,'WIB');
}
function alreadyCompleted(local,cfg) {
  if (!fs.existsSync(historyPath)) return false;
  const lines=fs.readFileSync(historyPath,'utf8').split(/\r?\n/).filter(Boolean);
  for(const line of lines) {
    let entry;
    try {entry=JSON.parse(line);}catch{continue;}
    if(entry.mode!==cfg.mode || entry.slot!==local.hhmm || !entry.startedAt)continue;
    const date=localTime(new Date(entry.startedAt),cfg.timezone).key;
    if(date===local.key)return true;
  }
  return false;
}
async function acquireLockWithRetry(local) {
  const started=Date.now();
  // Fast Delta typically owns the shared lock for several minutes. A 2-minute
  // wait caused V3 slots to be missed. Wait boundedly; never break another owner.
  const timeoutMs=6*60*1000;
  const retryMs=5000;
  let attempts=0;
  while(true) {
    attempts++;
    const result=shared.acquire();
    if(result.acquired) {
      if(attempts>1) console.log('LOCK ACQUIRED AFTER RETRY','attempts='+attempts,'waitMs='+(Date.now()-started));
      return true;
    }
    if(Date.now()-started>=timeoutMs) {
      skip('LOCK_TIMEOUT',local,{attempts,waitMs:Date.now()-started,lockReason:result.reason});
      return false;
    }
    await new Promise(resolve=>setTimeout(resolve,retryMs));
  }
}
function cleanup(days) {
  if(!fs.existsSync(stateDir))return;
  const cutoff=Date.now()-days*86400000;
  for(const name of fs.readdirSync(stateDir)) {
    if(!/^run-\d{4}-\d{2}-\d{2}T.*\.log$/.test(name))continue;
    try {const p=path.join(stateDir,name);if(fs.statSync(p).mtimeMs<cutoff)fs.unlinkSync(p);}catch{}
  }
}
async function main() {
  const {cfg,settings,workflow}=readConfig();
  if(showConfig){console.log(JSON.stringify({mode:cfg.mode,timezone:cfg.timezone,settings,workflow},null,2));return;}
  const when=due(new Date(),cfg,settings);
  if(!when.run){skip(when.reason,when.local,{delayMinutes:when.delay});return;}
  if(alreadyCompleted(when.local,cfg)){skip('ALREADY_COMPLETED',when.local,{delayMinutes:when.delay});return;}
  console.log('V3 SLOT ELIGIBLE:',when.local.key,when.local.hhmm,'delayMinutes='+when.delay);
  if(!(await acquireLockWithRetry(when.local)))return;
  let logFd;
  try {
    // Recheck after lock acquisition to guard against another runner having
    // finished this same slot while we were waiting.
    if(alreadyCompleted(when.local,cfg)){skip('ALREADY_COMPLETED_AFTER_LOCK',when.local);return;}
    cleanup(cfg.maxLogDays);
    const startedAt=new Date();
    const filename='run-'+startedAt.toISOString().replaceAll(':','-')+'.log';
    const logfile=path.join(stateDir,filename);
    logFd=fs.openSync(logfile,'a');
    fs.writeSync(logFd,`Started ${startedAt.toISOString()} mode=${cfg.mode} workflow=${workflow} args=--all --sync slot=${when.local.hhmm}\n`);
    console.log('RUN:',cfg.mode,when.local.hhmm,'WIB',filename);
    const child=spawn(process.execPath,[workflow,'--all','--sync'],{cwd:root,env:{...process.env,NETSUITE_PO_ENABLED:'1',NETSUITE_PI_ENABLED:'1',NETSUITE_VERIFIED_DELETE_CONFIRM:'I_CONFIRM_VERIFIED_SOFT_DELETE'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let captured='';const maxCapture=2_000_000;
    const onData=chunk=>{const s=chunk.toString('utf8');fs.writeSync(logFd,s);captured=(captured+s).slice(-maxCapture);};
    child.stdout.on('data',onData);child.stderr.on('data',onData);
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},cfg.maxRunMinutes*60000);
    const completion=await new Promise(resolve=>{child.on('error',e=>resolve({code:1,error:e.message}));child.on('close',(code,signal)=>resolve({code:code??1,signal}));});
    clearTimeout(timer);
    const status=classifyV3Recovery(completion.code,captured,timedOut);
    const entry={startedAt:startedAt.toISOString(),finishedAt:new Date().toISOString(),mode:cfg.mode,slot:when.local.hhmm,status,exitCode:completion.code,timedOut,log:filename};
    fs.writeSync(logFd,`\nScheduler status=${status} exitCode=${completion.code} timedOut=${timedOut}\n`);
    record(entry);
    if(status==='FAILED'||status==='NEEDS_REVIEW')notify(status,`Mode: ${cfg.mode}\nSlot: ${when.local.key} ${when.local.hhmm} WIB\nExit code: ${completion.code}\nLog: ${filename}`,`STATUS:${entry.startedAt}:${status}`);
    console.log('RESULT:',status,'exitCode='+completion.code,'log='+filename);
    if(status==='NEEDS_REVIEW')process.exitCode=3;
    else if(status!=='FINAL_PASS')process.exitCode=1;
  }finally {
    if(logFd!==undefined)fs.closeSync(logFd);
    const result=shared.release();
    if(!result.released)console.error('SCHEDULER LOCK RELEASE:',result.reason);
  }
}
main().catch(e=>{console.error('SCHEDULER FAILED:',e.stack??e);try{record({startedAt:new Date().toISOString(),status:'FAILED',error:e.message});notify('FAILED',`Runner error: ${e.message}`,'RUNNER_ERROR');}catch{}process.exitCode=1;});
```

### `scripts/scheduler-watchdog.mjs`

**Reconstructed SHA-256:** `33ccd26e34bfead02e92b8f0ab1fa16b707f66ff924dafbd524cd63a34772172`.

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notify } from './monitor-alert.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'logs','scheduler');
const config=JSON.parse(fs.readFileSync(path.join(root,'config','scheduler.json'),'utf8').replace(/^\uFEFF/,''));
const window=config.modes[config.mode];
if(!window||config.timezone!=='Asia/Jakarta')throw Error('Unsupported configuration');
const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'});
function local(d){const p=Object.fromEntries(fmt.formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return {key:`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`,min:+p.hour*60+(+p.minute),day:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday)};}
const start=window.start.split(':').map(Number).reduce((a,b)=>a*60+b),end=window.end.split(':').map(Number).reduce((a,b)=>a*60+b);
if(start>end)throw Error('Overnight windows unsupported');
// Find most recent scheduled slot at least grace minutes in the past. Uses timezone-aware local slots.
const grace=Number(process.env.NETSUITE_WATCHDOG_GRACE_MINUTES||45);
if(!Number.isFinite(grace)||grace<10)throw Error('Invalid grace');
let dueSlot=null;
const now=Date.now();
for(let t=now-grace*60000;t>now-72*3600000;t-=60000){const l=local(new Date(t));if(window.days.includes(l.day)&&l.min>=start&&l.min<=end&&l.min%window.intervalMinutes===0){dueSlot=l.key;break;}}
if(!dueSlot){console.log('WATCHDOG: no due slot in past 72 hours');process.exit(0);}
let latest=null;try{latest=JSON.parse(fs.readFileSync(path.join(dir,'latest.json'),'utf8'));}catch{}
const lastSlot=latest?.startedAt?local(new Date(latest.startedAt)).key:null;
const recoveryStatePath=path.join(dir,'watchdog-recovery.json');
let recoveryState={missed:false};
try{
  recoveryState=JSON.parse(fs.readFileSync(recoveryStatePath,'utf8'));
}catch{}
function saveRecoveryState(){
  fs.writeFileSync(recoveryStatePath,JSON.stringify(recoveryState,null,2));
}
const lockPath=path.join(dir,'.running.lock','owner.json');
let running=false;try{const owner=JSON.parse(fs.readFileSync(lockPath,'utf8'));if(owner.pid&&owner.host===process.env.COMPUTERNAME){try{process.kill(owner.pid,0);running=true;}catch(e){running=e.code==='EPERM';}}}catch{}
// Task might legitimately be processing a slower run. We do not assume missing until deadline expires.
if(!lastSlot||lastSlot<dueSlot){
 const text=`Expected slot: ${dueSlot} WIB\nLast start: ${lastSlot||'NONE'}\nMode: ${config.mode}\nActive lock: ${running}\nTask scheduler or machine may be offline.`;
 const r=notify('MISSED',text,`MISSED:${dueSlot}`);
 recoveryState.missed=true;
recoveryState.lastMissedSlot=dueSlot;
saveRecoveryState();
console.log('WATCHDOG: MISSED',dueSlot,'alert=',r);
 process.exitCode=2;
}else{
 console.log('WATCHDOG: OK expected=',dueSlot,'last=',lastSlot,'status=',latest.status);
if(recoveryState.missed && latest.status==='FINAL_PASS'){
  notify('RECOVERED',`Backup recovered at ${lastSlot} WIB\nPrevious missed slot: ${recoveryState.lastMissedSlot}`,'WATCHDOG_RECOVERED:'+lastSlot);
  recoveryState.missed=false;
  recoveryState.recoveredAt=lastSlot;
  saveRecoveryState();
}
 if(['FAILED','NEEDS_REVIEW'].includes(latest.status))notify(latest.status,`Last backup: ${lastSlot}\nStatus: ${latest.status}\nLog: ${latest.log||'n/a'}`,`STATUS:${latest.startedAt}:${latest.status}`);
}
```

### `scripts/shared-lock-inspect.mjs`

**Reconstructed SHA-256:** `890c41ee8ea5d4dd83b45c7ff47d65e373d45fd049b455e44137b7d5681b82f7`.

```javascript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const stateDir = path.join(root, 'logs', 'scheduler');

const paths = {
  lock: path.join(stateDir, '.running.lock'),
  guard: path.join(stateDir, '.lock-maintenance.guard')
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function inspect(name, directory) {
  const exists = fs.existsSync(directory);

  if (!exists) {
    return { name, exists: false, status: 'ABSENT' };
  }

  const owner = readJson(path.join(directory, 'owner.json'));

  if (!owner) {
    return {
      name,
      exists: true,
      status: 'UNKNOWN_OWNER'
    };
  }

  if (owner.host !== os.hostname()) {
    return {
      name,
      exists: true,
      status: 'FOREIGN_HOST',
      owner
    };
  }

  let pidStatus = 'UNKNOWN';

  if (Number.isInteger(owner.pid) && owner.pid > 0) {
    try {
      process.kill(owner.pid, 0);
      pidStatus = 'PID_EXISTS';
    } catch (error) {
      pidStatus = error.code === 'ESRCH'
        ? 'PID_NOT_FOUND'
        : 'UNKNOWN';
    }
  }

  return {
    name,
    exists: true,
    status: pidStatus,
    owner
  };
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  lock: inspect('lock', paths.lock),
  guard: inspect('guard', paths.guard)
}, null, 2));
```

### `scripts/verified-deletion.mjs`

**Reconstructed SHA-256:** `f33269dd9219c03ed8d3ed503392efcfd21a4c0b0b3581781c7c1bd427eb8b27`.

```javascript
// Verified deletion: one source-proven transaction at a time; historical detail untouched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BigQuery } from '@google-cloud/bigquery';
import { token, fetchAll } from '../common/netsuite-client.mjs';
import { matchDeletedRecordProof } from '../common/verified-deletion-proof.mjs';

const args = process.argv.slice(2);
const idPos = args.indexOf('--id');
const rawId = idPos === -1 ? null : args[idPos + 1];
const apply = args.includes('--apply');
const modPos = args.indexOf('--module');
const moduleName = modPos === -1 ? 'sales-invoice' : args[modPos + 1];
const recordTypes = { 'sales-invoice': { recordtypeid:'invoice', type:'INVOICE', table:'sales_invoice_headers' }, 'sales-order': { recordtypeid:'salesorder', type:'SALESORDER', table:'sales_order_headers' }, 'item-fulfillment': { recordtypeid:'itemfulfillment', type:'ITEMFULFILLMENT', table:'item_fulfillment_headers' }, 'item-receipt': { recordtypeid:'itemreceipt', type:'ITEMRECEIPT', table:'item_receipt_headers' }, 'purchase-order': { recordtypeid:'purchaseorder', type:'PURCHASEORDER', table:'purchase_order_headers' }, 'purchase-invoice': { recordtypeid:'vendorbill', type:'VENDORBILL', table:'purchase_invoice_headers' }, 'sales-return': { recordtypeid:'itemreceipt', type:'ITEMRECEIPT', table:'sales_return_headers' }, 'purchase-return': { recordtypeid:'vendorreturnauthorization', type:'VENDORRETURNAUTHORIZATION', table:'purchase_return_headers' }, 'sales-payment': { recordtypeid:'customerpayment', type:'CUSTOMERPAYMENT', table:'sales_payment_headers' } };
const record = recordTypes[moduleName];
const headerIdColumn = moduleName === 'sales-payment' ? 'payment_id' : 'internal_id';
const sandbox = args.includes('--sandbox');
const valid = new Set(['--id','--module','--apply','--dry-run','--sandbox']);
if (!/^[1-9][0-9]{0,14}$/.test(rawId ?? '') || args.some((x, i) => !valid.has(x) && i !== idPos + 1 && i !== modPos + 1) || !record || (apply && args.includes('--dry-run'))) {
  console.error('Usage: node scripts/verified-deletion.mjs --id 3150917 [--module sales-invoice|sales-order|item-fulfillment|purchase-invoice] [--sandbox] [--dry-run|--apply]');
  process.exit(2);
}
if (apply && process.env.NETSUITE_VERIFIED_DELETE_CONFIRM !== 'I_CONFIRM_VERIFIED_SOFT_DELETE') throw Error('BLOCKED: explicit NETSUITE_VERIFIED_DELETE_CONFIRM required');
const project = 'even-gearbox-255203';
const dataset = sandbox ? 'netsuite_backup_recovery_test' : 'netsuite_backup';
const credentials = process.env.NETSUITE_TEST_CREDENTIALS;
if (sandbox && (process.env.NETSUITE_SANDBOX_CONFIRM !== 'I_UNDERSTAND_SANDBOX_ONLY' || !credentials || !fs.existsSync(credentials))) throw Error('BLOCKED: sandbox test account and confirmation required');
const bq = new BigQuery({ projectId: project, ...(sandbox ? {keyFilename: credentials} : {}) });
const table = `\`${project}.${dataset}.${record.table}\``;
const run = async (q, params = {}) => (await bq.query({query:q,params,location:'asia-southeast1'}))[0];
const id = Number(rawId);
const bqId = rawId; // Supports STRING and INT64 internal_id columns without implicit comparison casts.
const access = await token();
const auditSql = `SELECT recordid, recordtypeid, type, name, deleteddate, deletedby, context FROM deletedrecord WHERE recordid = ${id}`;
const evidence = await fetchAll(access, auditSql);
const matching = matchDeletedRecordProof(evidence, rawId, record);
if (matching.length !== 1) throw Error(`NOT VERIFIED: audit rows=${evidence.length}, verified ${moduleName}=${matching.length}. No changes.`);
const stillVisible = await fetchAll(access, `SELECT id FROM Transaction WHERE id = ${id}`);
if (stillVisible.length) throw Error('BLOCKED: transaction remains visible; no deletion apply');
const before = await run(`SELECT CAST(${headerIdColumn} AS STRING) AS id, transaction_date, COALESCE(is_deleted,FALSE) AS is_deleted FROM ${table} WHERE CAST(${headerIdColumn} AS STRING) = @id`, {id: bqId});
if (before.length !== 1) throw Error('BLOCKED: expected exactly one header row');
if (before[0].is_deleted) { console.log('ALREADY SOFT-DELETED: NO-OP'); process.exit(0); }
const e = matching[0];
console.log(`VERIFIED DELETE | ${sandbox?'SANDBOX':'PRODUCTION'} | ID=${id} | recordtypeid=${e.recordtypeid} | name=${e.name} | deleteddate=${e.deleteddate} | deletedby=${e.deletedby}`);
if (!apply) {console.log('DRY RUN PASS: NetSuite proof verified, BigQuery unchanged');process.exit(0);}
// Re-read evidence before write to reduce the window between verification and mutation.
const proof2 = await fetchAll(await token(), auditSql);
if (matchDeletedRecordProof(proof2, rawId, record).length !== 1) throw Error('BLOCKED: deletion evidence changed');
if ((await fetchAll(await token(), `SELECT id FROM Transaction WHERE id = ${id}`)).length) throw Error('BLOCKED: source reappeared');
// One transaction, one header only. No line deletes; no checkpoint writes.
await run(`BEGIN TRANSACTION;
 ASSERT (SELECT COUNT(*) FROM ${table} WHERE CAST(${headerIdColumn} AS STRING)=@id AND COALESCE(is_deleted,FALSE)=FALSE)=1 AS 'Header state changed';
 UPDATE ${table} SET is_deleted=TRUE, deleted_at=CURRENT_TIMESTAMP() WHERE CAST(${headerIdColumn} AS STRING)=@id AND COALESCE(is_deleted,FALSE)=FALSE;
 ASSERT (SELECT COUNT(*) FROM ${table} WHERE CAST(${headerIdColumn} AS STRING)=@id AND is_deleted=TRUE)=1 AS 'Soft-delete assertion failed';
 COMMIT TRANSACTION;`, {id: bqId});
const after = await run(`SELECT COALESCE(is_deleted,FALSE) AS is_deleted FROM ${table} WHERE CAST(${headerIdColumn} AS STRING)=@id`,{id: bqId});
if (after.length!==1 || !after[0].is_deleted) throw Error('POST-COMMIT VERIFICATION FAILED');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const logDir=path.join(root,'logs','verified-deletions');fs.mkdirSync(logDir,{recursive:true});
fs.appendFileSync(path.join(logDir,'audit.jsonl'),JSON.stringify({at:new Date().toISOString(),dataset,module:moduleName,id,recordtypeid:e.recordtypeid,name:e.name,deleteddate:e.deleteddate,deletedby:e.deletedby,result:'SOFT_DELETED'})+'\n');
console.log('VERIFIED SOFT DELETE PASS; historical lines and checkpoints unchanged by this script');
```

## Appendix B — Previous handovers and source of truth

Earlier handovers available within original project archive `.docs/1_...` through `.docs/9_NETSUITE_BACKUP_HANDOVER_9_MODULES_FINAL_2026-10-26.md`. Role and permissions in section 3 are transcribed from `.docs/9_...`. Prior phases for initial six/nine modules are recorded there. Preserve these as history; **this document is the operational handover**, but actual production files are ultimate code authority. Avoid assuming missing file paths/permissions from models. Future handover update must append **only verified deltas, actual SHA from user machine, PASS evidence**, while maintaining the frozen baseline and 9 required + 6 additional scope.



---

## APPENDIX B — REFERENCE ARCHIVES / FILE MANIFEST (NOT PRODUCTION VERIFICATION)

- `netsuite-backup(20261029-025724).zip`: 2,413,818 bytes; SHA256 `9ce6d2a1e2156a7abdf32b88114ddfdfe06fa52a8034273adb8ad70c78bb1d5b`; 1148 zip entries.
- `module-14-phase-q-registration-validated.zip`: 15,568 bytes; SHA256 `80a5ecf1a4a93b099633e039b7a83cb9e11b962a4cf44e7b62712a82576de26f`; 7 zip entries.
- `module-15-phase-o-standalone-integration.zip`: 4,040 bytes; SHA256 `97249144eeb3d433ea110985ccb8e77170ea160f29f96e5d26826d9a9e9e3133`; 2 zip entries.
- `module-15-phase-p-final-pre-registration-gate.zip`: 2,148 bytes; SHA256 `5b16f101075aa9047f9e3d002b93b368942a0297542743b523b7ef2c8e14a948`; 1 zip entries.
- `module-15-phase-q-integration-candidate.zip`: 13,814 bytes; SHA256 `127d2ad8cc11e6377c27ea0ecc7e3594dd6b27cbfb398ccf6ec25eaafc427cd3`; 2 zip entries.
- `module15-phase-q-source.zip`: 17,073 bytes; SHA256 `c381ddb516971ba311275e55de670c16899c81d0adddc57c47145501db5afc73`; 3 zip entries.

### Current handover file provenance

- Generated locally 2026-11-02T16:03:06.954975+07:00 Asia/Jakarta offset.
- Current module statuses and cleanup proposals were taken from outputs supplied in this conversation; where no post-action result exists the file is marked pending/unverified.
