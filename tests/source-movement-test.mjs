import assert from 'node:assert/strict';
import {detectSourceMovement} from '../common/source-movement.mjs';
const si1 = 'NetSuite COUNT : 1128\nNetSuite TOTAL : 36085382366.11\nNetSuite LINE COUNT : 50564\nNetSuite LINE AMOUNT : 32509982453.86';
const si2 = 'NetSuite COUNT : 1128\nNetSuite TOTAL : 36085382366.09\nNetSuite LINE COUNT : 50565\nNetSuite LINE AMOUNT : 32509982453.82';
assert.equal(detectSourceMovement('sales-invoice',si1,si2).moving,true);
assert.equal(detectSourceMovement('sales-invoice',si1,si1).moving,false);
assert.equal(detectSourceMovement('sales-invoice','ERROR','ERROR').moving,false);
assert.equal(detectSourceMovement('sales-order','NetSuite: headers=809, lines=3848','NetSuite: headers=810, lines=3850').moving,true);
assert.equal(detectSourceMovement('item-fulfillment','NetSuite=802, BQ active=802','NetSuite=803, BQ active=802').moving,true);
// Changes only on the BQ side do NOT prove that NetSuite moved.
assert.equal(detectSourceMovement('item-fulfillment','NetSuite=802, BQ active=802','NetSuite=802, BQ active=803').moving,false);
console.log('SOURCE MOVEMENT TESTS PASS');
