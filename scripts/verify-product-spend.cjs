// Uses only a local Firestore emulator and an isolated test project.
const assert = require('node:assert/strict');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const localRequire = require('node:module').createRequire(require('node:path').resolve(__dirname,'../functions/package.json'));
const { initializeApp } = localRequire('firebase-admin/app');
const { getFirestore } = localRequire('firebase-admin/firestore');
const { ActivityProcessRepository } = require('../functions/lib/repositories/activityProcessRepository');
const { ActivityEngineService } = require('../functions/lib/services/activityEngine');
const { parseCreateCampaignCommand } = require('../functions/lib/domain/activity/campaign.schema');
const { MockCommerceAdapter } = require('../functions/lib/integrations/commerce/mock/mockCommerceAdapter');
const db = getFirestore(initializeApp({ projectId: 'demo-product-spend-verification' }));
const run = Date.now().toString();
const campaign = { id: `CAM_${run}`, type:'purchase', status:'active', startsAt:'2026-01-01', endsAt:'2027-01-01' };
const input = { name:'verification', startsAt:campaign.startsAt, endsAt:campaign.endsAt, rules:[
  { type:'PRODUCT_QUANTITY', productIds:['PPA001'], requiredQuantity:2, grantQuantity:3 },
  { type:'CUMULATIVE_SPEND', thresholdAmount:1000, grantQuantity:1 }
] };
const rules = parseCreateCampaignCommand(input).rules.map((rule,i)=>({...rule,id:`RULE_${i}`,campaignId:campaign.id}));
const repo = new ActivityProcessRepository(db);
const engine = new ActivityEngineService({ activityProcessRepository:repo, campaignRepository:{
  listActivePurchaseCampaigns:async()=>[campaign], listRulesForCampaign:async()=>rules
} });
function order(id, amount, items, userId=`USR_${run}`, status='paid') {
  const normalized = new MockCommerceAdapter().normalizeOrder({ externalOrderId:id, externalCustomerId:'TEST', status, amount,
    items:items.map(([productId,quantity])=>({productId,quantity,name:productId,unitPrice:1})), invoiceNumber:'TEST' });
  return {...normalized,id:`ORD_${run}_${id}`,userId,paidAt:status==='paid'?'2026-09-10T00:00:00Z':null};
}
(async()=>{
  assert.throws(()=>parseCreateCampaignCommand({...input,rules:[{...input.rules[0],productIds:[]}]}));
  assert.throws(()=>parseCreateCampaignCommand({...input,rules:[{...input.rules[0],requiredQuantity:0}]}));
  const first = order('first',600,[['PPA001',1],['OTHER',100],['PPA001',3]]);
  const result = await engine.processOrder(first);
  assert.equal(result.processedCampaigns[0].wallet.balances.SLOT_SPIN,6);
  assert.equal(result.processedCampaigns[0].wallet.balances.INVOICE_DRAW,0);
  await engine.processOrder(first);
  let progress = (await repo.listSpendProgress(first.userId))[0];
  assert.equal(progress.totalMinor,60000);
  assert.equal(progress.totalEntries,0);
  await Promise.all([engine.processOrder(order('second',600,[['OTHER',5]])),engine.processOrder(order('third',900,[['PPA001',1]]))]);
  progress = (await repo.listSpendProgress(first.userId))[0];
  assert.equal(progress.totalMinor,210000);
  assert.equal(progress.totalEntries,2);
  assert.equal(progress.remainingAmount,100);
  const wallet = (await db.collection('wallets').doc(first.userId).get()).data();
  assert.equal(wallet.balances.SLOT_SPIN,6);
  const entries = await db.collection('spend_draw_entries').where('userId','==',first.userId).get();
  assert.equal(entries.docs.reduce((sum,doc)=>sum+doc.data().quantity,0),2);
  await engine.processOrder(order('pending',9000,[['PPA001',10]],first.userId,'pending'));
  assert.equal((await repo.listSpendProgress(first.userId))[0].totalMinor,210000);
  const other = order('other',50,[['OTHER',1]],`USR_OTHER_${run}`);
  await engine.processOrder(other);
  assert.equal((await repo.listSpendProgress(other.userId))[0].totalEntries,0);
  console.log('PASS: product quantities, unrelated products, validation, cross-order accumulation, remainder, duplicate replay, concurrent orders, pending orders, member isolation, independent draw entries.');
  const { CampaignRepository } = require('../functions/lib/repositories/campaignRepository');
  const campaigns = new CampaignRepository(db);
  const created = [];
  for (const category of ['product','product','cumulative_spend','cumulative_spend']) {
    const command = parseCreateCampaignCommand({ ...input, category, rules:[category === 'product' ? input.rules[0] : input.rules[1]] });
    created.push(await campaigns.createCampaign(command));
  }
  await Promise.all(created.map(({campaign}) => campaigns.activateCampaign(campaign.id)));
  assert.ok((await Promise.all(created.map(({campaign}) => campaigns.getCampaign(campaign.id)))).every(c => c.status === 'active'));
  assert.throws(() => parseCreateCampaignCommand({...input, category:'product'}));
  assert.throws(() => parseCreateCampaignCommand({...input, category:'cumulative_spend',rules:[]}));
  await assert.rejects(campaigns.updateRule(created[0].rules[0].id, { grantQuantity:9 }));
  // Restrict query to this run's campaigns, while exercising the actual repository lifecycle.
  const multipleEngine = new ActivityEngineService({activityProcessRepository:repo,campaignRepository:{
    listActivePurchaseCampaigns:async()=>(await campaigns.listActivePurchaseCampaigns()).filter(c=>created.some(x=>x.campaign.id===c.id)),
    listRulesForCampaign:id=>campaigns.listRulesForCampaign(id)
  }});
  const multiUser = `USR_MULTI_${run}`;
  const multiOrder = order('multi',1200,[['PPA001',2]],multiUser);
  await Promise.all([multipleEngine.processOrder(multiOrder),multipleEngine.processOrder(multiOrder)]);
  assert.equal((await db.collection('wallets').doc(multiUser).get()).data().balances.SLOT_SPIN,6);
  const multiProgress = await repo.listSpendProgress(multiUser);
  assert.equal(multiProgress.length,2);
  assert.ok(multiProgress.every(p=>p.totalEntries===1 && p.totalMinor===120000));
  await campaigns.endCampaign(created[0].campaign.id);
  await multipleEngine.processOrder(order('after-end',800,[['PPA001',2]],multiUser));
  assert.equal((await db.collection('wallets').doc(multiUser).get()).data().balances.SLOT_SPIN,9);
  assert.ok((await repo.listSpendProgress(multiUser)).every(p=>p.totalEntries===2 && p.totalMinor===200000));
  console.log('PASS: four overlapping campaigns, category validation, concurrent replay isolation, independent spend totals, ending one campaign leaves others active.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.terminate());
