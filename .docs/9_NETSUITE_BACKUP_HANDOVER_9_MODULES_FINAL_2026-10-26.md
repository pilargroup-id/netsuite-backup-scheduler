# NETSUITE BACKUP → BIGQUERY — HANDOVER FINAL 9 MODUL (26 OKTOBER 2026)

**Sumber kebenaran:** snapshot ZIP `netsuite-backup(20261026-080330).zip` (file aktual) + output produksi yang dibagikan pengguna dalam percakapan ini + dokumentasi historis `.docs/1` s.d. `.docs/8`. Dokumen ini **mengganti arahan lama yang sudah terlampaui**; bukan pengganti pengecekan kondisi live pada awal chat berikutnya. 

**PENTING:** Status terkini terakhir yang dikirim user adalah V3 **slot 15:00 WIB, FINAL_PASS, exitCode 0, timedOut false** (mulai 2026-10-26T08:01:34.243Z, selesai 2026-10-26T08:13:23.835Z). Recovery summary berisi 8 modul berstatus FINAL_PASS dan Purchase Return NO_SOURCE. Fast Delta terakhir yang diobservasi SYNC_OK pada 2026-10-26T07:59:30.084Z, dengan delapan modul aktif berhasil dan Purchase Return NO_SOURCE. Ini bukti sukses pada timestamp tersebut, **bukan** jaminan kondisi selamanya. 

## 0. PERINTAH WAJIB UNTUK CHAT BARU — BACA TERLEBIH DAHULU

1. Baca dokumen ini keseluruhan dan **inspeksi ZIP project terbaru** sebelum menulis kode. ZIP bisa lebih baru dari handover. Jangan mengarang struktur file, schema, nama module, SQL, atau flag.
2. Scope awal selesai: 9 modul didukung otomatis (8 FINAL_PASS + Purchase Return NO_SOURCE). Penambahan modul hanya jika diminta.
3. Prioritas ekspansi pengguna: **Customer Credit Memo (`CustCred`), Vendor Credit (`VendCred`), Journal Entry (`Journal`), Vendor Payment (`VendPymt`)**. **Inventory Transfer (`InvTrnfr`) dan Inventory Adjustment (`InvAdjst`) ditunda.** Belum ada urutan *pembangunan* final yang ditetapkan di antara empat modul; lakukan probe dan pilih berdasar instruksi pengguna. Jangan otomatis memasukkan 6 modul sekaligus.
4. Baseline kode dan tahap testing harus mengikuti modul terdahulu, utamanya Sales Payment / Purchase Invoice / Purchase Return sesuai karakter transaksi. Jangan mengganti arsitektur, library, auth, role, scheduler, deletion, decimal, schema, atau status contract atas inisiatif sendiri.
5. **Semua file JS/MJS yang diberikan untuk download wajib dalam ZIP dengan path relatif project benar.** User ekstrak lalu **replace manual**; **jangan perintah `Expand-Archive`**. ZIP boleh mencakup dokumentasi/test bila relevan.
6. PowerShell/Node testing: **print langsung terminal**, jangan otomatis menyimpan hasil ke `.txt`/log; **jangan** `Tee-Object`, `Out-File`, `> something.txt`, redirection sejenis. User akan copy output.
7. Penjelasan/diagnosis **harus langsung diikuti langkah konkret** berupa syntax PS / Node / SuiteQL, bukan menunggu user minta lagi. Jalankan tes **bertahap** berdasarkan bukti output; jangan melompat langsung ke production.
8. BigQuery tables **harus dibuat otomatis oleh script Node yang user jalankan dari PowerShell** (menggunakan `CREATE TABLE IF NOT EXISTS` via helper), bukan membuat tabel manual lewat UI GCP. Schema-only khusus hanya jika dibuktikan sumber kosong dan sudah ada pola valid (contoh Purchase Return).
9. Automatic **verified deletion WAJIB** untuk semua modul sekarang dan yang akan dibuat: independent deletedrecord proof exact identity, source no longer visible, dry run, limit batch 3, audit, header soft-delete, historical details retained, checkpoints tidak bergeser karena deletion, ambiguity fail closed.
10. Jangan pernah menjadikan `SYNC_OK` setara `FINAL_PASS`; status V3 harus melalui presence/check/financial bila relevan dan contract lengkap. `NO_SOURCE` hanya boleh secara eksplisit pada modul dengan gate yang benar (sekarang Purchase Return).
11. Keselamatan production: jangan menghapus active shared lock, membatalkan task berjalan, mengubah role/permissions sembarangan, atau menjalankan manual sync bersamaan dengan scheduler. Jangan memaksakan FINAL_PASS pada source movement.
12. User tidak mau file sampah. Jangan membundel backup lawas, log runtime, state, `.tmp`, credential, atau file tambahan yang tidak berguna ke ZIP patch. Jangan menghapus script probe/tes secara spekulatif; audit call graph dan kebutuhan operasional dahulu.

## 1. Tujuan, periode, dan status scope

- Organisasi: PNM / PT Pilar Niaga Makmur; backup transaksi NetSuite ke BigQuery, validasi count dan nominal rupiah untuk periode **Oktober, November, Desember 2026**, tenggat awal proyek **10 Desember 2026**.
- Nama project GCP: `even-gearbox-255203`; BigQuery dataset: `netsuite_backup`; location: `asia-southeast1`; source NetSuite via REST SuiteQL.
- Workstation Windows 11, PowerShell, Node.js via `C:\nvm4w\nodejs\node.exe`; root project **`C:\netsuite-backup`**.
- Modul aktif: `sales-invoice`, `item-fulfillment`, `sales-order`, `item-receipt`, `purchase-order`, `purchase-invoice` (Vendor Bill), `sales-return`, `purchase-return`, `sales-payment` (Customer Payment).
- Purchase Return **NO_SOURCE**, bukan FAIL: 15 historical `VendAuth` visible 2021–2026 tetapi 0 `VendAuth` pada Oct–Dec 2026 saat probe; 5 tabel PR schema-only kosong, tanpa checkpoint palsu; 80 `VendCred` Oktober bukan otomatis physical purchase return. Gate harus dicek lagi bila source baru muncul.
- Historis indikator sebelum Module 9: SI Oct 329, total 11,024,326,946.66; IF 337 headers / 970 lines / COGS 3,166,002,141.16; PO 130 headers / 522 lines; PI sekitar 262 headers / 1249 detail / 168 prior links. **Historis, bukan angka live.** Angka transaksi dapat bertambah/berubah sewaktu-waktu.

### Status production FINAL terbaru dari chat

| Module | V3 15:00 | Fast Delta last recorded |
|---|---|---|
| Sales Invoice | FINAL_PASS | lastSuccess 2026-10-26T07:56:56.503Z |
| Item Fulfillment | FINAL_PASS | 2026-10-26T07:57:14.117Z |
| Sales Order | FINAL_PASS | 2026-10-26T07:57:29.043Z |
| Item Receipt | FINAL_PASS | 2026-10-26T07:57:46.165Z |
| Purchase Order | FINAL_PASS | 2026-10-26T07:58:02.203Z |
| Purchase Invoice | FINAL_PASS | 2026-10-26T07:58:30.303Z |
| Sales Return | FINAL_PASS | 2026-10-26T07:58:58.827Z |
| Purchase Return | NO_SOURCE | NO_SOURCE (tidak ada LastSuccess) |
| Sales Payment | FINAL_PASS | 2026-10-26T07:59:30.050Z |

V3 juga membuktikan FINAL_PASS slot 14:40 (2026-10-26T07:41:34.320Z → 07:48:27.765Z, exit 0). Status pengujian ini **bukan klaim** live automatic deletion Sales Payment pernah dipakai terhadap transaksi sungguhan.

## 2. Setup NetSuite awal — identitas dan permission (WAJIB PRESISI)

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

## 3. Arsitektur dan baseline komponen

1. `common/netsuite-client.mjs`: OAuth token dan SuiteQL `token()`, `fetchAll()` serta pagination; satu-satunya jalan koneksi NetSuite untuk module baru.
2. `common/bigquery-client.mjs`: `PROJECT=even-gearbox-255203`, `DATASET=netsuite_backup`, `LOCATION=asia-southeast1`, `query()`, `T()`, `dataset`; gunakan ini, jangan membuat BigQuery client alternatif.
3. `common/decimal-precision.mjs`: validation exact BigQuery NUMERIC, skala 9 digit. **Jangan floating-point JS untuk nominal/final reconciliation**, jangan silent rounding, gunakan decimal normalized string dan BigInt scaled.
4. `modules/<slug>/mapping.mjs`: SuiteQL source discovery→headers/lines/GL/links→normalisasi→validasi keys, relationships, arithmetic, source types. Query bounded/paginated dengan batch IDs dan tidak overscan.
5. `modules/<slug>/sync.mjs`: flags **`--dry-run` / `--sync`**, mutual exclusive. Dry run read-only, validasi mapping dan staging plan tanpa DDL/checkpoint; production sync yang membuat tabel otomatis, staging, SQL atomic commit dan checkpoint.
6. `modules/<slug>/presence.mjs`: independently compare NetSuite vs BigQuery identity, count, duplicate, only NS, only BQ. Penghapusan BigQuery-only tidak pernah langsung dianggap delete.
7. `modules/<slug>/check.mjs`: reconciliation end-to-end; `check-financial.mjs` jika finansial relevan. Semua read-only.
8. `common/verified-deletion-batch.mjs`, `common/verified-deletion-proof.mjs`, `scripts/verified-deletion.mjs`: shared deletion proof, guard, audit. Jangan fork jadi deletion engine liar per-modul.
9. `common/recovery-controller.mjs`: dua jalur `--core <module> <mode>` dan wrapper `<module|--all> <mode>`. Melakukan sync/check/financial/presence dan bounded repair menurut konfigurasi. Source movement bisa menghasilkan `NEEDS_REVIEW` exit 3.
10. `scripts/fast-delta.mjs`: serial incremental sync per modul, shared lock, merekam `logs/fast-delta/health-v2.json`; marker khusus per module, 30-minute timeout per module (dari source), `SYNC_OK` **hanya membuktikan delta**.
11. `scripts/scheduler-runner.mjs`: V3 serial workflow `common/recovery-controller.mjs --all --sync`, shared lock, status final via `common/v3-status-contract.mjs` dengan 9 module wajib, writes latest/history setelah selesai, maxRunMinutes 120.
12. `scripts/fast-delta-freshness.mjs`, `fast-delta-freshness-alert.mjs`, `scheduler-watchdog.mjs`, `monitor-alert.mjs`: freshness, watchdog, alerting/monitoring; task Ready dan result=0 **tidak** membuktikan semua jalur alert telah diuji sampai penerima.

**Shared lock**: `logs/scheduler/.running.lock/owner.json`, `common/shared-lock.mjs` owner PID/host/token/startedAt, guard, stale archive, ACQUIRED/RELEASED; min stale 120,000 ms ditambah validasi proses owner mati. **Jangan hapus lock manual, jangan menjalankan V3 dan Fast Delta bersamaan**. Windows Task Fast Delta `MultipleInstances=IgnoreNew` hanya mencegah duplikasi task yang sama, tidak mengganti cross-task shared lock.

**Recovery self-healing** `config/self-healing.json`: `enabled:true`, `catchUpSync:true`, `maxRecoveryPerModulePerRun:3`, `verifiedDeletionEnabled:true`, `verifiedIFDeletionEnabled:true`. Wrapper bisa melakukan maksimal 4 bounded recovery passes (sampai 12 targeted records menurut source) untuk modul relevan; bukan jaminan semua modul punya recover. Error/ambiguous tetap review.

**V3 final status contract** `REQUIRED_V3_MODULES`: tepat sembilan nama dari tabel bagian 1. Semua kecuali Purchase Return wajib `FINAL_PASS`; Purchase Return boleh `NO_SOURCE`; missing/duplicate/ERROR/unknown mencegah `FINAL_PASS`. Exit 3 `NEEDS_REVIEW`, exit nonzero lain `FAILED`. Jangan downgrade contract supaya hasil hijau.

## 4. STRUKTUR FOLDER AKTUAL dari ZIP (bukan tebakan)

```text
C:\netsuite-backup\
├── .docs/
│   ├── 1_NETSUITE_BIGQUERY_PROGRESS_HANDOVER_2026-10-08.md
│   ├── 2_NETSUITE_BACKUP_HANDOVER_FOUNDATION_V5_2_2026-10-14.md
│   ├── 3_NETSUITE_BACKUP_HANDOVER_BASELINE_4_MODULE_2026-10-20.md
│   ├── 4_NETSUITE_BACKUP_HANDOVER_5_MODULE_2026-10-21.md
│   ├── 5_NETSUITE_BACKUP_HANDOVER_6_MODUL_2026-10-22.md
│   ├── 6_NETSUITE_BACKUP_HANDOVER_FINAL_BASELINE_2026-10-22.md
│   ├── 7_NETSUITE_BACKUP_HANDOVER_MODULE_2026-10-23.md
│   ├── 8_NETSUITE_BACKUP_HANDOVER_MODULE_8_TO_9_2026-10-26.md
├── common/
│   ├── bigquery-client.mjs
│   ├── child-runner.mjs
│   ├── decimal-precision.mjs
│   ├── netsuite-client.mjs
│   ├── presence-reconcile.mjs
│   ├── recovery-controller.mjs
│   ├── shared-lock.mjs
│   ├── so-mismatch-candidates.mjs
│   ├── source-movement.mjs
│   ├── sync-utils.mjs
│   ├── targeted-recovery.mjs
│   ├── v3-status-contract.mjs
│   ├── verified-deletion-batch.mjs
│   ├── verified-deletion-proof.mjs
├── config/
│   ├── scheduler.json
│   ├── self-healing.json
│   ├── telegram-chat-id.txt
│   ├── telegram-credential.clixml
├── modules/
│   ├── item-fulfillment/  [check.mjs, mapping.mjs, presence.mjs, reconcile-accounting.mjs, recover.mjs, repair-accounting-bounded.mjs, sync.mjs]
│   ├── item-receipt/  [check-financial.mjs, check.mjs, mapping.mjs, presence.mjs, probe.mjs, recover.mjs, sync.mjs]
│   ├── purchase-invoice/  [check.mjs, mapping.mjs, presence.mjs, probe.mjs, sync.mjs]
│   ├── purchase-order/  [check.mjs, mapping.mjs, presence.mjs, probe.mjs, recover.mjs, sync.mjs]
│   ├── purchase-return/  [audit-common.mjs, check-financial.mjs, check.mjs, deletion-inventory.mjs, initialize-schema.mjs, mapping.mjs, presence.mjs, scheduler-gate.mjs, sync.mjs]
│   ├── sales-invoice/  [check.mjs, mapping.mjs, presence.mjs, recover.mjs, sync.mjs]
│   ├── sales-order/  [check.mjs, mapping.mjs, presence.mjs, recover.mjs, repair-active.mjs, sync.mjs]
│   ├── sales-payment/  [audit-source.mjs, check-financial.mjs, check.mjs, diagnose-financial.mjs, mapping.mjs, presence.mjs, probe-deletion-identity.mjs, probe.mjs, sync.mjs, test-mapping.mjs]
│   ├── sales-return/  [check-financial.mjs, check.mjs, mapping.mjs, presence.mjs, probe.mjs, sync.mjs]
├── scripts/
│   ├── diagnose-transaction.mjs
│   ├── fast-delta-freshness-alert.mjs
│   ├── fast-delta-freshness.mjs
│   ├── fast-delta.mjs
│   ├── freshness-incident-core.mjs
│   ├── monitor-alert.mjs
│   ├── monitor-notify.ps1
│   ├── run-fast-delta-hidden.vbs
│   ├── run-fast-delta.ps1
│   ├── run-freshness-monitor.ps1
│   ├── sales-payment-deletion-inventory.mjs
│   ├── scheduler-runner.mjs
│   ├── scheduler-watchdog.mjs
│   ├── shared-lock-inspect.mjs
│   ├── verified-deletion.mjs
├── tests/
│   ├── child-runner-test.mjs
│   ├── fast-delta-integration-test.mjs
│   ├── foundation-test.mjs
│   ├── sales-payment-deletion-contract.test.mjs
│   ├── sales-payment-source-movement.test.mjs
│   ├── sales-payment-v3-integration.test.mjs
│   ├── source-movement-test.mjs
│   ├── verified-deletion-proof.test.mjs
├── logs/ [RUNTIME STATE — jangan taruh di ZIP patch, jangan hapus sembarangan]
│   ├── scheduler/ (.running.lock, stale-lock-archives, latest.json, history.jsonl, skips.jsonl, shared-lock-audit.jsonl, run-*.log)
│   ├── fast-delta/ (health-v2.json, freshness-alert-state.json, run-*.log)
│   ├── verified-deletions/ (audit JSONL)
│   ├── freshness/, purchase-invoice/, sales-return/
├── backups/ [rollback snapshots historis; bukan runtime]
├── package.json
├── package-lock.json
└── .gitignore
```

**Total snapshot ZIP 779 file** termasuk sekitar 655 log/artefak runtime; source project aktif penting jauh lebih kecil. Jangan menganggap semua file dalam ZIP adalah dependency aplikasi. File backup lama dan `.tmp` bisa dibersihkan setelah pemeriksaan, tetapi jangan otomatis menghapus dokumen, tests, probes, state/audit/credential atau history yang diperlukan.

## 5. Module 9 SALES PAYMENT: perjalanan development dan baseline final

**Identitas:** label bisnis `Sales Payment` / `Customer Payment`, NetSuite Transaction type **`CustPymt`**; recordtype identity **`customerpayment`** pada record, NetSuite deletedrecord **`recordtypeid=customerpayment`** dan **`type=CUSTOMERPAYMENT`** (proof exact). Source data transaksi tidak boleh disamakan dengan refund/credit memos.

**Phase A → visibility:** read-only probe `modules/sales-payment/probe.mjs`; access awal terbatas sampai role ditambahkan **Customer Payment View**. Never change role Full as quick fix.

**Phase B1 → full source audit:** `audit-source.mjs`, finansial diagnosis `diagnose-financial.mjs`. Temuan struktur mainline + AR line pasangan tanda, accounting book debit=credit, `PreviousTransactionLineLink` dengan nextdoc customer payment, previousdoc customer invoice (`CustInvc`), linktype `Payment`. Probe harus mengecek cardinality dan sumber yang benar.

**Phase B2 mapping:** `mapping.mjs`, `test-mapping.mjs`, strict source identification, unique keys, no orphan, decimal exact. Header `amount_used + amount_unused = foreign_total`; sum application = amount used; transaction lines net zero; primary GL book debit=credit=base total untuk transaksi nonvoid, sesuai mapping source. Historical transaction crosslinks harus dipastikan benar.

**Phase B3 sync dan auto-create:** `sync.mjs` `--dry-run` sebelum `--sync`. Pada `--sync`, fungsi `ensureTables()` menerbitkan `CREATE TABLE IF NOT EXISTS` melalui BigQuery helper; **tidak ada pembuatan tabel manual di console GCP**. 4 tabel:

| Table | Key utama | Keterangan |
|---|---|---|
| `sales_payment_headers` | `payment_id` STRING | header, customer/currency/amount/date, `is_deleted`, `deleted_at`, `synced_at`; partition `transaction_date` |
| `sales_payment_lines` | (`payment_id`,`line_unique_key`) | transaction lines |
| `sales_payment_accounting_lines` | (`payment_id`,`accounting_book_id`,`line_id`,`account_id`) | GL lines |
| `sales_payment_applications` | (`payment_id`,`invoice_id`,`payment_line_id`,`invoice_line_id`) | linkage invoice applications |

`sync_checkpoints` shared harus sudah ada; script menolak partial/diverged checkpoints (Sales Payment **4**). Incremental checkpoint per table, overlap 5 menit, stage NDJSON temp OS, BigQuery load, row-count + unique-key asserts, atomic merge/replace grouped details, checkpoint commit bersama. Retry checkpoint transaction-abort terbatas bila original watermark tetap sama; unknown commit **tidak** direplay secara sembarang. Header-only `is_deleted` marker, historical details retained. No use `internal_id` for Sales Payment PK (`payment_id`).

**B4 reconciliation:** `presence.mjs`, `check.mjs`, `check-financial.mjs` read-only. Contoh hasil V3 slot 14:40: headers **887**; applications **2637**; accounting lines **1774**; transaction lines **1774**; `foreignTotal=amountUsed=applicationsTotal=book1Debit=book1Credit=28396421346.86`; `problems=[]`. `SALES PAYMENT CHECK PASS` dan `SALES PAYMENT FINANCIAL CHECK PASS`. Ini snapshot saat itu, bukan nilai tetap.

**B5 deletion identity:** `probe-deletion-identity.mjs`. Awalnya negative proof palsu karena record ID pada `deletedrecord` bisa muncul untuk *recordtype* lain (collision). Perbaikan: exact triple match `recordid + recordtypeid + type`, positive proof benar, negative guard jangan memblokir exact match hanya karena kolisi jenis lain. Regression **8 cases PASS**. B5.2 hardened shared delete; B5.3 deletion inventory guards. Script `scripts/sales-payment-deletion-inventory.mjs` read-only: OnlyBigQuery=0 saat pengujian, sehingga **BELUM ADA live deletion apply**. Jangan klaim end-to-end live delete PASS.

**B6 scheduler integration:** menambahkan Sales Payment ke `common/recovery-controller.mjs` (dua daftar modules core dan wrapper, module-specific check), `scripts/fast-delta.mjs` (marker, args, state), `common/v3-status-contract.mjs` (9 modules). Tests B6 integration **18 checks PASS**. B6.1 source-movement fix memperbaiki kesalahan mengklasifikasikan perubahan NetSuite selama inventory/presence sebagai fatal ERROR: normal source movement -> `NEEDS_REVIEW` **exit 3**, tidak pernah `FINAL_PASS` palsu. Test source movement PASS. Fast Delta ke-9 SYNC_OK, V3 slot 14:40 dan 15:00 FINAL_PASS.

**ZIP phase pengembangan yang ada di working attachment konteks sesi saat penulisan:** `Sales_Payment_Phase_A_Source_Discovery.zip`, `A2_Visibility_Diagnostic`, `B1_Full_Source_Audit`, `B1_1_Financial_Diagnostic`, `B2_Mapping_Validation`, `B3_BigQuery_Dry_Run`, `B4_Reconciliation`, `B5_Deletion_Identity_Discovery`, `B5_1_Collision_Proof_Fix`, `B5_2_Shared_Deletion_Hardening`, `B5_3_Inventory_Guards`, `B6_V3_Fast_Delta_Integration`, `B6_1_Source_Movement_Status_Fix`. Saat chat baru pakai **ZIP project paling akhir**, jangan menimpa dengan ZIP phase lama.

## 6. Verified deletion: syarat mutlak keamanan data

**Automatic verified deletion adalah baseline WAJIB untuk semua modul transaction sekarang dan modul baru**, tetapi setiap transaksi memiliki native recordtype/type berbeda yang harus diprobe, tidak boleh hardcode dari Sales Payment.

1. Source presence lengkap dengan daftar identitas; cek no duplicates/no truncation. BigQuery-only belum berarti deleted.
2. Candidate maksimal **3 header** per batch; lakukan **independent** NetSuite `deletedrecord` proof; triple identity exact (recordid, recordtypeid, type), selain source tidak lagi terlihat, bukti baru sebelum apply, bukan cache.
3. Dry run read-only dulu; approval/guard & audit JSONL; tidak ada mass deletes, tidak ada delete tanpa source proof. Soft delete **header saja** (`is_deleted`, `deleted_at`), jangan drop historical lines/applications/accounting.
4. **Jangan memindah checkpoint** hanya karena deletion; checkpoint berubah hanya akibat transaksi sync yang benar. Jangan hapus/rekonstruksi audit history.
5. Error permission, collision tidak pasti, missing proof, source masih visible, incomplete inventory, ID invalid, stale proof, atau ambiguous source ⇒ **fail closed, NEEDS_REVIEW / BLOCKED**; tidak boleh force apply.
6. `common/verified-deletion-batch.mjs` supported set snapshot mencakup `item-receipt`, `purchase-order`, `purchase-invoice`, `sales-return`, `purchase-return`, `sales-payment`, sedangkan SI/SO/IF deletion legacy punya own guards di controller. Jangan menghapus engine legacy. Untuk modul baru, extend shared verified deletion engine konsisten dan tes kontrak.
7. `NETSUITE_VERIFIED_DELETE_CONFIRM=I_CONFIRM_VERIFIED_SOFT_DELETE` ada di environment child V3 dari scheduler-runner; **bukan** izin melewati proof. Hindari mencantumkan credential.

**Tests:** `node tests/verified-deletion-proof.test.mjs` dan `node tests/sales-payment-deletion-contract.test.mjs`. Jangan melakukan destructive test di production demi memaksa proof nyata.

## 7. Insiden scheduler: timeline, root cause, solusi, dan batas pembuktian

**Ini masalah utama yang menyita chat dan SUDAH TERSELESAIKAN tanpa patch baru ke production.**

- V3 slot 14:00 (UTC 07:01:34→07:10:35) sukses FINAL_PASS, tetapi ringkasan hanya 8 modul sebab ini run **sebelum** integrasi Sales Payment tervalidasi. Jangan salah tafsir status lama sebagai hasil sembilan modul.
- Windows Task `NetSuite Backup V3` trigger **`PT10M`**, sedangkan `config/scheduler.json` production recovery **20 menit** (08:00–22:00 WIB, semua hari). `scheduler-runner.mjs` memakai `due()` menghitung canonical slot 10 menit dengan toleransi delay <=2 menit; hanya 00/20/40 dalam setiap jam untuk interval 20. Maka run Windows pukul 14:31, 14:37 dll memang `NOT_INTERVAL_SLOT`, normal, status Windows `LastTaskResult=0` tidak sama dengan menjalankan recovery.
- Fast Delta run 14:16:34 WIB PID 13972 **interrupted** (tidak ada release), `health-v2.json previousInterruptedRun` tercatat. Pada 14:21:34 V3 PID 7900 melihat stale dan mengarsipkan lock (`STALE_ARCHIVED`) setelah validating age+owner-not-alive+owner-recheck. Fast Delta berikutnya PID 3040 segera memperoleh shared lock dan berjalan sampai 14:24:34. V3 retry 25 kali selama **121054 ms**, menghasilkan `skips.jsonl`: `slot=14:20`, `reason=LOCK_TIMEOUT`, tidak membuat `history.jsonl` maupun `latest.json` baru. Ini bukan tanda Sales Payment crash.
- Fast Delta run berikutnya `SYNC_OK`, `previousInterruptedRun` menunjukkan 07:16:34→07:21:34 UTC; Windows Task `ExecutionTimeLimit=PT0S` (tidak ada Task Scheduler limit), `MultipleInstances=IgnoreNew`, `StopIfGoingOnBatteries=True`. **Penyebab pasti kenapa original Fast Delta PID mati tidak dibuktikan**; jangan mengarang penyebab baterai.
- `scheduler-runner.mjs` kini **memiliki** logika `SCHEDULER_V31_LOCK_RETRY`: 5 detik x 2 menit, `skips.jsonl`, `v31AlreadyCompleted` history dedupe. `latest.json` hanya diupdate sesudah seluruh child workflow selesai. V3 `Running` dapat menghasilkan task `LastTaskResult=267009` (0x41301 = running) dan file log active sementara terlihat 0 byte karena buffering; jangan salah menyebut ini gagal.
- Slot 14:40: task PID 6952, child recovery-controller `--all --sync` PID 15152, child `--core purchase-invoice --sync` dan sync module, shared-lock owner scheduler PID 6952. Selesai **14:48:27 WIB** dengan 9 modul final summary: 8 FINAL_PASS, Purchase Return NO_SOURCE, status overall **FINAL_PASS** exit 0 timedOut false. Sales Payment headers 887, financial check PASS.
- Slot 15:00: proses dimulai 15:01:34, selesai **15:13:23 WIB**, 8 FINAL_PASS + Purchase Return NO_SOURCE, status **FINAL_PASS** exit 0 timedOut false. Seusai itu empat Windows Tasks `Ready`, last result 0, dan `NO ACTIVE SHARED LOCK` pada output terakhir.
- `LastTaskResult=2147946720` sempat muncul selama V3 masih berjalan; output final kemudian kembali 0. Jangan memperlakukan hasil intermediate ini sebagai kegagalan final.

**ROOT CAUSE TERVERIFIKASI UNTUK SLOT 14:20:** shared-lock contention setelah stale-lock recovery dan Fast Delta mengambil lock lebih dahulu, V3 retry habis. **Bukan** bukti module 9 membuat scheduler deadlock. **Belum terbukti** semua skenario crash / retry telah teruji. Tidak dibutuhkan patch priority reservation; itu sempat jadi **rekomendasi hipotetis**, belum disetujui dan **jangan implementasi otomatis**.

**Task scheduler**: `NetSuite Backup V3`, `NetSuite Backup Fast Delta`, `NetSuite Backup Freshness Monitor`, `NetSuite Backup Watchdog`. V3 action executable `C:\nvm4w\nodejs\node.exe`, args `"C:\netsuite-backup\scripts\scheduler-runner.mjs"`, working dir root. `scheduler.json` workflow `common/recovery-controller.mjs`, mode production, maxRunMinutes 120, maxLogDays 30. Fast Delta setiap ±5 menit; V3 Windows trigger setiap 10 menit tetapi internal production hanya setiap 20 menit. Jangan ubah jadwal hanya karena ada skip yang normal.

## 8. Testing ladder WAJIB untuk setiap modul baru (IKUTI BASELINE, JANGAN LOMPAT)

**Fase 0 — snapshot & scope.** Audit source ZIP terbaru: folder, helper, mapping, flags, schema, checkpoint, tests, monitor. Pilih referensi modul finansial yang paling dekat: Sales Payment untuk pembayaran, Purchase Invoice untuk bill/GL, Sales Return/Purchase Return untuk credit/return (tetap probe tipe, jangan salah kategori). Tentukan intended NetSuite type *tanpa* menganggap semua permissions telah tersedia. Simpan progress hasil tiap fase. **Jangan modifikasi scheduler terlebih dahulu.**

**Fase A1 — source visibility read-only:** probe menggunakan `common/netsuite-client.mjs` dan SuiteQL untuk count type, contoh ID valid, date range Oct–Dec 2026, role permission. Kalau forbidden/empty, periksa permission dan sumber vs 0 source; **tidak create table atau asumsi tipe.**

**Fase A2 — source grain dan accounting:** probe transaction headers, `TransactionLine`, `TransactionAccountingLine`, `PreviousTransactionLineLink`/`NextTransactionLineLink` sesuai data nyata. Identifikasi posting/non-posting, book, currency, signs, application relationship, void, adjusted/fully applied, source movement, deletedrecord identity. Hindari query joins SuiteQL virtual tables tak didukung; bounded per-ID queries lalu dedup client-side bila perlu.

**Fase B1 — financial/source audit read-only:** audit total source, distribution, counts, amount used/unused, debit/credit, line key uniqueness, orphan, cross-links. Atasi angka kosong/foreign vs base secara eksplisit.

**Fase B2 — mapping & deterministic test:** `mapping.mjs`, `test-mapping.mjs` kalau sesuai pola; strict numeric up to 9 decimal; NaN/float rounding reject; exact BigInt scaled; duplicate/source identity failure fail-closed. Jalankan tes Node dan evaluasi output terminal **sebelum BQ writes**.

**Fase B3 — schema definition & production dry run:** `sync.mjs --dry-run` print source count/affected lines/checkpoint plan dan tidak melakukan DDL, checkpoint writes, source writes. Definisikan target table dari validated source grain dan checkpoint identity; **AUTO-CREATE TABLE oleh `sync.mjs --sync` lewat SQL `CREATE TABLE IF NOT EXISTS`, dijalankan Node di PowerShell**. Jangan meminta UI manual create table. Jika source empty dan desain membutuhkan schema-only, ikuti `modules/purchase-return/initialize-schema.mjs --dry-run/--apply-schema`, dengan guards (source benar 0, BQ kosong, no checkpoints), **jangan duplikasi secara otomatis untuk nonempty source**.

**Fase B4 — production sync HANYA setelah dry run PASS:** `node .\modules\<slug>\sync.mjs --sync`, stage NDJSON temporary (auto cleaned), cardinality + unique asserts, atomic transaction commit merge header and replace/merge details, checkpoint compare/update, retry only aborted transaction with same original watermark, overlap 5 min if relevant. Dilarang perintah bersamaan V3/Fast Delta. Jaga transaction time window dan double-posting/multibook.

**Fase B5 — reconciliation read-only:** `presence.mjs`, `check.mjs`, `check-financial.mjs` bila ada; buktikan source/BQ header presence, detail counts, GL balance, foreign/base amounts, links, deleted markers, checkpoint, no orphan/duplicate. Source bergerak tidak dipaksa PASS; classify NEEDS_REVIEW exit 3. Test no-change incremental idempotency serta bounded catch-up sesuai referensi.

**Fase B6 — verified deletion:** probe NetSuite `deletedrecord` exact identity recordid+recordtypeid+type (jangan copy Sales Payment type), source no-longer-visible, dry run, max3, audit, fail closed, regression negative/collision tests, soft delete header-only; initial may have 0 candidates. **Jangan membuat transaksi test palsu atau hapus riil production hanya untuk mendapatkan PASS**.

**Fase B7 — integration terakhir:** patch ZIP berisi *hanya* file berubah di `common/recovery-controller.mjs` (dua jalur), `scripts/fast-delta.mjs` (module list+marker+`--sync`), `common/v3-status-contract.mjs`, module files dan unit tests terkait. Run regression tests; read-only static probes, then production scheduled run automatically. Check Fast Delta module `SYNC_OK` dan V3 module `FINAL_PASS` secara terpisah; all module present status contract. Test module failure handling/warnings/lock skips. Jangan mengubah existing nine module logic.

**Fase B8 — post-integration production audit:** konfirmasi Windows Tasks State/LastRunTime, shared lock owner, `history.jsonl`, `latest.json` updated *after completed run*, recovery 10/11/12/13 modules as applicable, period full Oct–Dec. Beri release status jelas: production verified vs tests only, residual risks. Barulah buat handover baru.

**Prinsip interaksi:** Pada setiap fase kasih ZIP (path replace manual) + **tepat** perintah uji dan indikator PASS/FAIL, kemudian terima output user; perbaiki sebelum lanjut. Jangan memberikan multi-file .mjs secara terpisah atau perintah yang membuat log `.txt`.

## 9. Syntax PowerShell reproducible (READ ONLY kecuali flag yang jelas)

```powershell
cd C:\netsuite-backup

# A. Unit/contract tests, no transaction write
node .\tests\verified-deletion-proof.test.mjs
node .\tests\sales-payment-deletion-contract.test.mjs
node .\tests\sales-payment-source-movement.test.mjs
node .\tests\sales-payment-v3-integration.test.mjs

# B. Sales Payment read-only diagnostics
node .\modules\sales-payment\probe.mjs
node .\modules\sales-payment\audit-source.mjs
node .\modules\sales-payment\test-mapping.mjs
node .\modules\sales-payment\sync.mjs --dry-run
node .\modules\sales-payment\presence.mjs
node .\modules\sales-payment\check.mjs
node .\modules\sales-payment\check-financial.mjs
node .\scripts\sales-payment-deletion-inventory.mjs

# C. Latest completed V3
$latest = Get-Content .\logs\scheduler\latest.json -Raw | ConvertFrom-Json
$latest | Select-Object slot,status,exitCode,timedOut,startedAt,finishedAt
$logPath = Join-Path '.\logs\scheduler' $latest.log
Get-Content $logPath | Select-String -Pattern '^========== RECOVERY SUMMARY ==========|^(sales-invoice|item-fulfillment|sales-order|item-receipt|purchase-order|purchase-invoice|sales-return|purchase-return|sales-payment):' | Select-Object -Last 10 | ForEach-Object { $_.Line }

# D. Fast Delta latest state
$h = Get-Content .\logs\fast-delta\health-v2.json -Raw | ConvertFrom-Json
$h | Select-Object lastRunStatus,lastAttemptAt,lastFinishedAt
$h.modules.PSObject.Properties | ForEach-Object {
  [PSCustomObject]@{Module=$_.Name; LastSuccess=$_.Value.lastSuccessAt; Details=($_.Value|ConvertTo-Json -Compress -Depth 4)}
} | Format-Table -AutoSize

# E. Task status and shared lock
Get-ScheduledTask | Where-Object { $_.TaskName -match '^NetSuite Backup' } | ForEach-Object { $i=$_ | Get-ScheduledTaskInfo; [PSCustomObject]@{Task=$_.TaskName;State=$_.State;LastRun=$i.LastRunTime;LastResult=$i.LastTaskResult;NextRun=$i.NextRunTime} } | Format-Table -AutoSize
$owner = '.\logs\scheduler\.running.lock\owner.json'
if (Test-Path $owner) { Get-Content $owner -Raw } else { 'NO ACTIVE SHARED LOCK' }

# F. Slot skips and lock timeline
Get-Content .\logs\scheduler\skips.jsonl -Tail 20 | ForEach-Object { $_ | ConvertFrom-Json } | Select-Object at,slot,reason,attempts,waitMs
Get-Content .\logs\scheduler\shared-lock-audit.jsonl -Tail 20 | ForEach-Object { $_ | ConvertFrom-Json } | Select-Object at,event,worker,pid,reason
```

**Production write command** hanya setelah seluruh tahapan preflight PASS dan tidak concurrent dengan scheduler: `node .\modules\sales-payment\sync.mjs --sync`. Ini contoh legacy module yang sudah live, **bukan instruksi menjalankan manual sekarang**. Semua modul baru mengikuti syntax yang benar-benar terdapat pada source setelah dibuat; jangan mengarang `--init`, `--create`, atau `--force`.

**Validasi latest:** `latest.json` adalah last **completed** workflow. V3 saat `Running` dapat tetap menunjukkan slot 14:00 sementara slot 14:40 sedang diproses. Gunakan task State, PID tree, newest `run-*.log`, `history.jsonl` dan audit lock sebelum mengatakan stuck.

## 10. Bottleneck / kasus yang pernah terjadi, sebab, solusi, larangan regresi

| Kasus | Temuan/akar | Solusi final/baseline |
|---|---|---|
| NetSuite `CustPymt` awal 0/forbidden | Role belum memiliki transaksi Customer Payment View | Tambah permission minimum View berdasar probe; re-probe source, jangan blanket Full |
| Sales Payment foreign/base/application/GL diverge | Grain/header/lines/links dan sign convention berbeda | Independent financial audit; mapping exact, BigInt 9-digit; aplikasi hanya `Payment` dari `CustInvc` |
| BigQuery decimal overflow/rounding | JS Number floating-point tidak exact | `decimal-precision.mjs`, normalized NUMERIC string, reject overprecision |
| Partial 4 checkpoint | Commit partial/tidak konsisten berbahaya | Block bila 1–3 checkpoint atau timestamps diverge; single atomic guarded commit |
| BigQuery checkpoint write conflict | Concurrent transaction aborted | Bounded retry only definitive aborted transaction and unchanged original checkpoint; otherwise fresh dry run/sync |
| V3 NEEDS_REVIEW sementara | NetSuite berubah antara inventory, sync, presence | Bounded resync lalu `NEEDS_REVIEW` exit 3 jika moving source; jangan force FINAL_PASS |
| `deletedrecord` collision by ID | Recordid sama lintas recordtype | Exact triple proof, 8 regression cases PASS, preserve negative guards |
| Purchase Return `VendCred` salah klasifikasi | VendCred dari Bill chain, bukan otomatis `VendAuth` physical return | 15 historical VendAuth, 0 Oct–Dec; five schema-only tables + gate NO_SOURCE |
| V3 14:00 hanya 8 modul | Hasil lama sebelum integrasi Module 9 | Cek completed 14:40/15:00, 9 module statuses confirmed |
| V3 `latest.json` tak berubah | Log latest hanya setelah completed workflow; skip lock tak menulis latest | `history.jsonl`, `skips.jsonl`, process tree dan task state untuk diagnosis |
| V3 slot 14:20 `LOCK_TIMEOUT` | Fast Delta interrupted, stale archive, Fast Delta baru mengambil lock, V3 retry 2 min habis | Shared lock fail-closed tetap aman; slot 14:40 dan 15:00 sukses, **tidak patch scheduling** |
| Trigger Windows 10m vs V3 interval 20m | Expected: runner filters canonical slots | `NOT_INTERVAL_SLOT` normal; jangan ubah tanpa bukti |
| Windows `267009` sementara | 0x41301 task currently running | Tidak dianggap failure selama run; cek end status |
| Fast Delta interrupted | PID 13972 mati tanpa RELEASED, health previousInterruptedRun | Stale archiving dan next run berhasil; **penyebab original process termination tidak diketahui** |
| File sampah/ZIP membengkak | ZIP penuh ratusan runtime logs + backups | Patch ZIP hanya source berubah; cleanup backups & zero-byte temp dengan preview, audit state retained |
| `LastTaskResult=0` pada skip | Runner return success saat NOT_INTERVAL_SLOT / skip | Jangan gunakan Windows result 0 sebagai bukti reconciliation; baca latest/history dan 9 summary |

## 11. Audit ZIP: membersihkan file unused tanpa menghapus bukti penting

Snapshot `netsuite-backup(20261026-080330).zip` diperiksa: **779 file**. Hasil audit chat: **11 old backup snapshots** + **2 zero-byte `health-v2.json.*.tmp`** kandidat pembersihan; **12 `.txt` diagnostic** opsional, jangan anggap wajib hapus. Ada ratusan runtime log, tetapi **audit trail, history, state checkpoint/health, shared lock dan deletion proof** jangan dihapus. `.docs` 1–8 berisi riwayat keputusan; keep, jangan hapus hanya karena lama. Semua source code modules/common/scripts/tests sengaja dipertahankan karena probe, recovery dan regresi bisa dipakai insidental; tak setiap dependency muncul dari import statis.

**Contoh cleanup PowerShell safety-first:**

```powershell
cd C:
etsuite-backup
Get-ScheduledTask | Where-Object { $_.TaskName -match '^NetSuite Backup' } | Select-Object TaskName,State
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'netsuite-backup' } | Select-Object ProcessId,CommandLine
# Semua task idle dan no related Node process dulu; preview:
$candidates = @(
  Get-ChildItem .ackups -File -Recurse -ErrorAction SilentlyContinue
  Get-ChildItem .\logs\fast-delta -File -Filter 'health-v2.json.*.tmp' -ErrorAction SilentlyContinue | Where-Object { $_.Length -eq 0 }
)
$candidates | Select-Object FullName,Length,LastWriteTime | Format-Table -AutoSize
$candidates | Remove-Item -WhatIf -Force
# Hanya setelah user meninjau preview dan yakin rollback copies tidak perlu: 
# $candidates | Remove-Item -Force
```

**Jangan jalankan delete ketika Fast Delta berjalan tiap ±5 menit**; housekeeping planning harus memperhitungkan race. Jangan menghapus `config/telegram-credential.clixml` dari instalasi aktif dan jangan menyertakannya di ZIP patch.

## 12. Modul selanjutnya: keputusan user terakhir (bukan spekulasi)

User memutuskan untuk **fokus empat modul finansial** jika ekspansi dilanjutkan:

| Kandidat | NetSuite transaction type | Tujuan | Status sekarang |
|---|---|---|---|
| **Customer Credit Memo** | `CustCred` | credit/correction AR, application ke customer invoices | Belum diprobe/diimplementasi sebagai modul baru |
| **Vendor Credit** | `VendCred` | vendor credit/AP adjustment dan relasi ke Vendor Bill | Belum dibangun sebagai modul khusus; 80 Oct VendCred historis ada tetapi **bukan otomatis physical Purchase Return** |
| **Journal Entry** | `Journal` | GL journal, accrual, adjustments | Belum diprobe/diimplementasi |
| **Vendor Payment** | `VendPymt` | payment supplier dan applications ke Vendor Bill | Belum diprobe/diimplementasi |

**Inventory Transfer** `InvTrnfr` dan **Inventory Adjustment** `InvAdjst` **ditunda**. Alasan pengguna: ingin prioritaskan transaksi keuangan daripada pergerakan/koreksi stok. Catatan keuangan: Inventory Transfer/Adjustment juga dapat mempengaruhi valuasi/accounting dalam NetSuite; keputusan prioritas user tetap diikuti.

**Jangan mengubah scope historis**. Semua 4 ini tambahan opsional **setelah** baseline sembilan modul telah diverifikasi. Urutan empat baru masih bisa dipilih di chat berikutnya; jika user minta mulai tanpa spesifikasi, tawarkan probe pertama berdasar instruksi user, tidak perlu mendesain empat sekaligus. Role/read access per modul harus dipastikan lebih dulu. Jangan mengganti Sales Return atau Purchase Return menjadi Credit Memo / Vendor Credit tanpa bukti source link.

## 13. Known gaps dan status bukti

**Terbukti:** Sales Payment source visibility, mapping, four tables, exact financial checks, incremental sync, Fast Delta `SYNC_OK`, V3 nine-module runs `FINAL_PASS` (slot 14:40 dan 15:00), status contract protection, read-only deletion proof regression, shared-lock serial V3/Fast Delta.

**Belum terbukti / jangan claim:** live automatic soft-deletion Sales Payment pada record sungguhan (no eligible candidate), seluruh failure recovery scenarios, end-to-end alert delivery atas failure Payment, real source data untuk Purchase Return Oct–Dec, current permission levels setelah perubahan terakhir dari screenshot live, current state setelah output terakhir 15:13 WIB, final schema/transaction joins empat ekspansi, dan durasi eksekusi masa depan.

## 14. Cara memulai chat baru (COPY-PASTE)

> Lanjut proyek NetSuite Backup → BigQuery dari file `NETSUITE_BACKUP_HANDOVER_9_MODULES_FINAL_2026-10-26.md` dan ZIP project `netsuite-backup(20261026-080330).zip` atau snapshot ZIP live yang lebih baru jika ada. BACA SELURUH HANDOVER dan inspeksi source aktual. Baseline 9 modul telah berhasil otomatis: V3 slot 15:00 FINAL_PASS exit 0 dengan 8 FINAL_PASS + Purchase Return NO_SOURCE; Fast Delta 9 modul SYNC_OK/NO_SOURCE. Jangan sentuh baseline lama tanpa bukti. Role NetSuite `PNM NetSuite Backup Integration`, integration `PNM NetSuite Backup`, OAuth2 M2M PS256, SuiteQL, minimum permission View, `Run Server SuiteScript and Trigger Workflows` OFF. Semua tabel BQ dibuat otomatis dari Node sync yang dijalankan PowerShell, tidak manual UI. Exact decimal 9 digits, atomic staging/checkpoint, independent presence/check/financial, automatic verified deletion exact recordid+recordtypeid+type proof, batch max 3, header-only soft delete, audit, no checkpoint movement. Wajib ZIP untuk JS/MJS dengan correct path, user extract replace manual tanpa Expand-Archive; testing terminal langsung tanpa file log txt/Tee-Object/Out-File. Testing bertahap probe → source audit → mapping test → dry run → auto-create/sync → presence/financial → deletion proof → integration Fast Delta/V3 paling akhir. Next scope hanya empat finansial: Customer Credit Memo (CustCred), Vendor Credit (VendCred), Journal Entry (Journal), Vendor Payment (VendPymt); Inventory Transfer/Adjustment ditunda. Mulai dengan read-only probe modul pilihan user, dokumentasikan bukti, minta/analisis output sebelum melangkah.

---

**Lampiran wajib dibaca ulang bila butuh detail historis:** `.docs/1_*` sampai `.docs/8_*`; khususnya `.docs/8_NETSUITE_BACKUP_HANDOVER_MODULE_8_TO_9_2026-10-26.md` untuk role/screenshots/PR/source history. Handover ini memutakhirkan status sales-payment yang pada `.docs/8` masih disebut 'next scope'. **ZIP source, log live, dan hasil user terbaru mengungguli handover historis.**

