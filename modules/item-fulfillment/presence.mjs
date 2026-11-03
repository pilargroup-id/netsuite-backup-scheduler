import { reconcilePresence } from '../../common/presence-reconcile.mjs';
reconcilePresence('item-fulfillment',{ apply:process.argv.includes('--apply') }).catch(e=>{console.error('PRESENCE CHECK ERROR:',e.stack??e);process.exitCode=1;});
