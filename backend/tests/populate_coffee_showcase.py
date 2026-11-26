"""Populate and verify 15 real-data dashboards in an existing demo account.
Requires COFFEE_CSV, SHOWCASE_ACCESS_FILE, SHOWCASE_CONNECTION_FILE and SHOWCASE_METADATA.
Connection must already contain the CQI ratings/countries import. No credentials are committed.
"""
import csv,datetime,json,math,os,re,sqlite3
from collections import defaultdict
from pathlib import Path
from urllib.request import Request,urlopen
access=json.loads(Path(os.environ['SHOWCASE_ACCESS_FILE']).read_text())
connection=json.loads(Path(os.environ['SHOWCASE_CONNECTION_FILE']).read_text(encoding='utf-8'))
base=access['api'];token=None

def api(route,body=None,method=None):
 req=Request(base+route,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Content-Type':'application/json','Authorization':'Bearer '+str(token)})
 with urlopen(req,timeout=120) as response:return json.load(response)
account=api('/auth/login',{'email':access['email'],'password':access['password']});token=account['token']
connections=api('/databases');existing=next((c for c in connections if c['name']==connection['name']),None)
database=(existing or api('/databases/connect',connection))['id']
source=list(csv.DictReader(open(os.environ['COFFEE_CSV'],encoding='utf-8')))
def date(row):return datetime.datetime.strptime(re.sub(r'(\d+)(st|nd|rd|th)',r'\1',row['grading_date'].strip()),'%B %d, %Y').date().isoformat()
def nullable(v):return None if v in ('','NA') else v
metrics=[('count',None),('sum','number_of_bags'),('avg','total_cup_points'),('avg','aroma'),('avg','flavor'),('avg','acidity')]
phrase='count of ratings and total number of bags and average total cup points and average aroma and average flavor and average acidity'
plans=[('Global origin overview','country_of_origin',None,'',lambda r:True),('Processing method comparison','processing_method',None,'',lambda r:True)]
for y in range(2012,2018):plans.append((str(y)+' monthly quality and volume','month',str(y),'',lambda r:True))
for country in ['Brazil','Colombia','Ethiopia']:
 plans.append((country+' quality profile','processing_method',None,' where country of origin = '+json.dumps(country),lambda r,c=country:r['country_of_origin']==c))
for method in ['Washed / Wet','Natural / Dry']:
 plans.append((method+' origin comparison','country_of_origin',None,' where processing method = '+json.dumps(method),lambda r,m=method:r['processing_method']==m))
plans.extend([('High-scoring coffees (85+)','country_of_origin',None,' where total cup points >= 85',lambda r:float(r['total_cup_points'])>=85),('Coffees below 80 points','country_of_origin',None,' where total cup points < 80',lambda r:float(r['total_cup_points'])<80)])
manifest=[]
for title,group,year,filters,predicate in plans:
 name='CQI | '+title
 existing_report=next((d for d in api('/dashboards') if d['name']==name),None)
 request='Show a dashboard of '+phrase+' by '+group.replace('_',' ')+((' in '+year) if year else '')+filters
 report_id=existing_report['id'] if existing_report else api('/dashboards/recommend',{'database_id':database,'objective':request})['dashboard_id']
 report=api('/dashboards/'+str(report_id));layout=json.loads(report['layout_json']);widgets=layout['pages'][0]['widgets']
 assert len(widgets)==12,(name,len(widgets))
 selected=[r for r in source if predicate(r) and (not year or date(r).startswith(year))]
 def calculate(rows,aggregate,field):
  if aggregate=='count':return len(rows)
  values=[float(r[field]) for r in rows if nullable(r[field]) is not None]
  return sum(values)/(len(values) if aggregate=='avg' else 1) if values else None
 groups=defaultdict(list)
 for r in selected:groups[date(r)[:7] if group=='month' else nullable(r[group])].append(r)
 for index,(aggregate,field) in enumerate(metrics):
  for offset in (0,1):
   w=widgets[index*2+offset]
   result=api('/queries/ask',{'database_id':database,'question':'__dashboard_reload__','sql_query':w['sql']})['results']['rows']
   actual={r['category']:r['value'] for r in result} if offset else {None:result[0]['value']}
   expected={k:calculate(v,aggregate,field) for k,v in groups.items()} if offset else {None:calculate(selected,aggregate,field)}
   assert actual.keys()==expected.keys(),name
   for k,value in expected.items():assert actual[k] is None if value is None else math.isclose(actual[k],value,rel_tol=1e-10,abs_tol=1e-8),(name,k,actual[k],value)
   w.update(x=24+(index%2)*576 if offset else 24+(index%3)*384,y=340+(index//2)*366 if offset else 24+(index//3)*150,w=552 if offset else 360,h=342 if offset else 130)
   if not offset:w['formatting']={'numberFormat':'plain'}
 layout['canvasWidth']=1200
 api('/dashboards/'+str(report_id)+'/report',{'layout_json':json.dumps(layout),'widgets':[]},'PUT')
 with sqlite3.connect(os.environ['SHOWCASE_METADATA']) as meta:
  meta.execute('UPDATE dashboards SET name=? WHERE id=? AND user_id=?',(name,report_id,account['user']['id']))
 manifest.append({'name':name,'id':report_id,'source_rows':len(selected),'kpis':6,'charts':6,'request':request})
 print('VERIFIED',name,'—',len(selected),'source rows, 12 widgets',flush=True)
Path(os.environ['SHOWCASE_ACCESS_FILE']).with_name('showcase-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('Verified',len(manifest),'dashboards and',len(manifest)*12,'widgets; connection ID',database)
