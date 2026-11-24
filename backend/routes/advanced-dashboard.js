// Compose validated aggregate plans; never accept SQL fragments from the request.
const fail = message => { throw Object.assign(new Error(message), {status:422}); };
module.exports = async function advanced(goal, catalog, id, db, choices) {
  if (!/^(?:top \d+|growth in)\b/i.test(goal) && !/\swhere\s/i.test(goal)) return null;
  const pieces = goal.split(/\swhere\s/i);
  if (pieces.length > 2) fail('Use one where clause with filters joined by and.');
  if (pieces.length === 2 && (!pieces[1].trim() || /\band\s*$/i.test(pieces[1]))) fail('Complete every filter after where and and.');
  let base = pieces[0];
  const filters = [];
  if (pieces[1]) {
    // Quoted strings can themselves contain "and"; reject any unparsed remainder.
    const pattern = /\s*([a-z][a-z0-9_ ]*?)\s*(>=|<=|!=|=|>|<|is not|is|equals|at least|at most|above|below)\s*('(?:[^']|'')*'|"[^"]*"|-?\d+(?:\.\d+)?|null)\s*(?:and\s+|$)/igy;
    let position = 0;
    while (position < pieces[1].length) {
      pattern.lastIndex = position;
      const match = pattern.exec(pieces[1]);
      if (!match) fail('Specify filters as field = "value" or field >= number, joined by and.');
      position = pattern.lastIndex;
      const field = match[1].trim().toLowerCase().replaceAll('_',' ');
      const columns = [...catalog.values()].flat().filter(c=>c.column_name.toLowerCase().replaceAll('_',' ')===field);
      if (!columns.length) fail('Unknown filter field: '+field);
      let operator = ({equals:'=',is:'=', 'is not':'!=','at least':'>=','at most':'<=',above:'>',below:'<'})[match[2].toLowerCase()] || match[2];
      const value = match[3];
      let literal;
      if (/^null$/i.test(value)) {
        if (!['=','!='].includes(operator)) fail('Use is null or is not null.');
        operator = operator==='='?'IS':'IS NOT'; literal='NULL';
      } else if (/^["']/.test(value)) {
        if (/[\\\x00]/.test(value)) fail('Backslash and null characters are not supported in text filters.');
        const decoded=value[0]==="'" ? value.slice(1,-1).replaceAll("''", "'") : value.slice(1,-1);
        literal="'"+decoded.replaceAll("'","''")+"'";
      } else {
        if (columns.some(c=>!/INT|REAL|FLOAT|DOUBLE|DECIMAL|NUMERIC/i.test(c.data_type))) fail('Use a quoted value for a text field.');
        literal=String(Number(value));
        if (!Number.isFinite(Number(value))) fail('Use a finite numeric filter value.');
      }
      filters.push({field,operator,literal});
    }
  }
  const build = async request => {
    const result = await require('./related-dashboard')(request,catalog,id,db,choices,filters);
    if (!result) fail('Specify a count, total, or average using schema field names.');
    return result;
  };
  const top = base.match(/^top (\d+) (.+?) by (.+)$/i);
  if (top) {
    const n=Number(top[1]);
    if (n<1 || n>1000) fail('Choose a ranking size between 1 and 1000.');
    const specs=await build(top[3]+' by '+top[2]);
    if (specs.length!==2) fail('Rank by one metric.');
    return [{...specs[1],question:goal,sql:'SELECT category, value FROM ('+specs[1].sql+') ranked ORDER BY CASE WHEN value IS NULL THEN 1 ELSE 0 END, value DESC, category ASC LIMIT '+n}];
  }
  const growth=base.match(/^growth in (.+?) from (\d{4}) to (\d{4})(?: by (.+))?$/i);
  if (growth) {
    const [,metric,previous,current,dimension]=growth;
    if (previous===current) fail('Choose two different comparison years.');
    const before=await build(metric+(dimension?' by '+dimension:'')+' in '+previous);
    const after=await build(metric+(dimension?' by '+dimension:'')+' in '+current);
    if (before.length!==(dimension?2:1)) fail('Compare one metric at a time.');
    const p=before.at(-1).sql,c=after.at(-1).sql;
    const cte='WITH previous_period AS ('+p+'), current_period AS ('+c+')';
    const from=dimension ? ', categories AS (SELECT category FROM previous_period UNION SELECT category FROM current_period) SELECT categories.category AS category, ' : ' SELECT ';
    const join=dimension ? ' FROM categories LEFT JOIN previous_period p ON (p.category = categories.category OR (p.category IS NULL AND categories.category IS NULL)) LEFT JOIN current_period c ON (c.category = categories.category OR (c.category IS NULL AND categories.category IS NULL)) ORDER BY categories.category' : ' FROM previous_period p CROSS JOIN current_period c';
    return [['Previous '+previous,'p.value'],['Current '+current,'c.value'],['Change','c.value - p.value'],['Growth percent','(c.value - p.value) * 100.0 / NULLIF(p.value,0)']].map(([name,expression])=>({type:dimension?'bar':'kpi',question:name+' — '+goal,value:'value',allowNull:true,...(dimension?{x:'category'}:{}),sql:cte+from+expression+' AS value'+join}));
  }
  if (/^growth\b/i.test(base)) fail('Use growth in total field from YYYY to YYYY, optionally by a grouping field.');
  return (await build(base)).map(spec=>({...spec,question:spec.question+(pieces[1]?' where '+pieces[1]:'')}));
};
