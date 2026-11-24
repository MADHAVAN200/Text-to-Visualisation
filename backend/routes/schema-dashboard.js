
const fail = message => { throw Object.assign(new Error(message), { status: 422 }); };
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const words = name => name.toLowerCase().replace(/[_-]/g, ' ').trim();
const numeric = column => /INT|REAL|FLOAT|DOUBLE|DECIMAL|NUMERIC/i.test(column.data_type);
const temporal = column => /DATE|TIME/i.test(column.data_type) || /(?:date|_at|_on)$/i.test(column.column_name);

// Resolve ordinary aggregate requests locally; other phrasing can use a constrained model plan.
function localPlan(goal, catalog) {
  const text = words(goal).replace(/[.!?]$/, '')
    .replace(/^(?:please )?(?:build|create|make|show)(?: me)? (?:a |an )?/, '')
    .replace(/^dashboard (?:showing |of |for )?/, '').replace(/ dashboard\b/, '');
  const match = text.match(/^(total|average|mean|sum of|count of|number of|how many) (.+?)(?: (?:by|per) (.+?))?(?: (?:in|for) (\d{4}))?$/);
  if (!match) return null;
  const [, operation, metric, group, year] = match;
  const aggregate = ['number of','count of','how many'].includes(operation) ? 'count' :
    ['average','mean'].includes(operation) ? 'avg' : 'sum';
  const candidates = [];
  for (const [table, columns] of catalog) {
    const field = columns.find(c => words(c.column_name) === metric);
    if (aggregate === 'count' ? words(table) !== metric : !field) continue;
    const dimension = group === 'month' ? undefined : columns.find(c => words(c.column_name) === group);
    if (group && group !== 'month' && !dimension) continue;
    const dates = columns.filter(temporal);
    if ((year || group === 'month') && dates.length !== 1) fail('Specify the date field to use for this report.');
    candidates.push({table, aggregate, measure: aggregate === 'count' ? null : field.column_name,
      dimension: dimension?.column_name || null, monthly: group === 'month', year: year || null,
      date: dates.length === 1 ? dates[0].column_name : null});
  }
  if (candidates.length > 1) fail('Multiple tables match this measure. Specify the table.');
  return candidates[0] || null;
}

async function schemaWidgets(goal, id, db, key, choices, localOnly = false) {
  const originalGoal = goal;
  const rows = await new Promise((resolve,reject) => db.all(
    'SELECT table_name,column_name,data_type,primary_key,foreign_key FROM schema_metadata WHERE database_id=? ORDER BY table_name,id',
    [id], (err, result) => err ? reject(err) : resolve(result)));
  const catalog = new Map();
  for (const row of rows) {
    if (!catalog.has(row.table_name)) catalog.set(row.table_name, []);
    catalog.get(row.table_name).push(row);
  }
  const unsupported = 'Specify a row count, total, or average and an optional grouping field from your database.';
  if (!rows.length) fail('Sync the connection schema before creating a dashboard.');
  if (!goal.trim()) {
    return [...catalog.keys()].map(table => ({type:'kpi',question:'Count of '+table,value:'value',
      sql:'SELECT COUNT(*) AS value FROM '+quote(table)}));
  }
  goal = require('./conversation-plan').normalize(goal,catalog,choices);
  goal = goal.trim().replace(/[?.!]$/, '').replace(/^please\s+/i,'')
    .replace(/^(?:build|create|make|show)(?: me)?\s+(?:(?:a|an|the)\s+)?/i,'')
    .replace(/^dashboard\s+(?:showing|with|of|for)\s+(?:the\s+)?/i,'')
    .replace(/^the\s+/i,'').replace(/\s+for each\s+/i,' by ')
    .replace(/ are there$/i,'');
  // A monthly table request is only determinate when the table has one numeric measure.
  const monthlyRequest = goal.match(/^(?:build (?:a )?|show (?:me )?)?monthly (.+?)(?: dashboard)?(?: (?:for|in) (\d{4}))?[?.!]?$/i);
  if (monthlyRequest) {
    const entry = [...catalog].find(([table])=>words(table) === words(monthlyRequest[1]));
    if (entry) {
      const measures = entry[1].filter(c=>numeric(c) && !c.primary_key && !c.foreign_key && !/(^id$|_id$)/i.test(c.column_name));
      if (measures.length !== 1) fail('Specify which numeric field to summarize by month.');
      goal = 'total '+words(measures[0].column_name)+' by month'+(monthlyRequest[2]?' in '+monthlyRequest[2]:'');
    }
  }
  const advanced = await require('./advanced-dashboard')(goal,catalog,id,db,choices);
  if (advanced) return advanced;
  const related = await require('./related-dashboard')(goal,catalog,id,db,choices);
  if (related) return related;
  let plan = localPlan(goal, catalog);
  if (!plan && localOnly) return null;
  if (!plan) {
    const interpreted = await require('./conversation-plan').interpret(originalGoal,catalog,key,choices);
    if (interpreted) return schemaWidgets(interpreted,id,db,key,choices,true);
    fail('Describe the metric, grouping, and period, or configure a model key in Settings for broader language understanding.');
  }
  if (!plan || plan.unsupported || !catalog.has(plan.table)) fail(unsupported);
  const columns = catalog.get(plan.table);
  const column = name => columns.find(c => c.column_name === name);
  const {aggregate, measure, dimension, monthly, date, year} = plan;
  if (!['sum','avg','count'].includes(aggregate) || typeof monthly !== 'boolean' ||
      (aggregate === 'count' ? measure != null : !column(measure) || !numeric(column(measure))) ||
      (dimension != null && !column(dimension)) || (monthly && dimension != null) ||
      (year != null && !/^\d{4}$/.test(String(year))) ||
      ((year != null || monthly) && (!column(date) || !temporal(column(date))))) fail(unsupported);
  const value = aggregate === 'count' ? 'COUNT(*)' : aggregate.toUpperCase() + '(' + quote(measure) + ')';
  const label = aggregate === 'count' ? 'Count of ' + words(plan.table) :
    (aggregate === 'avg' ? 'Average ' : 'Total ') + words(measure);
  const period = year == null ? '' : ' for ' + year;
  const {db_type} = await require('./queries').getDbConnectionParams(id,db);
  const {period:formatPeriod} = require('../remote-source');
  const from = ' FROM ' + quote(plan.table) + (year == null ? '' : " WHERE " + formatPeriod(db_type,quote(date),false) + " = '" + year + "'");
  const widgets = [{type:'kpi', question:label + period, sql:'SELECT ' + value + ' AS value' + from, value:'value'}];
  if (dimension || monthly) {
    const group = monthly ? formatPeriod(db_type,quote(date),true) : quote(dimension);
    widgets.push({type:monthly ? 'line' : 'bar', question:label + ' by ' + (monthly ? 'month' : words(dimension)) + period,
      sql:'SELECT ' + group + ' AS category, ' + value + ' AS value' + from + ' GROUP BY 1 ORDER BY 1', x:'category', value:'value'});
  }
  return widgets;
}
module.exports = async (goal,id,db,key,choices,localOnly) => {
  const connection = await require('./queries').getDbConnectionParams(id,db);
  return require('../remote-source').planningSession(connection,()=>schemaWidgets(goal,id,db,key,choices,localOnly));
};
