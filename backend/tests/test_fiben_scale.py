"""FIBEN scale regression. Set FIBEN_SQLITE to the unmodified public SQLite mirror.
FIBEN_RESULT receives timings, counts, source SQL, generated SQL and comparisons.
No benchmark-specific planning logic is used by the application.
"""
import os,sys,json,time,hashlib,socket,tempfile,subprocess,sqlite3
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'ai-engine'))
from init_db import create_metadata_db
source=Path(os.environ['FIBEN_SQLITE']).resolve()
result_path=Path(os.environ.get('FIBEN_RESULT',str(source.with_suffix('.results.json'))))
result={'source':str(source),'bytes':source.stat().st_size,'cases':[]}
reference=sqlite3.connect('file:'+source.as_posix()+'?mode=ro',uri=True);reference.row_factory=sqlite3.Row
quote=lambda name:'"'+name.replace('"','""')+'"'
start=time.perf_counter()
tables=[r[0] for r in reference.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
result['tables']={table:reference.execute('SELECT COUNT(*) FROM '+quote(table)).fetchone()[0] for table in tables}
result['nonempty_tables']=sum(n>0 for n in result['tables'].values());result['sha256']=hashlib.file_digest(open(source,'rb'),'sha256').hexdigest();result['table_count']=len(tables);result['row_count']=sum(result['tables'].values());result['count_seconds']=time.perf_counter()-start
result['foreign_keys']=sum(len(reference.execute('PRAGMA foreign_key_list('+quote(t)+')').fetchall()) for t in tables)
result['primary_key_tables']=sum(any(c['pk'] for c in reference.execute('PRAGMA table_info('+quote(t)+')')) for t in tables)
print(json.dumps({k:result[k] for k in ['table_count','nonempty_tables','row_count','foreign_keys','primary_key_tables','count_seconds']}),flush=True)
print('Largest tables',sorted(result['tables'].items(),key=lambda x:-x[1])[:8],flush=True)
cases=[
 ('How many elementsoffinancialreport are there?','SELECT COUNT(*) AS value FROM elementsoffinancialreport'),
 ('Count of elementsoffinancialreport where ismemberof >= 2000000','SELECT COUNT(*) AS value FROM elementsoffinancialreport WHERE ismemberof >= 2000000'),
 ('How many monetaryamount are there?','SELECT COUNT(*) AS value FROM monetaryamount'),
 ('Count of holding','SELECT COUNT(*) AS value FROM holding'),
 ('Average holding hascount','SELECT AVG(hascount) AS value FROM holding'),
 ('Count of monetaryamount by hascurrency','SELECT hascurrency AS category,COUNT(*) AS value FROM monetaryamount GROUP BY hascurrency ORDER BY hascurrency'),
 ('Count of corporation by isdomiciledin','SELECT isdomiciledin AS category,COUNT(*) AS value FROM corporation GROUP BY isdomiciledin ORDER BY isdomiciledin'),
 ('Top 10 isheldby by total holding hascount','SELECT isheldby AS category,SUM(hascount) AS value FROM holding GROUP BY isheldby ORDER BY value DESC,isheldby ASC LIMIT 10'),
 ('Count of financialreport by haslegalname','SELECT c.haslegalname AS category,COUNT(*) AS value FROM financialreport f LEFT JOIN corporation c ON c.corporationid=f.isprovidedby GROUP BY c.haslegalname ORDER BY c.haslegalname'),
]
if os.environ.get('FIBEN_LIVE_MODEL'):
 cases.extend([
  ('How many financial reports are available?', 'SELECT COUNT(*) AS value FROM financialreport'),
  ('For holdings, what is the average count?', 'SELECT AVG(hascount) AS value FROM holding'),
  ("Show how many financial reports there are for each corporation's legal name", 'SELECT c.haslegalname AS category,COUNT(*) AS value FROM financialreport f LEFT JOIN corporation c ON c.corporationid=f.isprovidedby GROUP BY c.haslegalname ORDER BY c.haslegalname'),
 ])
with tempfile.TemporaryDirectory() as tmp:
 t=Path(tmp);meta=t/'metadata.db';create_metadata_db(meta)
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 log=open(t/'api.log','w');server=subprocess.Popen(['node',str(ROOT/'backend/server.js')],cwd=t,env=dict(os.environ,PORT=str(port),METADATA_DB_PATH=str(meta),SQLITE_SOURCE_ROOT=tmp,GROQ_API_KEY=os.environ.get('GROQ_API_KEY','') if os.environ.get('FIBEN_LIVE_MODEL') else '',JWT_SECRET=os.urandom(32).hex()),stdout=log,stderr=log)
 token=None;base=f'http://127.0.0.1:{port}/api'
 def api(path,body=None):
  request=Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json','Authorization':'Bearer '+str(token)})
  try:
   with urlopen(request,timeout=25) as r:return r.status,json.load(r)
  except HTTPError as error:return error.code,json.load(error)
 try:
  for _ in range(100):
   try:api('/health');break
   except URLError:time.sleep(.1)
  _,account=api('/auth/register',{'name':'Scale audit','email':'scale@example.test','password':'Scale-audit-only-2026'});token=account['token']
  user=t/str(account['user']['id']);user.mkdir();local=user/'fiben.sqlite';os.link(source,local)
  start=time.perf_counter();status,connected=api('/databases/connect',{'name':'FIBEN scale audit','db_type':'sqlite','database_name':str(local)})
  result['connect_seconds']=time.perf_counter()-start
  assert status==201,connected
  database=connected['id'];_,schema=api('/databases/'+str(database)+'/schema');assert len(schema)==len(tables)
  print('Schema synchronized in',round(result['connect_seconds'],3),'seconds',flush=True)
  for case_index,(request,sql) in enumerate(cases):
   if os.environ.get('FIBEN_LIVE_MODEL') and case_index>9:
    print('Pacing live-model request for provider token quota',flush=True);time.sleep(55)
   case={'request':request,'source_sql':sql};result['cases'].append(case)
   expected=[dict(r) for r in reference.execute(sql)]
   start=time.perf_counter()
   try:status,response=api('/dashboards/recommend',{'database_id':database,'objective':request})
   except TimeoutError:
    case.update(status='timeout',planning_seconds=time.perf_counter()-start);print('TIMEOUT',request,flush=True);break
   case['planning_seconds']=time.perf_counter()-start
   if status!=201:case.update(status='rejected',error=response);print('REJECTED',request,response,flush=True);continue
   _,report=api('/dashboards/'+str(response['dashboard_id']));widgets=json.loads(report['layout_json'])['pages'][0]['widgets'];case['widget_count']=len(widgets)
   case['sql']=widgets[-1]['sql']
   start=time.perf_counter();status,answer=api('/queries/ask',{'database_id':database,'question':'__dashboard_reload__','sql_query':case['sql']});case['reload_seconds']=time.perf_counter()-start
   assert status==200,answer
   actual=answer['results']['rows'];assert actual==expected,(request,actual[:3],expected[:3])
   case.update(status='passed',result_rows=len(actual),preview=actual[:3]);print('PASS',request,round(case['planning_seconds'],3),'seconds',flush=True)
 finally:
  server.terminate();server.wait(10);log.close();reference.close()
  result_path.write_text(json.dumps(result,indent=2),encoding='utf-8')
print('Report:',result_path)
if any(c['status']!='passed' for c in result['cases']):sys.exit(1)
