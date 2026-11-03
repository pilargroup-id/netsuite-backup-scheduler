# NetSuite -> BigQuery Backup / KPI Project Handover

**Project owner:** Azi / PT Pilar Niaga Makmur  
**Environment:** Windows 11 + PowerShell + Node.js + Google Cloud BigQuery + NetSuite REST SuiteQL  
**BigQuery project:** `even-gearbox-255203`  
**BigQuery dataset:** `netsuite_backup`  
**Dataset location:** `asia-southeast1`  
**Current date of progress:** 2026-10-08  
**Purpose of this document:** menjadi handover lengkap supaya percakapan baru bisa langsung lanjut dari progress terakhir tanpa mengulang analisis atau salah asumsi.

---

# 1. Goal Utama Project

Tujuan project ini adalah membuat **backup / mirror transaksi NetSuite ke BigQuery** dan memastikan KPI transaksi di BigQuery **sama dengan NetSuite**.

Target transaksi yang harus direkonsiliasi:

1. Sales Order
2. Item Fulfillment
3. Sales Invoice
4. Sales Return
5. Sales Payment
6. Purchase Order
7. Item Receipt
8. Purchase Invoice
9. Purchase Return
10. Bill

Target periode awal:

- October 2026
- November 2026
- December 2026

KPI minimum per jenis transaksi:

- **jumlah transaksi**
- **total amount**

Sales Invoice menjadi transaksi pertama yang dibangun penuh sebagai pattern/reference untuk transaksi lain.

---

# 2. Prinsip Arsitektur yang Sudah Diputuskan

## 2.1 Jangan mengaktifkan global CSV-triggered SuiteScript

Di NetSuite ditemukan setting:

`Setup -> Import/Export -> CSV Import Preferences -> Run Server SuiteScript and Trigger Workflows`

Saat ini **OFF**.

Keputusan: **tetap OFF**.

Alasannya:

- environment punya banyak legacy script/workflow,
- ada integrasi lama seperti Jubelio,
- ditemukan sekitar 79 deployment relevan saat audit,
- mengaktifkan global server SuiteScript saat CSV import berisiko memicu automation yang tidak diinginkan.

Jadi mekanisme backup **tidak boleh bergantung pada User Event untuk CSV import**.

---

## 2.2 Mekanisme sinkronisasi

Pattern yang digunakan:

```text
Initial Load
    ->
Checkpoint
    ->
Delta Sync berdasarkan lastmodifieddate
    ->
Safety overlap 5 menit
    ->
Upsert / replace current state
    ->
Reconciliation
```

Delta sync menggunakan:

```text
lastmodifieddate
```

dengan overlap:

```text
checkpoint - 5 minutes
```

Overlap sengaja dipakai supaya perubahan yang terjadi tepat di batas waktu checkpoint tidak terlewat.

Duplicate aman karena header menggunakan `MERGE`, sedangkan lines mengganti semua lines untuk invoice yang berubah.

---

## 2.3 Current-state vs history

Saat ini tabel utama berfungsi sebagai **current-state mirror**.

Belum dibuat:

- append-only history table,
- final-close snapshot table,
- delete tracking final,
- reconciliation history table.

Itu direncanakan setelah seluruh jenis transaksi utama sudah berhasil.

---

# 3. Google Cloud / BigQuery Setup

Application Default Credentials sudah berhasil dibuat dengan:

```powershell
gcloud auth application-default login
```

Credential ADC tersimpan lokal di:

```text
C:\Users\IT PIAGAM\AppData\Roaming\gcloud\application_default_credentials.json
```

Quota project:

```text
even-gearbox-255203
```

Project config:

```powershell
gcloud config set project even-gearbox-255203
```

Dataset:

```text
even-gearbox-255203.netsuite_backup
```

**PENTING:** dataset berada di:

```text
asia-southeast1
```

Jangan menggunakan `US`.

Node BigQuery connection sudah ditest dan berhasil.

---

# 4. NetSuite OAuth 2.0 M2M Setup

NetSuite Account:

```text
6930902
```

SuiteTalk base URL:

```text
https://6930902.suitetalk.api.netsuite.com
```

Token URL:

```text
https://6930902.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token
```

Authentication:

```text
OAuth 2.0 Client Credentials / M2M
JWT PS256
```

RSA certificate:

```text
4096-bit RSA
```

Private key lokal:

```text
C:\netsuite-backup-cert\private.pem
```

Public cert sudah diupload ke NetSuite OAuth 2.0 Client Credentials setup.

**Jangan simpan nilai literal berikut ke dokumentasi/chat baru:**

- Client ID
- Certificate ID
- private.pem
- access token
- Consumer Secret

Nilai validnya sudah ada di script yang bekerja, terutama:

```text
C:\netsuite-backup\sync-sales-invoice.mjs
```

Script test terbaru mulai memakai pola **auto-read credential dari file tersebut**, supaya credential tidak perlu dicopy ke semua script.

---

# 5. NetSuite Custom Role

Role:

```text
PNM NetSuite Backup Integration
```

Tujuan: read-only integration role, bukan Administrator.

Permission yang sudah ditambahkan supaya SuiteQL REST bekerja:

## Setup

```text
REST Web Services = Full
Log in using OAuth 2.0 Access Tokens = Full
```

## Reports

```text
SuiteAnalytics Workbook = Edit
```

## Transactions

```text
Invoice = View
Find Transaction = View
```

## Lists

```text
Perform Search = View
```

Sebelum `Find Transaction` dan `Perform Search` ditambahkan, SuiteQL sempat gagal dengan:

```text
Record 'Transaction' was not found
```

Setelah permission ditambahkan, SuiteQL sukses.

---

# 6. NetSuite Behavioral Findings

## 6.1 Sales Invoice dari CSV import

Finance sering membuat Sales Invoice dari CSV.

Flow aktual:

```text
CSV Import
    ->
Pending Approval
    ->
Finance buka invoice
    ->
Save & Approve
    ->
Open
    ->
Payment
    ->
Paid In Full
```

Karena setiap perubahan tersebut memperbarui `lastmodifieddate`, scheduled delta sync bisa menangkap perubahan walaupun server SuiteScript untuk CSV tetap OFF.

---

## 6.2 Dua pola source Sales Invoice

### NetSuite / offline flow

Contoh:

```text
SI261009491
```

Punya:

```text
createdfrom = Sales Order
DO number = Item Fulfillment / Delivery Order
```

### CSV / marketplace flow

Contoh:

```text
AKKGLG261006A
```

Punya:

```text
source = CSV
sourcesystem = CSV
createdfrom = blank
DO = blank
```

Catatan:

```text
CSV != selalu marketplace
```

Karena ke depan CSV bisa dipakai untuk transaksi lain juga.

---

# 7. BigQuery Tables yang Sudah Ada

## 7.1 sales_invoice_headers

Full table:

```text
even-gearbox-255203.netsuite_backup.sales_invoice_headers
```

Schema:

```sql
internal_id INT64 NOT NULL,
invoice_number STRING NOT NULL,
transaction_date DATE,
posting_period STRING,
source STRING,
source_system STRING,
technical_origin STRING,
created_from_id INT64,
created_from STRING,
do_number STRING,
customer_internal_id INT64,
customer_code STRING,
customer_name STRING,
subsidiary STRING,
location STRING,
sales_rep STRING,
document_owner STRING,
terms STRING,
currency STRING,
exchange_rate NUMERIC,
status STRING,
subtotal NUMERIC,
discount_total NUMERIC,
tax_total NUMERIC,
total_amount NUMERIC,
item_line_count INT64,
netsuite_last_modified_at DATETIME,
synced_at TIMESTAMP NOT NULL,
first_synced_at TIMESTAMP,
is_deleted BOOL DEFAULT FALSE NOT NULL,
deleted_at TIMESTAMP
```

Partition:

```text
transaction_date
```

Cluster:

```text
posting_period
status
technical_origin
```

Saat ini initial/delta sync **belum mengisi semua enrichment field**.

Field yang sudah aktif diisi:

```text
internal_id
invoice_number
transaction_date
posting_period
status
total_amount
netsuite_last_modified_at
synced_at
first_synced_at
is_deleted
deleted_at
```

Field enrichment seperti customer, DO, source, terms, subtotal, tax, dll belum menjadi fokus current script.

---

## 7.2 sales_invoice_lines

Full table:

```text
even-gearbox-255203.netsuite_backup.sales_invoice_lines
```

Schema:

```sql
invoice_internal_id INT64 NOT NULL,
invoice_number STRING NOT NULL,
line_number INT64 NOT NULL,
item_internal_id INT64,
item_name STRING,
description STRING,
quantity NUMERIC,
unit STRING,
rate NUMERIC,
amount NUMERIC,
transaction_date DATE,
posting_period STRING,
netsuite_last_modified_at DATETIME,
synced_at TIMESTAMP NOT NULL
```

Partition:

```text
transaction_date
```

Cluster:

```text
invoice_internal_id
item_internal_id
```

---

## 7.3 sync_checkpoints

Table:

```text
even-gearbox-255203.netsuite_backup.sync_checkpoints
```

Rows yang sekarang penting:

```text
record_type = sales_invoice
record_type = sales_invoice_lines
```

Checkpoint terakhir yang sudah terbukti saat final reconciliation:

```text
sales_invoice       ~= 2026-10-08 13:45:49
sales_invoice_lines ~= 2026-10-08 13:45:49
```

Jangan reset checkpoint tanpa alasan.

---

# 8. Sales Invoice - STATUS FINAL: DONE

Sales Invoice sudah berhasil dari initial load sampai final reconciliation.

## Latest validated result

Header:

```text
NetSuite COUNT : 389
BigQuery COUNT : 389

NetSuite TOTAL : 12920394172.66
BigQuery TOTAL : 12920394172.66

HEADER COUNT MATCH  : YES
HEADER AMOUNT MATCH : YES
```

Lines:

```text
NetSuite LINE COUNT : 18061
BigQuery LINE COUNT : 18061

NetSuite INVOICES WITH LINES : 389
BigQuery INVOICES WITH LINES : 389

NetSuite LINE AMOUNT : 11640012217.68
BigQuery LINE AMOUNT : 11640012217.68

LINE COUNT MATCH   : YES
LINE INVOICE MATCH : YES
LINE AMOUNT MATCH  : YES
```

Integrity:

```text
Duplicate line keys   : 0
Orphan lines          : 0
Headers without lines : 0

DUPLICATE CHECK : YES
ORPHAN CHECK    : YES
```

Final output:

```text
SALES INVOICE CHECK: PASS
NetSuite and BigQuery are synchronized.
Header, lines, duplicates, and orphan checks are OK.
```

**Kesimpulan: Sales Invoice sudah selesai dan jangan dibangun ulang.**

---

# 9. Sales Invoice Header - Development History

## 9.1 Initial NetSuite KPI validation

Awalnya Script Debugger dan REST SuiteQL sempat menunjukkan jumlah berbeda karena NetSuite sedang live.

Beberapa angka yang sempat terlihat:

```text
315 invoices
328 invoices
329 invoices
343 invoices
348 invoices
...
```

Setelah REST dan Script Debugger dijalankan hampir bersamaan, ditemukan:

```text
329
11,024,326,946.66
```

dan match.

Kesimpulan penting:

```text
Mismatch kecil saat testing bisa terjadi karena transaksi baru masuk
di antara dua query.
```

---

## 9.2 Initial header load

Script:

```text
initial-load-sales-invoice-oct-2026.mjs
```

Initial load terakhir yang sukses waktu itu:

```text
348 invoices
11,283,870,904.66
```

Kemudian terus berubah karena transaksi live dan ditangani delta sync.

---

## 9.3 Streaming insert issue

Initial header loader awal memakai:

```javascript
table.insert(batch, { raw: true })
```

Ini salah untuk plain JS object.

BigQuery mengembalikan:

```text
reason: invalid
```

Fix:

```javascript
table.insert(batch)
```

tanpa:

```text
raw: true
```

---

## 9.4 Streaming buffer issue

Setelah initial load, delta `MERGE` sempat gagal dengan:

```text
UPDATE or DELETE statement over table ...
would affect rows in the streaming buffer
```

Penyebab:

```text
table.insert()
```

menggunakan streaming insert.

Setelah streaming buffer selesai, MERGE berhasil.

Keputusan:

**initial load lines tidak menggunakan streaming insert.**

Lines menggunakan BigQuery **Load Job** supaya bisa langsung di-MERGE/DELETE/UPDATE tanpa menunggu streaming buffer.

---

# 10. Sales Invoice Header Delta Sync

Script:

```text
sync-sales-invoice.mjs
```

Fungsi:

```text
checkpoint
    ->
checkpoint - 5 minutes
    ->
query Transaction WHERE type = CustInvc
                    AND lastmodifieddate >= fetch_from
    ->
MERGE by internal_id
    ->
checkpoint update
```

Identity:

```text
internal_id
```

Existing invoice:

```text
UPDATE
```

New invoice:

```text
INSERT
```

Script ini tidak hanya terbatas Oktober, sehingga dapat menangkap invoice bulan berikutnya juga.

Run terakhir sebelum final reconciliation:

```text
Changed invoices found: 9
Max modified found: 2026-10-08 13:45:49
COUNT : 389
TOTAL : 12920394172.66
DELTA SYNC SUCCESS
```

---

# 11. Sales Invoice Lines - NetSuite Findings

Probe:

```text
test-sales-invoice-lines.mjs
```

Sample:

```text
Invoice: SI261009714
Internal ID: 3149116
```

TransactionLine mempunyai 3 tipe row:

## Main line

```text
mainline = T
accountinglinetype = ACCOUNTSRECEIVABLE
```

Jangan masuk item lines.

## Actual item line

```text
mainline = F
taxline = F
item != NULL
accountinglinetype = INCOME
```

Ini yang disimpan.

## Tax line

```text
taxline = T
itemtype = TaxItem
memo = VAT
```

Jangan masuk item lines.

Filter actual line:

```sql
tl.mainline = 'F'
AND tl.taxline = 'F'
AND tl.item IS NOT NULL
AND NVL(tl.iscogs, 'F') = 'F'
```

---

# 12. Sales Invoice Line Sign Convention

NetSuite TransactionLine menggunakan accounting sign.

Sample:

```text
quantity      = -50
foreignamount = -6799175.68
rate          = 150941.7
```

BigQuery business-facing version disimpan:

```text
quantity = 50
amount   = 6799175.68
rate     = 150941.7
```

Logika:

```text
NEGATE
```

bukan:

```text
ABS
```

Alasan: jika ada discount line yang accounting amount-nya positif, business amount harus tetap negatif.

---

# 13. Jangan Hitung Amount dari Qty x Rate

Contoh nyata:

```text
quantity = 50
rate     = 150,941.7

50 x rate = 7,547,085
```

Tetapi actual NetSuite line amount:

```text
6,799,175.68
```

Karena invoice inclusive tax.

Jadi:

```text
rate   = simpan NetSuite rate
amount = simpan NetSuite foreignamount dengan sign dibalik
```

**Jangan recalculate amount.**

---

# 14. Sales Invoice Lines Initial Load

Initial load berhasil:

```text
NetSuite item lines fetched: 18061
Invoices represented in lines: 389
NetSuite line amount total: 11640012217.68
```

Duplicate source key:

```text
invoice_internal_id + line_number
```

Result:

```text
18061 unique lines
```

`line_number` memakai:

```text
TransactionLine.linesequencenumber
```

bukan:

```text
TransactionLine.id
```

---

# 15. BigQuery Load Job Bug yang Sudah Ditemukan

Initial lines loader menggunakan `table.load()`.

Data sebenarnya berhasil dimuat, tetapi script sempat error:

```text
job.getMetadata is not a function
```

Penyebab:

hasil `table.load()` pada versi library yang dipakai bukan Job object yang perlu dipanggil `getMetadata()`.

Walaupun muncul error, pengecekan BigQuery membuktikan data sudah masuk:

```text
line_count        = 18061
invoice_count     = 389
total_line_amount = 11640012217.68
duplicate_keys    = 0
```

Delta lines script sudah memakai pola return metadata yang benar.

---

# 16. Sales Invoice Lines Delta Sync

Current file:

```text
sync-sales-invoice-lines.mjs
```

Catatan sejarah:

script delta sempat tersimpan dengan nama:

```text
initial-load-sales-invoice-lines.mjs
```

lalu sudah di-rename menjadi:

```text
sync-sales-invoice-lines.mjs
```

Current logic:

```text
lines checkpoint
    ->
checkpoint - 5 min
    ->
find changed Sales Invoice headers
    ->
collect changed invoice IDs
    ->
fetch current item lines for those invoices
    ->
load into staging table
    ->
DELETE all existing lines for changed invoice IDs
    ->
INSERT current lines from staging
    ->
update lines checkpoint
```

Ini sengaja bukan line-by-line MERGE.

Alasannya kalau invoice berubah:

```text
item ditambah
item dihapus
qty berubah
rate berubah
line sequence berubah
```

semua current lines harus benar-benar merepresentasikan state terbaru NetSuite.

Latest run:

```text
Changed invoices found: 4
Unique changed invoices: 4
Current changed lines fetched: 6

BigQuery stage load: SUCCESS
BigQuery lines replaced for 4 invoice(s): OK

Max modified found: 2026-10-08 13:45:49

LINE COUNT    : 18061
INVOICE COUNT : 389
LINE AMOUNT   : 11640012217.68
DUPLICATES    : 0

DELTA LINES SYNC SUCCESS
```

---

# 17. Sales Invoice Final Reconciliation Script

File:

```text
check-sales-invoice.mjs
```

Fungsi:

1. compare NetSuite header COUNT,
2. compare BigQuery header COUNT,
3. compare NetSuite header amount,
4. compare BigQuery header amount,
5. compare line count,
6. compare invoice count represented by lines,
7. compare line amount,
8. check duplicate lines,
9. check orphan lines,
10. diagnostic header without lines.

Final status:

```text
PASS
```

Ini sekarang menjadi validator utama Sales Invoice.

---

# 18. Script Files Saat Ini

Expected folder:

```text
C:\netsuite-backup
```

File yang relevan:

```text
check-october-kpi.mjs
check-sales-invoice.mjs
initial-load-sales-invoice-oct-2026.mjs
sync-sales-invoice.mjs
sync-sales-invoice-lines.mjs
test-bigquery.mjs
test-sales-invoice-lines.mjs
test-item-fulfillment.mjs
```

Folder certificate:

```text
C:\netsuite-backup-cert
```

Berisi minimal:

```text
private.pem
public.pem
openssl.cnf
```

dan beberapa script test lama.

---

# 19. Sales Invoice Routine Manual

Kalau ingin memastikan current Sales Invoice sinkron:

```powershell
cd C:\netsuite-backup

node .\sync-sales-invoice.mjs
node .\sync-sales-invoice-lines.mjs
node .\check-sales-invoice.mjs
```

Target:

```text
SALES INVOICE CHECK: PASS
```

Jangan jalankan initial loader lagi.

---

# 20. NEXT TRANSACTION: ITEM FULFILLMENT

Ini adalah progress terakhir saat handover dibuat.

## Initial assumption yang salah

Probe pertama menggunakan:

```sql
type = 'ItemShip'
AND BUILTIN.DF(postingperiod) = 'Oct 2026'
```

Hasil:

```text
Count        : 0
ForeignTotal : undefined
No Item Fulfillment found for Oct 2026.
```

Ini bukan karena tabel BigQuery belum ada.

Probe tersebut hanya query NetSuite.

Kemungkinan penyebab:

**Item Fulfillment adalah non-posting transaction**, sehingga `postingperiod` bisa kosong.

---

# 21. Item Fulfillment - Revised Probe

Keputusan terbaru:

Gunakan:

```text
type = ItemShip
```

dan filter dengan:

```text
trandate >= 2026-10-01
trandate <  2026-11-01
```

bukan `postingperiod`.

Latest `test-item-fulfillment.mjs` juga dirancang untuk:

- membaca Client ID dan Certificate ID otomatis dari:

```text
C:\netsuite-backup\sync-sales-invoice.mjs
```

- memakai private key:

```text
C:\netsuite-backup-cert\private.pem
```

Dengan pola ini user **tidak perlu paste credential ke setiap script baru**.

---

# 22. EXACT NEXT ACTION DI CHAT BARU

**Jangan bikin tabel BigQuery Item Fulfillment dulu.**

Pertama jalankan revised probe:

```powershell
cd C:\netsuite-backup
node .\test-item-fulfillment.mjs
```

Expected output yang perlu dilihat:

```text
NETSUITE ITEM FULFILLMENT TEST

ITEM FULFILLMENT OCT 2026
Count : <harusnya > 0 jika ItemShip benar>

SAMPLE ITEM FULFILLMENT

Internal ID   : ...
Document      : ...
Date          : ...
Status        : ...
PostingPeriod : EMPTY / value
ForeignTotal  : ...
Modified      : ...

Reading TransactionLine...

Lines returned : ...
Has more       : ...

AVAILABLE TRANSACTIONLINE COLUMNS
...

SAMPLE LINE ROWS
...
```

**User belum menjalankan revised probe ini pada saat handover dibuat.**

Ini adalah titik persis untuk melanjutkan di chat baru.

---

# 23. Yang Harus Dianalisis dari Output Item Fulfillment

Setelah output `test-item-fulfillment.mjs` tersedia, tentukan:

## A. Transaction type

Pastikan:

```text
ItemShip
```

memang Item Fulfillment di account ini.

## B. Filtering

Karena kemungkinan non-posting, gunakan:

```text
transaction_date
```

untuk October / November / December.

Jangan otomatis gunakan posting period seperti Sales Invoice.

## C. Amount source

Jangan berasumsi:

```text
Transaction.foreigntotal
```

adalah KPI amount Item Fulfillment.

Periksa:

```text
foreigntotal
TransactionLine.foreignamount
TransactionLine.netamount
inventory-affecting lines
COGS lines
```

Harus ditentukan dari data nyata.

## D. Line filtering

Periksa field:

```text
mainline
taxline
iscogs
isinventoryaffecting
item
itemtype
quantity
foreignamount
netamount
rate
units
```

Jangan copy filter Sales Invoice mentah-mentah.

---

# 24. Setelah Probe Item Fulfillment Berhasil

Baru desain:

```text
item_fulfillment_headers
item_fulfillment_lines
```

Pattern yang diinginkan:

```text
1. Probe exact NetSuite fields
2. Tentukan KPI COUNT + amount definition
3. CREATE BigQuery tables
4. Initial load October
5. Validate NetSuite vs BigQuery
6. Create checkpoint
7. Delta header sync
8. Delta line sync
9. Duplicate/orphan checks
10. Final reconciliation
```

Sales Invoice bisa dijadikan reference implementation.

---

# 25. Jangan Langsung Copy Struktur Sales Invoice untuk Item Fulfillment

Sales Invoice adalah posting financial transaction.

Item Fulfillment kemungkinan:

```text
non-posting operational transaction
```

Jadi hal berikut harus diverifikasi dulu:

```text
postingperiod
foreigntotal
amount
inventory quantity
COGS
line sign
status
createdfrom
location
```

Jangan menebak.

---

# 26. Known NetSuite Sales Invoice Sample Data

Useful reference:

## SI261009491

```text
Internal ID: 3145010
Date: 2026-10-01
Status: Invoice : Open
Total: 2,988,900
Last modified: 2026-10-02 15:33:01
```

## AKKGLG261006A

```text
Internal ID: 3147643
Invoice: AKKGLG261006A
Date: 2026-10-06
Status: Invoice : Open
Total: 649,900
```

Used earlier for REST validation.

---

# 27. Important Operational Notes

## Node version

Observed:

```text
Node.js v20.19.0
```

## Main working directory

```text
C:\netsuite-backup
```

## Certificate directory

```text
C:\netsuite-backup-cert
```

## BigQuery location

Always:

```text
asia-southeast1
```

for dataset:

```text
netsuite_backup
```

---

# 28. Security / Credential Guidance

Current scripts contain literal integration identifiers.

Do not paste those identifiers into future chat unless absolutely necessary.

Long-term cleanup recommendation:

buat centralized local config, misalnya:

```text
netsuite-config.mjs
```

atau `.env`:

```text
NETSUITE_CLIENT_ID
NETSUITE_CERTIFICATE_ID
NETSUITE_PRIVATE_KEY_PATH
NETSUITE_BASE_URL
BQ_PROJECT_ID
BQ_DATASET_ID
BQ_LOCATION
```

Tetapi **jangan refactor sekarang sebelum Item Fulfillment probe selesai**, supaya progress tidak terganggu.

---

# 29. Why Header Total != Line Amount

Sales Invoice validated:

Header total:

```text
12,920,394,172.66
```

Line item amount:

```text
11,640,012,217.68
```

Ini **bukan mismatch**.

Line table intentionally excludes:

- tax lines,
- main AR line,
- other accounting-only lines.

Header total includes financial effects seperti tax.

Jadi reconciliation yang benar:

```text
NetSuite header total <-> BQ header total
NetSuite filtered line total <-> BQ filtered line total
```

Jangan compare:

```text
header total <-> filtered item line total
```

---

# 30. Error / Lesson Log

## Error: Dataset not found in location US

Cause:

```text
dataset location = asia-southeast1
```

Fix:

```javascript
location: 'asia-southeast1'
```

---

## Error: BigQuery invalid rows

Cause:

```javascript
table.insert(batch, { raw: true })
```

Fix:

```javascript
table.insert(batch)
```

---

## Error: MERGE blocked by streaming buffer

Cause:

header initial load used streaming insert.

Fix:

- wait until streaming buffer cleared,
- future initial loads use BigQuery Load Job.

---

## Error: job.getMetadata is not a function

Cause:

wrong assumption about `table.load()` return type.

Data itself had already loaded successfully.

Fix delta script:

```javascript
const [metadata] = await table.load(...)
```

then inspect metadata directly.

---

## Error: Item Fulfillment count 0 with posting period

Cause suspected:

Item Fulfillment non-posting.

Next test:

```text
filter by trandate
```

instead of posting period.

---

# 31. Current Completion Matrix

| Transaction | Probe | BQ Tables | Initial Load | Delta | Reconciliation | Status |
|---|---:|---:|---:|---:|---:|---|
| Sales Invoice | DONE | DONE | DONE | DONE | DONE | DONE |
| Item Fulfillment | in progress | NO | NO | NO | NO | NEXT |
| Sales Order | NO | NO | NO | NO | NO | Pending |
| Sales Return | NO | NO | NO | NO | NO | Pending |
| Sales Payment | NO | NO | NO | NO | NO | Pending |
| Purchase Order | NO | NO | NO | NO | NO | Pending |
| Item Receipt | NO | NO | NO | NO | NO | Pending |
| Purchase Invoice | NO | NO | NO | NO | NO | Pending |
| Purchase Return | NO | NO | NO | NO | NO | Pending |
| Bill | NO | NO | NO | NO | NO | Pending |

---

# 32. Recommended First Message in New Chat

Copy-paste ini bersama file MD kalau perlu:

```text
Lanjut project NetSuite -> BigQuery dari handover ini.

Sales Invoice sudah DONE dan final reconciliation PASS.
Jangan bangun ulang Sales Invoice.

Sekarang progress terakhir adalah Item Fulfillment.
Probe pertama pakai postingperiod hasilnya 0.
Sudah disimpulkan kemungkinan Item Fulfillment non-posting.

Latest next action:
jalankan revised test-item-fulfillment.mjs yang filter:
trandate >= 2026-10-01
trandate < 2026-11-01

Script terbaru auto-read NetSuite Client ID dan Certificate ID dari:
C:\netsuite-backup\sync-sales-invoice.mjs

Private key:
C:\netsuite-backup-cert\private.pem

Setelah output probe keluar, analisis transaction type, amount source, dan line structure sebelum CREATE tabel BigQuery.
```

---

# 33. Golden Rule untuk Chat Baru

Untuk menjaga continuity:

1. **Sales Invoice jangan diulang.**
2. Jangan recreate table Sales Invoice.
3. Jangan reset checkpoint.
4. Jangan memakai posting period otomatis untuk Item Fulfillment.
5. Jangan asumsi `foreigntotal` cocok sebagai Item Fulfillment amount.
6. Probe NetSuite dulu.
7. Gunakan actual NetSuite field/output sebagai source of truth.
8. BigQuery location selalu `asia-southeast1`.
9. Gunakan pattern delta dengan overlap 5 menit.
10. Setelah satu transaksi selesai, buat final reconciliation sebelum pindah ke transaksi berikutnya.

---

# 34. Current Final State in One Screen

```text
NETSUITE -> BIGQUERY BACKUP

Sales Invoice
|-- OAuth REST SuiteQL          DONE
|-- BigQuery Header             DONE
|-- BigQuery Lines              DONE
|-- Initial Header Load         DONE
|-- Header Delta Sync           DONE
|-- Initial Line Load           DONE
|-- Line Delta Sync             DONE
|-- Header KPI Reconciliation   DONE
|-- Line KPI Reconciliation     DONE
|-- Duplicate Check             DONE
|-- Orphan Check                DONE
`-- FINAL PASS                  DONE

Latest validated Sales Invoice:
Header Count  : 389
Header Amount : 12,920,394,172.66
Line Count    : 18,061
Line Amount   : 11,640,012,217.68
Duplicates    : 0
Orphans       : 0

NEXT:
Item Fulfillment probe

Current problem:
postingperiod filter returned 0.

Next test:
type = ItemShip
trandate >= 2026-10-01
trandate < 2026-11-01

BigQuery Item Fulfillment tables:
NOT CREATED YET

Do not create them until actual NetSuite Item Fulfillment
fields and amount definition are confirmed.
```
