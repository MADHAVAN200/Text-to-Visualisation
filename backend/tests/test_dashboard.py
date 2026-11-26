"""Integration regression. Uses isolated metadata and sales fixtures, no provider calls."""
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ai-engine"))
from init_db import create_metadata_db


class DashboardTest(unittest.TestCase):
    def test_private_monthly_dashboard(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            metadata = root / "metadata.db"
            create_metadata_db(metadata)
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            env = dict(os.environ, PORT=str(port), METADATA_DB_PATH=str(metadata),
                       SQLITE_SOURCE_ROOT=temp, GROQ_API_KEY="", JWT_SECRET=os.urandom(32).hex())
            server = subprocess.Popen(["node", str(ROOT / "backend/server.js")], cwd=temp, env=env)
            base = f"http://127.0.0.1:{port}/api"

            def api(path, token=None, body=None, status=200):
                headers = {"Content-Type": "application/json"}
                if token:
                    headers["Authorization"] = "Bearer " + token
                req = Request(base + path, headers=headers, data=json.dumps(body).encode() if body is not None else None)
                try:
                    response = urlopen(req, timeout=30)
                except HTTPError as err:
                    response = err
                with response:
                    result = json.load(response)
                    self.assertEqual(response.status, status, result)
                    return result

            try:
                for _ in range(100):
                    try:
                        api("/health")
                        break
                    except URLError:
                        time.sleep(.1)
                api("/databases", status=401)
                def register(name):
                    return api("/auth/register", body={"name":name,"email":name+"@example.test","password":"test-only-password","role":"admin"}, status=201)
                alice, bob = register("Alice"), register("Bob")
                self.assertEqual(alice["user"]["role"], "analyst")
                a, b = alice["token"], bob["token"]
                source = root / str(alice["user"]["id"]) / "sales.db"
                source.parent.mkdir()
                db = sqlite3.connect(source)
                db.executescript("""
                    CREATE TABLE sales(id INTEGER PRIMARY KEY, sale_date TEXT, total_amount INTEGER);
                    INSERT INTO sales VALUES (1,'2023-12-31',999),(2,'2024-01-01',30),(3,'2024-01-20',20),
                                             (4,'2024-02-29',70),(5,'2025-01-01',888);
                    CREATE TABLE customers(id INTEGER PRIMARY KEY);
                    INSERT INTO customers VALUES (1),(2),(3);
                """)
                db.close()
                connection = {"name":"Fixture","db_type":"sqlite","database_name":str(source)}
                api("/databases/connect", b, connection, 400)
                database = api("/databases/connect", a, connection, 201)["id"]
                def ask(question):
                    return {"database_id":database,"question":question}
                api("/queries/ask", b, ask("Monthly sales in 2024"), 404)
                api("/ai/profile-schema", b, {"database_id":database}, 404)
                result = api("/queries/ask", a, ask("How many customers are there?"))
                self.assertEqual(result["results"]["rows"], [{"value":3}])
                api("/queries/history/"+str(result["query_id"]), b, status=404)
                self.assertEqual(api("/queries/history", b), [])
                api("/queries/ask", a, ask("What is net revenue after refunds?"), 422)
                objective = {"database_id":database,"objective":"Build a monthly sales dashboard for 2024"}
                dashboard = api("/dashboards/recommend", a, objective, 201)["dashboard_id"]
                report_path = "/dashboards/"+str(dashboard)
                api(report_path,b,status=404)
                self.assertEqual(api("/dashboards",b), [])
                self.assertEqual(api("/databases",b), [])
                bob_dash = api("/dashboards", b, {"name":"Personal"},201)["id"]
                api(f"/dashboards/{bob_dash}/widgets/import-query",b,{"query_id":result["query_id"]},404)
                widgets = json.loads(api(report_path,a)["layout_json"])["pages"][0]["widgets"]
                self.assertEqual([w["chartType"] for w in widgets], ["kpi","line"])
                rows = [api("/queries/ask",a,dict(ask("__dashboard_reload__"),sql_query=w["sql"]))["results"]["rows"] for w in widgets]
                self.assertEqual(rows, [[{"value":120}],[{"category":"2024-01","value":50},{"category":"2024-02","value":70}]])
                support = source.with_name("helpdesk.db")
                with sqlite3.connect(support) as dataset:
                    dataset.executescript("""
                        CREATE TABLE incidents(queue TEXT, resolution_hours REAL, closed_at TEXT);
                        INSERT INTO incidents VALUES ('Billing',2,'2024-01-01'),('Billing',6,'2024-02-01'),
                          ('Systems',10,'2024-04-01'),('Systems',NULL,'2024-05-01'),('Billing',90,'2025-01-01');
                    """)
                dataset.close()
                helpdesk = api("/databases/connect", a, dict(connection,name="Helpdesk",database_name=str(support)),201)["id"]
                request = {"database_id":helpdesk,"objective":"Show me a dashboard of average resolution hours by queue in 2024"}
                generated = api("/dashboards/recommend",a,request,201)
                saved = api("/dashboards/"+str(generated["dashboard_id"]),a)
                graphs = json.loads(saved["layout_json"])["pages"][0]["widgets"]
                self.assertEqual([w["chartType"] for w in graphs], ["kpi","bar"])
                values = [api("/queries/ask",a,{"database_id":helpdesk,"question":"__dashboard_reload__","sql_query":w["sql"]})["results"]["rows"] for w in graphs]
                self.assertEqual(values, [[{"value":6}],[{"category":"Billing","value":4},{"category":"Systems","value":10}]])
                dispatch = source.with_name("dispatch.db")
                with sqlite3.connect(dispatch) as fixture:
                    fixture.executescript("""
                        CREATE TABLE depots(id INTEGER PRIMARY KEY, region TEXT);
                        CREATE TABLE trips(id INTEGER PRIMARY KEY, depot_id REFERENCES depots(id), started_at TEXT);
                        CREATE TABLE deliveries(trip_id REFERENCES trips(id), parcels INTEGER);
                        CREATE TABLE expenses(trip_id REFERENCES trips(id), fuel_cost REAL);
                        CREATE TABLE transfers(from_id REFERENCES depots(id), to_id REFERENCES depots(id), weight REAL);
                        INSERT INTO transfers VALUES (1,2,9);
                        INSERT INTO depots VALUES (1,'North'),(2,'South');
                        INSERT INTO trips VALUES (1,1,'2024-01-01'),(2,2,'2024-02-02'),(3,2,'2025-01-01');
                        INSERT INTO deliveries VALUES (1,5),(1,5),(2,7),(3,100);
                        INSERT INTO expenses VALUES (1,8),(1,12),(1,10),(2,20),(3,100);
                    """)
                fixture.close()
                dispatch_id = api("/databases/connect",a,dict(connection,name="Dispatch",database_name=str(dispatch)),201)["id"]
                request = {"database_id":dispatch_id,"objective":"Show me a dashboard of total parcels and total fuel cost by region in 2024"}
                report_id = api("/dashboards/recommend",a,request,201)["dashboard_id"]
                widgets = json.loads(api(f"/dashboards/{report_id}",a)["layout_json"])["pages"][0]["widgets"]
                self.assertEqual(len({w["id"] for w in widgets}),4)
                actual = [api("/queries/ask",a,{"database_id":dispatch_id,"question":"__dashboard_reload__","sql_query":w["sql"]})["results"]["rows"] for w in widgets]
                self.assertEqual(actual, [[{"value":17}],[{"category":"North","value":10},{"category":"South","value":7}],
                                          [{"value":50}],[{"category":"North","value":30},{"category":"South","value":20}]])
                before = api("/dashboards",a)
                ambiguous = dict(request,objective="Show me a dashboard of total weight by region")
                prompt = api("/dashboards/recommend",a,ambiguous,422)["clarification"]
                self.assertEqual(api("/dashboards",a),before)
                origin = next(option for option in prompt["options"] if ".from_id" in option)
                chosen = api("/dashboards/recommend",a,dict(ambiguous,choices={prompt["key"]:origin}),201)
                resolved = json.loads(api("/dashboards/"+str(chosen["dashboard_id"]),a)["layout_json"])["pages"][0]["widgets"]
                breakdown = api("/queries/ask",a,{"database_id":dispatch_id,"question":"__dashboard_reload__","sql_query":resolved[1]["sql"]})
                self.assertEqual(breakdown["results"]["rows"],[{"category":"North","value":9}])
                funding = source.with_name("funding.db")
                with sqlite3.connect(funding) as fixture:
                    fixture.executescript("""
                        CREATE TABLE grants(id INTEGER PRIMARY KEY, budget REAL, awarded_at TEXT);
                        CREATE TABLE programs(id INTEGER PRIMARY KEY, sector TEXT);
                        CREATE TABLE memberships(grant_id INTEGER, program_id INTEGER);
                        INSERT INTO grants VALUES (1,100,'2024-01-01'),(2,100,'2024-02-01'),(3,40,'2024-01-01'),(4,999,'2023-01-01');
                        INSERT INTO programs VALUES (1,'Arts'),(2,'Science'),(3,'Arts');
                        INSERT INTO memberships VALUES (1,1),(1,1),(1,2),(1,3),(2,1),(4,2);
                    """)
                fixture.close()
                funding_id = api("/databases/connect",a,dict(connection,name="Funding",database_name=str(funding)),201)["id"]
                objective = {"database_id":funding_id,"objective":"Show me a dashboard of total budget and count of grants by sector in 2024"}
                clarification = api("/dashboards/recommend",a,objective,422)["clarification"]
                self.assertEqual(clarification["key"],"allocation|sector")
                for policy, budgets, counts in [
                    ("Split equally across groups",[40,150,50],[1,1.5,.5]),
                    ("Count fully in each group",[40,200,100],[1,2,1])]:
                    generated = api("/dashboards/recommend",a,dict(objective,choices={clarification["key"]:policy}),201)
                    widgets = json.loads(api("/dashboards/"+str(generated["dashboard_id"]),a)["layout_json"])["pages"][0]["widgets"]
                    outputs = [api("/queries/ask",a,{"database_id":funding_id,"question":"__dashboard_reload__","sql_query":w["sql"]})["results"]["rows"] for w in widgets]
                    self.assertEqual(outputs[0],[{"value":240}])
                    self.assertEqual(outputs[2],[{"value":3}])
                    for rows, expected in [(outputs[1],budgets),(outputs[3],counts)]:
                        self.assertEqual(rows,[{"category":group,"value":v} for group,v in zip([None,"Arts","Science"],expected)])
                # In the earlier year there is a single membership, so no allocation question is necessary.
                api("/dashboards/recommend",a,dict(objective,objective="Total budget by sector in 2023"),201)
                weighted = source.with_name("weighted.db")
                with sqlite3.connect(weighted) as fixture:
                    fixture.executescript("""
                        CREATE TABLE grants(serial TEXT PRIMARY KEY, budget REAL, awarded_at TEXT);
                        CREATE TABLE programs(identifier TEXT PRIMARY KEY, sector TEXT);
                        CREATE TABLE splits(origin TEXT, destination TEXT, allocation_pct REAL);
                        INSERT INTO grants VALUES ('G1',100,'2024-01-01'),('G2',100,'2024-02-01'),('G3',40,'2024-03-01'),('G4',999,'2023-01-01');
                        INSERT INTO programs VALUES ('P1','Arts'),('P2','Science'),('P3','Arts');
                        INSERT INTO splits VALUES ('G1','P1',20),('G1','P1',20),('G1','P2',70),('G1','P3',10),('G2','P1',1.0),('G4','P2',100);
                    """)
                    source_total = fixture.execute("SELECT SUM(budget),COUNT(*) FROM grants WHERE awarded_at LIKE '2024-%'").fetchone()
                fixture.close()
                weighted_id = api("/databases/connect",a,dict(connection,name="Weighted funding",database_name=str(weighted)),201)["id"]
                weighted_request = dict(objective,database_id=weighted_id)
                generated = api("/dashboards/recommend",a,weighted_request,201)
                widgets = json.loads(api("/dashboards/"+str(generated["dashboard_id"]),a)["layout_json"])["pages"][0]["widgets"]
                outputs = [api("/queries/ask",a,{"database_id":weighted_id,"question":"__dashboard_reload__","sql_query":w["sql"]})["results"]["rows"] for w in widgets]
                for idx, expected in enumerate(([40,130,70],[1,1.3,.7])):
                    self.assertEqual(outputs[idx*2],[{"value":source_total[idx]}])
                    rows = outputs[idx*2+1]
                    self.assertEqual([r["category"] for r in rows],[None,"Arts","Science"])
                    for row,value in zip(rows,expected):
                        self.assertAlmostEqual(row["value"],value)
                    self.assertAlmostEqual(sum(r["value"] for r in rows),source_total[idx])
                composite = source.with_name("composite.db")
                with sqlite3.connect(composite) as fixture:
                    fixture.executescript("""
                        CREATE TABLE grants(org TEXT, serial TEXT, budget REAL, awarded_at TEXT, PRIMARY KEY(org,serial));
                        CREATE TABLE programs(workspace TEXT, identifier TEXT, sector TEXT, PRIMARY KEY(identifier,workspace));
                        CREATE TABLE splits(destination TEXT, allocation_pct REAL, scope TEXT, origin TEXT);
                        INSERT INTO grants VALUES ('A','G1',200,'2024-01-01'),('B','G1',100,'2024-02-01'),
                            ('B','G2',40,'2024-03-01'),('A','G3',999,'2023-01-01');
                        INSERT INTO programs VALUES ('A','P1','Arts'),('A','P2','Science'),('B','P1','Science'),('B','P2','Arts');
                        INSERT INTO splits VALUES ('P1',75,'A','G1'),('P1',75,'A','G1'),('P2',25,'A','G1'),
                            ('P1',80,'B','G1'),('P2',20,'B','G1'),('P1',100,'A','G3');
                    """)
                    totals = fixture.execute("SELECT SUM(budget),COUNT(*) FROM grants WHERE awarded_at LIKE '2024-%'").fetchone()
                fixture.close()
                composite_id = api("/databases/connect",a,dict(connection,name="Composite funding",database_name=str(composite)),201)["id"]
                composite_request = dict(objective,database_id=composite_id)
                generated = api("/dashboards/recommend",a,composite_request,201)
                widgets = json.loads(api("/dashboards/"+str(generated["dashboard_id"]),a)["layout_json"])["pages"][0]["widgets"]
                outputs = [api("/queries/ask",a,{"database_id":composite_id,"question":"__dashboard_reload__","sql_query":w["sql"]})["results"]["rows"] for w in widgets]
                for idx, expected in enumerate(([40,170,130],[1,.95,1.05])):
                    self.assertEqual(outputs[idx*2],[{"value":totals[idx]}])
                    rows = outputs[idx*2+1]
                    self.assertEqual([r["category"] for r in rows],[None,"Arts","Science"])
                    for row,value in zip(rows,expected):
                        self.assertAlmostEqual(row["value"],value)
                    self.assertAlmostEqual(sum(r["value"] for r in rows),totals[idx])
                keyless = source.with_name("keyless.db")
                with sqlite3.connect(keyless) as fixture:
                    fixture.execute("ATTACH DATABASE ? AS original",(str(composite),))
                    for table in ("grants","programs","splits"):
                        fixture.execute(f"CREATE TABLE {table} AS SELECT * FROM original.{table}")
                        self.assertFalse(any(col[5] for col in fixture.execute(f"PRAGMA table_info({table})")))
                    totals = fixture.execute("SELECT SUM(budget),COUNT(*) FROM grants WHERE awarded_at LIKE '2024-%'").fetchone()
                fixture.close()
                keyless_id = api("/databases/connect",a,dict(connection,name="Keyless funding",database_name=str(keyless)),201)["id"]
                keyless_request = dict(objective,database_id=keyless_id)
                def verify_keyless(generated):
                    widgets = json.loads(api("/dashboards/"+str(generated["dashboard_id"]),a)["layout_json"])["pages"][0]["widgets"]
                    results = [api("/queries/ask",a,{"database_id":keyless_id,"question":"__dashboard_reload__","sql_query":w["sql"]})["results"]["rows"] for w in widgets]
                    for i,expected in enumerate(([40,170,130],[1,.95,1.05])):
                        self.assertEqual(results[2*i],[{"value":totals[i]}])
                        groups = results[2*i+1]
                        self.assertEqual([r["category"] for r in groups],[None,"Arts","Science"])
                        for row,value in zip(groups,expected):
                            self.assertAlmostEqual(row["value"],value)
                        self.assertAlmostEqual(sum(r["value"] for r in groups),totals[i])
                verify_keyless(api("/dashboards/recommend",a,keyless_request,201))
                # Large native catalog: irrelevant empty tables must not block
                # differently named composite keys and weighted bridge inference.
                with sqlite3.connect(keyless) as fixture:
                    for index in range(150):
                        fixture.execute(f"CREATE TABLE unrelated_{index}(code TEXT, description TEXT, amount REAL)")
                fixture.close()
                api(f"/databases/{keyless_id}/sync",a,{})
                verify_keyless(api("/dashboards/recommend",a,keyless_request,201))
                if os.getenv("DASHBOARD_BROWSER_TEST") == "1":
                    subprocess.run(["node", str(Path(__file__).with_name("browser.cjs")),base,str(database)],check=True,cwd=ROOT)
                large = source.with_name("large_keyless.db")
                with sqlite3.connect(large) as fixture:
                    fixture.executescript("CREATE TABLE observations(owner_ref INTEGER, reading REAL); CREATE TABLE owners(owner_code INTEGER, region TEXT);")
                    fixture.executemany("INSERT INTO owners VALUES (?,?)",[(i,f"Region {i}") for i in range(10)])
                    fixture.executemany("INSERT INTO observations VALUES (?,?)",[(i % 10,float(i % 7)) for i in range(100000)])
                    # Ordinary nonunique indexes aid execution but declare no keys.
                    fixture.executescript("CREATE INDEX observations_owner ON observations(owner_ref); CREATE INDEX owners_code ON owners(owner_code);")
                    for index in range(150):
                        fixture.execute(f"CREATE TABLE archive_{index}(code TEXT, note TEXT)")
                    expected = [dict(category=r[0],value=r[1]) for r in fixture.execute(
                        "SELECT region,SUM(reading) FROM observations JOIN owners ON owner_ref=owner_code GROUP BY region ORDER BY region")]
                    total = fixture.execute("SELECT SUM(reading) FROM observations").fetchone()[0]
                fixture.close()
                large_id = api("/databases/connect",a,dict(connection,name="Large keyless observations",database_name=str(large)),201)["id"]
                generated = api("/dashboards/recommend",a,{"database_id":large_id,"objective":"total observations reading by region"},201)
                widgets = json.loads(api("/dashboards/"+str(generated["dashboard_id"]),a)["layout_json"])["pages"][0]["widgets"]
                results = [api("/queries/ask",a,{"database_id":large_id,"question":"__dashboard_reload__","sql_query":w["sql"]})["results"]["rows"] for w in widgets]
                self.assertEqual(results,[[{"value":total}],expected])
                self.assertEqual(sum(r["value"] for r in results[1]),total)
                with sqlite3.connect(keyless) as fixture:
                    fixture.execute("ALTER TABLE grants ADD COLUMN alternate TEXT")
                    fixture.execute("UPDATE grants SET alternate=serial")
                fixture.close()
                api(f"/databases/{keyless_id}/sync",a,{})
                before = api("/dashboards",a)
                prompt = api("/dashboards/recommend",a,keyless_request,422)["clarification"]
                self.assertEqual(api("/dashboards",a),before)
                self.assertEqual(len(prompt["options"]),2)
                chosen_key = next(option for option in prompt["options"] if "grants.serial" in option)
                verify_keyless(api("/dashboards/recommend",a,dict(keyless_request,choices={prompt["key"]:chosen_key}),201))
                # Each orphan component exists individually, but ('A','G2') is not a parent tuple.
                with sqlite3.connect(composite) as fixture:
                    fixture.execute("INSERT INTO splits VALUES ('P1',100,'A','G2')")
                fixture.close()
                rejected = api("/dashboards/recommend",a,composite_request,422)
                self.assertNotIn("clarification",rejected)
                with sqlite3.connect(composite) as fixture:
                    fixture.execute("DELETE FROM splits WHERE scope='A' AND origin='G2'")
                    fixture.execute("ALTER TABLE splits ADD COLUMN alternative TEXT")
                    fixture.execute("UPDATE splits SET alternative=origin")
                fixture.close()
                api(f"/databases/{composite_id}/sync",a,{})
                before = api("/dashboards",a)
                prompt = api("/dashboards/recommend",a,composite_request,422)["clarification"]
                self.assertEqual(api("/dashboards",a),before)
                self.assertEqual(len(prompt["options"]),2)
                original = next(option for option in prompt["options"] if "splits.origin" in option)
                resumed = api("/dashboards/recommend",a,dict(composite_request,choices={prompt["key"]:original}),201)
                self.assertEqual(resumed["widget_count"],4)
                with sqlite3.connect(weighted) as fixture:
                    fixture.execute("UPDATE splits SET allocation_pct=60 WHERE origin='G1' AND destination='P2'")
                fixture.close()
                before = api("/dashboards",a)
                invalid = api("/dashboards/recommend",a,weighted_request,422)
                self.assertIn("sum to 1 or 100",invalid["error"])
                self.assertEqual(api("/dashboards",a),before)
                with sqlite3.connect(weighted) as fixture:
                    fixture.execute("ALTER TABLE splits ADD COLUMN budget_share REAL")
                    fixture.execute("UPDATE splits SET budget_share=CASE WHEN origin='G1' AND destination='P2' THEN 70 ELSE allocation_pct END")
                fixture.close()
                api(f"/databases/{weighted_id}/sync",a,{})
                prompt = api("/dashboards/recommend",a,weighted_request,422)["clarification"]
                self.assertCountEqual(prompt["options"],["budget_share","allocation_pct"])
                api("/dashboards/recommend",a,dict(weighted_request,choices={prompt["key"]:"budget_share"}),201)
                # A profiling budget failure must be explicit and atomic: no
                # partially generated report may appear in the account.
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1",0))
                    budget_port = sock.getsockname()[1]
                budget_server = subprocess.Popen(["node",str(ROOT / "backend/server.js")],cwd=temp,
                    env=dict(env,PORT=str(budget_port),MAX_INFERENCE_QUERIES="1"))
                normal_base = base
                base = f"http://127.0.0.1:{budget_port}/api"
                try:
                    for _ in range(100):
                        try:
                            api("/health")
                            break
                        except URLError:
                            time.sleep(.1)
                    before = api("/dashboards",a)
                    failure = api("/dashboards/recommend",a,keyless_request,422)
                    self.assertIn("profiling budget",failure["error"])
                    self.assertEqual(api("/dashboards",a),before)
                finally:
                    base = normal_base
                    budget_server.terminate()
                    budget_server.wait(timeout=8)
            finally:
                server.terminate()
                server.wait(timeout=8)


if __name__ == "__main__":
    unittest.main()
