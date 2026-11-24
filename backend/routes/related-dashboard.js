const remote = require('../remote-source');
const {executeQuery: runQuery,getDbConnectionParams} = require('./queries');
const {AsyncLocalStorage} = require('node:async_hooks');
const inferenceContext = new AsyncLocalStorage();
const positiveLimit = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
};
async function executeQuery(id, sql, db) {
  const context = inferenceContext.getStore();
  if (!context) return runQuery(id,sql,db);
  if (context.cache.has(sql)) return context.cache.get(sql);
  if (++context.queries > context.limit || Date.now() > context.deadline)
    rejectPlan('Join inference exceeded its profiling budget. Narrow the schema or declare relationships; no dashboard was saved.');
  const result = await runQuery(id,sql,db);
  context.cache.set(sql,result);
  return result;
}

const rejectPlan = message => { throw Object.assign(new Error(message), {status:422}); };
const quote = name => '"' + name.replaceAll('"','""') + '"';
const label = name => name.toLowerCase().replaceAll('_',' ');
const qualified = (table, field) => quote(table) + '.' + quote(field);

// Match each component by its observed domain, then verify every populated tuple
// against one parent row. Independent per-column matches are insufficient.
async function inferCompositeEdges(id, db, child, columns, parent, parentColumns, pk) {
  const affinity = type => /INT/i.test(type) ? 'integer' : /CHAR|TEXT|CLOB/i.test(type) ? 'text' : type.toUpperCase();
  const candidates = [];
  async function covered(keys) {
    const childFields = keys.map(([c]) => qualified(child,c));
    const populated = childFields.map(c => c+' IS NOT NULL').join(' OR ');
    const equality = keys.map(([c,p]) => qualified(parent,p)+' = '+qualified(child,c)).join(' AND ');
    const {rows:[check]} = await executeQuery(id,
      'SELECT EXISTS(SELECT 1 FROM '+quote(child)+' WHERE '+populated+') AS populated, '+
      'EXISTS(SELECT 1 FROM '+quote(child)+' WHERE ('+populated+') AND NOT EXISTS(SELECT 1 FROM '+
      quote(parent)+' WHERE '+equality+')) AS invalid',db);
    return check.populated && !check.invalid;
  }
  for (const {col} of pk) {
    const target = parentColumns.find(c => c.column_name === col);
    if (!target) return [];
    const matches = [];
    for (const column of columns) {
      if (affinity(column.data_type) !== affinity(target.data_type)) continue;
      const pair = [column.column_name,col];
      if (await covered([pair])) matches.push(pair);
    }
    if (!matches.length) return [];
    candidates.push(matches);
  }
  const edges = [];
  async function extend(keys) {
    for (const pair of candidates[keys.length]) {
      if (keys.some(([name]) => name === pair[0])) continue;
      const next = [...keys,pair];
      if (next.length === pk.length) {
        if (await covered(next)) edges.push({child,parent,keys:next});
      } else {
        await extend(next);
      }
    }
  }
  await extend([]);
  return edges;
}

// Only search keys whose components have an observed reference in the child.
async function inferredKeyEdges(id, db, child, columns, parent, parentColumns) {
  const available = [];
  for (const column of parentColumns) {
    const name = column.column_name;
    const reference = await inferCompositeEdges(id,db,child,columns,parent,parentColumns,[{col:name}]);
    if (reference.length) available.push({name,reference});
  }
  const edges = [];
  const minimalKeys = [];
  let level = available.map((_,i) => [i]);
  while (level.length) {
    const next = [];
    for (const indices of level) {
      if (minimalKeys.some(key => key.every(i => indices.includes(i)))) continue;
      const names = indices.map(i => available[i].name);
      const fields = names.map(quote);
      const {rows:[profile]} = await executeQuery(id,
        'SELECT EXISTS(SELECT 1 FROM '+quote(parent)+' WHERE '+fields.map(f=>f+' IS NULL').join(' OR ')+') AS nullable, '+
        'EXISTS(SELECT 1 FROM '+quote(parent)+' GROUP BY '+fields.join(',')+' HAVING COUNT(*) > 1) AS duplicates',db);
      if (profile.nullable) continue;
      if (!profile.duplicates) {
        minimalKeys.push(indices);
        const mappings = indices.length === 1 ? available[indices[0]].reference :
          await inferCompositeEdges(id,db,child,columns,parent,parentColumns,names.map(col=>({col})));
        edges.push(...mappings);
      } else {
        for (let i = indices.at(-1)+1; i < available.length; i++) next.push([...indices,i]);
      }
    }
    level = next;
  }
  return edges;
}

// Inspect whole constraints: one column of a composite FK cannot establish row grain.
async function relationships(id, db, catalog, connection, infer = true, parents = null) {
  let rows, primaryKeys;
  if (connection.db_type !== 'sqlite') {
    ({foreignKeys:rows,primaryKeys} = await remote.describe(connection));
  } else {
  ({rows} = await executeQuery(id, `SELECT t.name AS child, f.id, f.seq, f."table" AS parent,
    f."from" AS child_key, f."to" AS parent_key FROM sqlite_schema t,
    pragma_foreign_key_list(t.name) f WHERE t.type='table' ORDER BY t.name,f.id,f.seq`, db));
  ({rows: primaryKeys} = await executeQuery(id,
    "SELECT t.name AS tbl, c.name AS col, c.pk FROM sqlite_schema t, pragma_table_info(t.name) c WHERE t.type='table' AND c.pk > 0 ORDER BY t.name,c.pk",db));
  }
  const constraints = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.child,row.id]);
    if (!constraints.has(key)) constraints.set(key,[]);
    constraints.get(key).push(row);
  }
  const graph = new Map();
  for (const group of constraints.values()) {
    const {child,parent} = group[0];
    const parentColumns = catalog.get(parent);
    if (!parentColumns) continue;
    const pk = primaryKeys.filter(c => c.tbl === parent);
    // Implicit references follow the live primary key's declared ordinal order.
    const keys = group.map(r => [r.child_key,r.parent_key || pk[r.seq]?.col]);
    if (keys.length !== pk.length || !pk.every(c => keys.some(k => k[1] === c.col))) continue;
    if (!graph.has(child)) graph.set(child,[]);
    graph.get(child).push({child,parent,keys});
  }
  if (!infer) return graph;
  const declared = new Set(rows.map(r => JSON.stringify([r.child,r.child_key])));
  for (const [child,columns] of catalog) {
    for (const column of columns) {
      if (declared.has(JSON.stringify([child,column.column_name]))) continue;
      if (column.primary_key) continue;
      const matches = [];
      for (const [parent,parentColumns] of catalog) {
        if (parents && !parents.has(parent)) continue;
        if (parent === child) continue;
        const pk = primaryKeys.filter(k => k.tbl === parent);
        if (pk.length !== 1) continue;
        const noun = parent.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');
        const name = column.column_name.toLowerCase();
        const conventional = name === noun+'_id' || name.endsWith('_'+noun+'_id');
        const parentKey = parentColumns.find(c => c.column_name === pk[0].col);
        const textKey = /CHAR|TEXT|CLOB/i.test(column.data_type) && /CHAR|TEXT|CLOB/i.test(parentKey?.data_type);
        const integerKey = /INT/i.test(column.data_type) && /INT/i.test(parentKey?.data_type);
        if (/(?:^|_)(?:allocation|pct|percentage|percent|share|weight)(?:_|$)/i.test(name)) continue;
        if (!conventional && !textKey && !integerKey && !/(?:^|_)(?:id|key|code|ref|fk|number)$/.test(name)) continue;
        const c = qualified(child,column.column_name);
        const p = qualified(parent,pk[0].col);
        const {rows:[evidence]} = await executeQuery(id,
          'SELECT EXISTS(SELECT 1 FROM '+quote(child)+' WHERE '+c+' IS NOT NULL) AS populated, '+
          'EXISTS(SELECT 1 FROM '+quote(child)+' WHERE '+c+' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM '+
          quote(parent)+' WHERE '+p+' = '+c+')) AS orphan',db);
        if (!evidence.populated || evidence.orphan) continue;
        matches.push({conventional,child,parent,keys:[[column.column_name,pk[0].col]]});
      }
      const named = matches.filter(edge => edge.conventional);
      if (matches.length) {
        if (!graph.has(child)) graph.set(child,[]);
        graph.get(child).push(...(named.length ? named : matches));
      }
    }
  }
  for (const [parent,parentColumns] of catalog) {
    if (parents && !parents.has(parent)) continue;
    const pk = primaryKeys.filter(k => k.tbl === parent);
    if (pk.length === 1) continue;
    for (const [child,columns] of catalog) {
      if (child === parent || rows.some(r => r.child === child && r.parent === parent)) continue;
      const edges = pk.length ? await inferCompositeEdges(id,db,child,columns,parent,parentColumns,pk) :
        await inferredKeyEdges(id,db,child,columns,parent,parentColumns);
      if (edges.length) {
        if (!graph.has(child)) graph.set(child,[]);
        graph.get(child).push(...edges);
      }
    }
  }
  return graph;
}

function pathsTo(graph, source, target, seen = new Set()) {
  if (source === target) return [[]];
  if (seen.has(source)) return [];
  const visited = new Set(seen).add(source);
  const paths = [];
  for (const edge of graph.get(source) || []) {
    for (const tail of pathsTo(graph,edge.parent,target,visited)) {
      paths.push([edge,...tail]);
      if (paths.length > 64) rejectPlan("Too many relationship paths to resolve.");
    }
  }
  return paths;
}

module.exports = async function relatedWidgets(goal, catalog, id, db, choices = {}, filters = []) {
  const text = label(goal.trim()).replace(/[.!?]$/, '')
    .replace(/^(?:please )?(?:build|create|make|show)(?: me)? (?:a |an )?/, '')
    .replace(/^dashboard (?:showing |of |for |with )?/, '');
  const parts = text.match(/^(.+?)(?: (?:by|per) (.+?))?(?: (?:in|for) (\d{4}))?$/);
  if (!parts) return null;
  const [,metrics,dimension,year] = parts;
  const terms = metrics.split(/,\s*(?:and\s+)?|\s+and\s+/);
  const connection = await getDbConnectionParams(id,db);
  const specs = [];
  let graph;
  const inferredScopes = new Set();
  function choose(key, options, question) {
    if (options.length === 1) return options[0];
    const selected = options.find(option => option.label === choices?.[key]);
    if (selected) return selected;
    throw Object.assign(new Error(question), {status:422, clarification:{key, options:options.map(o=>o.label)}});
  }
  for (const term of terms) {
    const match = term.match(/^(average|mean|total|sum of|count of|number of|how many) (.+)$/);
    if (!match) return null;
    const [,operation,field] = match;
    const count = /^(count of|number of|how many)$/.test(operation);
    const avg = /^(average|mean)$/.test(operation);
    const matchesField = (table,c) => label(c.column_name) === field || label(table)+' '+label(c.column_name) === field;
    const sources = [...catalog].filter(([table,cols]) => count ? label(table) === field :
      cols.some(c => matchesField(table,c) && /INT|REAL|FLOAT|DOUBLE|DECIMAL|NUMERIC/i.test(c.data_type)));
    if (!sources.length) return null;
    const {table:source,columns} = choose('measure|'+field,sources.map(([table,columns])=>({table,columns,label:label(table)+' '+field})),
      'Which table should supply '+field+'?');
    const measure = columns.find(c => matchesField(source,c));
    const metric = count ? 'COUNT(*)' : (avg ? 'AVG' : 'SUM') + '(' + qualified(source,measure.column_name) + ')';
    const monthly = dimension === 'month';
    const used = new Map();
    let membership;
    async function locate(predicate,description,allowBridge=false) {
      const local = columns.filter(predicate);
      if (local.length) {
        const selected = choose(source+'|'+description,local.map(column=>({column,label:source+'.'+column.column_name})),
          'Which field should determine '+description+' for '+source+'?');
        return qualified(source,selected.column.column_name);
      }
      graph ||= await relationships(id,db,catalog,connection,false);
      const candidates = [];
      for (const [table,cols] of catalog) {
        for (const column of cols.filter(predicate)) {
          const paths = pathsTo(graph,source,table);
          for (const path of paths) candidates.push({table,column,path});
          if (!allowBridge || paths.length || table === source) continue;
          // A bridge must reference both the fact (or an ancestor) and the grouping side.
          for (const [bridge,edges] of graph) {
            if (bridge === source || bridge === table) continue;
            for (const anchor of edges) {
              for (const prefix of pathsTo(graph,source,anchor.parent)) {
                for (const suffix of pathsTo(graph,bridge,table)) {
                  if (!suffix.length || (suffix[0].keys.length === anchor.keys.length && suffix[0].keys.every(([key]) => anchor.keys.some(([a]) => a === key))) || suffix.some(e => e.parent === anchor.parent || e.parent === source)) continue;
                  candidates.push({table,column,path:prefix,anchor,suffix});
                }
              }
            }
          }
        }
      }
      const scopeKey = source+'|'+description;
      if (!candidates.length && !inferredScopes.has(scopeKey)) {
        const limit = positiveLimit('MAX_INFERENCE_TABLES',32);
        const parents = catalog.size > limit ? new Set([source,...[...catalog]
          .filter(([,cols])=>cols.some(predicate)).map(([table])=>table)]) : null;
        const inferred = await inferenceContext.run({cache:new Map(),queries:0,
          limit:positiveLimit('MAX_INFERENCE_QUERIES',2048),
          deadline:Date.now()+positiveLimit('INFERENCE_BUDGET_MS',15000)},async()=>{
          // Empty unrelated tables cannot establish a relationship. Probe with
          // EXISTS, then profile only source/target parents for a large schema.
          const active = new Map();
          for (const [table,cols] of catalog) {
            const {rows:[row]} = await executeQuery(id,'SELECT EXISTS(SELECT 1 FROM '+quote(table)+') AS populated',db);
            if (row.populated) active.set(table,cols);
          }
          return relationships(id,db,active,connection,true,parents);
        });
        for (const [child,edges] of inferred) {
          const existing = graph.get(child) || [];
          graph.set(child,[...existing,...edges.filter(edge=>!existing.some(old=>JSON.stringify(old)===JSON.stringify(edge)))]);
        }
        inferredScopes.add(scopeKey);
        return locate(predicate,description,allowBridge);
      }
      if (!candidates.length) rejectPlan('No supported relationship from '+source+' to '+description+'.');
      const describe = edge => edge.keys.map(([a,b])=>edge.child+'.'+a+' → '+edge.parent+'.'+b).join(', ');
      const options = candidates.map(c => ({...c,label:[...c.path,...(c.anchor?[c.anchor,...c.suffix]:[])].map(describe).concat(c.table+'.'+c.column.column_name).join(' / ')}));
      const {table,column,path,anchor,suffix} = choose(source+'|'+description,options,'Which relationship should determine '+description+' for '+source+'?');
      if (anchor) membership = {anchor,suffix,table,column};
      for (const edge of path) {
        if (used.has(edge.parent) && used.get(edge.parent) !== edge) rejectPlan('Conflicting join paths to ' + edge.parent);
        used.set(edge.parent,edge);
      }
      return qualified(table,column.column_name);
    }
    let date;
    if (year || monthly) date = await locate(c => /DATE|TIME/i.test(c.data_type) || /(?:date|_at|_on)$/i.test(c.column_name),'a date field');
    const predicates = [];
    for (const filter of filters) {
      const field = await locate(c => label(c.column_name) === filter.field,filter.field);
      predicates.push(field+' '+filter.operator+' '+filter.literal);
    }
    if (year) predicates.push(remote.period(connection.db_type,date,false)+" = '"+year+"'");
    const from = () => ' FROM ' + quote(source) + [...used.values()].map(e =>
      ' LEFT JOIN ' + quote(e.parent) + ' ON ' + e.keys.map(([child,parent]) =>
        qualified(e.parent,parent) + ' = ' + qualified(e.child,child)).join(' AND ')).join('') +
      (predicates.length ? ' WHERE '+predicates.join(' AND ') : '');
    const title = term + (year ? ' in ' + year : '');
    specs.push({type:'kpi',question:title,value:'value',sql:'SELECT ' + metric + ' AS value' + from()});
    if (dimension) {
      const group = monthly ? remote.period(connection.db_type,date,true) :
        await locate(c => label(c.column_name) === dimension || label(c.table_name)+' '+label(c.column_name) === dimension,dimension,true);
      let groupedSql = 'SELECT ' + group + ' AS category, ' + metric + ' AS value' + from() + ' GROUP BY 1 ORDER BY 1';
      let note = '';
      if (membership) {
        const {anchor,suffix} = membership;
        const join = e => ' JOIN '+quote(e.parent)+' ON '+e.keys.map(([a,b]) =>
          qualified(e.parent,b)+' = '+qualified(e.child,a)).join(' AND ');
        const keys = anchor.keys.map(([a],i)=>qualified(anchor.child,a)+' AS k'+i);
        // Collapse duplicate memberships and multiple dimension IDs with the same displayed category.
        const mapping = 'SELECT DISTINCT '+keys.join(', ')+', '+group+' AS category FROM '+quote(anchor.child)+suffix.map(join).join('');
        const partition = keys.map((_,i)=>'k'+i).join(', ');
        const association = anchor.keys.map(([,b],i)=>qualified(anchor.parent,b)+' = members.k'+i).join(' AND ');
        const base = from();
        const filter = base.indexOf(' WHERE ');
        const joined = (filter < 0 ? base : base.slice(0,filter))+' LEFT JOIN members ON '+association+(filter < 0 ? '' : base.slice(filter));
        let cte = 'WITH members AS (SELECT m.*, COUNT(*) OVER (PARTITION BY '+partition+') AS groups_n FROM ('+mapping+') m) ';
        const weightFields = catalog.get(anchor.child).filter(c =>
          /(?:^|_)(allocation|allocated|split|weight|share|portion|percentage|percent|pct)(?:_|$)/i.test(c.column_name));
        let weight;
        if (weightFields.length) {
          const selected = choose('weight|'+anchor.child,weightFields.map(c=>({label:c.column_name})),
            'Which field in '+anchor.child+' gives the allocation for this dashboard?');
          const weightColumn = catalog.get(anchor.child).find(c=>c.column_name===selected.label);
          if (connection.db_type !== 'sqlite' && !/INT|REAL|FLOAT|DOUBLE|DECIMAL|NUMERIC/i.test(weightColumn.data_type)) rejectPlan('Use a numeric allocation field.');
          const invalidWeight = connection.db_type === 'sqlite' ? "typeof(members.w) NOT IN ('integer','real')" : 'members.w IS NULL';
          const raw = qualified(anchor.child,selected.label);
          // Keep distinct destination IDs even when their displayed categories coincide.
          const destinations = suffix[0].keys.map(([col],i)=>qualified(anchor.child,col)+' AS d'+i);
          const entries = 'SELECT DISTINCT '+[...keys,...destinations].join(', ')+', '+group+' AS category, '+raw+
            ' AS w FROM '+quote(anchor.child)+suffix.map(e => join(e).replace(/^ JOIN /,' LEFT JOIN ')).join('');
          const partitions = 'PARTITION BY '+partition;
          cte = 'WITH entries AS ('+entries+'), members AS (SELECT entries.*, SUM(w) OVER ('+partitions+
            ') AS total_w, COUNT(*) OVER ('+partitions+', '+destinations.map((_,i)=>'d'+i).join(', ')+
            ') AS variants FROM entries) ';
          const {rows:[check]} = await executeQuery(id,cte+'SELECT MAX(CASE WHEN members.variants IS NOT NULL AND '+
            "("+invalidWeight+" OR members.w < 0 OR members.variants > 1 OR (ABS(members.total_w-1)>0.0000001 AND ABS(members.total_w-100)>0.0000001)) THEN 1 ELSE 0 END) AS invalid"+
            joined,db);
          if (check.invalid) rejectPlan('Allocation values in '+anchor.child+'.'+selected.label+
            ' must be nonnegative numbers with one weight per membership and sum to 1 or 100 for each allocated record.');
          weight = 'CASE WHEN members.variants IS NULL THEN 1.0 ELSE members.w * 1.0 / members.total_w END';
          note = ' (weighted by '+selected.label+')';
        } else {
          const {rows:[overlap]} = await executeQuery(id,cte+'SELECT MAX(members.groups_n) AS n'+joined,db);
          const policy = overlap.n > 1 ? choose('allocation|'+dimension,[{label:'Split equally across groups'},{label:'Count fully in each group'}],
            'Some records belong to multiple groups. How should their values contribute to '+dimension+'?') : {label:'Split equally across groups'};
          if (policy.label.startsWith('Split')) weight = '1.0 / COALESCE(members.groups_n,1)';
          note = ' ('+policy.label+')';
        }
        let groupedMetric = metric;
        if (weight) {
          const field = count ? '1' : qualified(source,measure.column_name);
          groupedMetric = 'SUM('+field+' * ('+weight+'))';
          if (avg) groupedMetric += ' / SUM(CASE WHEN '+field+' IS NOT NULL THEN '+weight+' END)';
        }
        groupedSql = cte+'SELECT members.category AS category, '+groupedMetric+' AS value'+joined+' GROUP BY 1 ORDER BY 1';
      }
      specs.push({type:monthly?'line':'bar',question:term+' by '+dimension+(year?' in '+year:'')+note,
        value:'value',x:'category',sql:groupedSql});
    }
  }
  return specs;
};
