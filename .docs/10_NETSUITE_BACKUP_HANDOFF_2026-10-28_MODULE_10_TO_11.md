# NetSuite Backup — Handoff SOT dan Baseline Wajib, 28 Oktober 2026

> **TUJUAN:** Dokumen mandiri untuk memulai chat baru dan mengerjakan **Module 11**, tanpa mengulang kesalahan dan tanpa menyimpang dari pola 10 modul sebelumnya. **SOT code** yang diberikan pengguna adalah `netsuite-backup(20261028-021956).zip` (snapshot source, bukan bukti isi environment Windows live sesudah snapshot). **SOT hasil operasi** adalah output PowerShell/log V3 pengguna, terutama eksekusi sukses 2026-10-28 09:00–09:08 WIB. Jangan anggap dokumen ini memberikan kredensial atau akses langsung ke laptop, NetSuite, atau BigQuery.

## 0. Instruksi mutlak untuk assistant di CHAT BARU (BACA DULU)

1. **JANGAN manual `--sync`** pada modul yang diurus scheduler production, kecuali pengguna **secara eksplisit** memberi izin untuk pengecualian terkontrol. Proses update production adalah milik Fast Delta/V3 otomatis. **Read-only** `--audit-only`, `--dry-run`, `presence`, `check`, pemeriksaan log/status dan `node --check` boleh dipakai saat relevan; dry-run bukan bukti update telah dilakukan.
2. **JANGAN** stop, disable, enable, recreate, menggeser trigger, mengubah jadwal, mengubah shared lock, menghapus lock, atau memodifikasi checkpoint production sebagai cara memperbaiki error. Tidak menjalankan proses paralel melawan scheduler. Masalah sebelumnya: V3 pernah tidak sengaja dibuat `Disabled` sewaktu penyesuaian trigger; sudah diselesaikan. Jangan ulangi.
3. **SETIAP file JavaScript `.js`/`.mjs` untuk unduhan HARUS dibungkus ZIP**, dengan path relatif benar agar pengguna dapat extract manual dan replace ke `C:\netsuite-backup`. **Jangan** berikan `.mjs` sebagai direct-download. **Jangan** sertakan `Expand-Archive` PowerShell karena user extract/replace sendiri.
4. **JANGAN** buat otomatis output log pengujian `.txt`, `Tee-Object`, `Out-File`, ataupun redirect ke file `.txt`; hasil testing harus muncul langsung di terminal dan user akan copy/paste bila perlu. File asli internal sistem seperti `history.jsonl` dan scheduler logs tetap mengikuti baseline production yang sudah ada.
5. Setelah diagnosis, beri **langkah konkret dan syntax PowerShell/Node tepat**; jangan mengulang pertanyaan yang sudah terjawab, jangan mengarang path/filename/syntax. Sebelum menyarankan perintah, cocokkan keberadaan file dengan ZIP SOT; contoh `modules/purchase-order/deletion-inventory.mjs` **tidak ada** pada SOT ini dan pernah salah disarankan.
6. **Semua modul berikut harus mengikuti pola implementasi existing**: SuiteQL/source mapping, precision, staging, atomic BigQuery transaction, checkpoint, presence, financial field-level verification, bounded self-healing, independent deletion proof, scheduler integrations, test gates. Jangan membuat arsitektur alternatif atau mengedit modul existing tanpa alasan/bukti dan persetujuan yang relevan.
7. **Pembuatan tabel BigQuery baru: OTOMATIS dari script yang diberikan untuk di-copy/paste ke PowerShell (PS),** sama dengan modul sebelumnya. Jangan memerintahkan membuat tabel satu per satu secara manual di BigQuery UI. Bila perlu file script, distribusi ZIP siap extract/replace; jalankan initializer eksplisit untuk schema modul baru sebagai tahap onboarding terkontrol, bukan manual sync transaksi existing.
8. **Role dan permission NetSuite wajib dibahas SEBELUM coding modul baru.** Gunakan role integrasi existing `PNM NetSuite Backup Integration`; akses hanya `View`/read yang diperlukan dan diverifikasi sesuai transaction type, termasuk SuiteQL/related records. **Jangan** berasumsi permission Module 11 sama dengan Credit Memo; daftar lengkap semua permission historical tidak diverifikasi dari snapshot ini—konfirmasi lewat UI NetSuite/hasil probe sebelum instruksi perubahan. Jangan menulis secret/token/PEM/JSON SA ke chat/dokumen.
9. **Automatic verified deletion wajib** mengikuti baseline: independent NetSuite `deletedrecord` proof dengan recordtype identity yang tepat, source transaction absent, dry-run, batch bounds, audit, hanya soft-delete header yang sudah terverifikasi; jangan menghapus historical detail atau memajukan checkpoint karena deletion. Jangan infer deletion hanya karena transaksi tidak tampak pada satu query.
10. Status `Ready` Windows Task **bukan** `FINAL_PASS`. `latest.json` dapat menunjuk hasil kemarin bila hari ini belum ada run selesai. `NO_SOURCE` Purchase Return normal dalam keadaan sekarang. `NEEDS_REVIEW` artinya perbedaan yang butuh pemeriksaan; **tidak otomatis data hilang**.
11. **SOT user mengungguli asumsi assistant**. Sebelum patch, inspeksi file real terbaru; cek apakah source SOT berubah, apakah latest V3 masih sama, dan apakah masalah benar reproduktif. Jangan mengklaim perubahan atau hasil testing yang belum dilakukan.

## 1. Identitas sistem, scope, dan sumber kebenaran

- Windows project root: `C:\netsuite-backup`; terminal default **PowerShell**, menjalankan `node` terhadap `.mjs`.
- NetSuite sebagai source of truth transaksi; BigQuery project `even-gearbox-255203`, dataset `netsuite_backup`, region `asia-southeast1`.
- Tanggal dokumen **2026-10-28**; timezone operasional `Asia/Jakarta` (WIB, UTC+7). Timestamps JSON sering UTC/Z; untuk audit konversi ke WIB secara eksplisit.
- Perangkat Windows laptop mungkin dimatikan saat malam. Windows scheduler `LastTaskResult=0` tidak cukup untuk menyimpulkan end-to-end reconciled.
- Current SOT snapshot ZIP `netsuite-backup(20261028-021956).zip`. ZIP berisi source, config dan `credentials/`; **jaga rahasia**. Jangan memasukkan credentials ke patch dan jangan share plain-text.
- Kode asli berisi `common/recovery-controller.mjs`, `modules/...`, `scripts/...`, `config/...`, `tests/...`. Log runtime `logs/` **tidak ada di ZIP SOT**—lokasinya pada mesin Windows.

## 2. Daftar 10 modul (urutan SOT controller)

| No | Slug | Transaksi | Status V3 28-Okt 09:08 WIB |
|---:|---|---|---|
| 1 | `sales-invoice` | Sales Invoice | `FINAL_PASS` *berdasarkan V3 overall dan mekanisme summary; verifikasi summary V3 jika perlu nama tiap modul* |
| 2 | `item-fulfillment` | Item Fulfillment | `FINAL_PASS` |
| 3 | `sales-order` | Sales Order | `FINAL_PASS` |
| 4 | `item-receipt` | Item Receipt | `FINAL_PASS` |
| 5 | `purchase-order` | Purchase Order | `FINAL_PASS` |
| 6 | `purchase-invoice` | Purchase Invoice / Vendor Bill | `FINAL_PASS` |
| 7 | `sales-return` | Sales Return | `FINAL_PASS` |
| 8 | `purchase-return` | Purchase Return | `NO_SOURCE` (SCHEMA_ONLY, zero source) |
| 9 | `sales-payment` | Sales Payment / Customer Payment | `FINAL_PASS` |
| 10 | `customer-credit-memo` | Customer Credit Memo (CCM) | `FINAL_PASS` **verified detailed log** |

**Evidence:** pengguna melaporkan 4 tasks `Ready`, V3 `FINAL_PASS`, exit `0`, selesai **28 Oktober 2026 09:08:28 WIB**. CCM log `B5 EXACT FINANCIAL RECONCILIATION: PASS`, `customer-credit-memo: FINAL_PASS`. Urutan modul sesuai array di `common/recovery-controller.mjs`; V3 `FINAL_PASS` adalah verdict keseluruhan pada siklus tersebut, bukan jaminan future runs. Pastikan hasil terbaru saat mulai chat berikut.

## 3. Jadwal otomatis & integration runtime

### Empat Windows Scheduled Tasks **EXACT**

| Nama task | Fungsi | Keterangan |
|---|---|---|
| `NetSuite Backup Fast Delta` | Incremental fast update | kira-kira setiap **5 menit**, melalui script `scripts/fast-delta.mjs` / PowerShell-VBS wrapper; health `logs/fast-delta/health-v2.json` |
| `NetSuite Backup Freshness Monitor` | Monitor freshness / alert | monitoring, bukan source truth finansial |
| `NetSuite Backup V3` | Full guarded recovery + reconciliation | Windows task trigger bisa muncul tiap 10 menit; production logic dari `config/scheduler.json` **hanya slot tiap 20 menit `:00/:20/:40`, 08:00–22:00 WIB**. Entry `scripts/scheduler-runner.mjs` memanggil workflow `common/recovery-controller.mjs --all --sync` di bawah lock. `NOT_INTERVAL_SLOT` pada slot lain bukan error recovery |
| `NetSuite Backup Watchdog` | Cek V3 / health task | hasil Windows `2` perlu konteks, jangan selalu anggap V3 failure |

`config/scheduler.json` dari ZIP: `mode=production`, timezone `Asia/Jakarta`, `intervalMinutes=20`, start `08:00`, end `22:00`, days `[0..6]`, `maxRunMinutes=120`, `maxLogDays=30`; test mode `intervalMinutes=10` sepanjang hari, **jangan aktifkan mode test di production**.

`config/self-healing.json`: `enabled=true`, `catchUpSync=true`, `maxRecoveryPerModulePerRun=3`, `verifiedDeletionEnabled=true`, `verifiedIFDeletionEnabled=true`. Recovery guarded, bukan izin memperbaiki angka akuntansi secara arbitrer.

**Shared lock** `common/shared-lock.mjs`, `scripts/shared-lock-inspect.mjs`. Jangan menjalankan dua backup writer bersamaan; lihat state scheduler terlebih dahulu. `common/recovery-controller.mjs` punya jalur internal `--core`; **jangan jadwalkan internal `--core` langsung**.

**Hasil status disimpan di:**
- `logs/scheduler/latest.json` (only updated after finished V3), `history.jsonl`, `skips.jsonl`, `run-*.log`.
- `logs/fast-delta/health-v2.json` status per module `lastResult`, `lastSuccessAt`.
- `config/scheduler.json` dan `config/self-healing.json` adalah konfigurasi runtime dan jangan diutak-atik tanpa kebutuhan jelas.

## 4. Struktur folder SOT AKTUAL (direkam dari ZIP user, bukan inventaris perkiraan)

```text
netsuite-backup/
  common/
    bigquery-client.mjs
    child-runner.mjs
    decimal-precision.mjs
    netsuite-client.mjs
    presence-reconcile.mjs
    recovery-controller.mjs
    shared-lock.mjs
    so-mismatch-candidates.mjs
    source-movement.mjs
    sync-utils.mjs
    targeted-recovery.mjs
    v3-status-contract.mjs
    verified-deletion-batch.mjs
    verified-deletion-proof.mjs
  config/
    scheduler.json
    self-healing.json
    telegram-chat-id.txt
    telegram-credential.clixml
  credentials/
    netsuite-secrets.mjs
    private.pem
    public.pem
    recovery-test-sa.json
  modules/
    sales-invoice/
      check.mjs
      mapping.mjs
      presence.mjs
      recover.mjs
      sync.mjs
    item-fulfillment/
      check.mjs
      mapping.mjs
      presence.mjs
      reconcile-accounting.mjs
      recover.mjs
      repair-accounting-bounded.mjs
      sync.mjs
    sales-order/
      check.mjs
      mapping.mjs
      presence.mjs
      recover.mjs
      repair-active.mjs
      sync.mjs
    item-receipt/
      check-financial.mjs
      check.mjs
      mapping.mjs
      presence.mjs
      probe.mjs
      recover.mjs
      sync.mjs
    purchase-order/
      check.mjs
      mapping.mjs
      presence.mjs
      probe.mjs
      recover.mjs
      sync.mjs
    purchase-invoice/
      check.mjs
      mapping.mjs
      presence.mjs
      probe.mjs
      sync.mjs
    sales-return/
      check-financial.mjs
      check.mjs
      mapping.mjs
      presence.mjs
      probe.mjs
      sync.mjs
    purchase-return/
      audit-common.mjs
      check-financial.mjs
      check.mjs
      deletion-inventory.mjs
      initialize-schema.mjs
      mapping.mjs
      presence.mjs
      scheduler-gate.mjs
      sync.mjs
    sales-payment/
      audit-source.mjs
      check-financial.mjs
      check.mjs
      diagnose-financial.mjs
      mapping.mjs
      presence.mjs
      probe-deletion-identity.mjs
      probe.mjs
      sync.mjs
      test-mapping.mjs
    customer-credit-memo/
      check-financial.mjs
      deletion-identity.confirmed.json
      deletion-inventory.mjs
      deletion-proof.mjs
      incremental-sync.mjs
      initialize-schema.mjs
      mapping.mjs
      presence.mjs
      reconcile-common.mjs
      schema-contract.mjs
      sync.mjs
      verified-deletion.mjs
  scripts/
    diagnose-transaction.mjs
    fast-delta-freshness-alert.mjs
    fast-delta-freshness.mjs
    fast-delta.mjs
    freshness-incident-core.mjs
    monitor-alert.mjs
    monitor-notify.ps1
    run-fast-delta-hidden.vbs
    run-fast-delta.ps1
    run-freshness-monitor.ps1
    sales-payment-deletion-inventory.mjs
    scheduler-runner.mjs
    scheduler-watchdog.mjs
    shared-lock-inspect.mjs
    verified-deletion.mjs
  tests/
    child-runner-test.mjs
    fast-delta-integration-test.mjs
    foundation-test.mjs
    sales-payment-deletion-contract.test.mjs
    sales-payment-source-movement.test.mjs
    sales-payment-v3-integration.test.mjs
    source-movement-test.mjs
    verified-deletion-proof.test.mjs
  package.json
  package-lock.json
```

**Penting:** ZIP mengandung file rahasia di `credentials/` dan `config/telegram-credential.clixml`; nama didokumentasikan untuk memetakan struktur, **konten sengaja tidak dimuat**. Jangan menempelkan secret. Folder runtime mungkin juga mempunyai `logs/`, `node_modules/`, `.archive/` atau `backups/` pada laptop; **folder tersebut tidak termasuk ZIP saat ini**, jadi jangan klaim eksistensi/deletion-nya. Di percakapan sebelumnya sempat dilakukan archive dev artefacts CCM dan diminta menghapus `.archive`/`backups`, tetapi aksi akhir penghapusannya tidak terbukti dari snapshot SOT.

## 5. Baseline implementasi kode — **ikuti existing, bukan bikin pola baru**

**Tahap analisis modul baru:** identifikasi transaction record type SuiteQL dan recordtypeid NetSuite, sumber field/header, line unique key, GL/accounting book, status/void, transaction links (`Previous/Next Transaction Link` bila berlaku), posting, entity, subsidiary, currency, exchange, tanggal lastModified, dan batas waktu source. Probe SuiteQL read-only lebih dulu. Ketidaksesuaian NetSuite query/persyaratan permission harus diselesaikan sebelum table schema.

**Mapping/precision:** modul punya `mapping.mjs`, schema contract bila relevan, `common/decimal-precision.mjs`. Gunakan BigQuery NUMERIC/BIGNUMERIC menurut contract existing. Decimal dan debit/credit harus exact; **jangan floating-point approximate, jangan abaikan selisih rounding**. Contoh CCM `rate` BIGNUMERIC, `debit/credit` NUMERIC.

**BigQuery table provisioning:** file khusus initializer sesuai pola `modules/*/initialize-schema.mjs` bila modul memerlukannya (CCM/PR). Schema dibuat **otomatis oleh Node code yang dipanggil lewat perintah PowerShell**, sama dengan modul sebelumnya; jalankan schema verification (`INFORMATION_SCHEMA`, column types, keys) tanpa membuat tabel manual di UI. Pilih nama tabel sebagai group konsisten (`*_headers`, `*_lines`, `*_accounting_lines`, links/applications/classifications sesuai transaksi). Bukan semua modul punya 6 tabel: CCM 6, Purchase Invoice/Sales Payment/Sales Return 4 pada sumber tertentu; baru tentukan schema Module 11 setelah audit source.

**Sync:** incremental berdasarkan lastModified + 5 menit overlap (contoh spesifik CCM), staging `_stage_*` unik per run, load NDJSON/temp file dengan cleanup, data quality assert (count, duplicate key, orphan, source line consistency), BigQuery transaction atomik untuk MERGE header/detail replace/cp updates, concurrency/cp guards dan safe retries; consistent with `modules/<similar module>/sync.mjs` dan `common` helpers. **Pakai exact implementation existing yang paling mirip**, bukan asumsikan satu pola cocok semua. No source / no change harus aman dan idempotent. Jangan melewati checkpoint atau memanipulasi historical rows.

**Checks dan assurance:** `presence.mjs` → full field-by-field `check.mjs`/`check-financial.mjs`, validasi quantity, GL debit=credit, source-versus-BQ links, duplicates/orphans, deletion inventory. Jangan klaim `FINAL_PASS` dari jumlah header saja. Beda `AUDIT_CLEAN` (mode audit/read-only) dan `FINAL_PASS` (proses V3 production sudah menjalankan gates full yang disyaratkan).

**Deletion:** `common/verified-deletion-proof.mjs`, `common/verified-deletion-batch.mjs`, module-level `deletion-proof.mjs`, `verified-deletion.mjs` jika applicable. Bila source-only vs BQ-only: *only BigQuery* **belum tentu deletion**, wajib independent NS `deletedrecord`, cocokkan `recordtypeid`/type, source absent, bounded max 3, dry-run and audit. Soft-delete header only, `is_deleted`/`deleted_at`, historical details retained, checkpoint unchanged. Tidak boleh auto-delete unsupported source only.

**Stage cleanup:** kode `sync.mjs` yang diperiksa menyediakan penghapusan staging setelah commit melalui `finally` atau jalur cleanup; CCM incremental juga `finally` delete stage + remove local NDJSON. Verified di SOT pada source stage creation/cleanup; **bukan jaminan zero orphan pada hard crash**, karena Windows shutdown/kill dan BigQuery delete failure bisa meninggalkan temporary table. Fakta 28 Oct: user melihat `_stage_*` muncul lalu hilang, sesuai behaviour normal. Penambahan future orphan-staging sweeper harus guarded and approved, jangan drop tabel secara liar.

## 6. Fokus Module 10 Customer Credit Memo — implementasi dan masalah terselesaikan

### 6.1 Setup NetSuite
- Role: **`PNM NetSuite Backup Integration`** (nama exact yang diwajibkan pengguna).
- Permission relevan untuk Module 10: **`Credit Memo: View`**. Keberhasilan OAuth SuiteQL diuji; sumber detail accounting/link harus benar-benar dapat dibaca. Nama dan kategori permission untuk record lain harus diturunkan dari NetSuite UI/probe, bukan asumsi assistant.
- Authentication melalui `common/netsuite-client.mjs` + credential local, jangan disalin ke dokumen/chat.

### 6.2 Tabel CCM (6 tabel)
1. `customer_credit_memo_headers`: primary document `credit_memo_id`, deletion flags `is_deleted`, `deleted_at`, `synced_at`.
2. `customer_credit_memo_lines`: line `line_unique_key`, `rate` **BIGNUMERIC**, foreign/net amounts.
3. `customer_credit_memo_accounting_lines`: accounting book, line/account key, debit/credit.
4. `customer_credit_memo_previous_links`: link upstream.
5. `customer_credit_memo_next_links`: link downstream (0 rows dalam contoh audit).
6. `customer_credit_memo_financial_classification`: GL class/verified adjustment details.

Source `modules/customer-credit-memo/schema-contract.mjs`; `initialize-schema.mjs` tersedia. Source checkpoint disimpan terpisah per enam record type dalam BigQuery `sync_checkpoints`. Jangan menghapus/recreate tables production atau menggeser checkpoint untuk debugging.

### 6.3 Riwayat Module 10 sebelum patch chat ini
- Completed initial probe, source discovery, financial classifications, six-table initializer, initial sync, exact financial six-table reconcile, guarded incremental, deletion identity proof.
- Sample deletedrecord proof recorded in `deletion-identity.confirmed.json`: identity `recordtypeid='creditmemo'`, `type='CREDITMEMO'`, historical sample ID `3144782`; actual production deletion of a missing real record **belum dibuktikan** (no eligible live candidate). Dry-run/no-op, simulated isolated rollback/soft-deletion tests telah dilaporkan lulus. Jangan mengarang uji real deletion.
- CCM refactor: `decimal-types.mjs` dan `financial-classification.mjs` digabung ke `mapping.mjs` (SOT sekarang **12 `.mjs` file**, tidak ada dua helper tersebut di folder CCM). Diinstall lewat ZIP + installer sebelumnya; `--audit-only` dan incremental `--dry-run` setelah refactor PASS.
- 50 orphan staging `_stage_*` sebelumnya dibersihkan dan total **34 permanent BigQuery tables** sempat diverifikasi (temporal snapshot saat itu, bukan penghitungan current 28-Oct; jangan jamin live 34 saat chat baru).

### 6.4 Masalah chat ini: stale historical mismatch membuat V3 FAILED
**2026-10-28 ~08:33 WIB:** 4 schedulers `Ready`, V3 `FAILED`, exit `1`; audit: 7 clean, `sales-order` `NEEDS_REVIEW` (NetSuite-only IDs `3163069`, `3163071`), `purchase-return` `NO_SOURCE`, `customer-credit-memo` `ERROR`. CCM presence NetSuite 349 = BQ 349, six-table row counts equal, tetapi B5 exact reconciliation menemukan **10 mismatched `lines.rate` fields** dan **10 mismatched accounting debit/credit fields** pada existing transactions. Contoh: `3141313` source `152124.21` vs BQ `152136.64`; `3149264` rate source `2578.91` vs stored `2578.915`, accounting `5157.82` vs `5157.83`.

**Mengapa V3 retry lama tidak pulih:** checkpoint `2026-10-27 20:04:47`; overlap dari `19:59:47`; `CHANGED_HEADERS: 7`, source and stored equal for 7 headers/59 transaction lines/59 accounting lines/7 links; `B6 INCREMENTAL NO_CHANGE`, zero writes, cp unchanged; retry yang sama tetap gagal. Ini membuktikan **incremental overlap tidak mencakup lima stale candidates**, sementara full exact reconciliation menemukannya. Penyebab historis awal tiap mismatch (source mutation tanpa updated lastModified, mapping sebelumnya, precision) **belum sepenuhnya dapat dipastikan** hanya dari log. Jangan mengklaim definitive root cause tingkat NetSuite.

### 6.5 Patch otomatis dan bukti production PASS
Source ZIP intermediate `CCM-AUTO-REPAIR-SOURCE.zip` berisi 9 file yang diminta. Dibuat patch `CCM-AUTO-REPAIR-PATCH.zip` berisi perubahan `modules/customer-credit-memo/incremental-sync.mjs` + `common/recovery-controller.mjs`, dan README. Pengguna manual extract/replace ke `C:\netsuite-backup`; **tidak ada manual sync**. Kedua file `node --check` sukses; incremental `--dry-run` sukses, `NO_CHANGE`/zero writes/cp unchanged.

**Design implemented in new SOT:**
- On V3 `--sync` only, full B5 financial check fails → call `incremental-sync.mjs --repair-audit`; skip write entirely in `--dry-run`/`--audit-only`.
- Exact whole-module source vs BQ keys/fields, find actual candidate credit_memo_id, **maximum 10 documents** (`MAX_REPAIR_DOCUMENTS=10`), fail closed on inventory/key mismatch; source snapshot & target shape assert, 6-table staged atomic repair only for selected IDs; BQ checkpoint guarded but **not advanced** in repair. Re-run full six-table financial reconciliation mandatory. Reject ambiguous/too-many candidates, no blind global corrections.
- On scheduler 28-Oct-2026 V3 09:00 run log `run-2026-10-28T02-00-01.726Z.log`: initial B5 `BLOCKED`; `CCM VERIFIED BOUNDED AUTO REPAIR`; five candidates `3141313,3149264,3149265,3149266,3149392`; `CCM AUTO REPAIR ATOMIC COMMIT PASS: candidate IDs only, checkpoint unchanged; attempts=1`; subsequent `B5 EXACT FINANCIAL RECONCILIATION: PASS`; `customer-credit-memo: FINAL_PASS`; `Scheduler status=FINAL_PASS exitCode=0 timedOut=false` at **09:08:28 WIB**. User confirmed all four Windows tasks `Ready`. **Ini bukti real production auto-repair, bukan cuma syntax success.**
- Full V3 passed. Jangan menganggap semua masalah future solved; source modifications can happen again and 10-document max will rightly block over-limit.

## 7. Perkembangan lintas modul / diagnosis tertutup di chat ini

- **27 Oct:** Full module audit had PO `ERROR` and PI `NEEDS_REVIEW`; PO presence NS/BQ `179/179` tanpa onlyNS/BQ, tetapi field-level header/status mismatch selama PO berubah real-time; user melarang manual sync; pada **28 Oct audit** PO `AUDIT_CLEAN` NS/BQ `180/180` headers dan `711/711` lines, zero mismatches/orphans. PI audit `AUDIT_CLEAN` headers `454`, lines `2097`, accounting lines `2097`, prior links `273`; all exact/pass. Jangan ubah PO/PI codes karena masalah tersebut sudah clear di audit terbaru.
- 27 Oct `NEEDS_REVIEW`: Item Receipt onlyNS 2, PO onlyNS 1, PI onlyNS 1, Sales Payment onlyNS 7, CCM onlyNS 6; 28 Oct source movement sudah ditangani oleh scheduler untuk IR/PO/PI/SP/CCM. Sales Order 28-Oct 08:33 had 2 pending IDs; V3 pukul 09:08 overall `FINAL_PASS` indicates cleared on that run, but new transactions can appear later.
- Purchase Return precheck `state=SCHEMA_ONLY; sourceHeaders=0; checkpoints=0` ⇒ `NO_SOURCE`, normal, **jangan fabricate transactions, jangan seed checkpoint seolah sumber ada**.
- Verified deletion not equivalent to `not found in query`: match NS independent proof, batch bounds, historical line retention.
- Auto stage cleanup is present in 10 modules' sync paths; hard-process crash still may leave stage orphan. Observed temporary stage disappearing normally. Source zip contains **no runtime logs**; do not infer current BQ stage count from ZIP.
- `CHECKPOINT` historical CCM `2026-10-27 20:04:47` is **evidence from specific failed run**, not guaranteed current; future module testing must inspect own checkpoint live.

## 8. Prosedur testing **HARUS SAMA DENGAN BASELINE SEBELUMNYA**

**Urutan gated tests saat membuat modul baru** (sesuaikan filename dengan reference module paling mirip; jangan asal membuat file/function):

1. **Preflight code + environment**: ekstrak SOT, telaah package/version, cek NetSuite role permission dan OAuth lewat probe read-only; pastikan lokasi/dataset dan scope period. Jangan mengubah scheduler atau modul lama.
2. **Discovery/read-only probe** `modules/<new>/probe.mjs` (bila ada) dan read-only SuiteQL: pilih sample real transaksi serta count/period, relationship line/gl/linked records, detect rare/void/deleted. Jika `NO_SOURCE`, adopsi gating pattern Purchase Return, bukan memalsukan sample.
3. **Mapping validation**: `mapping.mjs` dan schema contract exact decimals, audit source invariants (GL, quantities, links) dengan existing test style (`tests/...` atau `test-mapping.mjs` jika pattern modul relevan). No ad hoc rounding.
4. **Schema provisioning script**: buat `initialize-schema.mjs`/script sesuai source reference, user **copy-paste executable PowerShell** untuk otomatis create BQ tables; verify INFORMATION_SCHEMA, keys, type/nullable + 0 duplicates; jangan mencipta manual di BQ Console. Jika schema only, dokumentasikan sebagai SCHEMA_ONLY.
5. **Non-writing dry-run**: `node .\modules\<new>\sync.mjs --dry-run` atau exact arg supported by chosen module (CCM special: `incremental-sync.mjs --dry-run`). Validasi `DRY RUN PASS`/`NO_CHANGE` dan zero writes/zero cp mutation.
6. **Initial onboarding**: **ikuti urutan baseline modul mirip dan jadwal production**, jangan melakukan `--sync` manual pada scheduler modules tanpa eksplisit izin user. Apabila initial source load baru mensyaratkan controlled exception, minta izin eksplisit terlebih dahulu dan jelaskan isolasi/lock/checkpoint. Bila belum siap, tetap `NO_SOURCE`/schema only. Jangan re-run bulk historic sync tanpa mekanisme guarded.
7. **Presence + exact reconciliation READ ONLY**: `presence.mjs`, `check.mjs`, `check-financial.mjs` bila ada; verify headers, lines, GL, links/applications, GL balance, decimal exact parity, duplicate/orphans, deleted-record inventory.
8. **Integrasi scheduler + shared lock**: setelah standalone onboarding benar dan sudah disetujui, integrasikan modul ke kedua list (`common/recovery-controller.mjs`, `scripts/fast-delta.mjs`) menggunakan existing hooks/gates dan timeout/locking; jangan reconfigure Windows tasks atau production schedule. Regression existing 10 modules wajib.
9. **Production proof**: biarkan V3 slot `:00/:20/:40` melakukan sync; setelah `Ready` dan `latest.json.finishedAt` hari itu (WIB), konfirmasi `status=FINAL_PASS`, `exitCode=0`, summary tiap module; lalu read-only audit. `LastTaskResult=0` Windows Task saja bukan proof.
10. **Deletion gate**: perform independent deletedrecord identity proof; test dry-run/no-op/rollback and bounded logic. Jika belum ada real deletion candidate, tandai **real deletion untested**, jangan klaim fully E2E verified.
11. **Cleanup QA**: verifikasi staging `_stage_*` temporary dibuat/dihapus oleh normal success/finally; jangan broad-delete orphan staging tanpa independent ownership/age proof.
12. **Document final acceptance:** exact per-module statuses, source counts, BQ six/four-table field checks, CP before/after, scheduler log run ID, errors, archived tests, next tasks. No logs-to-txt automation.

**Perintah read-only operation** (copy dari `C:\netsuite-backup`, terminal output saja):

```powershell
cd C:\netsuite-backup
Get-ScheduledTask | Where-Object { $_.TaskName -like 'NetSuite Backup*' } | ForEach-Object {
    $i = $_ | Get-ScheduledTaskInfo
    [PSCustomObject]@{ Task=$_.TaskName; State=$_.State; LastRun=$i.LastRunTime; LastResult=$i.LastTaskResult; NextRun=$i.NextRunTime }
} | Format-Table -AutoSize
```

```powershell
cd C:\netsuite-backup
$v3 = Get-Content .\logs\scheduler\latest.json -Raw | ConvertFrom-Json
$t = ([datetimeoffset]::Parse($v3.finishedAt)).ToOffset([timespan]::FromHours(7))
Write-Host "V3=$($v3.status) exit=$($v3.exitCode) finished=$($t.ToString('yyyy-MM-dd HH:mm:ss')) WIB log=$($v3.log)"
$fd = Get-Content .\logs\fast-delta\health-v2.json -Raw | ConvertFrom-Json
$f = ([datetimeoffset]::Parse($fd.updatedAt)).ToOffset([timespan]::FromHours(7))
Write-Host "FastDelta=$($fd.lastRunStatus) updated=$($f.ToString('yyyy-MM-dd HH:mm:ss')) WIB"
```

```powershell
cd C:\netsuite-backup
# HANYA ketika seluruh 4 task Ready agar tidak bentrok dengan writer aktif
node .\common\recovery-controller.mjs --all --audit-only
Write-Host "ALL MODULE AUDIT EXIT CODE: $LASTEXITCODE"
```

Status: `AUDIT_CLEAN` read-only match for exercised checks; `NEEDS_REVIEW` differences/source race; `ERROR` check fails; `NO_SOURCE` no eligible source; V3 `FINAL_PASS` all configured gates passed. V3 full log summary located via `latest.json.log` in `logs/scheduler`.

**Dry-run vs full check:** jangan memaksa `--dry-run` melakukan full historical repair; production automatic repair CCM **khusus V3 `--sync`** dan tetap memerlukan exact reconciliation sebelum `FINAL_PASS`.

## 9. NetSuite role / access onboarding Module 11 (WAJIB SEBELUM IMPLEMENTASI)

1. Masuk NetSuite admin role; cari existing **`PNM NetSuite Backup Integration`**. **Jangan bikin role baru** bila existing role memenuhi kebutuhan.
2. Identifikasi record type Module 11 dahulu; cek **permission transaksi tepat** di NetSuite `Setup > Users/Roles > Manage Roles` sesuai UI akun. Untuk CCM permission **`Credit Memo` level `View`** telah ditetapkan sebelumnya. Permission lainnya dapat berbeda, terutama Transaction, Lists/Records, accounting access, search/SuiteQL visibility; jangan copy blind.
3. Verifikasi apakah SuiteQL OAuth token role dapat SELECT: header transaction, `transactionline`, `transactionaccountingline`, links, `deletedrecord` jika relevan, currency/subsidiary/vendor/customer. **View** minimal dan least privilege; hindari Edit/Full tanpa kebutuhan dan approval.
4. Dokumentasikan nama NetSuite menu permission **exact as displayed**, kategori, level, dan hasil permission probe per query; hanya setelah itu lanjut source mapping.
5. Application/account/role IDs, OAuth signing cert/private key, cloud service account JSON dan tokens **tidak boleh dimasukkan ke dokumentasi**; gunakan existing credentials path local.

**Yang belum dapat diturunkan dari ZIP:** daftar lengkap seluruh NetSuite role permissions yang terpasang, identity Module 11, permission label/recordtypeid Module 11, tanggal/amount sample Module 11. Ini adalah **blocking preflight**, jangan diisi dengan tebakan.

## 10. Bottleneck, akar masalah, dan solusi chat ini

| Bottleneck | Diagnosis/penyelesaian | Status bukti |
|---|---|---|
| Scheduler setelah laptop mati menunjukkan V3 kemarin | `Ready` bukan fresh; bandingkan timestamp `finishedAt` dalam WIB dan `Today` | Resolved detection workflow |
| PO/PI/sales-payment/IR `NEEDS_REVIEW` akibat source bergerak | Auto scheduler catch-up; 28-Oct audit clean untuk IR/PO/PI/SP | Verified live audit |
| CCM 20 field mismatches meski header count sama | Full B5 exact check menangkap stale historic rows di luar 7-header overlap | Verified |
| V3 automatic retry cuma ulang incremental `NO_CHANGE` | `CHECKPOINT 20:04:47` vs overlap 19:59:47 dan 7 changed headers tidak mencakup 5 stale candidates | Verified |
| CCM stale detail / money repair | Added bounded `--repair-audit`, 5 candidate IDs, 6-table atomic transaction, checkpoint untouched, exact recheck | **Verified production 09:08 PASS** |
| `_stage_*` terlihat saat backup, kemudian hilang | Sync staging temporary + cleanup `finally`; hard crash orphan tetap possible | Code/observational, not guaranteed crash recovery |
| Baseline berpotensi salah dari assistant (PO deletion-inventory nonexistent; manual sync; scheduler trigger edit) | Explicit file availability check, **no manual `--sync`**, no scheduler changes | Wajib rule permanently |
| Purchase Return tanpa source | Gate `SCHEMA_ONLY -> NO_SOURCE` | Verified expected |
| Risiko refactor CCM tidak konsisten | Consolidated mapping helpers, proof audit/dry-run, new SOT contains consolidated mapping | Verified snapshot |

## 11. Modul berikutnya = Module 11 (transaction type BELUM DISEBUTKAN)

**Jangan mengarang nama transaksi atau permission NetSuite Module 11.** Pada chat ini keputusan eksplisit hanya **siap lanjut Module 11**, tanpa menentukan jenis transaksi yang akan dibackup. Langkah pertama new chat: pengguna menetapkan transaksi target, lalu lakukan NetSuite role/view/SuiteQL probe dan data discovery, mengikuti baseline; **tidak perlu mengulang pembangunan 10 modul.**

**Definition of Done Module 11:** documented role rights + source probe + automatic BQ schema provisioning + exact mapping precision + safe initial data path + incremental + atomic staging + auto cleanup + source/financial reconciliation + verified deletion or documented not-yet-testable proof + gate integration both schedulers + lock + per-module `FINAL_PASS`/`NO_SOURCE` + V3 end-to-end `FINAL_PASS`, plus updated SOT ZIP/handoff. **No production writes until appropriate guarded stage and explicit approval for any manual exception.**

## 12. Quick-start prompt untuk chat baru

> Kita lanjut NetSuite Backup **Module 11**. Baca handoff Markdown ini **SELURUHNYA** dan perlakukan ZIP SOT `netsuite-backup(20261028-021956).zip` sebagai basis aktual source. Jangan improvisasi arsitektur; ikuti pendekatan 10 modul, shared lock, BQ schema otomatis dari PowerShell, strict precision/full reconciliation, independent verified deletion, ZIP-only JS delivery, tanpa `.txt` logs, **tidak ada manual `--sync`** ataupun perubahan scheduler/checkpoint. Baseline V3 terakhir 28 Okt 2026 09:08:28 WIB `FINAL_PASS` exit 0 dan CCM bounded automatic repair telah berhasil. Sebelum coding Modul 11: identifikasi transaction type yang akan saya tentukan, pastikan NetSuite role `PNM NetSuite Backup Integration` dan permission `View` yang tepat, kemudian probe read-only. Buat testing dan deployment sesuai baseline, satu langkah konkret dan syntax tepat tiap tahap. Jangan menganggap status log lama sebagai status hari ini.

---

### Dokumentasi provenance / batas verifikasi

- **Source-code**: folder dan file, config production, CCM `--repair-audit` conditions/bounds, six-table schema, staging cleanup path ditinjau dari ZIP user terbaru.
- **Production evidence**: angka, statuses, ID CCM yang diperbaiki, timestamp 09:08 WIB berasal dari paste PowerShell/log yang user bagikan. **Bukan** hasil mengakses live NetSuite/BQ dari sisi assistant.
- **Tidak diverifikasi langsung:** current live BQ table count, real full NetSuite role permission matrix, actual deletion with live candidate, per-module fault-injection cleanup on hard crash, identity jenis transaksi Module 11.
- **Security:** jangan menyertakan secret; ZIP SOT mengandung file credential yang harus tetap lokal/terkontrol.
