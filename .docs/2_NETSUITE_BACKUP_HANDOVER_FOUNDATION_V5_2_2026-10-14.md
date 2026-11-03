# NETSUITE → BIGQUERY BACKUP — FULL PROJECT HANDOVER
## Foundation V5.2 — Production baseline as of 2026-10-14 (Asia/Jakarta)

> **READ FIRST IN THE NEW CHAT.** This is the operating handover for the NetSuite Backup project, including the existing three production modules, technical architecture, NetSuite role and permissions, deletion/audit discoveries, all changes through V5.2, operational scheduling and Telegram, test evidence, caveats and next steps. It is deliberately detailed. **Treat actual files and live checks on the user's Windows machine as final source of truth when they differ from this snapshot.**
>
> **Current verified condition:** Scheduled production run **2026-10-14 13:30 WIB** completed **`FINAL_PASS`, exit code 0** for the combined V5.2 workflow. Windows Task Scheduler task and watchdog are enabled (`Ready`). Watchdog manual check says `WATCHDOG: OK`. Three modules currently live: **Sales Invoice, Item Fulfillment, Sales Order**. **Next planned module: Item Receipt**. Do not unintentionally revert to V4 or disrupt V5.2.

---

## 0. Rules for the next assistant / how to work with this user

- User prefers straightforward Indonesian, concise instructions for **the next command or file**; avoid protracted back-and-forth and needless explanations. Provide ready-to-paste PowerShell and SQL when possible. Do not vaguely say “edit a line” without the exact file and replacement.
- **Do not deliver standalone `.js` / `.mjs` downloads as the main approach:** user says these cannot be downloaded in their interface. Previously user successfully used **ZIP patches** or direct PowerShell replacement. If delivering ZIP, actually create and verify its path first.
- Prefer **BigQuery SQL Editor** queries when a query can be run there. User's `bq` CLI failed due to broken `pyenv-win` Python resolution; do not require fixing `bq` simply to inspect schema or data.
- Keep changes scoped. Production is running: preserve existing SI/IF/SO, never overwrite whole root folders without a backup, do not re-enable deleted-record processing for unsupported module types, never treat a missing SuiteQL row alone as proof of deletion.
- Distinguish **DRY RUN / READ ONLY** from **PRODUCTION WRITE**, indicate the target dataset, and use a sandbox with isolated credentials for write-path tests first.
- Do not reveal or request exposed NetSuite/Google/Telegram token material in responses. The user previously pasted a **Google OAuth access token in a verbose BigQuery stack trace** and previously shared Telegram bot tokens; recommend rotating/revoking if exposed outside trusted context. Token strings are intentionally absent from this document.
- **No automatic accounting repair** is enabled in V5.2. A future accounting change may produce `NEEDS_REVIEW` and should be investigated, not silently overwritten.

## 1. Project objective and roadmap

This system backs up and reconciles NetSuite transactions to Google BigQuery for business/Finance KPIs, initially **October, November, December 2026**; due date mentioned in earlier planning: **2026-12-10**. Initial full scope is ~10 transaction record types: Sales Order, Item Fulfillment, Sales Invoice, Sales Return, Sales Payment, Purchase Order, Item Receipt, Purchase Invoice/Vendor Bill, Purchase Return, and related bill/return type (business naming must be mapped to actual NetSuite records before implementing). **Do not imply remaining seven modules already exist.**

Reconciliation philosophy: agree with source **count, amount, details, audit/integrity**; data sync alone is not enough. Each type should have source diagnostics, confirmed KPI definition (which “total” and which date), header/line mapping, staging + atomic sync, checkpoint, presence reconciliation, source-driven recovery, deletion validation where supported, full reconciliation, sandbox evidence and controlled production scheduler integration.

### Implemented vs future

| Area | Current |
|---|---|
| Sales Invoice / `sales-invoice` | Implemented, automated, production `FINAL_PASS` |
| Item Fulfillment / `item-fulfillment` | Implemented, automated, accounting audit, production `FINAL_PASS` |
| Sales Order / `sales-order` | Implemented, automated, production `FINAL_PASS` |
| Item Receipt / `item-receipt` | **NEXT**; not yet implemented |
| Remaining transaction types | Future / not yet implemented |

**Baseline architecture version = Foundation V5.2.** V5.1 and V4 files may be retained for recovery, but **should not be the active scheduled workflow**.

---

## 2. Runtime, platform, identifiers and locations

| Item | Value / verified details |
|---|---|
| Operating system | Windows 11; Windows Task Scheduler |
| Machine/host | `LAPTOP-OIJPC6V0` (watchdog message) |
| Project root | `C:\netsuite-backup` |
| Node.js | `v20.19.0` seen in run output; node executable in tasks is `C:\nvm4w\nodejs\node.exe` |
| Source system | Oracle NetSuite account; OAuth 2.0 machine-to-machine (certificate/client-credentials) |
| NetSuite REST/SuiteQL base seen in source | `https://6930902.suitetalk.api.netsuite.com` |
| BigQuery GCP project | `even-gearbox-255203` |
| BigQuery production dataset | `netsuite_backup` |
| BigQuery recovery-test dataset | `netsuite_backup_recovery_test` |
| BigQuery job location | `asia-southeast1` |
| Project timezone | `Asia/Jakarta` (WIB, UTC+7) |
| Private key path seen in IF source | `C:\netsuite-backup-cert\private.pem` (private key is external to root) |
| NetSuite OAuth integration secrets | `credentials/netsuite-secrets.mjs`; do **not** copy values into this handover |
| Production Google auth | Existing machine/account configuration (`@google-cloud/bigquery` shared client / ADC); do not assume it ports to another PC automatically |
| Sandbox BigQuery service account | `credentials/recovery-test-sa.json` used in `NETSUITE_TEST_CREDENTIALS` |
| Telegram bot | `@pilar_netsuite_backup_bot` (bot identity, not credential) |
| Notification | Telegram alerts via `scripts/monitor-alert.mjs` and Windows DPAPI credential |

An important caution: a historical cleanup ZIP **contained credentials and sandbox service-account JSON**; never publish it in a public repository. `.gitignore` was expanded to keep credentials, Telegram secrets and logs out of git, but always verify it.

### NetSuite initial setup — Role naming and permissions (MANDATORY)

**Verified actual role name: `PNM NetSuite Backup Integration`**.

**NetSuite custom role ID: `customrole1042`**.

**Do NOT rename it to `NetSuite Backup OAuth M2M`.** That phrase describes the *authentication method*, not the actual role. This confusion occurred during setup; avoid repeating it. The logged-in UI administrator role is not automatically the same role as the M2M integration. When inspecting certificate mapping/integration settings, refer to the actual `PNM NetSuite Backup Integration` role.

Navigation used to locate this role: **Setup → Users/Roles → Manage Roles → Search**; Role Search form → `Submit` → find role `PNM NetSuite Backup Integration` → Edit → `Permissions` tabs.

**Permissions verified from screenshots of the role** (preserve category/level distinctions; screens showed these permissions and levels):

| Permission shown | Level shown | Purpose |
|---|---|---|
| `Find Transaction` | `View` | Search/read transactions |
| `Invoice` | `View` | Sales Invoice access |
| `Item Fulfillment` | `View` | Fulfillment access |
| `Sales Order` | `View` | Sales Order access |
| `Log in using OAuth 2.0 Access Tokens` | `Full` | OAuth access |
| `REST Web Services` | `Full` | REST SuiteQL use |
| **`Deleted Records`** | **`View`**, **added during this chat** | Read deleted-record audit evidence through SuiteQL `deletedrecord` |

**The role may have additional permissions that were outside the screenshots.** The list above is the *confirmed observed subset*, **not an exhaustive export**. Before implementing purchase/item receipt modules, check the role for corresponding read permissions (e.g. Item Receipt, Purchase Order, Vendor Bill), rather than assuming they are present. Do not grant `Full` where `View` suffices merely to troubleshoot SuiteQL errors.

**`Deleted Records` permission discovery:** initially `Setup → Users/Roles → View Audit Trail` was suggested but not visible. The useful **human UI audit** was **Transactions → Management → View Audit Trail**, which confirmed an invoice deletion. Later role `Permissions → Setup` dropdown contained **Deleted Records**, granted at **View**. Setting this permission did not make `transactionhistory` queryable; it **did** allow testing the supported `deletedrecord` record successfully.

### OAuth / security model

- OAuth 2.0 M2M certificate setup was already completed; OAuth token and SuiteQL requests successfully tested on Node 20.
- The private key is not supposed to be embedded in scripts/logs or in this Markdown. The NetSuite secrets module is under `credentials/` and the private key sits outside project root.
- **Do not conflate** the integration record, certificate mapping, and role; this handover has verified the role **name/ID**, but **not the full integration record ID, OAuth certificate ID, employee mapping or full role permission export**. Check original NetSuite UI/settings if needed.
- The NetSuite account numeric prefix can be observed in the API endpoint; do not reconstruct any secrets from it.
- If moving the project to a server, the private key, machine authentication, filesystem permissions, scheduled-task run-as account and Telegram DPAPI configuration all require deliberate migration.

---

## 3. Working directory — baseline folder tree

The following is a **consolidated functional tree** from the cleaned V4 archive, uploaded V5.1/V5.2 sources, patch ZIP manifests, and commands/user outputs. It is **not a live `tree /F` dump of the current Windows PC**; some files may have been added or removed by subsequent manual extraction. Do not state that every archived/reference filename is guaranteed present on the PC.

```text
C:\netsuite-backup\
│  package.json
│  package-lock.json
│  .gitignore
│  README-CLEANUP.md                         [from earlier cleaned V4 release]
│
├─ common\
│   bigquery-client.mjs                      shared BigQuery client, query(), T()
│   netsuite-client.mjs                      OAuth token(), fetchAll(), BASE_URL
│   sync-utils.mjs                           shared helpers
│   presence-reconcile.mjs                   NetSuite↔BQ inventory/presence check
│   targeted-recovery.mjs                    source-validated recovery helper
│   unified-workflow-v3.mjs                  previous workflow / rollback
│   unified-workflow-v4.mjs                  older self-healing / rollback
│   unified-workflow-v51.mjs                 prior workflow / rollback
│   unified-workflow-v52.mjs                 **CURRENT ACTIVE FOUNDATION**
│
├─ modules\
│  ├─ sales-invoice\
│  │   sync.mjs                               combined header+lines delta
│  │   check.mjs                              monthly full KPI reconciliation
│  │   presence.mjs                           read-only presence wrapper
│  │   recover.mjs                            guarded targeted recovery
│  │   recover-sandbox.mjs                    sandbox recovery experiments
│  │   recover-fault-sandbox.mjs              fault injection / reference
│  │   mapping.mjs                            mappings
│  │
│  ├─ item-fulfillment\
│  │   sync.mjs                               header+lines+accounting delta
│  │   mapping.mjs                            buildData() mapping
│  │   check.mjs                              full count/lines/COGS/qty checks
│  │   presence.mjs                           read-only inventory check
│  │   recover.mjs                            guarded recovery
│  │   reconcile-accounting.mjs               read-only audit / targeted --apply
│  │   reconcile-accounting-sandbox-v52.mjs   isolated accounting test variant
│  │   recover-sandbox.mjs                    sandbox recovery experiments
│  │   recover-fault-sandbox.mjs              fault injection / reference
│  │   workflow.mjs                           older local helper (not active runner)
│  │
│  └─ sales-order\
│      sync.mjs                               combined SO header+lines delta
│      mapping.mjs
│      check.mjs                              full field-by-field reconciliation
│      presence.mjs
│      recover.mjs
│      recover-sandbox.mjs
│      recover-fault-sandbox.mjs
│      migrate-soft-delete.mjs               historical migration/reference
│
├─ scripts\
│   scheduler-runner.mjs                     **active Windows scheduled action**
│   scheduler-watchdog.mjs                   **active watchdog action**
│   monitor-alert.mjs                        Telegram notifications
│   monitor-notify.ps1                       notification helper
│   configure-telegram.ps1                   DPAPI Telegram setup
│   install-scheduler.ps1                    task install/reference
│   install-unattended.ps1                   unattended task setup
│   set-scheduler-mode.ps1                   test/production mode helper
│   verified-deletion.mjs                    **CURRENT SI/SO verified soft-delete**
│   probe-deletion-audit.mjs                 read-only NetSuite deletedrecord probe
│   test-v51-sandbox.mjs                     V5.1 SI soft-delete sandbox harness
│   test-if-accounting-v52.mjs               V5.2 IF accounting sandbox harness
│   [other phase3* fixture/fault scripts]    historical test/reference
│
├─ config\
│   scheduler.json                           **active mode / timezone / workflow**
│   self-healing.json                        **active recovery and deletion switches**
│   telegram-chat-id.txt                     notification destination; private
│   telegram-credential.clixml               Windows DPAPI protected token; private
│   [*.bak / previous config backup files]
│
├─ credentials\
│   netsuite-secrets.mjs                     **SECRET; NEVER commit/share**
│   recovery-test-sa.json                    **SECRET; sandbox service account**
│
├─ logs\
│  ├─ scheduler\
│  │   latest.json                            most recent *completed* workflow
│  │   history.jsonl                          chronological workflow history
│  │   run-<UTC-ISO>.log                      verbose per-run log
│  │   alerts.json / alerts-attempts.jsonl    monitor delivery/dedup artifacts
│  │   watchdog-recovery.json                 added by local watchdog patch
│  │   .running.lock\owner.json              process ownership + locking
│  └─ verified-deletions\audit.jsonl         soft-delete audit log
│
├─ .archive\                                old diagnostics / legacy scripts
├─ .docs\                                   earlier progress handover
└─ node_modules\                            npm installed packages
```

**Notable actual code connections:**
- `common/bigquery-client.mjs` provides `query` and `T()` pointing to production dataset; don't use it unmodified for sandbox writes.
- `modules/item-fulfillment/reconcile-accounting.mjs` intentionally writes only to production and requires exact `--id` for `--apply`.
- V5.2 patch adds `common/unified-workflow-v52.mjs` and updates `scripts/verified-deletion.mjs`; V5.2 IF sandbox package adds the two `*-sandbox-v52.mjs` / `test-if-accounting-v52.mjs` files.
- Windows task name **`NetSuite Backup V3` remains unchanged**. The name is historical, **NOT the active workflow version**. `scheduler.json` determines active version.

### Reference command to inspect exact live tree in the new chat

```powershell
cd C:\netsuite-backup
Get-ChildItem -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\logs\\|\\\.archive\\' } | Select-Object -ExpandProperty FullName
```

Never paste the *contents* of credentials or `.clixml` into chat. If auditing paths/version only, filename listing suffices.

---

## 4. BigQuery data model and dataset usage

**Production:** `even-gearbox-255203.netsuite_backup`  
**Recovery test:** `even-gearbox-255203.netsuite_backup_recovery_test`  
**Job location:** `asia-southeast1`.

Known operational BigQuery tables:

| Table | Purpose / key details |
|---|---|
| `sales_invoice_headers` | Invoice headers, `internal_id`, `transaction_date`, `is_deleted`, `deleted_at`, amount fields |
| `sales_invoice_lines` | Invoice historical detail rows; `invoice_internal_id` FK |
| `item_fulfillment_headers` | IF header, `internal_id` INT64, `fulfillment_number`, `transaction_date`, `total_cogs_amount` NUMERIC, `is_deleted`, `netsuite_last_modified_at` DATETIME |
| `item_fulfillment_lines` | IF detail, `fulfillment_internal_id` INT64, `line_unique_key` INT64, `quantity_shipped` NUMERIC, `cogs_amount` NUMERIC, etc. |
| `item_fulfillment_accounting` | Earlier accounting-related table/diagnostic present in project history; **do not assume currently written by every sync version without code confirmation** |
| `sales_order_headers` | SO header, `internal_id` **STRING** (important type mismatch incident), `is_deleted`, `deleted_at` |
| `sales_order_lines` | SO detail; historical lines preserved by verified soft-delete |
| `sync_checkpoints` | Version observed in active IF sync; record type + last successful modified/sync times |
| `checkpoints` | Older project historical naming; **do not assume this is active checkpoint table** |

**Schema validation completed on 2026-10-14:** An `INFORMATION_SCHEMA.COLUMNS` query compared `item_fulfillment_headers` and `item_fulfillment_lines` between production and sandbox. **Column names/data types match**, while **some production columns are NOT NULL and sandbox equivalents are NULLABLE**. Relevant examples: IF `internal_id` INT64 both; line `line_unique_key` INT64 both; header `total_cogs_amount` NUMERIC; line `cogs_amount` NUMERIC. Sandbox fixture has permissive nullable constraints: acceptable for targeted tests but don't mistake for identical DDL.

Use BigQuery UI for diagnostics:

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM `even-gearbox-255203.netsuite_backup.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name IN ('item_fulfillment_headers','item_fulfillment_lines')
ORDER BY table_name, ordinal_position;
```

Note: `INFORMATION_SCHEMA` dataset region scoping and permissions follow BigQuery rules. The project tested dataset-qualified view successfully.

### Soft deletion safety

- Only header row updated with `is_deleted = TRUE` and `deleted_at = CURRENT_TIMESTAMP()`; **never physically delete historical lines**.
- Active records for KPI/presence typically filter `COALESCE(is_deleted,FALSE)=FALSE`.
- Source-verified deletes must not be reintroduced from stale sync without authoritative NetSuite source records; recovery revalidates source.
- Missing NetSuite transaction is **not enough** to mark deleted; could mean permissions, API/filter or temporary outage. Require matching `deletedrecord` audit row and verify Transaction absence.
- Preserve and log evidence in `logs/verified-deletions/audit.jsonl`; historical lines and `sync_checkpoints` left untouched.

---

## 5. NetSuite SuiteQL: deleting-record investigation and authoritative evidence

This was a major breakthrough in this chat. Initially a BigQuery-only Sales Invoice appeared active while unavailable through normal SuiteQL. Both `SELECT ... FROM Transaction WHERE id=3152379` and direct UI link indicated absence. Manual NetSuite **Transactions → Management → View Audit Trail** showed deletion; however, no automated proof was initially available.

### Wrong approach to avoid

`transactionhistory` is **NOT queryable** in this account's SuiteQL endpoint. A probe returned:

```text
HTTP 400: Record 'transactionhistory' was not found.
```

Adding `Deleted Records: View` to the role did not fix this unsupported SuiteQL record. **Do not retry the old `transactionhistory` approach**, and do not escalate to Full as a workaround.

### Working approach, verified on live NetSuite

Read `deletedrecord` via SuiteQL with M2M credentials:

```sql
SELECT recordid, recordtypeid, type, name, deleteddate, deletedby, context
FROM deletedrecord
WHERE recordid = 3152379;
```

**Actual verified invoice evidence**:

```json
{
  "context":"UIF",
  "deletedby":"10878",
  "deleteddate":"13/10/2026",
  "name":"Invoice #SI261009908",
  "recordid":"3152379",
  "recordtypeid":"invoice",
  "type":"INVOICE"
}
```

**Actual verified Sales Order evidence**:

```json
{
  "context":"UIF",
  "deletedby":"3359",
  "deleteddate":"13/10/2026",
  "name":"Sales Order #SO261010202",
  "recordid":"3150917",
  "recordtypeid":"salesorder",
  "type":"SALESORDER"
}
```

A previous broad `SELECT * FROM deletedrecord` returned arbitrary historical deleted records from 2021 (five rows) because no ID filter was applied. A mistaken script text replacement failed, then replacing the *whole* `ask('deletedrecord', ...)` call by explicit `WHERE recordid = ${Number(rawId)}` worked. **Always confirm the query actually changed** and evidence is for the correct ID.

**Mapping confirmed**:

| Module | `deletedrecord.recordtypeid` | `deletedrecord.type` | Target |
|---|---|---|---|
| Sales Invoice | `invoice` | `INVOICE` | `sales_invoice_headers` |
| Sales Order | `salesorder` | `SALESORDER` | `sales_order_headers` |
| Item Fulfillment | **NOT VERIFIED; auto-deletion NOT ENABLED** | **NOT VERIFIED** | No automatic deletedrecord-based delete |

Verification conditions in production `scripts/verified-deletion.mjs`:

1. `--module` allowlist (`sales-invoice`/`sales-order`) and syntactically validated ID.
2. Exactly one `deletedrecord` evidence row, matching ID + recordtypeid + type, with `deleteddate` present.
3. Independent `Transaction WHERE id=...` query must return no active record.
4. BigQuery must contain exactly one header matching the ID; if already deleted, `ALREADY SOFT-DELETED: NO-OP`.
5. Dry-run prints `DRY RUN PASS` and changes nothing.
6. Apply additionally needs `NETSUITE_VERIFIED_DELETE_CONFIRM=I_CONFIRM_VERIFIED_SOFT_DELETE`; fresh NetSuite evidence and absence are rechecked immediately before write.
7. Atomic BigQuery header-only transaction with assertions; no lines or checkpoint modification; post-commit verification and audit log.

**Important SO type fix:** Sales Order header `internal_id` is STRING, unlike IF INT64. An early V5.2 patch compared a STRING to INT64, producing BigQuery `No matching signature for operator = for argument types: STRING, INT64`. Fixed by using `CAST(internal_id AS STRING)=@id` with a string parameter in read, assertions and update. Verified dry run passed afterwards.

Practical commands:

```powershell
cd C:\netsuite-backup
node .\scripts\probe-deletion-audit.mjs 3152379
node .\scripts\probe-deletion-audit.mjs 3150917
node .\scripts\verified-deletion.mjs --module sales-order --id 3150917 --dry-run
node .\scripts\verified-deletion.mjs --module sales-invoice --id 3152379 --dry-run
```

**Both historical examples have already been soft-deleted successfully in production. Do not reapply unless specifically diagnosing idempotency.**

---

## 6. Version/build history and important changes

### Initial development (Oct 6–9, before this chat)

- Implemented OAuth M2M and successful SuiteQL query. NetSuite transaction headers/lines mapped into BigQuery. Early stand-alone scripts migrated into modular folder structure.
- Sales Invoice Oct 7 historical checkpoint: count **329**, total **11,024,326,946.66**; this is **historical**, not current count.
- Item Fulfillment Oct 8 historical checkpoint: count **337**, lines **970**, COGS **3,166,002,141.16**, accounting book id `1`; historical, not current.
- Delta checkpoint overlap five minutes; sync stages batches, atomic merge, integrity validation; diagnostic and reconciliation modules made independently runnable.

### V3 and Phase 2/3 foundations

- Modules modularized under `modules/<type>/` with `sync`, `check`, `presence`, `recover`, `mapping`.
- Recovery mode established: source validated; supports missing or soft-deleted BQ records; guarded rollback/fault and sandbox tests.
- Unified V3 workflow, strict completeness/presence, reconciler and bounded recovery. Presence distinguishes **ONLY BIGQUERY**, **ONLY NETSUITE**, complete candidate lists.
- Historical Phase 3 scripts and backups may remain in `.archive/` or `scripts/` but are not the active scheduler.

### V4, monitoring and self-healing

- V4 adds automatically triggered catch-up sync and bounded recovery of NetSuite-only records; no implicit delete, no accounting repair.
- IF `reconcile-accounting.mjs` detects accounting changes even if `Transaction.lastmodifieddate` does **not** reflect those changes.
- Scheduler every 10-min Windows trigger, application-level production **30-minute** slots, daily 08:00–22:00 WIB. Telegram alerts + watchdog and machine-local lock.
- Windows Task Scheduler tasks installed for unattended execution. V4 at one point showed `FINAL_PASS` in earlier scheduled runs, and later development disabled tasks intentionally.
- Root folder cleaned; secrets consolidated under `credentials/`, `.archive` minimized, references retained.

### V5 / V5.1: Sales Invoice verified deletion

- V5 catch-up on IF accounting audit race; initially SI `NEEDS_REVIEW` because 1 BigQuery-only invoice `3152379`, while IF/SO clean. **Never automatically delete without audit.**
- Manual Transactions audit confirmed ID deletion, but unsupported `transactionhistory` API prevented automated proof.
- Actual NetSuite custom integration role located. Added `Deleted Records: View` permission.
- **Success:** `deletedrecord` SuiteQL readable, returned `recordid=3152379`, `recordtypeid=invoice`, `type=INVOICE`.
- V5.1 `scripts/verified-deletion.mjs` built for strict verified header-only soft-delete, plus workflow integration gated by `verifiedDeletionEnabled`.
- V5.1 Sales Invoice sandbox validation: prepared **1 header + 4 historical lines** for ID `3152379`; soft-delete PASS, repeat apply idempotent NO-OP, non-invoice evidence rejection PASS, lines untouched PASS, checkpoint hash unchanged PASS, reset PASS.
- In production V5.1, automatic SI soft-delete of `3152379` succeeded and reconciliation matched exactly: **761 NetSuite vs 761 BigQuery** at time of that run; SI header amount **24,386,210,235.50** and line count **34,949**, line amount **21,970,107,552.01** (historical Oct 14 snapshot, not a permanent total).
- Initial V5.1 workflow check was too restrictive (`p.onlyNS===0`), and a patch improved ordering so confirmed BigQuery-only deletions can be resolved even if independent new NetSuite-only records exist. Maximum three deletion candidates per run.

### V5.2: Sales Order verified deletion + IF targeted accounting recovery

- Audit found SO BQ-only ID **`3150917`**, and IF COGS mismatches.
- `deletedrecord` returned SO `3150917`, `recordtypeid=salesorder`, `type=SALESORDER`, document `SO261010202`, deleted by 3359 on 13 Oct.
- Extended verified-deletion allowlist and workflow to SI+SO, not IF. Added CAST AS STRING workaround for SO header ID type.
- SO dry-run succeeded; SI already-soft-deleted NO-OP; then production SO targeted `--apply` succeeded, leaving historical lines/checkpoint untouched.
- Immediately after deletion, SO presence showed 4 new NetSuite-only IDs (`3153013`, `3153016`, `3153019`, `3153023`); running delta sync/full workflow caught new/modified source records and restored SO `FINAL_PASS`. DO NOT interpret new arrivals as a deletion failure.
- IF accounting mismatch #1 ID **`3152387`**, doc `DO261010199`: source COGS `28,493,865.89`, BQ `29,263,547.79`, diff **-769,681.90**. It was not picked up by delta because accounting can change independently of transaction modified timestamp.
- Existing `modules/item-fulfillment/reconcile-accounting.mjs` already had a **single-record, guarded atomic `--apply`**; no need to rewrite `sync.mjs` (large, stable file).
- V5.2 IF sandbox package installed isolated `reconcile-accounting-sandbox-v52.mjs` and `test-if-accounting-v52.mjs`.
- IF sandbox test for ID 3152387: prepared **1 header + 8 lines** in `netsuite_backup_recovery_test`, read-only audit PASS, apply PASS, read-only rerun `differences=0`, keys/quantities unchanged, checkpoints unchanged, cleanup/reset PASS.
- Applied live production `reconcile-accounting.mjs --id 3152387 --apply`, returned `ACCOUNTING REPAIRED: 3152387 (header + 8 lines; checkpoints unchanged)`; targeted and full audit initially zero for that ID.
- Full IF audit then discovered mismatch #2 ID **`3152641`**, doc `DO261010219`: source COGS `8,526,923.65`, BQ `8,526,665.78`, diff **+257.87**. User subsequently ran the prescribed targeted repair sequence and reported final V5.2 summary **ALL FINAL_PASS**; exact apply log of #2 was not separately pasted. Treat as **resolved at final reconciliation**, not assume implementation of automatic accounting repair.
- V5.2 unified workflow and standalone deletion script verified and live-tested. Historical rollback versions retained.

### Scheduler restoration and Telegram Watchdog patch (Oct 14)

- Source `config/scheduler.json` still referenced `common/unified-workflow-v4.mjs`; manually changed to **`common/unified-workflow-v52.mjs`**, wrote JSON UTF-8 **without BOM**.
- `self-healing.json` originally lacked `verifiedDeletionEnabled`: direct PowerShell property assignment threw an exception. Used PowerShell `Add-Member` to insert it, set to `true`; other observed settings: `enabled=true`, `catchUpSync=true`, `maxRecoveryPerModulePerRun=3`.
- Scheduler runner originally launched workflow with `{env: process.env}`, so confirmation set only in an interactive shell would not reach scheduled runs. Manual PowerShell patch to `scripts/scheduler-runner.mjs` changed child `spawn` env to include `NETSUITE_VERIFIED_DELETE_CONFIRM:'I_CONFIRM_VERIFIED_SOFT_DELETE'`. **Do not replace runner with an older file that removes this change.** It deliberately authorizes verified header-only soft-deletes; the V5.2 workflow independently validates source before applying.
- Both Windows tasks re-enabled. Task names remain **`NetSuite Backup V3`** and **`NetSuite Backup Watchdog`**; both showed state `Ready`.
- **2026-10-14 13:30 WIB** scheduled run of V5.2 succeeded (details below).
- Telegram sent `NetSuite Backup MISSED` referring to expected slot **2026-10-14 12:30 WIB**, because earlier tasks were disabled and latest started backup had been 09:00 WIB. This was an accurately detected past missed slot during intentional maintenance, **not a new V5.2 failure after recovery**.
- Reviewed watchdog source. Manual patch added `logs/scheduler/watchdog-recovery.json` state and `RECOVERED` alert when a future MISSED state clears after a `FINAL_PASS`. Existing MISSED before introducing state does not trigger a retrospective RECOVERED alert. **The new RECOVERED path has not been tested by a simulated outage; do not claim that it has.**
- User ran patched watchdog manually and got `WATCHDOG: OK expected= 2026-10-14T12:30 last= 2026-10-14T13:30 status= FINAL_PASS`; both tasks `Ready`.

---

## 7. Current active Foundation V5.2 workflow behavior

**Entrypoint**: `common/unified-workflow-v52.mjs`.

```powershell
cd C:\netsuite-backup
node .\common\unified-workflow-v52.mjs --all --sync
node .\common\unified-workflow-v52.mjs --all --audit-only
node .\common\unified-workflow-v52.mjs --all --dry-run
node .\common\unified-workflow-v52.mjs sales-order --sync
```

Modes: `--sync` performs source sync and may write BigQuery; `--dry-run` sync dry-run + presence (nonwrite); `--audit-only` presence checks and audit path without delta sync, not expected to be clean when new source transactions await sync. Both modules and modes are explicit positional args. **`--all` must be passed before mode**.

Detailed per-module sequencing (based on actual V5.2 source):

1. `sync.mjs` for selected module; check expected success marker. Dry-run uses `--dry-run` and asserts `DRY RUN PASS`.
2. Read-only `presence.mjs` obtains ONLY BQ/ONLY NS counts; parses candidate IDs, rejects incomplete/duplicate/truncated lists.
3. If mismatch and `catchUpSync=true`, performs one bounded catch-up delta sync, then checks presence again.
4. **Verified Deletion** (ONLY SI/SO, `verifiedDeletionEnabled=true`): for `ONLY_BIGQUERY > 0` with max **3** candidates, obtain exact missing ID lines from presence output, run independent `scripts/verified-deletion.mjs --module ... --id ... --dry-run`; only on proof success execute `--apply` with explicit environment confirmation. Unverified IDs remain reviewable; never infer deletion.
5. **NetSuite-only recovery**: only after BQ-only mismatch clears; requires `config.enabled=true`, candidate inventory complete, and at most `maxRecoveryPerModulePerRun` (observed 3). Per ID, `recover.mjs --dry-run` must show source validation/action markers, then `--apply`, then recheck presence.
6. If counts still mismatch, `NEEDS_REVIEW`.
7. IF specifically: read-only `reconcile-accounting.mjs` checks every active October fulfillment against current NetSuite line accounting. Accounting audit can trigger bounded catch-up **for inventory race**, but **does not automatically repair COGS differences**. Any accounting mismatch => `NEEDS_REVIEW`.
8. When clean in `--sync`, call module's `check.mjs` and require `CHECK: PASS`. Only then mark `FINAL_PASS`.
9. End summary; `ERROR` → exit code 1; `NEEDS_REVIEW` → exit code 3; all clean → 0.

```
========== V5.2 SUMMARY ==========
sales-invoice: FINAL_PASS
item-fulfillment: FINAL_PASS
sales-order: FINAL_PASS
SAFETY: verified SI/SO deletion ENABLED (NetSuite proof required); no automatic accounting repair.
```

**Important nuance:** `FINAL_PASS` is per-run state for currently covered October 2026 window. It is not proof of future October/November/December coverage; module date windows currently reference Oct 2026 and must be generalized/expanded intentionally for later months.

### Current self-healing config (values user verified)

Location `C:\netsuite-backup\config\self-healing.json`. At last verification:

```json
{
  "enabled": true,
  "catchUpSync": true,
  "maxRecoveryPerModulePerRun": 3,
  "verifiedDeletionEnabled": true
}
```

Other properties may exist; do not overwrite with this abbreviated illustration. Use a non-destructive JSON edit. A failed earlier edit showed setting nonexistent property on a `PSCustomObject` requires `Add-Member`.

**Safety limit for verified deletions in V5.2 source = 3 per module/run**, independent of `maxRecoveryPerModulePerRun` (3). Future versions may centralize this config, but do not silently change it.

---

## 8. Scheduled production operation, tasks and observability

**Active JSON** `C:\netsuite-backup\config\scheduler.json`, verified:

```json
{
  "mode": "production",
  "timezone": "Asia/Jakarta",
  "workflow": "common/unified-workflow-v52.mjs",
  "modes": {
    "test": {
      "intervalMinutes": 10,
      "start": "00:00",
      "end": "23:59",
      "days": [0,1,2,3,4,5,6]
    },
    "production": {
      "intervalMinutes": 30,
      "start": "08:00",
      "end": "22:00",
      "days": [0,1,2,3,4,5,6]
    }
  },
  "maxRunMinutes": 120,
  "maxLogDays": 30
}
```

**Windows Task Scheduler details:**

| Task name (registered Windows name) | Executable | Arguments | Last confirmed status |
|---|---|---|---|
| `NetSuite Backup V3` | `C:\nvm4w\nodejs\node.exe` | `"C:\netsuite-backup\scripts\scheduler-runner.mjs"` | **Ready** |
| `NetSuite Backup Watchdog` | `C:\nvm4w\nodejs\node.exe` | `"C:\netsuite-backup\scripts\scheduler-watchdog.mjs"` | **Ready** |

Both scheduled tasks trigger at 10-minute cadence (confirmed operational context). **The application runner** checks `scheduler.json` and actually launches production backup on 30-minute slots 08:00–22:00 WIB. Thus `NextRunTime=13:40` after 13:30 does **not** mean production runs at 13:40; it means the Windows task checks schedule, often prints `SKIP`.

Previously run-as unattended task used Windows account `LAPTOP-OIJPC6V0\IT PIAGAM`, configured with password-based unattended logon. **Reconfirm actual current task principal before moving/updating accounts.** Tasks cannot execute when the computer is powered off, unless relocated to an always-on host.

### Most important proof — scheduled V5.2 production success

From user `logs/scheduler/latest.json` and `history.jsonl`:

```json
{
  "startedAt": "2026-10-14T06:30:01.685Z",
  "finishedAt": "2026-10-14T06:32:13.212Z",
  "mode": "production",
  "slot": "13:30",
  "status": "FINAL_PASS",
  "exitCode": 0,
  "timedOut": false,
  "log": "run-2026-10-14T06-30-01.685Z.log"
}
```

UTC timestamps correspond to **13:30–13:32 WIB**. Duration **~2 min 11.5 sec**. This validates the complete V5.2 **scheduled** execution (not merely a manual command), with no timeout.

Older `latest.json` had `FAILED` at 09:00 (old workflow during maintenance); `LastTaskResult=0` by itself means Windows launched/completed runner and **does not guarantee** sync success. Always read `latest.json`, timestamp, `history.jsonl` and the corresponding `run-*` log.

```powershell
cd C:\netsuite-backup
node .\scripts\scheduler-runner.mjs --show-config
Get-ScheduledTask | Where-Object { $_.TaskName -match 'NetSuite Backup' } | Select-Object TaskName,State
Get-ScheduledTaskInfo -TaskName 'NetSuite Backup V3' | Format-List LastRunTime,LastTaskResult,NextRunTime
Get-ScheduledTaskInfo -TaskName 'NetSuite Backup Watchdog' | Format-List LastRunTime,LastTaskResult,NextRunTime
Get-Content .\logs\scheduler\latest.json
Get-Content .\logs\scheduler\history.jsonl -Tail 5
```

### Scheduler runner implementation highlights

- Resolves configured workflow path under project root, validates `.mjs` and existence; `--show-config` prints active config without running sync.
- Chooses due production slots using timezone-aware local date logic.
- Uses `.running.lock/owner.json` to prevent overlapping jobs.
- Spawns `process.execPath` with workflow `--all --sync` and streams both stdout/stderr to per-run log.
- **Important manual V5.2 patch to runner**: spawned environment now includes `NETSUITE_VERIFIED_DELETE_CONFIRM:'I_CONFIRM_VERIFIED_SOFT_DELETE'` in addition to `process.env`. This was verified by `Select-String` at line ~107 after patch. Avoid replacing it with an older file, or review how current V5.2 itself sets the confirmation for the deletion subprocess.
- Result status classifier distinguishes `FINAL_PASS`, `NEEDS_REVIEW`, `FAILED`; detects exit code 3 and failure markers; refuses treating plain `exitCode=0` as automatic success without workflow markers.
- `maxRunMinutes=120` watchdog timeout for workflow, log retention `maxLogDays=30`.

### Telegram integration

- Notification code: `scripts/monitor-alert.mjs`, `scripts/monitor-notify.ps1` and DPAPI file `config/telegram-credential.clixml`.
- Telegram bot username `@pilar_netsuite_backup_bot`; chat destination stored in `config/telegram-chat-id.txt`. Do not publish token/chat ID; full secret values intentionally excluded.
- Earlier successful Telegram sending demonstrated; alerts on `FAILED`, `NEEDS_REVIEW`, watchdog `MISSED`. Dedup records under logs/scheduler.
- **Watchdog uses `latest.json`**, not all history entries, to compare most recent started backup against expected due slot (with grace). It also checks a local active run lock for diagnostic text.

### Watchdog `MISSED` and recovery patch

Example alert after intentional maintenance:

```text
NetSuite Backup MISSED
Host: LAPTOP-OIJPC6V0
Expected slot: 2026-10-14T12:30 WIB
Last start: 2026-10-14T09:00
Mode: production
Active lock: false
Task scheduler or machine may be offline.
```

**Explanation:** Tasks had been disabled earlier, resulting in a genuinely missed 12:30 slot. Following V5.2 activation, the 13:30 job passed. This alert is not evidence of a V5.2 failure at 13:30. Dedup was keyed by missed slot.

Original watchdog implementation:
- Load JSON config, timezone `Asia/Jakarta`; for production schedule find latest due slot at least `grace` minutes in past (**default 45 min**, from `NETSUITE_WATCHDOG_GRACE_MINUTES || 45`), looking back up to 72 h.
- Load `logs/scheduler/latest.json`; compare local time slot from `startedAt` with expected due slot.
- Report `MISSED` if `lastSlot` missing or earlier; include lock state.
- Otherwise report `WATCHDOG: OK...`, and forward `FAILED` or `NEEDS_REVIEW` status alerts when present.

Manual local patch in `scripts/scheduler-watchdog.mjs` (after V5.2 success):
- Introduced `logs/scheduler/watchdog-recovery.json` persisted state `{missed: false}`.
- On MISSED: record `missed=true`, `lastMissedSlot=dueSlot` and persist state.
- On later OK with `latest.status==='FINAL_PASS'` and stored `missed===true`, send `RECOVERED` once, then clear flag and store `recoveredAt`.
- Because the earlier 12:30 MISSED occurred *before state tracking existed*, no retrospective recovery message was produced.
- Actual manual test **PASS**: `WATCHDOG: OK expected= 2026-10-14T12:30 last= 2026-10-14T13:30 status= FINAL_PASS` and both tasks `Ready`.
- **Unverified:** the new RECOVERED notification has not been tested through future/simulated missed-and-recovered scenarios. Likewise the monitor cannot alert while its own host is powered off. Consider independent external heartbeat to address host-down blind spot.

**Potential security limitation:** DPAPI secret is tied to Windows context. Migrating the scheduled task or server requires reprovisioning Telegram credential, not just copying `.clixml`.

---

## 9. Accounting reconciliation and targeted repair — exact behavior

File: `modules/item-fulfillment/reconcile-accounting.mjs` (source uploaded and reviewed).

Commands:

```powershell
# Read-only audit of every active October IF
node .\modules\item-fulfillment\reconcile-accounting.mjs

# Read-only audit one IF
node .\modules\item-fulfillment\reconcile-accounting.mjs --id 3152387

# PRODUCTION WRITE: repair exactly one IF, only after validation
node .\modules\item-fulfillment\reconcile-accounting.mjs --id 3152387 --apply
```

**Important: `--apply` on this script is production-write. It is not the sandbox variant.** No mass/bulk apply: script rejects `--apply` without `--id`.

Detailed mapping/guards visible in script:

- Fixed source time window October 1–November 1, 2026.
- Pull NetSuite `Transaction` type `ItemShip`, `TransactionLine`, and `TransactionAccountingLine` (batches of 25 IDs); map through `modules/item-fulfillment/mapping.mjs` `buildData()`.
- Compare source vs BigQuery active headers; abort when inventory mismatch/duplicate/empty snapshots.
- Compute COGS using rounded cents for header comparison.
- On apply, fetch BQ line keys, quantities, COGS; compare to NetSuite mapped line keys, exact counts/duplicates and quantities (tolerance `1e-6`).
- Check stored `netsuite_last_modified_at` **equals** source header last modified. If changed, abort and require ordinary sync.
- Require valid numeric COGS; update **only** header `total_cogs_amount` and mapped line `cogs_amount`, `synced_at` in BigQuery via `BEGIN TRANSACTION`/assertions, with rollback on error. Verify sum of line COGS equals expected header COGS.
- **Does not touch NetSuite, checkpoint, SI, SO, or unrelated IFs**.
- Read-only final audit reports `differences=N` and `mode=READ ONLY`.
- Source/accounting changes may occur without changed `Transaction.lastmodifieddate`; routine delta sync's 5-minute overlap cannot be relied on to capture all GL changes. Hence per-run independent IF accounting audit is intentional.

**Test evidence** for 3152387:

```text
IF V5.2 SANDBOX | --prepare | ..._recovery_test ONLY
PREPARE PASS: 1 header and 8 lines in sandbox; checkpoint unchanged
SOURCE READ-ONLY: PASS
ACCOUNTING REPAIRED: 3152387 (header + 8 lines; checkpoints unchanged)
SANDBOX ACCOUNTING REPAIR: PASS
ACCOUNTING RECONCILIATION COMPLETE; differences=0; mode=READ ONLY
IDEMPOTENCY READ-ONLY: PASS
LINES KEYS/QUANTITY: PASS; CHECKPOINT: PASS
IF V5.2 SANDBOX TEST PASS
RESET PASS: fixture removed, checkpoint untouched
```

Production 3152387 apply succeeded and full audit moved on to the unrelated 3152641 accounting change. User eventually reported `item-fulfillment: FINAL_PASS` from full V5.2, so the issue was reconciled at that time.

**No automated COGS repair was built or enabled by V5.2.** Future desire: guarded automatic, per-ID accounting change repair **only after** more robust tests and audit approval, but not a prerequisite for developing Item Receipt.

---

## 10. Known production reconciliation details and diagnostics

### Sales Invoice

- NetSuite SuiteQL type: `CustInvc`.
- KPI fields and comparisons in `modules/sales-invoice/check.mjs`: October header count, total amount, line count, line amount; duplicates/orphans, invoices without lines.
- SI `3152379` document `SI261009908`, human audit and `deletedrecord` verified; live V5.1 automatically marked header deleted. Historical lines kept.
- During first successful after-delete V5.1 snapshot, `NetSuite COUNT=761`, `BigQuery COUNT=761`, `NetSuite TOTAL=BigQuery TOTAL=24,386,210,235.50`, `LINE COUNT=34,949`, `LINE AMOUNT=21,970,107,552.01`. Not fixed values; business traffic changes daily.
- Invoice values/nominal definitions should be read from current `mapping.mjs` + `check.mjs`, not assumed from an unrelated report.

### Item Fulfillment

- NetSuite type: `ItemShip`.
- `ACCOUNTING_BOOK='1'` observed in IF sync; include accounting lines with this book per mapper, not arbitrary net amount fields.
- IF `3152387`, `DO261010199` repaired from 29,263,547.79 to 28,493,865.89 based on NetSuite, preserving quantities and 8 lines.
- IF `3152641`, `DO261010219` later detected diff +257.87; full V5.2 subsequently `FINAL_PASS` after user's targeted resolution.
- Last pre-repair broader October full audit snapshot: 582 NetSuite/BQ headers, 1643 raw detail line rows, qty 194,083, COGS 4,899,635,943.86. These are date-stamped observations, not invariants.
- There may be an `item_fulfillment_accounting` table referenced historically. For new code inspect live table metadata and current writer before depending on it.

### Sales Order

- NetSuite type: `SalesOrd`.
- `sales_order_headers.internal_id` STRING; use `CAST(... AS STRING)` or string-typed parameters when querying/editing.
- Verified deletion SO `3150917`, doc `SO261010202`, was soft-deleted header-only in production.
- Next presence/check run saw NS=583, BQ=579, 4 new NetSuite-only IDs, plus field mismatch; delta sync/recovery through V5.2 resolved, producing `FINAL_PASS`.
- SO reconciliation is strict, including field-by-field header/line, signed raw line amount, category/class checks (CLASS DISCOUNT / OTHER_ITEM / PRODUCT_INCOME / TAX), and duplicate/orphan checks.
- Historical diagnostics noted NetSuite SO rounding discounts can cause detailed `foreignamount` sum to differ from header `foreigntotal` **by under 0.50 per order**; preserve source semantics rather than 'correcting' header totals to line totals.
- Prior SO check `HEADER COUNT=FAIL` while 4 new docs awaited delta; don't alter amount mapping based solely on that transient mismatch.

---

## 11. Patches/releases, rollback and known gotchas

### Relevant patch artifacts from prior chat

Names listed for **orientation**, not a guarantee of an accessible download in a new chat:

```text
netsuite-backup-clean-v4.zip
netsuite-foundation-v51-verified-deletion.zip
netsuite-v51-sandbox-validation.zip
netsuite-v51-workflow-integration.zip
netsuite-foundation-v52-targeted.zip
netsuite-v52-so-type-fix.zip
netsuite-v52-if-accounting-sandbox.zip
```

The user's PC has the **extracted and subsequently patched live files**, so the contents of an older ZIP **alone** are **not** the final current baseline. In particular:

- V4 ZIP is for historical baseline/rollback, but missing later v5.1/v5.2, role permission discovery and local watchdog recovery patch.
- V5.2 targeted ZIP initially had BigQuery STRING vs INT64 bug for SO; the **later SO type-fix ZIP** corrected it.
- `scripts/scheduler-runner.mjs` manual change authorizing verified deletion and `scripts/scheduler-watchdog.mjs` local recovery-state patch were **applied after earlier ZIPs**. Preserve those edits.
- JSON PowerShell `Set-Content -Encoding UTF8` on some Windows combinations introduced BOM (`ï»¿`) and caused `Unexpected token ... not valid JSON`. Save with `[System.IO.File]::WriteAllText(...,[System.Text.UTF8Encoding]::new($false))`. Do not blindly write BOM-laden JSON.
- A failed direct `PSCustomObject` `.verifiedDeletionEnabled=$true` assignment required `Add-Member -NotePropertyName ...` before saving.
- BigQuery user `bq` CLI broken by `C:\Users\IT PIAGAM\.pyenv\pyenv-win\shims\python.bat` resolution; use BigQuery Web SQL Editor for quick inspections.
- IF targeted accounting repair already existed and passed sandbox/production; do not overwrite it with an untested generic updater.

### Baseline rollback guidance

- **Current production baseline: V5.2**. Keep a versioned copy of `common/unified-workflow-v52.mjs`, `scripts/verified-deletion.mjs`, `scripts/scheduler-runner.mjs`, `scripts/scheduler-watchdog.mjs`, both JSON config files and current module scripts before adding Item Receipt.
- For significant modifications, disable **both scheduled tasks** temporarily and wait for running workflow completion; preserve logs and `.running.lock` diagnostic evidence. Rollback should restore both source and config coherently.
- Do **not** silently revert `config/scheduler.json` to `common/unified-workflow-v4.mjs`, as this would lose verified deletion automation and potentially produce false BQ-only NEEDS_REVIEW.
- Keep credentials separate; never duplicate credentials into a ZIP for a new chat unnecessarily.
- After changes, validate Node syntax, `scheduler-runner.mjs --show-config`, `--all --audit-only` (if appropriate), manual `--all --sync` (writes production), then scheduled run and Telegram watchdog.

### Recommended short operational preflight

```powershell
cd C:\netsuite-backup
node --check .\common\unified-workflow-v52.mjs
node --check .\scripts\verified-deletion.mjs
node --check .\scripts\scheduler-runner.mjs
node --check .\scripts\scheduler-watchdog.mjs
node .\scripts\scheduler-runner.mjs --show-config
Get-ScheduledTask | Where-Object { $_.TaskName -match 'NetSuite Backup' } | Select-Object TaskName,State
Get-Content .\logs\scheduler\latest.json
```

This is read-only validation except any rare Node import-time behavior of changed files; `--check` itself is syntax-only and safe.

---

## 12. Foundation status at chat end — what is confirmed and unconfirmed

### Confirmed

1. OAuth M2M / SuiteQL operational for existing three transaction types.
2. Actual NetSuite custom role **`PNM NetSuite Backup Integration` (`customrole1042`)** identified; observed transaction/REST/OAuth permissions and `Deleted Records: View` added.
3. `deletedrecord` SuiteQL audit works for Invoice `3152379` and Sales Order `3150917`.
4. Strict SI and SO verified soft-delete scripts have worked in production (both IDs soft-deleted) and SI sandbox test passed. SO guarded production dry-run/apply passed after type fix.
5. IF accounting sandbox read-only/apply/idempotency/reset all passed, as did targeted production repair for 3152387. Follow-up mismatch 3152641 resolved by final full run.
6. The **V5.2 full workflow** most recently produced **all 3 `FINAL_PASS`** manually, then automatically in the **13:30 WIB 2026-10-14** scheduled production run (`exitCode=0`).
7. `scheduler.json` current `workflow=common/unified-workflow-v52.mjs`, mode production, slots 08:00–22:00 WIB every 30 minutes; Windows task trigger every ~10 minutes.
8. Task names `NetSuite Backup V3` and `NetSuite Backup Watchdog` still registered and enabled/Ready.
9. Watchdog after local patch manually returns `WATCHDOG: OK` with latest 13:30 FINAL_PASS.
10. No automatic accounting repair in V5.2.

### Not yet confirmed; don't claim as complete

- A working Item Receipt module, schema, fields, ERP permission scope or KPIs.
- Role's full exact permission export beyond rows seen in screenshots.
- New watchdog `RECOVERED` delivery after a real/simulated future MISSED state. Only status `OK` was manually tested.
- External monitoring capable of detecting full machine shutdown (local watchdog cannot send alerts when offline).
- Continuous coverage of **November/December 2026**; current check/reconciliation scripts observed fixed **October 2026** time filters. Must audit future month strategy.
- All project files currently on disk exactly match the schematic tree above without running a fresh live file listing.
- Universal automatic verified deletion for Item Fulfillment or any future module. Only SI and SO are approved/mapped/tested.
- Fully automatic accounting repair. Deliberately disabled due to risk.
- Zero future mismatches; NetSuite is a moving target, so `FINAL_PASS` has to be checked each run.

---

## 13. How to continue in a NEW CHAT — Item Receipt without touching production baseline

**Suggested opening statement to new assistant:**

> "Read this entire handover first. Our current production baseline is NetSuite Backup Foundation V5.2 on `C:\netsuite-backup`. Three live modules SI, IF, SO have ALL FINAL_PASS and 13:30 WIB automatic run PASS. Windows scheduled task name still V3 but config points to `common/unified-workflow-v52.mjs`; watchdog Ready. NetSuite custom role `PNM NetSuite Backup Integration` / `customrole1042` with permissions specified in this document; `Deleted Records: View` present. Start module 4 **Item Receipt** without modifying existing three production modules. Use concrete SuiteQL diagnostic and confirm KPI definition before database schema and code. Prefer ZIP patches / BigQuery SQL Editor; never single-file .mjs download. Keep V5.2 scheduler active until a new module is sandbox-tested."

**Recommended Item Receipt steps:**

1. **Definition/permissions and diagnostics FIRST:** confirm item receipt transaction type from SuiteQL (likely `ItemRcpt`; verify live rather than treating as proven), record volume for October, transaction date, created/lastmodified timestamps, posting/book semantics, source reference to PO, item/location/quantity/rate/cost, and whether a meaningful header “total” is available. Determine with Finance what their expected count/amount should be for KPI (inventory quantity vs value, signed amounts and accounting book can diverge).
2. Verify M2M role has `Item Receipt: View` or relevant privilege before adding scripts, using exact **role name/id** above. Use permissions least privilege and restore role if changes inadvertently impact existing sync.
3. Create **new** `modules/item-receipt/{mapping,sync,check,presence,recover}.mjs` and BigQuery `item_receipt_headers`, `item_receipt_lines` (and any required accounting records) with checkpoint keys; use `asia-southeast1` and avoid changing SI/IF/SO schema.
4. Incremental catch-up with staging validation, atomic merge/line replace/checkpoint; reconcile source count/amount/quantity and duplicates/orphans; handle accounting changes without relying exclusively on `lastmodifieddate` if needed.
5. Add strict read-only presence before considering source-verified deletion. **Do not copy SI/SO's `deletedrecord` mapping to Item Receipt without an observed `deletedrecord` type**.
6. Run read-only diagnostic, sandbox/isolated sync and fault tests, then manual production sync and full reconciliation for October. Next test scheduler compatibility.
7. Keep `scheduler.json` pointing to V5.2 until the new **V5.3** workflow has passed; only then add Item Receipt to module list and switch scheduler (with backup and rollback).
8. Verify scheduled `FINAL_PASS` (4 modules), watchdog/Telegram, historical log continuity and update this handover.

### Useful operator commands for module work

```powershell
# Live V5.2 status, no sync
cd C:\netsuite-backup
node .\scripts\scheduler-runner.mjs --show-config
Get-Content .\logs\scheduler\latest.json

# Full live production flow (writes BigQuery, only when deliberately testing)
node .\common\unified-workflow-v52.mjs --all --sync

# Observe task state
Get-ScheduledTask | Where-Object { $_.TaskName -match 'NetSuite Backup' } | Select-Object TaskName,State

# Read-only type checks / debugging
node .\modules\item-fulfillment\reconcile-accounting.mjs
node .\modules\sales-order\presence.mjs
node .\modules\sales-invoice\presence.mjs
```

### Safety notice for new versioning

**Use an additive V5.3 workflow** instead of changing V5.2 in place; preserve V5.2 unchanged and do not rename Windows Scheduled Task merely because it still says V3. When ready, point `config/scheduler.json` to V5.3, verify first scheduled run, retain V5.2 as rollback.

---

## 14. Source provenance and confidence

This document is compiled from the existing conversation, explicit terminal and BigQuery outputs, previously uploaded source files (`verified-deletion.mjs`, `unified-workflow-v51.mjs`, `reconcile-accounting.mjs`, `sync.mjs`, `presence-reconcile.mjs`), the user's displayed Role/Search/Permissions screenshots, package ZIP manifests, and V5.2 patch source available in this session. No external audit of the user's live PC or access to NetSuite/GCP was performed while writing this handover. Explicit outputs take precedence over expectations; descriptions of folder tree distinguish historical package membership from verified operational entrypoints.

**Last supported operational evidence:** Wed **2026-10-14**, scheduled V5.2 **13:30–13:32 WIB**, `FINAL_PASS`, Windows tasks `Ready`, Watchdog `OK`. If reused after that time, read current `logs/scheduler/latest.json` before declaring current health.

---

**END OF HANDOVER — NetSuite Backup Foundation V5.2 / 2026-10-14.**
