"""Verify real CQI coffee ratings against independent CSV calculations.
Set COFFEE_CSV to the downloaded TidyTuesday 2020-07-07 coffee_ratings.csv.
Country is normalized into a dimension; all observations and nulls are retained.
"""
import csv, datetime, hashlib, json, math, os, re, socket, sqlite3, subprocess, sys, tempfile, time
from pathlib import Path
from collections import defaultdict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"ai-engine"))
from init_db import create_metadata_db
data=Path(os.environ["COFFEE_CSV"])
source=list(csv.DictReader(data.open(encoding="utf-8")))
def nullable(v):return None if v in ("","NA") else v
def number(v):return float(v) if nullable(v) is not None else None
def date(v):return datetime.datetime.strptime(re.sub(r"(\d+)(st|nd|rd|th)",r"\1",v.strip()),"%B %d, %Y").date().isoformat()
countries=list(dict.fromkeys(nullable(r["country_of_origin"]) for r in source))
country_id={name:i+1 for i,name in enumerate(countries) if name is not None}
cases=[
 ("How many ratings are there?","count",None,None,None),
 ("Average total cup points by country of origin","avg","total_cup_points","country_of_origin",None),
 ("Show me a dashboard of total number of bags and average aroma by country of origin in 2015",["sum","avg"],["number_of_bags","aroma"],"country_of_origin","2015"),
 ("Please show the average total cup points for each country of origin","avg","total_cup_points","country_of_origin",None),
 ("Build a dashboard showing the number of ratings by month in 2014","count",None,"month","2014"),
 ("Show average total cup points by processing method","avg","total_cup_points","processing_method",None)]
def reference(agg,measure,group,year):
 selected=[r for r in source if year is None or date(r["grading_date"]).startswith(year)]
 def calc(rows):
  values=[number(r[measure]) for r in rows if number(r[measure]) is not None] if measure else rows
  return len(rows) if agg=="count" else sum(values)/(len(values) if agg=="avg" else 1) if values else None
 groups=defaultdict(list)
 for r in selected:groups[date(r["grading_date"])[:7] if group=="month" else nullable(r[group]) if group else None].append(r)
 return calc(selected),{key:calc(rows) for key,rows in groups.items()}
with tempfile.TemporaryDirectory() as temp:
 folder=Path(temp);metadata=folder/"metadata.db";create_metadata_db(metadata)
 with socket.socket() as sock:sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
 server=subprocess.Popen(["node",str(ROOT/"backend/server.js")],cwd=folder,stdout=subprocess.DEVNULL,
  env=dict(os.environ,PORT=str(port),METADATA_DB_PATH=str(metadata),SQLITE_SOURCE_ROOT=temp,GROQ_API_KEY=os.environ.get("GROQ_API_KEY","") if os.environ.get("COFFEE_LIVE_MODEL") else "",JWT_SECRET=os.urandom(32).hex()))
 base=f"http://127.0.0.1:{port}/api";token=None
 def api(path,body=None):
  request=Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={"Content-Type":"application/json","Authorization":"Bearer "+str(token)})
  try:
   with urlopen(request,timeout=120) as response:return response.status,json.load(response)
  except HTTPError as error:return error.code,json.load(error)
 try:
  for _ in range(100):
   try:api("/health");break
   except URLError:time.sleep(.1)
  _,account=api("/auth/register",{"name":"Alice","email":"Alice@example.test","password":"test-only-password"});token=account["token"]
  folder=folder/str(account["user"]["id"]);folder.mkdir();path=folder/"coffee.db"
  with sqlite3.connect(path) as db:
   db.executescript("""CREATE TABLE countries(country_id INTEGER PRIMARY KEY,country_of_origin TEXT);
    CREATE TABLE ratings(rating_id INTEGER PRIMARY KEY,country_id INTEGER REFERENCES countries(country_id),
    total_cup_points REAL,number_of_bags REAL,aroma REAL,processing_method TEXT,grading_date TEXT);""")
   db.executemany("INSERT INTO countries VALUES (?,?)",[(i,name) for name,i in country_id.items()])
   db.executemany("INSERT INTO ratings VALUES (?,?,?,?,?,?,?)",[(i+1,country_id.get(nullable(r["country_of_origin"])),number(r["total_cup_points"]),number(r["number_of_bags"]),number(r["aroma"]),nullable(r["processing_method"]),date(r["grading_date"])) for i,r in enumerate(source)])
  db.close()
  connection_options={"name":"Coffee ratings","db_type":"sqlite","database_name":str(path)}
  if os.environ.get("COFFEE_CONNECTION_FILE"):
   connection_options=json.loads(Path(os.environ["COFFEE_CONNECTION_FILE"]).read_text())
   subprocess.run(["node",str(ROOT/"backend/tests/load_coffee.cjs"),str(path),os.environ["COFFEE_CONNECTION_FILE"]],check=True)
  _,connection=api("/databases/connect",connection_options);database=connection["id"]
  failures=[]
  for text,aggregates,measures,group,year in cases:
   status,result=api("/dashboards/recommend",{"database_id":database,"objective":text})
   if status!=201:failures.append((text,result));continue
   _,saved=api("/dashboards/"+str(result["dashboard_id"]));widgets=json.loads(saved["layout_json"])["pages"][0]["widgets"]
   if not isinstance(aggregates,list):aggregates,measures=[aggregates],[measures]
   assert len(widgets)==len(aggregates)*(2 if group else 1),text
   for index,(aggregate,measure) in enumerate(zip(aggregates,measures)):
    overall,expected=reference(aggregate,measure,group,year)
    for offset in range(2 if group else 1):
     sql=widgets[index*(2 if group else 1)+offset]["sql"]
     if offset and group=="country_of_origin":assert "JOIN" in sql and "country_id" in sql,sql
     status,answer=api("/queries/ask",{"database_id":database,"question":"__dashboard_reload__","sql_query":sql})
     assert status==200,answer
     rows=answer["results"]["rows"];actual={r["category"]:r["value"] for r in rows} if offset else {None:rows[0]["value"]}
     expected_values=expected if offset else {None:overall}
     assert actual.keys()==expected_values.keys(),(text,actual,expected_values)
     for key,value in actual.items():
      assert value is None if expected_values[key] is None else math.isclose(value,expected_values[key],abs_tol=1e-8),(text,key,value,expected_values[key])
   if len(aggregates)==1:
    status,answer=api("/queries/ask",{"database_id":database,"question":text})
    assert status==200,answer
    expected=reference(aggregates[0],measures[0],group,year)
    actual={r["category"]:r["value"] for r in answer["results"]["rows"]} if group else {None:answer["results"]["rows"][0]["value"]}
    expected_values=expected[1] if group else {None:expected[0]}
    assert actual.keys()==expected_values.keys()
    assert all(math.isclose(actual[k],v,abs_tol=1e-8) for k,v in expected_values.items())
   print("PASS",text,flush=True)
  # Independent CSV references for ranking, combined filters, and growth.
  def grouped(rows, field, aggregate, measure):
   groups=defaultdict(list)
   for row in rows:groups[nullable(row[field])].append(number(row[measure]))
   return {k:sum(v)/(len(v) if aggregate=="avg" else 1) for k,v in groups.items()}
  def validate_request(request, expected):
   status,result=api("/dashboards/recommend",{"database_id":database,"objective":request})
   assert status==201,(request,result)
   _,saved=api("/dashboards/"+str(result["dashboard_id"]))
   widgets=json.loads(saved["layout_json"])["pages"][0]["widgets"]
   assert len(widgets)==len(expected),(request,len(widgets))
   for widget,want in zip(widgets,expected):
    status,answer=api("/queries/ask",{"database_id":database,"question":"__dashboard_reload__","sql_query":widget["sql"]})
    assert status==200,(request,answer)
    rows=answer["results"]["rows"]
    actual={r.get("category"):r["value"] for r in rows}
    assert list(actual)==list(want),(request,actual,want)
    for k,v in want.items():
     assert actual[k] is None if v is None else math.isclose(actual[k],v,abs_tol=1e-8),(request,k,actual[k],v)
   print("PASS",request,flush=True)
  def ordered(values):return dict(sorted(values.items(),key=lambda pair:(pair[0] is not None,pair[0] or "")))
  values=grouped(source,"country_of_origin","sum","number_of_bags")
  top=dict(sorted(values.items(),key=lambda pair:(-pair[1],pair[0] or ""))[:10])
  validate_request("Show top 10 country of origin by total number of bags",[top])
  selected=[r for r in source if date(r["grading_date"]).startswith("2015") and r["processing_method"]=="Washed / Wet" and number(r["aroma"])>=7.5]
  values=grouped(selected,"country_of_origin","avg","total_cup_points")
  validate_request('Show average total cup points by country of origin in 2015 where processing method = "Washed / Wet" and aroma >= 7.5',[{None:sum(number(r["total_cup_points"]) for r in selected)/len(selected)},ordered(values)])
  selected=[r for r in source if r["country_of_origin"]=="Brazil" and number(r["aroma"])>=7.5]
  validate_request('Show total number of bags where country of origin = "Brazil" and aroma >= 7.5',[{None:sum(number(r["number_of_bags"]) for r in selected)}])
  selected=[r for r in source if number(r["aroma"])>=7.5]
  values=grouped(selected,"country_of_origin","avg","total_cup_points")
  validate_request('Show top 10 country of origin by average total cup points where aroma >= 7.5',[dict(sorted(values.items(),key=lambda pair:(-pair[1],pair[0] or ""))[:10])])
  for dimension in [None,"country_of_origin"]:
   yearly=[]
   for year in ["2014","2015"]:
    selected=[r for r in source if date(r["grading_date"]).startswith(year) and number(r["aroma"])>=7.5]
    yearly.append(grouped(selected,dimension,"sum","number_of_bags") if dimension else {None:sum(number(r["number_of_bags"]) for r in selected)})
   keys=ordered({k:None for d in yearly for k in d})
   previous={k:yearly[0].get(k) for k in keys};current={k:yearly[1].get(k) for k in keys}
   change={k:current[k]-previous[k] if current[k] is not None and previous[k] is not None else None for k in keys}
   growth={k:change[k]*100/previous[k] if change[k] is not None and previous[k] else None for k in keys}
   validate_request('Show growth in total number of bags from 2014 to 2015'+(' by country of origin' if dimension else '')+' where aroma >= 7.5',[previous,current,change,growth])
  validate_request('Show growth in count of ratings from 1900 to 2015',[{None:0},{None:197},{None:197},{None:None}])
  for bad in ['Show total number of bags where aroma >= 7.5 or aroma < 3','Show total number of bags where unknown field = 1','Show top 0 country of origin by total number of bags']:
   status,result=api("/dashboards/recommend",{"database_id":database,"objective":bad})
   assert status==422,(bad,result)
  # Conversational equivalents must produce the same source-grounded values.
  top_bags=dict(sorted(grouped(source,"country_of_origin","sum","number_of_bags").items(),key=lambda pair:(-pair[1],pair[0] or ""))[:10])
  for phrase in ['Could you show me the top 10 country of origin by total bags?', 'Which 10 countries have the most bags?', 'Give me a report showing the highest 10 country of origin by total bags please']:
   validate_request(phrase,[top_bags])
  all_avg=sum(number(r["total_cup_points"]) for r in source)/len(source)
  for phrase in ["What's the average cup points?",'Can you tell me average points?', 'I want a dashboard of average total cup points']:
   validate_request(phrase,[{None:all_avg}])
  before=reference("sum","number_of_bags",None,"2014")[0];after=reference("sum","number_of_bags",None,"2015")[0]
  validate_request('How did total bags change between 2014 and 2015?',[{None:before},{None:after},{None:after-before},{None:(after-before)*100/before}])
  selected=[r for r in source if number(r["aroma"])>=7.5 and r["country_of_origin"]=="Brazil"]
  validate_request('Could you show me total bags only include aroma at least 7.5 and country of origin equals "Brazil"',[{None:sum(number(r["number_of_bags"]) for r in selected)}])
  if os.environ.get("COFFEE_LIVE_MODEL"):
   for phrase in ["I'm curious about the ten origins with the largest combined bag volumes. Can you put that on a dashboard?", "Across all the coffee reviews, what is the mean overall cup score?", "Please compare the combined bag volume for 2015 against 2014 and show the percentage change as well"]:
    expected=[top_bags] if "origins" in phrase else [{None:all_avg}] if "mean" in phrase else [{None:before},{None:after},{None:after-before},{None:(after-before)*100/before}]
    validate_request(phrase,expected)
  if os.environ.get("COFFEE_LIVE_MODEL"):
   ambiguous="Build a dashboard of the best countries. I have not chosen whether best means quality scores or bag volume."
   status,result=api("/dashboards/recommend",{"database_id":database,"objective":ambiguous})
   assert status==422 and result.get("clarification"),(status,result)
   clarification=result["clarification"]
   selected=next((o for o in clarification["options"] if "bag" in o.lower()),None)
   assert selected,clarification
   status,result=api("/dashboards/recommend",{"database_id":database,"objective":ambiguous,"choices":{clarification["key"]:selected}})
   assert status==201,(status,result)
   print("PASS ambiguous request asks and accepts clarification",flush=True)
  if os.environ.get("COFFEE_BROWSER") and not failures:
   env=dict(os.environ,BROWSER_FIXTURE_NAME="Coffee ratings",BROWSER_REQUEST=cases[2][0],
    BROWSER_KPI=str(reference("sum","number_of_bags","country_of_origin","2015")[0]),BROWSER_LABELS="Colombia,Ethiopia", BROWSER_KPI_DISPLAY=format(reference("sum","number_of_bags","country_of_origin","2015")[0]/1000,'.1f')+'K')
   subprocess.run(["node",str(ROOT/"backend/tests/browser.cjs"),base],env=env,check=True)
  print(json.dumps({"engine":connection_options["db_type"],"source_rows":len(source),"sha256":hashlib.sha256(data.read_bytes()).hexdigest(),"failures":failures},indent=2))
  if failures:sys.exit(1)
 finally:server.terminate();server.wait(10)

