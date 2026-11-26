const assert = require('node:assert/strict');
process.env.GROQ_API_KEY = '';
const {recommendChart} = require('../routes/ai-engine');
(async()=>{
  const grouped = await recommendChart('Total observations by queue',['queue','value'],[{queue:'A',value:2},{queue:'B',value:3}]);
  assert.equal(grouped.chart_type,'bar','Grouped values must not become an overall KPI');
  const multiple = await recommendChart('Total sales and orders',['temperature','pressure'],[{temperature:20,pressure:90}]);
  assert.equal(multiple.chart_type,'table','Several metrics must not silently discard all but one');
  assert.deepEqual(multiple.y_axis,['temperature','pressure']);
  const single = await recommendChart('Total observations',['value'],[{value:5}]);
  assert.equal(single.chart_type,'kpi');
  console.log('Schema-neutral chart selection passed');
})().catch(error=>{console.error(error);process.exitCode=1});
