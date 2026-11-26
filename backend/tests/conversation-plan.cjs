const assert = require('node:assert/strict');
const {normalize,compile} = require('../routes/conversation-plan');
const catalog = new Map([['events',[
  {column_name:'gross_amount',data_type:'REAL'},
  {column_name:'net_amount',data_type:'REAL'},
  {column_name:'region',data_type:'TEXT'}
]]]);
assert.throws(()=>normalize('Show total amount',catalog),error=>error.status===422 && error.clarification.options.length===2);
assert.equal(normalize('Show total amount',catalog,{'field|amount':'net amount'}),'total net amount');
const plan={metrics:[{aggregate:'sum',field:'net_amount'}],dimension:'region',year:null,top:10,growth:null,filters:[]};
assert.equal(compile(plan,catalog),'top 10 region by total net amount');
assert.throws(()=>compile({...plan,metrics:[{aggregate:'sum',field:'invented'}]},catalog));
assert.throws(()=>compile({...plan,filters:[{field:'region',operator:'OR 1=1',value:1}]},catalog));
assert.throws(()=>compile({...plan,sql:'SELECT secret'},catalog));
assert.throws(()=>compile({...plan,top:0},catalog));
console.log('Schema alias ambiguity and model-plan validation passed');
