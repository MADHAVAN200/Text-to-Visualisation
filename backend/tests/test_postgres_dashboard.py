"""Isolated PostgreSQL 16 smoke test for keyless, weighted composite joins (Windows).
Set POSTGRES_BIN to the directory containing initdb/pg_ctl/psql.
"""
import os,socket,subprocess as sp,tempfile,time,json,sys
from pathlib import Path
from urllib.request import Request,urlopen
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'ai-engine'))
from init_db import create_metadata_db
pg=Path(os.environ['POSTGRES_BIN']);flags={'creationflags':sp.CREATE_NO_WINDOW} if os.name=='nt' else {}
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
with tempfile.TemporaryDirectory() as tmp:
 t=Path(tmp);dbport=port();apiport=port();data=t/'pg'
 sp.run([str(pg/'initdb'),'--pgdata='+str(data),'--username=matrix','--auth=trust','--encoding=UTF8','--no-locale'],check=True,stdout=sp.DEVNULL,**flags)
 sp.run([str(pg/'pg_ctl'),'-D',str(data),'-l',str(t/'postgres.log'),'-o',f'-h 127.0.0.1 -p {dbport}','-w','start'],check=True,stdout=sp.DEVNULL,**flags)
 server=None
 try:
  sp.run([str(pg/'psql'),'-h','127.0.0.1','-p',str(dbport),'-U','matrix','-d','postgres','-v','ON_ERROR_STOP=1','-f',str(ROOT/'backend/tests/weighted_fixture.sql')],check=True,stdout=sp.DEVNULL,**flags)
  meta=t/'metadata.db';create_metadata_db(meta)
  server=sp.Popen(['node',str(ROOT/'backend/server.js')],cwd=t,env=dict(os.environ,PORT=str(apiport),METADATA_DB_PATH=str(meta),JWT_SECRET=os.urandom(32).hex(),GROQ_API_KEY=''),stdout=sp.DEVNULL,**flags)
  base=f'http://127.0.0.1:{apiport}/api'
  for _ in range(100):
   try:urlopen(base+'/health').close();break
   except OSError:time.sleep(.1)
  request=Request(base+'/auth/register',data=json.dumps({'name':'Matrix','email':'matrix@example.test','password':'Isolated-test-only-2026'}).encode(),headers={'Content-Type':'application/json'})
  with urlopen(request) as r:account=json.load(r)
  config=t/'connection.json';config.write_text(json.dumps({'name':'PostgreSQL matrix','db_type':'postgresql','host':'127.0.0.1','port':dbport,'username':'matrix','password':'test-only-trust','database_name':'postgres','schema':'public','tls':False}))
  sp.run([sys.executable,str(ROOT/'backend/tests/test_live_dashboard.py')],env=dict(os.environ,LIVE_API_BASE=base,LIVE_AUTH_TOKEN=account['token'],LIVE_CONNECTION_FILE=str(config)),check=True,**flags)
  print('PostgreSQL keyless weighted composite dashboard passed',flush=True)
 finally:
  if server:server.terminate();server.wait(10)
  sp.run([str(pg/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],check=True,stdout=sp.DEVNULL,**flags)
