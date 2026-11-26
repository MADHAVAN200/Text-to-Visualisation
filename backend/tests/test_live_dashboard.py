"""Run against an already provisioned isolated fixture. Credentials come from a JSON file."""
import json
import os
from urllib.request import Request, urlopen

# The API server must be running. LIVE_CONNECTION_FILE contains the normal
# /databases/connect payload. LIVE_AUTH_TOKEN belongs to a disposable test user.
base = os.environ["LIVE_API_BASE"]
token = os.environ["LIVE_AUTH_TOKEN"]
def api(path, body=None):
    request = Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                      headers={"Content-Type":"application/json","Authorization":"Bearer "+token})
    with urlopen(request, timeout=240) as response:
        return json.load(response)

with open(os.environ["LIVE_CONNECTION_FILE"]) as file:
    connection = json.load(file)
database = api("/databases/connect",connection)["id"]
schema = api(f"/databases/{database}/schema")
assert set(schema) == {"grants","programs","splits"}
assert all(not c["isPrimary"] and not c["isForeign"] for table in schema.values() for c in table)
report = api("/dashboards/recommend",{"database_id":database,
    "objective":"Show me a dashboard of total budget and count of grants by sector in 2024"})
widgets = json.loads(api("/dashboards/"+str(report["dashboard_id"]))["layout_json"])["pages"][0]["widgets"]
assert len(widgets) == 4
def execute(sql):
    return api("/queries/ask",{"database_id":database,"question":"__dashboard_reload__","sql_query":sql})["results"]["rows"]
source = execute("SELECT SUM(budget) AS budget, COUNT(*) AS records FROM grants WHERE awarded_at >= '2024-01-01' AND awarded_at < '2025-01-01'")[0]
for i, expected in enumerate(([40,170,130],[1,.95,1.05])):
    rows = sorted(execute(widgets[2*i+1]["sql"]),key=lambda r:r["category"] or "")
    assert [r["category"] for r in rows] == [None,"Arts","Science"]
    assert all(abs(row["value"]-value)<1e-7 for row,value in zip(rows,expected))
    total = source["budget" if i == 0 else "records"]
    assert abs(sum(r["value"] for r in rows)-total)<1e-7
    assert abs(execute(widgets[2*i]["sql"])[0]["value"]-total)<1e-7
print("Saved dashboard matches source",source)
