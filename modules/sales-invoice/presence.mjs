import { reconcilePresence } from '../../common/presence-reconcile.mjs';
reconcilePresence('sales-invoice',{ apply:process.argv.includes('--apply') }).catch(e=>{console.error('PRESENCE CHECK ERROR:',e.stack??e);process.exitCode=1;});
