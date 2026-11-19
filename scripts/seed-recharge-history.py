"""Add terminal recharge and contribution fixtures to the temporary pinned database."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import uuid

root = Path(sys.argv[1])
configs = json.loads((root / "payments.json").read_text())
with sqlite3.connect(root / "studio.sqlite") as con:
    owner, workspace = con.execute(
        "SELECT id,default_workspace FROM users WHERE name='admin'"
    ).fetchone()
    config = configs["alipay"]
    merchant = hashlib.sha256((config["gateway"] + "|" + config["pid"]).encode()).hexdigest()
    for index in range(35):
        created = 1_700_000_000 + index
        oid = f"FM{created}{index:016x}"
        con.execute(
            """INSERT INTO recharge_orders
               (id,uid,owner,workspace,method,merchant,amount,credits,state,checkout,created,expires)
               VALUES(?,?,?,?,'alipay',?,100,10,'expired',?,?,?)""",
            (oid, str(uuid.uuid5(uuid.NAMESPACE_URL, oid)), owner, workspace, merchant,
             config["gateway"] + "/expired", created, created + 1800),
        )


# Reserve and settle a historical consumption charge. Seed the old fractional
# contribution history directly so the recharge check can run after retirement.
for key in list(os.environ):
    if key.startswith("FUMIAO_") or key == "OPENAI_API_KEY":
        del os.environ[key]
os.environ["FUMIAO_DATA"] = str(root)
sys.path.insert(0, str(root.parent / "app"))
import core
import credits

with core.db(True) as con:
    worker, earnings_workspace = con.execute(
        "SELECT id,default_workspace FROM users WHERE name='member'"
    ).fetchone()
    node = con.execute(
        "INSERT INTO nodes(owner,name,key,stage,lastseen) VALUES(?,?,?,'ready',?)",
        (worker, "Synthetic historical contributor", core.hashed(core.token()), core.now()),
    ).lastrowid
    con.execute(
        "INSERT INTO fm_resources(node,kind,enabled,created) VALUES(?,'breeze',1,?)",
        (node, core.now()),
    )
    job = con.execute(
        """INSERT INTO jobs(uid,owner,workspace,prompt,refs,kind,model,status,created,updated,node,ticket)
        VALUES(?,?,?,'Synthetic local task','[]','audio','breeze-tts-2','running',?,?,?,?)""",
        (core.token(), owner, workspace, core.now(), core.now(), node, core.token()),
    ).lastrowid
    credits.reserve(con, job)
    con.execute("UPDATE jobs SET status='done' WHERE id=?", (job,))
    con.execute(
        "INSERT INTO fm_rewards(job,node,owner,workspace,units,credited,created) VALUES(?,?,?,?,7000,0,?)",
        (job, node, worker, earnings_workspace, core.now()),
    )
    con.execute("INSERT INTO fm_reward_remainders(workspace,units) VALUES(?,7000)", (earnings_workspace,))
    con.execute("DELETE FROM jobs WHERE id=?", (job,))
