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
const modules = ['sales-invoice','item-fulfillment','sales-order','item-receipt','purchase-order','purchase-invoice','sales-return','purchase-return','sales-payment','customer-credit-memo','vendor-credit','vendor-payment','journal-entry','inventory-transfer','inventory-adjustment'];
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
    if(mod==='vendor-payment') {
      // Module 12 only: automatic certified per-batch deletion is performed
      // inside its independently tested atomic incremental writer. Existing
      // module branches and recovery controller behavior remain untouched.
      if(mode==='--audit-only') {
        const audit=exec(mod,'check-financial.mjs');
        if(!audit.includes('MODULE 12 EXACT FINANCIAL AUDIT PASS'))throw Error('VP exact financial marker absent');
        summary.push([mod,'AUDIT_CLEAN']);continue;
      }
      const runnerPath=join(root,'modules',mod,'standalone-runner.mjs');
      if(!existsSync(runnerPath))throw Error('Missing '+runnerPath);
      const args=[runnerPath,mode];
      const env=mode==='--sync'
        ? {...process.env,NETSUITE_VENDOR_PAYMENT_RUNNER_CONFIRM:'MODULE12_STANDALONE_RUNNER_AUTHORIZED'}
        : process.env;
      const run=spawnSync(process.execPath,args,{cwd:root,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024,env});
      if(run.stdout)process.stdout.write(run.stdout);
      if(run.stderr)process.stderr.write(run.stderr);
      if(run.error||run.signal||run.status!==0)throw Error('VP standalone runner failed '+(run.error?.message??run.signal??run.status));
      const marker=mode==='--sync'
        ? 'MODULE 12 STANDALONE RUNNER FINAL_PASS: VERIFIED INCREMENTAL AND EXACT AUDIT'
        : 'MODULE 12 STANDALONE RUNNER DRY RUN PASS: ZERO WRITES';
      if(!run.stdout.includes(marker))throw Error('VP standalone runner success marker absent');
      summary.push([mod,mode==='--sync'?'FINAL_PASS':'AUDIT_CLEAN']);
      continue;
    }
    if(mod==='journal-entry') {
      // Module 13 only. Journal writer validates fresh per-ID deletion proof, global
      // absence, bounded batch (max 3), atomic checkpoint CAS and exact reconciliation.
      if(mode==='--audit-only') {
        const audit=exec(mod,'check-financial.mjs',['--audit-only']);
        if(!audit.includes('MODULE 13 EXACT FINANCIAL AUDIT PASS'))throw Error('JE exact financial marker absent');
        summary.push([mod,'AUDIT_CLEAN']);continue;
      }
      const runnerPath=join(root,'modules',mod,'standalone-runner.mjs');
      if(!existsSync(runnerPath))throw Error('Missing '+runnerPath);
      const env=mode==='--sync'
        ? {...process.env,NETSUITE_JOURNAL_ENTRY_RUNNER_CONFIRM:'MODULE13_STANDALONE_RUNNER_AUTHORIZED'}
        : process.env;
      const run=spawnSync(process.execPath,[runnerPath,mode],{cwd:root,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024,env});
      if(run.stdout)process.stdout.write(run.stdout);
      if(run.stderr)process.stderr.write(run.stderr);
      if(run.error||run.signal||run.status!==0)throw Error('JE standalone runner failed '+(run.error?.message??run.signal??run.status));
      const marker=mode==='--sync'
        ? 'MODULE 13 STANDALONE RUNNER FINAL_PASS: VERIFIED INCREMENTAL AND EXACT AUDIT'
        : 'MODULE 13 STANDALONE RUNNER DRY RUN PASS: ZERO WRITES';
      if(!run.stdout.includes(marker))throw Error('JE standalone runner success marker absent');
      summary.push([mod,mode==='--sync'?'FINAL_PASS':'AUDIT_CLEAN']);
      continue;
    }
    if(mod==='inventory-transfer') {
      // Module 14 only: exact audit is read-only; sync invokes certified standalone
      // incremental runner. Verified deletion apply is intentionally never scheduled.
      if(mode==='--audit-only') {
        const audit=exec(mod,'check-financial.mjs',['--audit-only']);
        if(!audit.includes('MODULE 14 EXACT RECONCILIATION PASS'))throw Error('IT exact reconciliation marker absent');
        summary.push([mod,'AUDIT_CLEAN']);continue;
      }
      const runnerPath=join(root,'modules',mod,'standalone-runner.mjs');
      if(!existsSync(runnerPath))throw Error('Missing '+runnerPath);
      const env=mode==='--sync'
        ? {...process.env,NETSUITE_INVENTORY_TRANSFER_RUNNER_CONFIRM:'MODULE14_STANDALONE_RUNNER_AUTHORIZED'}
        : process.env;
      const run=spawnSync(process.execPath,[runnerPath,mode],{cwd:root,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024,env});
      if(run.stdout)process.stdout.write(run.stdout);
      if(run.stderr)process.stderr.write(run.stderr);
      if(run.error||run.signal||run.status!==0)throw Error('IT standalone runner failed '+(run.error?.message??run.signal??run.status));
      const marker=mode==='--sync'
        ? 'MODULE 14 STANDALONE RUNNER FINAL_PASS: INCREMENTAL + EXACT RECONCILIATION; NO DELETION APPLY'
        : null;
      if(mode==='--dry-run') {
        if(!run.stdout.includes('MODULE 14 STANDALONE RUNNER DRY RUN PASS: ZERO WRITES; NO DELETION APPLY') &&
           !run.stdout.includes('MODULE 14 STANDALONE RUNNER DRY RUN PASS: DELTA DETECTED; ZERO WRITES; NO DELETION APPLY'))
          throw Error('IT standalone dry-run marker absent');
      } else if(!run.stdout.includes(marker))throw Error('IT standalone sync marker absent');
      summary.push([mod,mode==='--sync'?'FINAL_PASS':'AUDIT_CLEAN']);
      continue;
    }
    if(mod==='inventory-adjustment') {
      // Module 15 only. Audit mode is strictly read-only; sync invokes the
      // standalone incremental writer and exact reconciliation, never deletion apply.
      if(mode==='--audit-only') {
        const audit=exec(mod,'check-financial.mjs',['--audit-only']);
        if(!audit.includes('MODULE 15 EXACT RECONCILIATION PASS'))throw Error('IA exact reconciliation marker absent');
        summary.push([mod,'AUDIT_CLEAN']);continue;
      }
      const runnerPath=join(root,'modules',mod,'standalone-runner.mjs');
      if(!existsSync(runnerPath))throw Error('Missing '+runnerPath);
      const env=mode==='--sync'
        ? {...process.env,NETSUITE_INVENTORY_ADJUSTMENT_RUNNER_CONFIRM:'MODULE15_STANDALONE_RUNNER_AUTHORIZED'}
        : process.env;
      const run=spawnSync(process.execPath,[runnerPath,mode],{cwd:root,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024,env});
      if(run.stdout)process.stdout.write(run.stdout);
      if(run.stderr)process.stderr.write(run.stderr);
      if(run.error||run.signal||run.status!==0)throw Error('IA standalone runner failed '+(run.error?.message??run.signal??run.status));
      if(mode==='--dry-run') {
        if(!run.stdout.includes('MODULE 15 STANDALONE RUNNER DRY RUN PASS: ZERO WRITES; NO DELETION APPLY') &&
           !run.stdout.includes('MODULE 15 STANDALONE RUNNER DRY RUN PASS: DELTA DETECTED; ZERO WRITES; NO DELETION APPLY'))
          throw Error('IA standalone dry-run marker absent');
      } else if(!run.stdout.includes('MODULE 15 STANDALONE RUNNER FINAL_PASS: INCREMENTAL + EXACT RECONCILIATION; NO DELETION APPLY')) {
        throw Error('IA standalone sync marker absent');
      }
      summary.push([mod,mode==='--sync'?'FINAL_PASS':'AUDIT_CLEAN']);
      continue;
    }
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
const modules = ['sales-invoice','item-fulfillment','sales-order','item-receipt','purchase-order','purchase-invoice','sales-return','purchase-return','sales-payment','customer-credit-memo','vendor-credit','vendor-payment','journal-entry','inventory-transfer','inventory-adjustment'];
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
