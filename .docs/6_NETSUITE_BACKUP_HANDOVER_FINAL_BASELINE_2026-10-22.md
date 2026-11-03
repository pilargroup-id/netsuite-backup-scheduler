# NETSUITE BACKUP -> BIGQUERY — HANDOVER MASTER FINAL, 22 OKTOBER 2026

**Revisi:** setelah Scheduler V3 `2026-10-22T09-01-31.306Z` (= **16:01 WIB**), hasil `6/6 FINAL_PASS`, dilaporkan sekitar 16:17 WIB.  
**Cakupan:** seluruh riwayat setup dan baseline sebelumnya + addendum teknis terbaru: Decimal Precision Hardening, Purchase Invoice empty staging, Verified Deletion 6/6, audit proof, test, batasan dan handover Modul 7.  
**Prioritas otoritas:** source aktif `C:\netsuite-backup` dan hasil run live terbaru > Bagian **A–K (ADDENDUM TERBARU)** dokumen ini > bagian "ARSIP HANDOVER SEBELUM REVISI". Arsip lama dipertahankan untuk konteks historis dan tidak boleh diperlakukan sebagai status operasional final.

**Instruksi pada chat berikutnya:** Baca addendum dahulu, lalu arsip untuk setup awal dan histori. **Jangan mereset checkpoint, menyalin script lama, mengganti scheduler, atau mengaktifkan feature flag PO/PI yang sudah tidak digunakan.** Selalu periksa kode dan nama file aktif sebelum patch. PowerShell patch wajib memiliki preflight, backup, syntax-check, rollback dan audit-only. Jangan pernah mengekspor kredensial privat atau menganggap bukti `ONLY BIGQUERY` saja cukup untuk deletion.

---

## A. Snapshot final saat dokumentasi dibuat

### A.1 Enam modul — status terbaru yang telah dikonfirmasi

| Modul | Folder | Latest V3 (16:01 WIB) | Perubahan terbaru / catatan |
|---|---|---|---|
| Sales Invoice | `modules/sales-invoice` | `FINAL_PASS` | `rate` presisi 9 desimal; validasi NUMERIC; automatic verified deletion telah benar-benar menghapus beberapa batch ber-audit |
| Item Fulfillment | `modules/item-fulfillment` | `FINAL_PASS` | validasi NUMERIC; source-accounting reconciliation 964 headers, 2710 lines, 0 differences pada audit-only sebelumnya; verified deletion existing |
| Sales Order | `modules/sales-order` | `FINAL_PASS` | `rate` dinormalisasi menggunakan shared utility; validasi NUMERIC; verified deletion existing |
| Item Receipt | `modules/item-receipt` | `FINAL_PASS`* | NUMERIC validator; audit identity `itemreceipt`; automatic verified deletion terintegrasi; header amount/GL accounting book **belum certified** |
| Purchase Order | `modules/purchase-order` | `FINAL_PASS` | NUMERIC validator; audit identity `purchaseorder`; verified deletion baru terintegrasi |
| Purchase Invoice / Vendor Bill | `modules/purchase-invoice` | `FINAL_PASS` | empty-stage bug diperbaiki; `rate` dan `exchange_rate` dinormalisasi; NUMERIC validator; verified deletion baru terintegrasi |

\* **PERINGATAN PENTING:** IR `FINAL_PASS` milik workflow existing (source count, presence, financial detail, integritas). Log tetap menyatakan **`AMOUNT KPI NOT CERTIFIED; NOT FINAL_PASS`** untuk sertifikasi header amount/GL accounting book. Jangan menyimpulkan IR sudah certified secara akuntansi penuh.

**Bukti operasional V3 terbaru:** log `logs/scheduler/run-2026-10-22T09-01-31.306Z.log`: `sales-invoice`, `item-fulfillment`, `sales-order`, `item-receipt`, `purchase-order`, `purchase-invoice` masing-masing `FINAL_PASS`; `Scheduler status=FINAL_PASS exitCode=0 timedOut=false`. Untuk IR/PO/PI muncul `VERIFIED DELETION INVENTORY CLEAN`. Ini adalah hasil **satu run production** dengan source pada snapshot itu, bukan garansi semua future run akan selalu PASS.

**Bukti Fast Delta pasca precision-hardening:** `logs/fast-delta/run-2026-10-22_14-51-34.log` menunjukkan **6/6 `SYNC_OK`, exit=0**, setelah NUMERIC validators keenam modul dipasang. Run Fast Delta lain `run-2026-10-22_15-46-34.log` juga 6/6 `SYNC_OK`.

**Lock/scheduler dari pengecekan terakhir:** `NetSuite Backup Fast Delta=Running`, `NetSuite Backup V3=Ready`, shared lock `PID_EXISTS` dimiliki `worker=fast-delta`, PID `18068`, mulai 16:16:34 WIB (time of observation 16:17 WIB), guard `ABSENT`. **PID bukan konfigurasi tetap**, hanya nilai diagnostik saat itu. Jangan mematikan worker/menghapus lock valid.

### A.2 Status deletion yang benar, jangan bingung dengan insiden awal

Pada awal diagnosis ada **14** Sales Invoice dari batch deletion 21 Oktober 2026 yang tersisa aktif di BQ. Recovery Controller ternyata **sudah** memiliki automatic verified deletion untuk SI/SO/IF. Sumber masalah utamanya bukan fitur absen; run awal SI sempat terhambat error presisi NUMERIC pada field rate sehingga catch-up/recovery tertunda. Setelah patch dan scheduler berjalan, backlog diproses bertahap dan akhirnya `ONLY BIGQUERY: 0` pada audit berikutnya. SI sempat `ONLY NETSUITE: 1` karena transaksi baru (contoh ID `3159073`, kemudian `3159077`) muncul selama aktivitas sumber; kemudian scheduler V3 memberi `FINAL_PASS`.

**Jangan menyatakan ke-14 invoice diselesaikan oleh satu run**. Ledger audit menunjukkan batch terpisah, sebelum dan sesudah patch. Bukti di `logs/verified-deletions/audit.jsonl` dan scheduler log harus jadi sumber final untuk transaksi spesifik.

---

## B. Baseline wajib universal untuk SEMUA modul — termasuk Modul 7+

1. **Incremental sync dengan watermark/checkpoint dan overlap 5 menit**, jika pola modul existing sesuai; run full initial/diagnostic terpisah dan read-only dahulu.
2. **NetSuite OAuth2 M2M, SuiteQL / REST API**, gunakan `common/netsuite-client.mjs`, role persis **`PNM NetSuite Backup Integration`**, tanpa mengubah role/sertifikat tanpa kebutuhan.
3. **BigQuery dataset `even-gearbox-255203.netsuite_backup`, location `asia-southeast1`**. Skema modul minimal header, detail relevan, field audit, checkpoint.
4. **Validation BEFORE write** (source integrity, NUMERIC representability, presence) lalu staging NDJSON, staging check, **atomic MERGE + detail replace + checkpoint**, post-commit reconciliation. Jangan pisahkan header/lines update tanpa mekanisme atomic existing.
5. **`NUMERIC` default maksimal 9 digit di belakang koma** dan batas magnitude; rate dapat dinormalisasi secara deterministik berbasis string/BigInt bila kebijakan field mengizinkan. Monetary amount, COGS, debit, credit tidak boleh rounded silently.
6. **AUTOMATIC VERIFIED DELETION adalah BASELINE WAJIB.** Tidak boleh melakukan soft delete berdasar ketidakhadiran di SuiteQL saja. Harus independent `deletedrecord` proof + exact record type + source still invisible + BQ unique row + dry-run + re-proof + atomic header-only soft-delete + post-commit check + audit log.
7. **Batas deletion** `maxDeletePerRun=3` kandidat per **Core Recovery invocation** per modul. Scheduler V3 berjalan 20 menit; satu siklus bisa memanggil Core lebih dari sekali. Batas tersebut bukan fixed 3 per 20 menit dan bukan limit harian.
8. **`is_deleted=TRUE`, `deleted_at=CURRENT_TIMESTAMP()` di header**, historical lines/GL/detail tetap tersimpan; verified deletion script **tidak** memindahkan checkpoint.
9. **Presence discrepancy tetap `NEEDS_REVIEW`** sampai verified deletion/catch-up menyelesaikannya. `ONLY NETSUITE` bukan deletion, masuk delta sync / bounded recovery. `ONLY BIGQUERY` bukan bukti deletion. Source-moving perlu pengamatan ulang.
10. **Read-only audit** dan dry-run bukan `FINAL_PASS`. `FINAL_PASS` butuh workflow full existing dan tidak boleh di-hardcode.
11. **Scheduler:** task `NetSuite Backup V3` (sekitar tiap 20 menit), `NetSuite Backup Fast Delta` (sekitar tiap 5 menit). Shared lock serialize; jangan panggil manual production `--sync` saat lock dipegang.
12. **Jangan membuat implementasi modul berikut berbeda dari baseline**: folder `modules/<slug>` berisi mapping/sync/presence/check, extend recovery/scheduler list hanya setelah hasil probe, exact guards, negative test, audit, dan evidence. Tidak ada rewrite massal.

---

## C. Decimal Precision Hardening — kronologi, berkas, aturan

### C.1 Insiden awal Sales Invoice

Scheduler V3 14:01 WIB (log `run-2026-10-22T07-01-31.354Z.log`) mengalami `sales-invoice: ERROR`; lima modul lain `FINAL_PASS`; overall `FAILED exitCode=1`. Fast Delta sempat error staging `Invalid NUMERIC value: 4816.666666666667 Field: rate` (BigQuery `NUMERIC` max 9 fractional decimal digits). SI source fetch/validation sudah PASS; gagal ketika NDJSON BigQuery load, sebelum checkpoint commit. Bukan indikasi korupsi header atau delete.

Patch minimal `modules/sales-invoice/mapping.mjs`: tambah `asNumericRate(value)` deterministik (string/BigInt, max 9 digits) dan ganti **hanya** `rate: asDecimal(r.rate)` menjadi `rate: asNumericRate(r.rate)`. Backup `mapping.mjs.bak-20261022-141406`. Offline test input `4816.666666666667` -> `4816.666666667` PASS. Sync berikutnya `STAGING VALIDATION: PASS`, `ATOMIC MERGE + REPLACE + CHECKPOINT: SUCCESS`, SI delta sync success. Jangan membulatkan semua `asDecimal` tanpa analisis.

### C.2 Shared utility `common/decimal-precision.mjs`

Dibuat dan unit test PASS; berisi:

- `validateNumeric(value, context={})`: normalisasi format desimal, cek representability `NUMERIC`, lempar `BigQuery NUMERIC precision violation [...]` jika skala/range tidak muat; **tidak membulatkan**.
- `normalizeNumericRate(value, context={})`: normalisasi rate maksimal 9 digit desimal (ties rounded away from zero), konversi notasi ilmiah, hasil difinalkan via `validateNumeric`. Canonical trailing zero dihapus, sehingga `1.1234567895` -> **`1.12345679`**, bukan fixed-format `1.123456790`. Secara numerik setara.
- `validateNumericRows(rows, fields, context={})`: iterasi kolom dengan tipe `'NUMERIC'`, konteks `module/recordId/field`, throw sebelum staging. Mengembalikan array asli (tanpa mutasi).

Unit test dasar dan `NUMERIC ROW VALIDATOR TEST PASS` telah dilaporkan. Utility memeriksa **format/scale/range**, bukan otomatis membenarkan kebijakan skala bisnis atau keakuratan float source yang lebih awal.

### C.3 Pemasangan rate precision

| Modul | File | Perubahan | Bukti |
|---|---|---|---|
| Sales Invoice | `modules/sales-invoice/mapping.mjs` | `asNumericRate` untuk line `rate` | Unit test PASS; Fast Delta PASS |
| Sales Order | `modules/sales-order/mapping.mjs` | import `normalizeNumericRate`; ganti `l.rate == null ? null : String(l.rate)` | Backup `mapping.mjs.bak-20261022-143824`, unit test PASS |
| Purchase Invoice | `modules/purchase-invoice/mapping.mjs` | import utility; normalisasi `rate` dan `exchange_rate` saja | Backup `mapping.mjs.bak-20261022-143908`, corrected unit test + PI dry-run PASS |
| Item Receipt | `mapping.mjs` | existing `Number(v).toFixed(6)` dipertahankan | Source dry-run PASS; catatan possible IEEE-754 precision loss |
| Purchase Order | `mapping.mjs` | existing `Number(v).toFixed(6)` dipertahankan | Source dry-run PASS; catatan possible IEEE-754 precision loss |
| Item Fulfillment | `mapping.mjs`/`sync.mjs` | existing `toFixed(2)`, `toFixed(6)`, `Math.round(...*100)` dipertahankan demi COGS baseline | Accounting reconciliation PASS pada run tercatat |

**Jangan mengklaim semua source precision loss IEEE-754 telah diperbaiki.** Existing IF/IR/PO tetap memakai floating-point transform yang sebelumnya dikalibrasi untuk schema bisnis. Hardening kali ini fokus memastikan NDJSON representable dan tidak melakukan perubahan finansial diam-diam. Bila kemudian diperlukan `BIGNUMERIC`, butuh migration plan dan ulang full reconciliation.

### C.4 Validator sebelum staging, keenam modul

- IR, PO, PI: import `validateNumericRows` di `sync.mjs`; panggil pada awal `async function stage(name,rows,fields){` sebelum serialisasi. Fields berasal dari schema explicit, termasuk rate/amount/GL.
- SO: validator di staging sebelum `rows.map(JSON.stringify)` dengan `schemaFields(schema).map(f=>[f.name,f.type])`.
- SI: validator dua dataset source di `sync.mjs` sebelum `jsonl(hf, source.headers)`; header `[exchange_rate,subtotal,discount_total,tax_total,total_amount]`, lines `[quantity,rate,amount]`.
- IF: validator dua dataset sebelum `writeJsonl(headerFile, source.headerRows)`; header `[total_quantity_shipped,total_cogs_amount]`, lines `[quantity_shipped,unit_cost,cogs_amount]`.

Semua `node --check modules/<mod>/sync.mjs` PASS dan 6/6 `VALIDATOR FOUND`. Backup SI & IF `sync.mjs.bak-20261022-144807`. Dry-run IR/PO/PI PASS. **Fast Delta 14:51 WIB: 6/6 `SYNC_OK`, exit=0 setelah integrasi.**

### C.5 40 kolom BigQuery `NUMERIC` terinventarisasi

| Tabel | Kolom NUMERIC |
|---|---|
| `sales_invoice_headers` | `exchange_rate`, `subtotal`, `discount_total`, `tax_total`, `total_amount` |
| `sales_invoice_lines` | `quantity`, `rate`, `amount` |
| `item_fulfillment_headers` | `total_quantity_shipped`, `total_cogs_amount` |
| `item_fulfillment_lines` | `quantity_shipped`, `unit_cost`, `cogs_amount` |
| `sales_order_headers` | `total_amount` |
| `sales_order_lines` | `quantity`, `rate`, `foreign_amount`, `net_amount`, `tax_amount` |
| `item_receipt_headers` | `total_amount` |
| `item_receipt_lines` | `quantity`, `rate`, `foreign_amount`, `net_amount` |
| `purchase_order_headers` | `exchange_rate`, `foreign_total`, `base_total` |
| `purchase_order_lines` | `quantity`, `rate`, `foreign_amount`, `net_amount` |
| `purchase_invoice_headers` | `exchange_rate`, `signed_foreign_total`, `signed_base_total` |
| `purchase_invoice_lines` | `quantity`, `rate`, `foreign_amount`, `net_amount` |
| `purchase_invoice_accounting_lines` | `debit`, `credit` |

Count: SI 8 + IF 5 + SO 6 + IR 5 + PO 7 + PI 9 = **40**. Tidak ada BIGNUMERIC/FLOAT64 dalam hasil inventory yang diberikan untuk tabel terkait.

---

## D. Purchase Invoice empty staging bug — solved

Fast Delta run `run-2026-10-22_14-16-34.log` memiliki SI, IF, SO, IR, PO success tetapi PI error:

```
Source mapped: {"purchase_invoice_headers":2,"purchase_invoice_lines":9,"purchase_invoice_accounting_lines":9,"purchase_invoice_prior_links":0}
FAST DELTA ERROR: VENDOR BILL ERROR: Query without FROM clause cannot have a WHERE clause
```

Di `modules/purchase-invoice/sync.mjs` fungsi `stage(name,rows,fields)`, branch empty rows dahulu membentuk `CREATE TABLE ... AS SELECT CAST(NULL AS ...) AS ... WHERE FALSE` yang ditolak BigQuery. Diubah **satu baris** menjadi `... FROM UNNEST([1]) AS dummy WHERE FALSE` agar schema staging kosong tetap valid. Backup `sync.mjs.bak-20261022-142444`; `PI EMPTY STAGING PATCH PASS`; dry-run dengan `prior_links=0` PASS; Fast Delta 14:36 & 14:51 WIB memperlihatkan `VENDOR BILL SYNC SUCCESS`. Empat checkpoints PI tetap di-update atomically hanya saat commit, dan empty prior links adalah case yang normal.

**Peringatan lintas modul:** Sales Order memiliki kode empty stage `SELECT ... WHERE FALSE` tanpa `FROM` (hasil source snippet 225–229). Jika jalur tersebut suatu saat dieksekusi dan BigQuery menolak query, perlakukan sebagai bug terpisah; jangan mengklaim sudah diperbaiki. Gunakan validasi read-only dan patch minimal seperti PI. Ini residual risk yang perlu dicek sebelum modul 7 meniru empty-stage pattern.

---

## E. Automatic Verified Deletion — BASELINE WAJIB 6/6

### E.1 Perbedaan deletion vs catch-up

- `ONLY BIGQUERY`: kandidat *possible deletion* saja; juga bisa source visibility, permission, filter, race, moving snapshot. **Tidak pernah cukup untuk auto-delete.**
- `ONLY NETSUITE`: kandidat catch-up incremental/targeted recovery, **bukan** deletion. Harus memvalidasi snapshot source.
- `deletedrecord` NetSuite independent audit proof: harus cocok tepat `recordid`, `recordtypeid`, `type`, `deleteddate`, **tepat satu audit row** untuk ID tersebut; lalu `Transaction WHERE id=...` harus tidak mengembalikan row.
- Existing SI/IF/SO Core Recovery sudah memiliki bounded deletion; IR/PO/PI ditambahkan kini. Deletion **header-only soft delete**; historical lines dan checkpoints tidak disentuh oleh deletion script.

### E.2 Six-way recordType mapping (VERIFIED via NetSuite audit)

| Modul | `recordtypeid` | `type` | BQ header table | Status |
|---|---|---|---|---|
| SI | `invoice` | `INVOICE` | `sales_invoice_headers` | Auto active, positive evidence ada |
| IF | `itemfulfillment` | `ITEMFULFILLMENT` | `item_fulfillment_headers` | Auto existing |
| SO | `salesorder` | `SALESORDER` | `sales_order_headers` | Auto existing |
| IR | `itemreceipt` | `ITEMRECEIPT` | `item_receipt_headers` | Auto newly integrated |
| PO | `purchaseorder` | `PURCHASEORDER` | `purchase_order_headers` | Auto newly integrated |
| PI | `vendorbill` | `VENDORBILL` | `purchase_invoice_headers` | Mapping existed, auto newly integrated |

NetSuite read-only `deletedrecord` probe untuk tiga jenis terbaru mengembalikan **1.722 total**: `itemreceipt|ITEMRECEIPT` **940**, `purchaseorder|PURCHASEORDER` **571**, `vendorbill|VENDORBILL` **211** (historical audit, banyak tahun). Itu membuktikan identitas audit nyata dan hak akses role, **tidak berarti 1.722 transaksi Oktober harus dihapus**. Mapping IR/PO ditambahkan pada `scripts/verified-deletion.mjs`, backup `verified-deletion.mjs.bak-20261022-151920`. PI mapping sudah ada; jangan gandakan.

### E.3 Soft-delete script existing `scripts/verified-deletion.mjs`

- CLI: `node .\scripts\verified-deletion.mjs --module <slug> --id <numeric> --dry-run` untuk read-only, `--apply` untuk mutation. Supported 6 modules setelah patch.
- `--apply` menuntut env `NETSUITE_VERIFIED_DELETE_CONFIRM=I_CONFIRM_VERIFIED_SOFT_DELETE`; **Core Recovery existing sudah mengirim env ini dalam child process**. Jangan salah diagnosis sebagai missing env.
- `deletedrecord WHERE recordid = <id>` -> evidence wajib **tepat satu** dan exact type; lalu `Transaction WHERE id = <id>` -> harus invisible; BQ header by ID -> **tepat satu** dan aktif; if already deleted, no-op.
- Apply re-reads audit proof dan checks source invisibility, menjalankan transaction BQ dengan ASSERT before/after, `UPDATE <header> SET is_deleted=TRUE, deleted_at=CURRENT_TIMESTAMP()`; verifies after; audit log ke `logs/verified-deletions/audit.jsonl` dengan time, dataset, module, record ID, deleteddate/by/result.
- **No hard delete**, no history lines delete, no checkpoint mutation. Siapkan audit log tersimpan dalam backup.

### E.4 Core existing SI, SO, IF

File `common/recovery-controller.mjs` `coreMain()`:

- config `config/self-healing.json`: `enabled=true`, `catchUpSync=true`, `maxRecoveryPerModulePerRun=3`, `verifiedDeletionEnabled=true`, `verifiedIFDeletionEnabled=true`.
- `maxDeletePerRun = 3` batas kandidat per **Core invocation per module**; recovery targeted `maxRecoveryPasses=4` x max 3 per batch (maks 12 targeted recoveries per module run) adalah jalur yang berbeda.
- Standard Core examines `presence.mjs` -> `ONLY BIGQUERY` list via exact `MISSING <id>: NOT_VISIBLE_IN_NETSUITE` complete-count validation -> calls `verified-deletion.mjs --dry-run` and then `--apply` only if dry-run PASS -> refresh presence -> `NEEDS_REVIEW` if leftover.
- Satu Scheduler V3 dapat melakukan dua Core invocations sehingga log satu siklus bisa mencatat 6 soft deletes; **bukan** melanggar batas 3 per invocation.
- Jangan menaikkan batas mass deletion untuk mempercepat backlog; pertahankan bounded safety.

### E.5 Core newly added IR/PO/PI

**Skema header sudah siap (BigQuery verified):** `internal_id STRING`, `is_deleted BOOL`, `deleted_at TIMESTAMP` pada ketiga modul. Saat pre-integration 22 Oktober IR presence 176/176, PO 149/149, PI 303/303 — no BQ-only backlog.

**Problem pertama:** IR presence output text:
```
NETSUITE 176 BIGQUERY 176 ONLY NETSUITE 0 ONLY BIGQUERY 0
ONLY NETSUITE IDs: []
ONLY BIGQUERY IDs: []
PRESENCE PASS
```
PO/PI presence output JSON dengan `onlyNetSuite`, `onlyBigQuery`. Mereka return exit 3 ketika ada mismatch; sebelumnya PI `throw Error('PURCHASE INVOICE PRESENCE FAILED')` exit 1. PI presence diperbaiki menjadi exit 3 untuk discrepancy valid, exit 1 untuk corrupt/duplicate/empty; backup `modules/purchase-invoice/presence.mjs.bak-20261022-153803`. Clean PI 303/303 PASS.

**File baru:** `common/verified-deletion-batch.mjs`, exports:

- `inspectDeletionInventory(module)`: menjalankan masing-masing `presence.mjs` secara read-only, parsing text IR atau JSON PO/PI; validasi count/list, valid positive numeric IDs, uniqueness, exit 0 clean atau 3 discrepancy. Kalau ambigu, throw / fail closed.
- `processVerifiedDeletionBatch(module, inventory, {apply=false})`: maksimal `inventory.onlyBigQuery.slice(0,3)`; setiap ID lewat `verified-deletion.mjs --dry-run` untuk independent proof; jika `apply=true` baru `--apply` dengan confirmation env, audit+post-commit via script; kalau tidak ada proof skip and remains reviewable. Fungsi menerima inventory object yang berasal dari inspect.
- Handler **hanya** untuk IR, PO, PI; existing SI/SO/IF logic retained. Test audit handler 3/3 PASS, keluaran `applied=0 candidates=0 backlog=0` untuk ketiganya.

**Patch controller:** `common/recovery-controller.mjs` menambahkan import `inspectDeletionInventory, processVerifiedDeletionBatch`, menambahkan `specialDeletionGuard(mod)` **di dalam `coreMain()`**, yang:

1. inspeksi presence;
2. bila mode `--sync`, config deletion enabled, dan BQ-only > 0 -> bounded verified deletion apply;
3. inspect ulang;
4. jika ONLY BQ atau ONLY NS masih ada -> return false dan `summary.push([mod,'NEEDS_REVIEW'])`; jangan menjalankan final reconciliation/menyatakan PASS;
5. jika clean -> jalankan validation existing di cabang PI, PO atau IR.

Dipanggil tepat **3 kali** (PI sebelum strict presence, PO sebelum strict presence, IR sebelum financial checks). **Jangan menghapus pemeriksaan `check.mjs`, `presence.mjs`, `check-financial.mjs` existing**. Backup controller `recovery-controller.mjs.bak-20261022-154419`. `node --check` PASS dan `Guard calls: 3`. Percobaan patch pertama gagal preflight whitespace, kedua menemukan **dua** loop `for(const mod of selected)` (di `coreMain` dan `recoveryMain`) dan STOP tanpa perubahan; patch ketiga memilih **loop pertama coreMain**, berhasil. Ini penting untuk patch masa depan: jangan global replace/regex seluruh controller tanpa scope fungsi.

### E.6 Bukti uji negatif, audit-only, production

**NetSuite negative IDs yang masih aktif:**

| Modul | Active ID | `verified-deletion.mjs --dry-run` | Hasil |
|---|---|---|---|
| IR | `3158649` | audit rows=0 | `NOT VERIFIED... No changes` / expected nonzero -> PASS |
| PO | `3157978` | audit rows=0 | `NOT VERIFIED... No changes` / expected nonzero -> PASS |
| PI | `3158008` | audit rows=0 | `NOT VERIFIED... No changes` / expected nonzero -> PASS |

Stack trace Node.js / PowerShell `RemoteException` pada negative test adalah expected safety rejection. Tidak ada `--apply` pada negative test. Jangan menjadikan hasil read-only ini bukti bahwa positive deletion IR/PO/PI pernah terjadi.

**Audit-only setelah controller patch:**

- SI `NEEDS_REVIEW` karena ONLY NS=1 (`3159073`) saat source bergerak; ONLY BQ=0.
- IF `AUDIT_CLEAN`; Oct read-only source headers=964, lines=2710, qty=337334, COGS=9656889152.18, `ACCOUNTING RECONCILIATION ... differences=0`.
- SO `AUDIT_CLEAN`.
- IR `VERIFIED DELETION INVENTORY CLEAN`, `AUDIT_CLEAN` (financial detail not certified outside --sync).
- PO `VERIFIED DELETION INVENTORY CLEAN`, audit 149 headers / 580 lines, no mismatches, `AUDIT_CLEAN`.
- PI `NEEDS_REVIEW` ONLY BQ=0, ONLY NS=1; kemudian PI standalone presence NetSuite=305 BQ=305 0/0 PASS.

**Latest V3 16:01 WIB** menunjukan seluruh 6 `FINAL_PASS`, termasuk tiga `VERIFIED DELETION INVENTORY CLEAN`. Ini membuktikan module integration/regression ketika presence clean. **Positive deletion IR/PO/PI belum diuji end-to-end**, sebab tidak ada kandidat nyata. No dummy/prod deletion performed. Wajib observasi audit pertama kali ada real deletedrecord Oktober untuk ketiganya.

### E.7 SI real auto deletion ledger — evidence, bounded batches

File `logs/verified-deletions/audit.jsonl` menunjukkan SI soft deleted historis 20 Oktober oleh user 3339 dan 10878, kemudian batch 21 Oktober oleh 3330. Untuk kelompok case terbaru, contoh hasil:

- `2026-10-22T04:03:46Z` ID **3158519**, `04:03:55Z` **3158518**, `04:04:04Z` **3158523** (3).
- V3 `run-2026-10-22T07-41-31.303Z.log`: sekitar 07:42Z 3158517, 3158516, 3158532; dan sekitar 07:44Z 3158530, 3158531, 3158525 — **dua batch 3**, backlog 14 -> 11, lalu 11 -> 8.
- V3 `run-2026-10-22T08-01-31.300Z.log`: sekitar 08:02Z **3158528**, **3158529**, **3158522**, `VERIFIED DELETION BATCH: 3/3 applied; backlog before batch=8`.
- Subsequent SI presence `ONLY BIGQUERY: 0`, proving backlog no longer active at snapshot; later V3 `FINAL_PASS`. Untuk 5 ID final yang tidak terlihat di cuplikan audit pasted, jangan mengarang timestamp/batch; cek log resmi jika diperlukan.

**Status audit delete**: Keberhasilan real auto-delete pada SI terbukti dari ledger dan log. Untuk module lain, pemakaian mekanisme sama bukan pengganti positive evidence.

---

## F. Struktur folder dan file baru — live delta atas snapshot ZIP lama

Source root lokal user **`C:\netsuite-backup`** (Windows 11, PowerShell, Node 20). Berkas dibuktikan dari `Select-String`, `Get-Content`, `node --check`, dan logs selama chat:

```text
C:\netsuite-backup\
|-- common\
|   |-- netsuite-client.mjs                 # OAuth M2M, SuiteQL fetch
|   |-- bigquery-client.mjs                 # BQ shared client, query/T helpers
|   |-- recovery-controller.mjs            # --core internal + recoveryMain
|   |-- decimal-precision.mjs              # NEW: validateNumeric, normalizeNumericRate, validateNumericRows
|   |-- verified-deletion-batch.mjs        # NEW: IR/PO/PI presence parser + bounded deletion
|   |-- source-movement.mjs
|   `-- so-mismatch-candidates.mjs
|-- config\
|   `-- self-healing.json                  # config flags/limits
|-- scripts\
|   |-- verified-deletion.mjs              # 6 mapping record types, independent proof, header soft delete
|   |-- shared-lock-inspect.mjs
|   |-- scheduler-watchdog.mjs
|   `-- ...                                # verified other schedulers scripts in archived section
|-- modules\
|   |-- sales-invoice\
|   |   |-- mapping.mjs                    # asNumericRate patch
|   |   |-- sync.mjs                       # validateNumericRows header+lines
|   |   |-- presence.mjs
|   |   `-- ... check/recover etc.
|   |-- item-fulfillment\
|   |   |-- mapping.mjs
|   |   |-- sync.mjs                       # validateNumericRows header+lines
|   |   |-- presence.mjs
|   |   `-- ...
|   |-- sales-order\
|   |   |-- mapping.mjs                    # normalizeNumericRate
|   |   |-- sync.mjs                       # validateNumericRows
|   |   |-- presence.mjs
|   |   `-- ...
|   |-- item-receipt\
|   |   |-- mapping.mjs
|   |   |-- sync.mjs                       # validateNumericRows in stage()
|   |   |-- presence.mjs                   # text-format inventory
|   |   |-- check.mjs
|   |   `-- check-financial.mjs
|   |-- purchase-order\
|   |   |-- mapping.mjs
|   |   |-- sync.mjs                       # validateNumericRows in stage()
|   |   |-- presence.mjs                   # JSON inventory
|   |   `-- check.mjs
|   `-- purchase-invoice\
|       |-- mapping.mjs                    # rate/exchange_rate normalized
|       |-- sync.mjs                       # empty staging fix + NUMERIC validator
|       |-- presence.mjs                   # exit 3 discrepancy, 0 clean
|       `-- check.mjs
|-- logs\
|   |-- fast-delta\run-*.log
|   |-- scheduler\run-*.log
|   `-- verified-deletions\audit.jsonl
|-- credentials\...                     # SECRET; never copy or paste
`-- ...                                  # see archived handover for further files
```

**Important:** Tree di atas adalah daftar file yang telah terkonfirmasi dalam percakapan, **bukan hasil `tree` fresh atas user PC**. Arsip di bawah memuat snapshot ZIP untuk struktur detail lain. Pada chat baru, minta output `Get-ChildItem` hanya bila benar-benar butuh path baru. File `.bak-YYYYMMDD-HHmmss` sengaja dibentuk untuk rollback dan jangan dihapus sebelum backup/migrasi final.

---

## G. Operational runbook, syntax yang relevan (PowerShell)

### G.1 Status scheduler dan shared lock (READ ONLY)

```powershell
cd C:
etsuite-backup
Get-ScheduledTask -TaskName 'NetSuite Backup V3','NetSuite Backup Fast Delta' |
  Select-Object TaskName,State
node .\scripts\shared-lock-inspect.mjs
```

`lock.status=PID_EXISTS` & task running -> aktif, jangan jalankan manual sync/delete locks. `PID_NOT_FOUND` setelah worker selesai sering stale; existing next scheduled cycle bisa mengarsipkan lock. Jangan menganggap stale lock otomatis izin manual intervention; baca logs dulu.

### G.2 Fast Delta latest 100 lines dan result summary

```powershell
$log = Get-ChildItem .\logsast-delta -Filter 'run-*.log' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host "LOG: $($log.Name)"
Get-Content $log.FullName -Tail 100
```

Fast Delta `SYNC_OK` berarti incremental sync berhasil, **bukan full reconciliation**. Fast Delta 14:11 `SKIPPED_LOCKED; reason=STALE_ARCHIVED` ber-exit 0 namun **tidak menjalankan sync**; jangan salah nilai sebagai PASS. Scheduler latest 14:01 error SI adalah log lama setelah patch sehingga jangan tarik kesimpulan dari file lama.

### G.3 V3 latest full outcome dan deletion events

```powershell
$log = Get-ChildItem .\logs\scheduler -Filter 'run-*.log' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host "LOG: $($log.Name)"
Select-String -Path $log.FullName -Pattern   'CORE SUMMARY','FINAL_PASS','NEEDS_REVIEW','ERROR',   'VERIFIED DELETION','INVENTORY CLEAN','Scheduler status=' |
  ForEach-Object { $_.Line }
```

**PowerShell note:** backslash `\` bukan line-continuation Windows PS. Untuk command di atas yang benar, pakai satu baris Pattern atau backtick; contoh terjamin:

```powershell
Select-String -Path $log.FullName -Pattern 'CORE SUMMARY','FINAL_PASS','NEEDS_REVIEW','ERROR','VERIFIED DELETION','INVENTORY CLEAN','Scheduler status=' | ForEach-Object { $_.Line }
```

### G.4 Audit-only semua modul, gunakan ketika tidak ada production mutation

```powershell
node .\commonecovery-controller.mjs --all --audit-only
```

Audit-only tidak melakukan soft delete, tapi tetap mengakses NetSuite dan BigQuery. `AUDIT_CLEAN` bisa berbeda dari full `FINAL_PASS` (terutama IR). Jika source baru muncul maka sementara `NEEDS_REVIEW` bukan otomatis bug.

### G.5 Audit deletion log (READ ONLY)

```powershell
$audit = '.\logserified-deletionsudit.jsonl'
Get-Content $audit |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.module -eq 'sales-invoice' -and $_.result -eq 'SOFT_DELETED' } |
  Select-Object at,id,recordtypeid,deleteddate,deletedby,result |
  Format-Table -AutoSize
```

### G.6 Negative deletion tests — existing active IDs at observation time

```powershell
node .\scriptserified-deletion.mjs --module item-receipt --id 3158649 --dry-run
node .\scriptserified-deletion.mjs --module purchase-order --id 3157978 --dry-run
node .\scriptserified-deletion.mjs --module purchase-invoice --id 3158008 --dry-run
```

Expected when still active: nonzero and `NOT VERIFIED: audit rows=0 ... No changes.`; **IDs dapat berubah relevansinya setelah tanggal ini**. Jangan memakai contoh ID tersebut sebagai positive deletion targets dan jangan tambahkan `--apply`.

### G.7 Verify numeric mapping utility tanpa memodifikasi production

```powershell
node --input-type=module -e "import {normalizeNumericRate} from './common/decimal-precision.mjs'; const v=normalizeNumericRate('4816.666666666667'); if(v!=='4816.666666667') throw Error(v); console.log('RATE PASS',v)"
```

### G.8 BigQuery audit: schema soft-delete IR/PO/PI

```sql
SELECT table_name,column_name,data_type
FROM `even-gearbox-255203.netsuite_backup.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name IN ('item_receipt_headers','purchase_order_headers','purchase_invoice_headers')
  AND column_name IN ('internal_id','is_deleted','deleted_at')
ORDER BY table_name,column_name;
```

Ketiganya verified: internal_id STRING, is_deleted BOOL, deleted_at TIMESTAMP.

---

## H. Daftar perubahan/backup konkret 22 Oktober 2026

| File | Backup / waktu | Perubahan |
|---|---|---|
| `modules/sales-invoice/mapping.mjs` | `mapping.mjs.bak-20261022-141406` | normalisasi `rate` |
| `modules/purchase-invoice/sync.mjs` | `sync.mjs.bak-20261022-142444` | empty staging `FROM UNNEST([1]) AS dummy` |
| `modules/sales-order/mapping.mjs` | `mapping.mjs.bak-20261022-143824` | shared `normalizeNumericRate` |
| `modules/purchase-invoice/mapping.mjs` | `mapping.mjs.bak-20261022-143908` | normalize rate + exchange_rate |
| `modules/sales-invoice/sync.mjs` | `sync.mjs.bak-20261022-144807` | validateNumericRows before jsonl |
| `modules/item-fulfillment/sync.mjs` | `sync.mjs.bak-20261022-144807` | validateNumericRows before jsonl |
| `scripts/verified-deletion.mjs` | `verified-deletion.mjs.bak-20261022-151920` | add IR + PO mapping (PI existed) |
| `modules/purchase-invoice/presence.mjs` | `presence.mjs.bak-20261022-153803` | exit 3 discrepancy vs exit 1 integrity |
| `common/recovery-controller.mjs` | `recovery-controller.mjs.bak-20261022-154419` | specialDeletionGuard in Core for IR/PO/PI |
| `common/decimal-precision.mjs` | file new; validator addition backup timestamp not surfaced | shared decimal utility |
| `common/verified-deletion-batch.mjs` | file new | bounded IR/PO/PI handler |
| `modules/item-receipt/sync.mjs`, `modules/purchase-order/sync.mjs`, `modules/purchase-invoice/sync.mjs`, `modules/sales-order/sync.mjs` | backups created by patch or preexisting; exact names not reported | stage NUMERIC validation |

All six `sync.mjs` `node --check` PASS and all six have `validateNumericRows` integration. Backups on machine remain the user's local files, not bundled in this handover document.

---

## I. Residual risks / belum diverifikasi (jangan dihilangkan dari handover)

1. **Positive end-to-end auto soft-delete IR/PO/PI belum pernah dijalankan terhadap real October deletion**; negative tests 3/3 PASS, mapping audit identified, branch production clean PASS. Pertahankan safety, amati ketika pertama kali ada `ONLY BIGQUERY` dengan true deletion proof. Jangan buat/hapus transaksi production hanya untuk demonstrasi.
2. **IR amount KPI/header GL book** belum certified. `FINAL_PASS` workflow bukan GL posting-certified; lihat `check-financial.mjs` dan scoped limitations.
3. **IF/IR/PO numerical `Number().toFixed`** existing berpotensi rounding floating point walau staging representable; jangan secara sepihak rewrite jika reconciliation sudah PASS.
4. **Sales Order empty staging** potensi `SELECT ... WHERE FALSE` tanpa `FROM` dari potongan kode; belum terbukti error di production pada current runs; audit branch pada kesempatan aman.
5. **PI dan PO special branches**: ketika source-only mismatch (`ONLY NETSUITE`), `specialDeletionGuard` membiarkannya `NEEDS_REVIEW`; normal Fast Delta berikutnya catch-up. Jangan memanggil mass targeted recovery untuk source-only PI/PO/IR tanpa capability yang divalidasi.
6. **SI verified deletion may need historical row normalization:** `sales_invoice_headers` pernah deltas/deletes; gunakan `is_deleted=FALSE` untuk KPI aktif dan separate audit table/history bila perlu.
7. **Disk / log retention, credential backup** belum dikonfirmasi secara final dari live PC dalam chat ini. Snapshot ZIP lama dan environment file bisa berubah.
8. **Fresh Windows live project tree** tidak diperiksa langsung oleh dokumen ini. Jangan mengarang nama script di luar yang ditunjukkan; baca file source.
9. **Role permission inventory** historis, bukan export current UI; sudah terbukti SuiteQL read access untuk IR/PO/PI deletedrecord. Untuk modul 7 tetap probe permission minimal.
10. **No daily upper bound on deletion** selain batch per invocation; bila perlu corporate approval mass deletion/kill-switch, desain terpisah dan jangan diam-diam mengubah max=3.

---

## J. Persyaratan untuk Modul 7 Sales Return dan setiap modul berikut

1. **Read-only transaction probe** NetSuite: type/status, source/destination links, mainline/detail, tax, COGS, GL, `lastmodifieddate`, `deletedrecord` identity. Sales Return tidak otomatis setara Return Authorization, Customer Credit Memo, atau receipt; validasi model transaksi asli.
2. Definisikan BigQuery header schema dengan `internal_id`, `is_deleted`, `deleted_at` sejak awal, plus transaksi date/status/last_modified; relevant detail lines/accounting/links. `NUMERIC` schema cocok kebutuhan precision.
3. Gunakan shared clients, stage NDJSON, `validateNumericRows` preflight, normalized rate hanya bila sesuai field, dry-run source validation, atomic header/lines/checkpoint, post-commit check.
4. Buat presence check yang **mengeluarkan full IDs** dan count, exit 0 clean / 3 discrepancy / 1 execution/integrity error; dari awal gunakan format JSON terstruktur (tidak ada truncated output). Jangan mengandalkan parser jika list incomplete.
5. Tambahkan exact NetSuite audit mapping ke `scripts/verified-deletion.mjs` **setelah** verified `deletedrecord` sample nyata (no guessing). Integrasikan `--sync` bounded verified deletion ke Recovery Controller, dengan fail closed.
6. Uji valid record still visible (negative test), empty stage, mapping precision, no-change watermark, checkpoint conflict, source moving, strong reconciliation; positive deletion hanya jika ada kejadian penghapusan real dan aman.
7. Scheduler V3 & Fast Delta integrate **hanya** setelah standalone dry-run/check/presence semua PASS; jangan tambahkan env feature flags lama PO/PI.
8. Kirim report dengan bukti status, file backup, config/role, exception yang belum certified. Jangan mengubah modul ke-1..6 kecuali bug yang nyata.

**Mandatory stop conditions:** source auth failure, candidate list incomplete, duplicate IDs, deletedrecord mismatched or >1, original Transaction still visible, BigQuery header not exactly 1, NUMERIC nonrepresentable money/GL, atomic checkpoint conflicts without safe guard, production lock currently owned. Jangan override demi memperoleh PASS.

---

## K. Prompt singkat untuk new chat

> Saya meneruskan project Windows `C:\netsuite-backup` (NetSuite OAuth2 M2M role **PNM NetSuite Backup Integration** -> BigQuery `even-gearbox-255203.netsuite_backup` region `asia-southeast1`). Baca dokumen handover master 22 Okt 2026 terlebih dahulu. **Six production modules** SI, IF, SO, IR, PO, PI. Latest Scheduler V3 16:01 WIB `6/6 FINAL_PASS`; Fast Delta after precision hardening `6/6 SYNC_OK`. Shared `common/decimal-precision.mjs` and `validateNumericRows()` in all six; SI/SO/PI rate normalization. **Automatic Verified Deletion WAJIB 6/6**: exact NetSuite `deletedrecord` proof, source invisibility, bounded max 3 IDs per Core invocation, header-only soft delete, audit, no checkpoint/lines mutation; IR/PO/PI integration in `common/verified-deletion-batch.mjs` + `specialDeletionGuard()` in Core Recovery, negative test PASS, positive deletion for IR/PO/PI belum diuji. IR header amount accounting-book GL KPI belum certified. Mulai Modul 7 Sales Return dengan read-only NetSuite probe, pertahankan seluruh baseline, jangan mengarang schema/role/scripts dan jangan mengubah scheduler atau checkpoint tanpa bukti.

---

# ARSIP HANDOVER SEBELUM REVISI — RIWAYAT SETUP DAN PERKEMBANGAN AWAL

> Bagian di bawah disalin dari dokumen sebelumnya untuk menyimpan kronologi, nama role, struktur snapshot, dan debugging historis. **Jika status, instruksi, atau prioritas di bawah berbeda dengan A–K di atas, ikuti A–K.** Misalnya kalimat lama "6/6 belum FINAL_PASS" atau "deletion SI belum selesai" sekarang sudah tersupersesi bukti 16:01 WIB.

# NETSUITE BACKUP → BIGQUERY — HANDOVER 6 MODUL & CHAT 21–22 OKTOBER 2026

**Tanggal dokumen:** 22 Oktober 2026 (Asia/Jakarta).  
**Tujuan:** dokumen kontinuitas untuk membuka chat baru dan membangun Modul 7 **Sales Return** tanpa menyimpang dari baseline existing.  
**SOT:** source aktif di `C:\netsuite-backup` pada PC Windows pengguna **mengungguli** dokumen ini. Snapshot ZIP yang dapat diperiksa saat handover: `netsuite-backup(9).zip` beserta ZIP patch berikutnya dan output PowerShell dari pengguna. **ZIP (9) mendahului beberapa patch akhir**; jadi pohon file ZIP adalah *verified snapshot*, bukan klaim isi live filesystem final. Tidak ada akses live ke Windows pengguna.

> **INSTRUKSI WAJIB UNTUK ASISTEN DI CHAT BARU:** baca dokumen sampai selesai, lalu lihat source code modul existing sebelum mengubah apa pun. Jangan mengarang layout folder, kolom/jenis transaksi, konfigurasi role, atau API. Berikan PowerShell siap copy-paste yang sesuai kondisi nyata, perubahan sekecil mungkin, serta verifikasi otomatis. Jangan mengubah scheduler, shared lock, checkpoint, atau core yang sudah stabil tanpa bukti. Jangan memakai script/script path lama yang berbeda dengan struktur `modules/*`.

## 1. Gambaran proyek dan status

Backup transaksi NetSuite ke BigQuery untuk KPI Oktober, November, Desember 2026; tenggat KPI pernah disebut 10 Desember 2026. Enam modul telah dibangun:

| No | Modul | Folder | NetSuite Transaction.type | Tabel BigQuery utama |
|---|---|---|---|---|
| 1 | Sales Invoice (SI) | `modules/sales-invoice` | `CustInvc` (pastikan dari mapping aktif) | `sales_invoice_*` (lihat schema live) |
| 2 | Item Fulfillment (IF) | `modules/item-fulfillment` | `ItemShip` | `item_fulfillment_headers`, `item_fulfillment_lines` |
| 3 | Sales Order (SO) | `modules/sales-order` | `SalesOrd` | `sales_order_*` |
| 4 | Item Receipt (IR) | `modules/item-receipt` | `ItemRcpt` (verifikasi mapping) | `item_receipt_*` |
| 5 | Purchase Order (PO) | `modules/purchase-order` | `PurchOrd` (verifikasi mapping) | `purchase_order_headers`, `purchase_order_lines` |
| 6 | Purchase Invoice / Vendor Bill (PI) | `modules/purchase-invoice` | **`VendBill`** | empat tabel PI, detail di bawah |

**Status akhir chat:** enam modul *terintegrasi dan sudah bisa sync*. Namun audit simultan di jam sibuk **belum semuanya clean pada snapshot terakhir**. Tidak boleh menulis “6/6 FINAL_PASS sekarang” tanpa bukti output terbaru. Ada pergantian status ketika Finance terus membuat/mengedit transaksi antara ±09:00–12:00 WIB; Fast Delta dan recovery bergerak mengejar sumber. Pada audit terakhir: SI dan SO `NEEDS_REVIEW`, IF/IR/PO/PI `AUDIT_CLEAN` pada satu putaran; putaran lebih baru sempat PO/PI `ERROR` karena perubahan source (lihat §8). **Production system tidak di-reset.**

**Next module:** **Modul 7 Sales Return** direkomendasikan. Mulai dengan NetSuite **read-only probe** untuk memastikan apakah alur customer return dicatat sebagai Return Authorization, Item Receipt dari pelanggan, Credit Memo, dan/atau hubungan transaksi lain. Jangan menganggap semua itu satu Transaction.type atau satu tabel, dan jangan memaksakan model penjualan normal ke return.

## 2. Setup awal NetSuite — ROLE, AUTHENTICATION, PERMISSION (WAJIB)

### 2.1 Nama dan identitas yang benar

| Item | Nilai |
|---|---|
| **Nama role tepat** | **`PNM NetSuite Backup Integration`** |
| NetSuite role ID historis | `customrole1042` |
| NetSuite account ID historis | `6930902` |
| Account REST base | `https://6930902.suitetalk.api.netsuite.com` |
| OAuth token URL | `https://6930902.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token` |
| OAuth flow | OAuth 2.0 Machine-to-Machine / Client Credentials dengan JWT **PS256** |
| Sertifikat | RSA, setup historis 4096-bit; public certificate telah di-mapping ke integrasi NetSuite |
| Credential loader | `credentials/netsuite-secrets.mjs` → `common/netsuite-client.mjs` |
| Lokasi UI role | Setup → Users/Roles → Manage Roles → cari `PNM NetSuite Backup Integration` → Edit → Permissions |

**Jangan salah nama:** `NetSuite Backup OAuth M2M` adalah sebutan metode autentikasi, **bukan role**. Role Administrator UI bukan identitas izin role M2M. **Jangan mencantumkan client ID, certificate ID, access token, private key, atau secret literal di dokumen/patch/chat.** Credential file/PEM di ZIP source pengguna adalah rahasia dan tidak boleh dibagikan ulang.

### 2.2 Daftar permission yang terdokumentasi historis

Daftar ini **bukan export seluruh izin role terkini**. Beberapa dikonfirmasi di handover proyek terdahulu, sementara kebutuhan masing-masing modul dibuktikan fungsional via SuiteQL yang berhasil. Untuk modul baru, cek ulang tab dan level melalui UI role; gunakan izin minimum yang bekerja.

| Tab | Permission | Level terdokumentasi | Tujuan |
|---|---|---|---|
| Setup | `REST Web Services` | **Full** | REST/SuiteQL API |
| Setup | `Log in using OAuth 2.0 Access Tokens` | **Full** | OAuth M2M |
| Setup | `Deleted Records` | **View** | `deletedrecord` independent deletion proof |
| Reports | `SuiteAnalytics Workbook` | **Edit** historis | SuiteQL availability |
| Transactions | `Find Transaction` | **View** | Transaction lookup |
| Transactions | `Invoice` | **View** | SI |
| Transactions | `Item Fulfillment` | **View** | IF |
| Transactions | `Sales Order` | **View** | SO |
| Transactions | `Bills` / Vendor Bill | **View** menurut implementasi PI | `VendBill` |
| Lists | `Perform Search` | **View** historis | SuiteQL/search |
| Lists | `Vendors`, `Accounts`, `Currency` | **View** pada kebutuhan PI; **verifikasi label/level UI live** | Join/BUILTIN.DF / GL |

Item Receipt dan Purchase Order juga telah *berfungsi* dengan role ini; **jangan menebak level permission persisnya** tanpa pemeriksaan role UI. Demikian pula untuk Sales Return nanti (`Return Authorization`, `Credit Memo`, related transactions, Item, Location dll.) lakukan permission probe, jangan memberi Full otomatis. Dulu query `Transaction` sempat gagal “Record 'Transaction' was not found” sebelum tambahan `Find Transaction`/`Perform Search`.

### 2.3 Pengaturan WAJIB tetap OFF

`Setup → Import/Export → CSV Import Preferences → Run Server SuiteScript and Trigger Workflows` = **OFF**. Jangan aktifkan. Finance sering import CSV dan ada banyak legacy workflow/script; backup dirancang dengan REST/SuiteQL polling **tanpa** bergantung User Event CSV. Jangan ganti OAuth mapping/sertifikat/role jika masih sehat.

### 2.4 Deleted Record Audit

- Deletion **tidak** boleh disimpulkan dari hilangnya row dalam SuiteQL. Bisa akibat source movement, filter, visibility, izin, atau soft deletion sebenarnya.
- Independent proof via `deletedrecord`, ditambah kecocokan exact `recordid`, `recordtypeid`, `type`; perlu guard pada `scripts/verified-deletion.mjs`.
- Audit historis Oktober 2026: 325 deletedrecord lintas tipe; **tidak ada Vendor Bill deletion pada Oktober di probe tersebut**.
- Probe *seluruh sejarah* menemukan 212 row hasil `LIKE` VendorBill/VendBill, termasuk `recordtypeid='vendorbill', type='VENDORBILL'` dan tipe lain `POSTVENDORBILLVARIANCES`. **Hanya exact pasangan `vendorbill` / `VENDORBILL`** yang boleh dipakai untuk Vendor Bill. 212 = hasil query longgar, **bukan** 212 deletion Vendor Bill yang siap diaplikasikan.
- Untuk SI pernah ada delapan invoices ID `3147029..3147036` yang dibuktikan deleted via audit dan dilakukan soft delete pada sesi sebelumnya; jangan menganggap semua `ONLY_BIGQUERY` serupa.

## 3. Teknologi, penjadwalan, safety baseline

- Host **Windows 11**, PowerShell, root `C:\netsuite-backup`.
- Node.js **20**, ESM `.mjs`; Task Scheduler historically uses `C:\nvm4w\nodejs\node.exe`.
- GCP project **`even-gearbox-255203`**, BigQuery dataset **`netsuite_backup`**, region **`asia-southeast1`** (bukan `US`).
- Central OAuth client `common/netsuite-client.mjs` (`token`, `fetchAll`) dan BQ client `common/bigquery-client.mjs` (`query`, `T`, `dataset`), **tidak membuat klien per-modul**.
- Shared checkpoint table **`netsuite_backup.sync_checkpoints`**: `record_type`, `last_successful_modified_at DATETIME`, `last_successful_sync_at TIMESTAMP`, `updated_at TIMESTAMP`.
- Incremental via `lastmodifieddate`, **overlap 5 menit**, strict source mapping validation, staging, atomic merge/replacement detail/checkpoint, presence dan field-by-field reconciliation. Tidak menurunkan kualitas validation untuk sekadar lulus PASS.
- Shared mutual exclusion `common/shared-lock.mjs` antara Scheduler/Recovery dan Fast Delta; lihat `scripts/shared-lock-inspect.mjs`. Status `PID_EXISTS` dengan `worker=scheduler`/`fast-delta` berarti kerja sedang berjalan; jangan delete lock sembarang. `guard=ABSENT` normal jika tanpa maintenance.
- **Fast Delta** Task `NetSuite Backup Fast Delta`: cadence **5 menit**; launcher `scripts/run-fast-delta.ps1`, `scripts/run-fast-delta-hidden.vbs`; worker `scripts/fast-delta.mjs`.
- **Scheduler V3** Task `NetSuite Backup V3`: Windows trigger *sekitar setiap 10 menit* menjalankan `scripts/scheduler-runner.mjs`; scheduler internal production **slot 20 menit** `:00/:20/:40`, rentang **08:00–22:00 WIB**. Perubahan dari interval historis 30 menjadi 20 pada chat sebelumnya adalah **live baseline final**, jangan kembali ke nilai di ZIP `.docs` lama.
- Task lain: `NetSuite Backup Freshness Monitor`, `NetSuite Backup Watchdog`.
- Windows scheduler user historis `IT PIAGAM`, password logon, limited run level, policy IgnoreNew. Windows code `267009` = task sedang Running, bukan automatically failure.
- `config/scheduler.json` → `modes.production.intervalMinutes = 20`. **Tidak** memerlukan task Windows baru per-modul.
- Scheduler `logs/scheduler/latest.json`, `history.jsonl`, `run-...log`; Fast Delta `logs/fast-delta/run-...log`, `health-v2.json`. `latest.json` menyimpan **hasil job terakhir selesai**, bukan indikator realtime; periksa `startedAt`, `finishedAt`, `slot` dan state Windows task.
- Status: `FINAL_PASS` = sync + verifikasi dalam workflow berhasil; `AUDIT_CLEAN` = audit-only bersih dalam scope yang diperiksa; `NEEDS_REVIEW` = ada ketidakcocokan/ketidakpastian; `ERROR` = script gagal/exit nonzero, perlu lihat error yang mendasari; `SOURCE_MOVING_DETECTED` = sumber berubah selama snapshot, guard untuk mencegah false certification. **`AUDIT_CLEAN` untuk IR audit-only bukan full financial certification; core mencatat `IR AUDIT: financial detail not certified outside --sync`.**
- Jangan ubah checkpoint atau COGS manual untuk “menyelesaikan warning”. Saat periode 09–12 banyak transaksi, audit asynchronous terhadap source moving dapat bergantian menunjukkan SI/SO/PI needs review; tunggu catch-up, cek live logs dan event sumber sebelum repair.

## 4. Struktur folder baseline — diverifikasi dari snapshot `netsuite-backup(9).zip`

**Catatan status:** beberapa tambahan yang dilakukan sesudah snapshot: `scripts/verified-deletion.mjs` diperluas untuk PI; `modules/purchase-invoice/{mapping.mjs,sync.mjs}` patch SuiteQL incremental; dan `common/recovery-controller.mjs` kemungkinan telah diubah di workstation untuk menghapus feature flags. Periksa live file. Daftar berikut adalah struktur **snapshot**, bukan klaim final persis setelah patch; file `.bak` dan log bisa bertambah.

```text
C:\netsuite-backup\
├── .docs\
│   ├── 1_NETSUITE_BIGQUERY_PROGRESS_HANDOVER_2026-10-08.md
│   ├── 2_NETSUITE_BACKUP_HANDOVER_FOUNDATION_V5_2_2026-10-14.md
│   ├── 3_NETSUITE_BACKUP_HANDOVER_BASELINE_4_MODULE_2026-10-20.md
│   └── 4_NETSUITE_BACKUP_HANDOVER_5_MODULE_2026-10-21.md
├── .gitignore
├── package.json
├── package-lock.json
├── credentials\                    # SENSITIVE; jangan commit/share
│   ├── netsuite-secrets.mjs
│   ├── private.pem
│   ├── public.pem
│   └── recovery-test-sa.json
├── common\
│   ├── netsuite-client.mjs
│   ├── bigquery-client.mjs
│   ├── child-runner.mjs
│   ├── shared-lock.mjs
│   ├── recovery-controller.mjs
│   ├── presence-reconcile.mjs
│   ├── targeted-recovery.mjs
│   ├── source-movement.mjs
│   ├── so-mismatch-candidates.mjs
│   └── sync-utils.mjs
├── config\
│   ├── scheduler.json
│   ├── self-healing.json
│   ├── verified-deletion-example.json
│   └── telegram-...             # credentials/IDs; jangan ekspor
├── modules\
│   ├── sales-invoice\
│   │   ├── mapping.mjs  sync.mjs  presence.mjs  check.mjs  recover.mjs
│   ├── item-fulfillment\
│   │   ├── mapping.mjs  sync.mjs  presence.mjs  check.mjs  recover.mjs
│   │   ├── reconcile-accounting.mjs  repair-accounting-bounded.mjs
│   ├── sales-order\
│   │   ├── mapping.mjs  sync.mjs  presence.mjs  check.mjs  recover.mjs
│   │   └── repair-active.mjs
│   ├── item-receipt\
│   │   ├── mapping.mjs  sync.mjs  presence.mjs  check.mjs
│   │   ├── check-financial.mjs  probe.mjs  recover.mjs
│   ├── purchase-order\
│   │   ├── mapping.mjs  sync.mjs  presence.mjs  check.mjs  recover.mjs
│   │   ├── probe.mjs  diagnostic.mjs  reconcile-probe.mjs
│   └── purchase-invoice\
│       ├── mapping.mjs  sync.mjs  presence.mjs  check.mjs
│       ├── probe.mjs  validate-source.mjs  dry-run-bq.mjs
│       ├── check-base-currency-probe.mjs  check-financial-probe.mjs
│       ├── check-mapping-readiness.mjs  diagnose-gl-mismatch.mjs
├── scripts\
│   ├── fast-delta.mjs
│   ├── scheduler-runner.mjs
│   ├── scheduler-watchdog.mjs
│   ├── shared-lock-inspect.mjs
│   ├── verified-deletion.mjs
│   ├── run-fast-delta.ps1
│   ├── run-fast-delta-hidden.vbs
│   ├── run-freshness-monitor.ps1
│   ├── fast-delta-freshness.mjs
│   ├── fast-delta-freshness-alert.mjs
│   ├── freshness-incident-core.mjs
│   ├── monitor-alert.mjs
│   ├── monitor-notify.ps1
│   └── diagnose-transaction.mjs
├── logs\
│   ├── scheduler\                # latest.json, history.jsonl, per-run logs, lock audit
│   ├── fast-delta\               # per-run logs, health-v2.json
│   ├── freshness\
│   ├── purchase-invoice\         # historical probes/diagnostics (ADA di snapshot)
│   └── verified-deletions\        # audit.jsonl
└── backups\                     # historical code snapshots, termasuk sebelum patches
```

**PENTING mengenai folder:** Jangan membuat/mengasumsikan root berbeda, membangun `common/recovery-controller-v2.mjs`, module-level OAuth/BQ clients, ataupun task terpisah. Folder `logs/purchase-invoice` *memang ada di snapshot* karena hasil eksperimen, tetapi standar log production tetap shared logs. `check-financial.mjs` ada di `item-receipt` **bukan** di `item-fulfillment`; IF reconciliation = `reconcile-accounting.mjs`. Jangan pakai legacy root scripts `sync-sales-invoice.mjs` sebagai instruksi baru: gunakan `modules/sales-invoice` dan core existing.

Untuk melihat **struktur aktif live** di chat baru:

```powershell
cd C:\netsuite-backup
Get-ChildItem .\common,.\config,.\scripts,.\modules -Recurse -File |
  Where-Object { $_.Name -notmatch '\.bak' } |
  Select-Object FullName
```

## 5. Metode kode dan pola DDL — MANDATORY untuk modul berikutnya

**Pengguna secara eksplisit mengharuskan CREATE TABLE otomatis dari script yang dicopy ke PowerShell, bukan membuat tabel BigQuery manual lebih dulu.** Pola existing PO/PI:

1. Awali **probe NetSuite read-only**: tentukan transaction type, window Oktober, header/detail GL/links, line grain, jumlah transaksi, currency, signed amount, properti status, sebelumnya/sesudahnya, source integrity. Tidak mengarang field SuiteQL.
2. Permission probe menggunakan role existing; jangan mengubah global NetSuite settings.
3. Susun `modules/<modul>/mapping.mjs`: ekspor source `token`, `fetchHeaders(access,since?)`, `fetchLines` batched IDs, GL/related link jika relevan, `mapSource` dan validasi. Gunakan `common/netsuite-client.mjs`.
4. Buat `modules/<modul>/sync.mjs` ber-flag `--dry-run` dan `--sync` (tepat satu). **`ensureTables()` menjalankan `CREATE TABLE IF NOT EXISTS` BigQuery secara otomatis pada production sync**, dipanggil dari Node script yang dijalankan dengan command PowerShell `node .\modules\...\sync.mjs --sync`; jangan pisahkan DDL menjadi tindakan BigQuery manual wajib. BigQuery central checkpoints existing **tidak** di-drop/dibuat ulang.
5. DDL: definisikan schema dari hasil probe mapping, key, tipe NUMERIC/DATETIME, clustering/partition mengikuti grain existing; staging tables unik; transaksi atomik `MERGE` header + replace details + checkpoint bersama. Detail replacement hanya untuk header yang masuk batch. Jangan delete historical rows dari absence SuiteQL.
6. `sync.mjs` harus menolak source kosong untuk initial, checkpoint inconsistent, duplicate IDs/keys, foreign/header financial imbalance, GL debit-credit imbalances, dan unknown commit outcomes. Bounded retry **hanya** saat error aborted BigQuery transaction yang terbukti safe, re-read checkpoint dan hentikan jika telah bergerak; jangan retry pada unknown network/timeout commit.
7. **5-minute overlap** menggunakan watermark `lastmodifieddate`; untuk efisiensi filter di **SuiteQL** ketika terkonfirmasi query support. Header full-window tetap tersedia untuk `presence.mjs` / `check.mjs` tanpa `since`.
8. Buat `presence.mjs` (read-only: NetSuite vs BQ active, missing both directions, duplicate) dan `check.mjs` (read-only: full source vs BQ field-by-field, financial, line keys, totals, orphan/duplicate, related links, posting/accounting). Perbedaan disampaikan sebagai ERROR/NEEDS_REVIEW, bukan disembunyikan.
9. Integrasikan ke **existing** `common/recovery-controller.mjs`, `scripts/fast-delta.mjs`, `scripts/scheduler-runner.mjs`, launcher terkait dengan perubahan sangat kecil dan pengujian; **jangan** membuat scheduler terpisah.
10. Sebelum writer, backup file yang diganti, `node --check`, dry-run read-only, cek Task Ready & shared lock ABSENT, uji `--sync` sekali setelah aman, presence + check, full audit + scheduler post-change. Jangan mengganti seluruh project ZIP untuk patch dua file.
11. Soft delete hanya independent `deletedrecord` audit evidence exact type, atomic guarded path `scripts/verified-deletion.mjs`. Never automatically mark deleted from missing SuiteQL results. Reappearance of an already soft-deleted document requires explicit restore policy, not unconditional flip.
12. Dokumentasikan query, invariants, log output, checkpoint names, fail cases, role permissions, backup/rollback, no-write semantics, and test evidence.

Contoh *pola command*, bukan instruksi menjalankan modul 7 sebelum source dibuat:

```powershell
cd C:\netsuite-backup
node --check .\modules\sales-order\sync.mjs
node .\modules\purchase-invoice\sync.mjs --dry-run
# HANYA saat aman dan diperlukan:
# node .\modules\purchase-invoice\sync.mjs --sync
node .\modules\purchase-invoice\presence.mjs
node .\modules\purchase-invoice\check.mjs
```

**Penting:** Mode `--audit-only` bisa hanya presence/ringkas bagi beberapa modul; untuk klaim financial PASS jalankan full check yang relevan atau `--sync` terjadwal sampai `FINAL_PASS`. Jangan anggap `AUDIT_CLEAN` otomatis berarti full financial reconciliation enam modul.

## 6. Modul 6 Purchase Invoice — fitur yang dibangun dan diverifikasi dalam chat ini

### 6.1 Mapping dan schema

- NetSuite `Transaction.type = 'VendBill'`; window `t.trandate >= 2026-10-01` dan `< 2026-11-01`.
- `Transaction` headers: `id`, `tranid`, `trandate`, `lastmodifieddate`, `BUILTIN.DF(status)`, entity/vendor, currency, exchange rate, `foreigntotal`, `total`, posting period, subsidiary.
- `TransactionLine`: `transaction`, `id`, `uniquekey`, sequence, item, quantity, rate, foreignamount, netamount, mainline/taxline/iscogs/accountinglinetype.
- `TransactionAccountingLine`: accountingbook, account, transactionline, debit, credit, posting; AP mainline balance checked.
- `PreviousTransactionLineLink` link types **`OrdBill`**, **`BillRcpt`**, dedup by (bill, previous doc, link type).
- Mapper `scaled()` uses BigInt at 1e-6 scale, not floating-point rounding, compares GL debit/credit balanced, AP net credits vs negative signed base header. **Do not** compare gross GL debit to header total: bill `3148317` had balanced extra GL amount 15665, making gross GL > absolute header while AP still reconciles.
- Signed NetSuite header total and foreign total are distinct, including CNY vs IDR. Legacy October source mix ~232 IDR / 27 CNY from early 259 headers. Later total count grew. Non-item/GL-related details must follow source/accounting grain, not invent item-only rules.
- Tables created automatically via PI sync `ensureTables`:
  - `purchase_invoice_headers` (partition by `transaction_date`, cluster `internal_id`; includes `synced_at`, `is_deleted BOOL DEFAULT FALSE`, `deleted_at TIMESTAMP`).
  - `purchase_invoice_lines`.
  - `purchase_invoice_accounting_lines`.
  - `purchase_invoice_prior_links`.
- 4 shared checkpoints: **`purchase_invoice_headers`**, **`purchase_invoice_lines`**, **`purchase_invoice_accounting_lines`**, **`purchase_invoice_prior_links`**. All four updated together in transaction with detail replacement.

### 6.2 Proven operational results

- First full recon clean: 262 headers, 1249 lines, 1249 GL, 170 prior links; subsequent 272 headers and checkpoint 2026-10-21 16:00:33.
- 21 October one header `3158046` had `last_modified`: source `2026-10-21 16:35:29`, BigQuery `2026-10-21 14:58:53`; presence 272/272 PASS but one mismatch. PI dry run → sync `ATOMIC MERGE + DETAIL REPLACE + FOUR CHECKPOINTS: SUCCESS` → presence/check four-table PASS: 272 headers, 1293 lines, 1293 GL, 180 links, zero mismatch/duplicate/orphan. Thus checkpoint delta and update-existing path proven.
- **Checkpoint retry hardening**: 4 checkpoint guard and bounded retry based on PO pattern installed; `node --check`, dry-run, normal production sync PASS. **Real concurrent abort retry branch not independently tested**; do not claim it was.
- **Deletion safety**: `scripts/verified-deletion.mjs` extended to PI exact `vendorbill` / `VENDORBILL`, using existing independent proof. Test `--module purchase-invoice --id 3158046 --dry-run` rejected `NOT VERIFIED: audit rows=0, verified purchase-invoice=0. No changes.` This is **correct safety PASS**, not script bug. Actual positive verified soft-delete not tested. Re-activation of already `is_deleted=true` bill not auto-managed by header MERGE (`WHEN MATCHED AND COALESCE(d.is_deleted,FALSE)=FALSE`), deliberate manual policy needed.
- **SuiteQL incremental optimization**: originally PI `fetchHeaders(access)` fetched all October then Node filtered by `last_modified >= since`; PO already passed `since` to SuiteQL. Probe SuiteQL filter `t.lastmodifieddate >= TO_DATE('2026-10-21 16:39:44', 'YYYY-MM-DD HH24:MI:SS')` returned two IDs `3158191` and `3158193`. Patch installed updating `mapping.mjs` signature `fetchHeaders(access,since?)` and `sync.mjs` `const headers = await fetchHeaders(access, since)`. Presence/check still full-month (no since). 22 October post-patch dry-run: 3 headers, 10 lines, 10 GL, 6 links; checkpoint `2026-10-22 09:55:35`, overlap `09:50:35`, PASS.
- Post-optimization full audit on 22 Oct: **277** headers, **1314** lines, **1314** GL, **190** links, all 4 PASS, no mismatch/duplicate/orphan. Scheduler slot 10:00 logged PI `FINAL_PASS`.
- Later active audit during busy hours: **284 headers, 1355 lines, 1355 GL, 204 links** all PASS. Next dynamic audit **290 NS / 289 BQ**, new Vendor Bill `3158646` missing BQ at that moment; PI labeled `ERROR` because `presence.mjs` exits nonzero, **not proof module broken**.

### 6.3 PI no-change semantics

From `sync.mjs`:

```js
if (DRY_RUN) { /* validate source, do not write */ return; }
if (baseline && !headers.length) {
  console.log('VENDOR BILL NO CHANGES: SUCCESS; checkpoint not moved');
  return;
}
```

A 5-minute overlap often returns 1–3 already-seen headers, so no-change branch **not proven by normal dry-run** even when no business changes. Do not force checkpoint into the future, manipulate source, or create fake prod changes just to test it. No-change code path exists, normal dry-run/sync validated.

## 7. Perubahan Recovery Controller — enam modul tanpa feature flags

Awalnya `common/recovery-controller.mjs` memiliki **dua** deklarasi module list (di `coreMain()` dan `recoveryMain()`) berbasis env flag:

```js
const modules = [
  'sales-invoice', 'item-fulfillment', 'sales-order', 'item-receipt',
  ...(process.env.NETSUITE_PO_ENABLED === '1' ? ['purchase-order'] : []),
  ...(process.env.NETSUITE_PI_ENABLED === '1' ? ['purchase-invoice'] : [])
];
```

Itu merupakan **feature flags masa pengembangan** untuk PO dan PI agar belum otomatis terlibat dalam recovery production sampai siap. Saat semua 6 siap pengguna meminta hapus flags sehingga `node common/recovery-controller.mjs --all --audit-only` secara manual mengikutkan keenam modul. Assistant memberikan **PowerShell patch** untuk mengganti dua kemunculan menjadi:

```js
const modules = [
  'sales-invoice', 'item-fulfillment', 'sales-order',
  'item-receipt', 'purchase-order', 'purchase-invoice'
];
```

**Bukti penerapan di live:** audit berikutnya memang menampilkan keenam modul tanpa setting flags manual. Namun isi dua deklarasi di live tetap sebaiknya `Select-String` pada chat baru. Jangan menghapus env var di launcher hanya karena redundan: terpisah, tidak perlu disentuh. `--all --audit-only` read-only; `--all --sync` menjalankan keenam writer dan bukan alat debugging read-only.

`PO/PI` diperlakukan dengan branch khusus di controller: `presence.mjs` + `check.mjs`; tidak menggunakan targeted accounting repair SI/SO/IF. Di core, modul PO/PI `AUDIT_CLEAN` jika check sukses (tanpa penulisan). `ERROR` bisa hanya karena presence/check mismatch akibat transaction baru; baca reason, jangan disable check.

## 8. Bottleneck, insiden, solusi dan kondisi terakhir — detail kronologi 21–22 Oktober

### 8.1 Scheduler/Fast Delta lock dan pemahaman `latest.json`

- Output lock seperti `PID_EXISTS`, `worker=fast-delta` (contoh PID 21180 / 13948), `guard=ABSENT`, Task `Running` berarti normal: Fast Delta sedang memproses. Saat selesai `Ready`, `lock=ABSENT`.
- Scheduler slot **10:00 WIB (22/10)** `startedAt=2026-10-22T03:01:31.394Z`, `finishedAt=03:05:59.570Z`, `status=NEEDS_REVIEW`, `exitCode=3`, `timedOut=false`. **Bukan hang** meskipun diperiksa 10:19; belum ada run baru.
- Slot **10:20 WIB** started `03:21:31.298Z`, finished `03:29:32.984Z`, `NEEDS_REVIEW` exit 3; log menunjukkan IF pulih, namun SO belum. Jadwal tetap **20 menit**, tidak diubah/direset.

### 8.2 Item Fulfillment COGS mismatch — SOLVED otomatis

- IF dokumen `3158215`, `DO261010577`:
  - COGS NetSuite **21,863,882.05** vs BigQuery **21,800,073.77**; diff **63,808.28**.
  - Full October point-in-time: 923 headers, 2628 lines, qty 327017, source COGS 9,224,933,669.92, source validation PASS, `differences=1`.
  - One document: 10 lines, quantity 320, source validation PASS. BQ header COGS = SUM(line COGS) = 21,800,073.77 (so BigQuery internally consistent but stale). Timestamp BQ **`2026-10-22 08:22:29`** and NetSuite `lastmodifieddate` **sama**, jadi perubahan costing bisa terjadi tanpa timestamp header berubah sebagaimana biasa.
  - `modules/item-fulfillment/reconcile-accounting.mjs --id 3158215` **read-only**. `--apply` exists for bounded one-document accounting repair but **tidak perlu dijalankan manual**.
  - Scheduler 10:20 melalui existing `repair-accounting-bounded.mjs` melakukan guard/dry run/apply, kemudian `reconcile-accounting.mjs` `differences=0`. Pengguna memverifikasi setelah run: `differences=0; mode=READ ONLY`.
  - **Resolution:** IF mismatch selesai otomatis; jangan melakukan repair ulang.
  - Dalam source `reconcile-accounting.mjs`, `--apply` memeriksa exact line key, qty, timestamp, old BQ COGS dan menggunakan BigQuery transaction untuk header+lines; jangan sembarangan bypass.

### 8.3 Sales Order NEEDS_REVIEW — terkejar Fast Delta

- Scheduler slot 10:20 awalnya SO `LINE FIELD-BY-FIELD MATCH FAIL mismatch=14` dan `RAW LINE AMOUNT FAIL`; first comparison diff besar, bounded retry diff raw line tinggal **0.65**; `SOURCE_MOVING_DETECTED sales-order: changed=headerTotal,rawLineAmount; defer full verification; no checkpoint changes`.
- Setelah itu manual read-only SO `check.mjs` saat source terus bergerak: NS headers 925 vs BQ 924, lines 4383 vs 4381, beda total header **4,937,499.66**, contoh missing/changed ID **3158460** dan **3158514**, mismatch 38 lines. *Bukan fix dengan merombak mapping*.
- Fast Delta slot 10:31 WIB berjalan dan selepas selesai SO `check.mjs` **FULL PASS**: NS=BQ **925 headers**, **4383 lines**, header total kedua sisi **15,195,269,148.72**, signed raw lines **-15,194,879,103.68**, mismatch=0, seluruh class discount/other/product/tax PASS.
- Jam sibuk berikutnya SO berubah lagi: NS 926/BQ 925 (ID 3158620), kemudian NS 931/BQ 929 (IDs **3158644**, **3158645**). Ini data baru pada waktu berikutnya, bukan bukti recovery lama gagal.

### 8.4 Sales Invoice tertinggal dan potensi deletion — BELUM DIKONFIRMASI

- Pada satu audit: SI NS=1277 vs BQ=1271 (6 missing), 56952 vs 55958 lines, amounts NS 41,477,911,120.24 vs BQ 40,358,460,444.11; missing IDs **3158522..3158527**. Kemudian audit NS 1282/BQ 1271 (11 new: 3158522..3158532).
- Audit selanjutnya **membalik arah**: NS **1274** vs BQ active **1285**, `ONLY_BIGQUERY=11`, ids **3158518,3158519,3158521,3158520,3158523,3158525,3158522,3158524,3158530,3158517,3158516**; masing-masing `NOT_VISIBLE_IN_NETSUITE`.
- **Wajib bedakan:** NS-only=catch-up candidate; BQ-only=**not automatically deleted**. Jika tetap BQ-only saat sumber stabil, gunakan audit `deletedrecord` per document dan existing `scripts/verified-deletion.mjs` strict guard; jangan `--apply` hanya karena `NOT_VISIBLE_IN_NETSUITE`.

### 8.5 Purchase Order update status — source moving bukan schema issue

- Audit pertama PO NS/BQ **145/145**, lines **572/572**, mismatch 0, AUDIT_CLEAN.
- Audit beberapa waktu berikutnya: 145/145, 572/572, **1 header mismatch** ID `3154225`: `last_modified` NS **2026-10-22 10:58:10**, BQ **2026-10-16 17:02:32**; status NS `Purchase Order : Pending Bill`, BQ `Purchase Order : Pending Receipt`; detail mismatch 0. Controller melabel `ERROR` karena `check.mjs` exited 1. Itu menunjukkan **status berubah, menunggu catch-up**, bukan bukti PO code salah.

### 8.6 Purchase Invoice new bill — source moving

- Audit pertama PI 284 headers, 1355 lines, 1355 GL, 204 links, **4/4 PASS**.
- Audit berikutnya NS **290** vs BQ **289**, hanya `ONLY_NETSUITE = [3158646]`, PI `presence.mjs` exit nonzero -> controller `ERROR`. Ini disebabkan invoice baru belum tercermin di BQ ketika snapshot, bukan otomatis crash kode.

### 8.7 Baseline operasional untuk jam sibuk

Finance input padat sekitar **09:00–12:00 WIB** sehingga hasil audit dapat berganti dari modul ke modul pada tiap menit. User memutuskan **jangan menjalankan audit berulang yang tak pernah selesai**; biarkan Fast Delta 5 menit dan scheduler 20 menit melakukan catch-up. Saat Finance lebih sepi ~13:00 WIB lakukan 1 read-only audit bila perlu. `NEEDS_REVIEW` tetap status jujur; jangan disable reconciliation atau memaksa status PASS.

### 8.8 Last audit visible 22 Oktober

Ada log dengan **dua snapshot audit berbeda**. Snapshot pertama: SI needs review 11 NS-only, IF clean, SO needs review 1 NS-only, IR clean, PO clean, PI clean. Snapshot kedua (lebih baru): SI needs review 11 BQ-only, IF clean, SO needs review 2 NS-only, IR clean (audit only), PO ERROR one header changed, PI ERROR new bill. Semua hasil merupakan *point-in-time*, bukan live final state. Pertahankan pembedaan ini di chat baru.

## 9. PowerShell command reference — semua dari Windows root

### 9.1 Status dan lock

```powershell
cd C:\netsuite-backup
Get-ScheduledTask |
  Where-Object { $_.TaskName -match 'NetSuite Backup' } |
  Select-Object TaskName, State
node .\scripts\shared-lock-inspect.mjs
Get-ScheduledTaskInfo -TaskName 'NetSuite Backup V3' |
  Select-Object LastRunTime,LastTaskResult,NextRunTime
```

**Jangan manual writer apabila scheduler/fast delta Running atau lock `PID_EXISTS`.** `latest.json` adalah hasil run selesai terakhir, bukan status real time.

### 9.2 Log scheduler

```powershell
$latest = Get-Content .\logs\scheduler\latest.json -Raw | ConvertFrom-Json
$latest | Select-Object slot,status,exitCode,timedOut,startedAt,finishedAt,log
$log = Join-Path '.\logs\scheduler' $latest.log
Select-String -Path $log -Pattern '^sales-invoice:|^item-fulfillment:|^sales-order:|^item-receipt:|^purchase-order:|^purchase-invoice:' |
  Select-Object -ExpandProperty Line
Select-String -Path $log -Pattern 'MODULE ERROR|SOURCE_MOVING_DETECTED|NEEDS REVIEW|mismatch|differences=' -Context 2,3
```

### 9.3 Audit 6 modul **read-only** (sesudah perubahan feature flags)

```powershell
cd C:\netsuite-backup
node .\common\recovery-controller.mjs --all --audit-only
```

Kalau hanya 4 modul muncul, **jangan ubah scheduler dulu**: periksa apakah live `recovery-controller.mjs` masih memakai `NETSUITE_PO_ENABLED`/`NETSUITE_PI_ENABLED` di kedua module arrays. Pada versi lama gunakan local process env flags sementara:

```powershell
$env:NETSUITE_PO_ENABLED = '1'
$env:NETSUITE_PI_ENABLED = '1'
node .\common\recovery-controller.mjs --all --audit-only
```

Jangan samakan audit-only IR dengan full financial. Jangan jalankan `--all --sync` pada kondisi Finance sibuk hanya untuk memaksa status clean.

### 9.4 Checks terpisah

```powershell
node .\modules\sales-invoice\presence.mjs
node .\modules\sales-invoice\check.mjs
node .\modules\item-fulfillment\reconcile-accounting.mjs --id 3158215
node .\modules\sales-order\check.mjs
node .\modules\item-receipt\check-financial.mjs
node .\modules\purchase-order\presence.mjs
node .\modules\purchase-order\check.mjs
node .\modules\purchase-invoice\sync.mjs --dry-run
node .\modules\purchase-invoice\presence.mjs
node .\modules\purchase-invoice\check.mjs
```

`check-financial.mjs` IR adalah script existing; ketahui argumennya dari source sebelum memakainya jika perlu. Untuk IF **tidak** ada `check-financial.mjs` di folder IF, gunakan `reconcile-accounting.mjs`.

### 9.5 Jadwalkan audit 12:31 WIB dalam satu terminal PowerShell (script yang disarankan di chat)

```powershell
cd C:\netsuite-backup
$target = (Get-Date).Date.AddHours(12).AddMinutes(31)
if ((Get-Date) -ge $target) { $target = $target.AddDays(1) }
Write-Host "Audit dijadwalkan: $target"
while ((Get-Date) -lt $target) { Start-Sleep -Seconds 5 }
node .\common\recovery-controller.mjs --all --audit-only
Write-Host "Audit selesai: $(Get-Date)"
```

Ini **bukan** Task Scheduler Windows dan terminal harus tetap terbuka. **Keterbatasan:** script timer tersebut *tidak otomatis menunggu lock menjadi ABSENT*; sebelum menjalankan audit sesuai slot, pengguna perlu memastikan tidak bentrok atau tambahkan guard read-only sesuai baseline jika ingin otomatis ditunda. Pada saat file handover ini dibuat tidak ada bukti output audit 12:31 yang telah selesai; jangan klaim sudah PASS.

## 10. Ketentuan integrasi Modul 7 Sales Return — next chat

### 10.1 First action yang wajib dilakukan

1. User membuka chat baru, melampirkan dokumen ini **dan idealnya ZIP source live terbaru yang sudah dibersihkan dari rahasia**. Assistant membaca `modules/sales-invoice`, `modules/item-fulfillment`, `modules/purchase-order`, `modules/purchase-invoice`, serta `common/recovery-controller.mjs` / `scripts/fast-delta.mjs` / `scripts/scheduler-runner.mjs` *sebelum* menyarankan patch.
2. Periksa scheduled task Ready + shared lock ABSENT dan catat baseline `config/scheduler.json` **interval 20 menit**. Jangan memulai dengan redesign scheduler.
3. NetSuite **probe SuiteQL read-only** untuk `Return Authorization`, `Item Receipt` retur pelanggan, `Credit Memo` dan linked transactions yang benar-benar digunakan di akun ini; verifikasi October 2026 count, posting, amount sign, item GL/COGS, link to SO/IF/SI, multiple currencies, lines/IDs.
4. Tanyakan hanya fakta kritis yang tidak dapat dipastikan oleh probe; jangan memberi jawaban deterministik tentang tipe record sebelum data ada.
5. Audit role existing `PNM NetSuite Backup Integration` untuk permission minimal transaksi terkait (View) dan dependen Lists/Reports bila gagal query.
6. Rancang tabel BigQuery berdasar raw grain dan join, jangan copy schema Vendor Bill membabi-buta. **Automated CREATE TABLE IF NOT EXISTS di sync.mjs** saat user copy-paste dan jalankan script lewat PowerShell.
7. Implement source mapper + strict financial invariants, `--dry-run`, `--sync`, `presence.mjs`, `check.mjs`, checkpoint-safe atomic upsert/delta, deletion proof, restore policy sesuai baseline existing; staging auto cleanup.
8. Integrasikan ke same six-module recovery/fast delta/scheduler **setelah** standalone financial/source validation lulus; menjadi tujuh modul tanpa penjadwalan baru. Waktu menjalankan writer harus bebas lock; backup/rollback.
9. Hasilkan dokumentasi FE/ops/hand-over baru beserta exact field names, schema, checkpoint labels, query probes, sample totals, permissions, logs, success/failure evidence.

**Peringatan:** Sales Return adalah rekomendasi perencanaan, **belum** dibangun. Jangan menyebut Return Authorization otomatis sebagai satu-satunya transaksi return sampai NetSuite probe mengonfirmasi workflow lokal.

## 11. Referensi source of truth yang perlu dibawa jika tersedia

- `netsuite-backup(9).zip` — snapshot lengkap proyek enam modul sebelum sebagian perubahan akhir chat ini. Memuat file credential: **jangan upload ke pihak ketiga tanpa redaksi**, dan jangan menyalin isi rahasia ke dokumentasi.
- `.docs/1_NETSUITE_BIGQUERY_PROGRESS_HANDOVER_2026-10-08.md` — foundational setup, SI OAuth/role.
- `.docs/2_NETSUITE_BACKUP_HANDOVER_FOUNDATION_V5_2_2026-10-14.md` — SI/IF/SO, recovery, NetSuite access, deletion, scheduler lama.
- `.docs/3_NETSUITE_BACKUP_HANDOVER_BASELINE_4_MODULE_2026-10-20.md` — IR + core stabilisasi.
- `.docs/4_NETSUITE_BACKUP_HANDOVER_5_MODULE_2026-10-21.md` — PO + integration baseline; beberapa scheduler config lama 30 menit, **sudah diganti menjadi 20 menit di live**.
- Patch artisanal yang pernah diinstall: `purchase-invoice-checkpoint-retry-hardening.zip`; `purchase-invoice-verified-deletion-extension.zip`; `purchase-invoice-suiteql-incremental-optimization.zip`; PowerShell replacement recovery controller flags. **Jangan reapply patch dari awal tanpa diff terhadap live files**.

## 12. Checklist pemeliharaan status (untuk start chat baru)

- [ ] Pernah dibuktikan SI/IF/SO/IR/PO/PI dapat berjalan di production (tergantung source moving saat audit).
- [ ] File dan project root yang digunakan `C:\netsuite-backup`.
- [ ] Region BigQuery `asia-southeast1`, dataset `netsuite_backup`.
- [ ] Exact NetSuite role `PNM NetSuite Backup Integration`; global CSV SuiteScript setting OFF.
- [ ] Scheduler V3 20 menit; Fast Delta 5 menit; Windows Task state Ready dan shared lock ABSENT sebelum tindakan manual writer.
- [ ] Reuse central OAuth/BQ, sync checkpoint, lock, controller, verified-deletion utilities.
- [ ] PO/PI audit availability tidak boleh bergantung flags setelah code patch terbaru; jika masih muncul 4, check actual current code first.
- [ ] PI four checkpoint/tables dan SuiteQL incremental optional `since`; preservation of full-month presence/check.
- [ ] SI BQ-only 11 pada 22 Oct bukan verified deletion otomatis.
- [ ] IF `3158215` COGS mismatch solved via bounded auto recovery (read-only diff 0).
- [ ] SO, PO, PI berubah selama high-traffic Finance, jangan memaksakan ALL PASS snapshot yang tidak stabil.
- [ ] **Next: Sales Return read-only probe, followed by automatic DDL from same sync script PowerShell.**

---

### Ringkasan satu paragraf untuk prompt awal chat baru

> Lanjut project NetSuite Backup `C:\netsuite-backup` (Windows/PowerShell/Node ESM), GCP `even-gearbox-255203`, BQ dataset `netsuite_backup`, region `asia-southeast1`. Enam modul production: SI, IF, SO, IR, PO, PI/Vendor Bill. Scheduler V3 20 menit 08:00–22:00 WIB; Fast Delta 5 menit; shared lock/checkpoints/recovery-controller existing. NetSuite role persis `PNM NetSuite Backup Integration` (historical `customrole1042`), OAuth2 M2M JWT PS256, global `Run Server SuiteScript and Trigger Workflows` OFF. PI empat tabel dan checkpoints, SuiteQL incremental filtering, deletion audit exact `vendorbill/VENDORBILL`; patched and validated. Chat 22 Oct: IF COGS diff 63808.28 at 3158215 auto-recovered to diff 0; SI/SO/PO/PI show transient source movement during Finance high traffic; do not disable guard. Recovery --all audited six modules after removal of PO/PI feature flags. Next module **Sales Return**, start read-only SuiteQL probe and follow same patterns incl auto `CREATE TABLE IF NOT EXISTS` inside Node `sync.mjs` called from copy-paste PowerShell. Preserve baseline; inspect live source, never invent new architecture or modify stable scheduler for convenience.
