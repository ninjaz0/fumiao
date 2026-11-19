"""Serve the Python Studio fallback with contribution execution retired."""

from importlib.abc import MetaPathFinder
from importlib.machinery import SourceFileLoader
from importlib.util import spec_from_file_location
import os
from pathlib import Path
import runpy
import sys


# Adapt only verified runtime sources and fail startup if a pinned call site moves.
# The oracle still loads all of its original modules, including worker_pool.
PATCHES = {
    "server": (
        ("from worker_pool_api import router as worker_pool_router\n", ""),
        ("app.include_router(worker_pool_router)\n", ""),
        ("WHERE n.control!='removed' ORDER BY n.id DESC",
         "WHERE n.control!='removed' AND n.id NOT IN (SELECT node FROM studio_retired_nodes) ORDER BY n.id DESC"),
        ('        for j in reversed(jobs):',
         '        retired = {row[0] for row in con.execute("SELECT job FROM studio_retired_jobs")}\n'
         '        for j in reversed(jobs):\n'
         '            if j["id"] in retired: continue'),
        ('        if request.method == "POST":\n            if j["status"] != "queued":',
         '        if request.method == "POST":\n'
         '            if con.execute("SELECT 1 FROM studio_retired_jobs WHERE job=?", (i,)).fetchone():\n'
         '                fail(409, "原贡献任务结果待核对")\n'
         '            if j["status"] != "queued":'),
    ),
    "worker_api": (
        ("import worker_pool\n", ""),
        ('    with db(True) as con:\n        p = con.execute(',
         '    with db(True) as con:\n'
         '        if con.execute("SELECT 1 FROM nodes n JOIN studio_retired_nodes r ON r.node=n.id WHERE n.key=?", (key,)).fetchone():\n'
         '            fail(403, "实例凭据已撤销")\n'
         '        p = con.execute('),
        ('SELECT * FROM nodes WHERE key=? AND control!=\'removed\'',
         'SELECT * FROM nodes WHERE key=? AND control!=\'removed\' AND id NOT IN (SELECT node FROM studio_retired_nodes)'),
        ('SELECT * FROM jobs WHERE status=\'queued\' ORDER BY id',
         'SELECT * FROM jobs WHERE status=\'queued\' AND id NOT IN (SELECT job FROM studio_retired_jobs) ORDER BY id'),
        ('            if not worker_pool.can_claim(con,n,j):continue\n', ''),
        ('            worker_pool.assigned(con, n, current)\n', ''),
        ('            worker_pool.settle_reward(con, i)\n', ''),
        ("UPDATE nodes SET control=? WHERE id=? AND control!='removed'",
         "UPDATE nodes SET control=? WHERE id=? AND control!='removed' AND id NOT IN (SELECT node FROM studio_retired_nodes)"),
    ),
    "credits": (
        ("    from worker_pool import reserve_funds\n"
         "    reserve_funds(con, jid, job['workspace'], amount, already_reserved=True)\n", ""),
    ),
    "core": (
        ("        from worker_pool import migrate as migrate_worker_pool\n"
         "        migrate_worker_pool(con)\n",
         "        from studio_python_compat import archive_contributions\n"
         "        archive_contributions(con)\n"),
        ("    from worker_pool import reap_flow\n    reap_flow(con, ts)\n", ""),
        ("SELECT count(*) FROM jobs WHERE status IN ('queued','running')",
         "SELECT count(*) FROM jobs WHERE status IN ('queued','running') AND id NOT IN (SELECT job FROM studio_retired_jobs)"),
        ("AND status='running' AND lease<?",
         "AND status='running' AND lease<? AND id NOT IN (SELECT job FROM studio_retired_jobs)", 2),
        ("WHERE control='draining'\n        AND NOT EXISTS",
         "WHERE control='draining' AND id NOT IN (SELECT node FROM studio_retired_nodes)\n        AND NOT EXISTS"),
    ),
    "profiles": (
        ("node IN (SELECT id FROM nodes WHERE owner=?)",
         "node IN (SELECT id FROM nodes WHERE owner=?) AND id NOT IN (SELECT job FROM studio_retired_jobs)", 2),
        ("UPDATE nodes SET control='removed',stage='offline' WHERE owner=?",
         "UPDATE nodes SET control='removed',stage='offline' WHERE owner=? AND id NOT IN (SELECT node FROM studio_retired_nodes)"),
    ),
    "flow_provider": (
        ("        import worker_pool\n"
         "        if worker_pool.has_ready_flow(con,row['model']):return False\n", ""),
        ("AND model LIKE 'flow:%' AND status IN ('queued','running')",
         "AND model LIKE 'flow:%' AND status IN ('queued','running') AND id NOT IN (SELECT job FROM studio_retired_jobs)"),
        ("        inputs = {'source_job':source_id,'source_media_id':metadata['flow_media_id']}",
         "        if con.execute('SELECT 1 FROM studio_retired_jobs WHERE job=?', (source_id,)).fetchone():\n"
         "            fail(400, '独立 Flow 无法续写原贡献节点生成的视频')\n"
         "        inputs = {'source_job':source_id,'source_media_id':metadata['flow_media_id']}"),
        ("        for key in json.loads(job['refs']):",
         "        if inputs.get('source_job') and con.execute(\n"
         "            'SELECT 1 FROM studio_retired_jobs WHERE job=?', (inputs['source_job'],)\n"
         "        ).fetchone():\n"
         "            raise FlowError('独立 Flow 无法续写原贡献节点生成的视频')\n"
         "        for key in json.loads(job['refs']):"),
        ("WHERE j.status='running' AND f.state=",
         "WHERE j.status='running' AND j.id NOT IN (SELECT job FROM studio_retired_jobs) AND f.state=", 2),
        ('WHERE j.status=\'queued\' AND "+model_policy.allowed_sql',
         'WHERE j.status=\'queued\' AND j.id NOT IN (SELECT job FROM studio_retired_jobs) AND "+model_policy.allowed_sql'),
        ("AND status='queued' AND owner IN (SELECT id FROM users WHERE active=0)",
         "AND status='queued' AND id NOT IN (SELECT job FROM studio_retired_jobs) AND owner IN (SELECT id FROM users WHERE active=0)"),
    ),
    "timing": (
        ("SELECT * FROM nodes WHERE control!='removed'",
         "SELECT * FROM nodes WHERE control!='removed' AND id NOT IN (SELECT node FROM studio_retired_nodes)"),
        ("def queue_estimates(con, jobs, nodes, runs, estimator, stamp):\n",
         "def queue_estimates(con, jobs, nodes, runs, estimator, stamp):\n"
         "    retired = {row[0] for row in con.execute('SELECT job FROM studio_retired_jobs')}\n"
         "    jobs = [job for job in jobs if job['id'] not in retired]\n"),
    ),
}


def archive_contributions(con):
    # Archive rows remain the source of truth for revocation, even for disabled
    # nodes and jobs requeued by the old reaper with their lease cleared.
    tables = {row[0] for row in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('fm_resources','fm_assignments','fm_rewards','fm_usage')"
    )}
    node_sources = [f"SELECT node FROM {table} WHERE node IS NOT NULL"
                    for table in ("fm_resources", "fm_assignments", "fm_usage") if table in tables]
    rewarded_jobs = ""
    if "fm_rewards" in tables:
        node_sources.append("SELECT n.id FROM nodes n JOIN fm_rewards r ON r.node=n.id AND r.owner=n.owner")
        rewarded_jobs = " UNION SELECT job FROM fm_rewards"
    assigned_jobs = (
        " UNION SELECT j.id FROM jobs j JOIN fm_assignments a ON a.job=j.id"
        " WHERE j.status='queued' OR (j.node=a.node AND j.ticket=a.ticket)"
        if "fm_assignments" in tables else ""
    )
    con.execute("DROP VIEW IF EXISTS studio_retired_jobs")
    con.execute("DROP VIEW IF EXISTS studio_retired_nodes")
    con.execute(
        "CREATE VIEW studio_retired_nodes(node) AS " + (" UNION ".join(node_sources) or "SELECT NULL WHERE 0")
    )
    con.execute(
        "CREATE VIEW studio_retired_jobs(job) AS"
        " SELECT j.id FROM jobs j JOIN studio_retired_nodes n ON n.node=j.node"
        " UNION SELECT job FROM flow_tasks WHERE state='worker'" + assigned_jobs + rewarded_jobs
    )
    # Existing accounting rows remain intact. Normal credits use their own
    # triggers and no longer update contribution-only funding or holds.
    for trigger in ("fm_account", "fm_paid_in", "fm_adjust_out", "fm_fund_settle"):
        con.execute(f"DROP TRIGGER IF EXISTS {trigger}")


class CompatSource(SourceFileLoader):
    def __init__(self, name, path, source):
        super().__init__(name, str(path))
        self.source = source

    def get_code(self, fullname):
        return self.source_to_code(self.source, self.path)


class CompatImports(MetaPathFinder):
    def __init__(self, app):
        if PATCHES.keys() & sys.modules.keys():
            raise RuntimeError("Studio compatibility must load before the pinned application")
        self.loaders = {}
        for module, patches in PATCHES.items():
            path = app / f"{module}.py"
            source = path.read_text(encoding="utf-8")
            for before, after, *count in patches:
                if source.count(before) != (count[0] if count else 1):
                    raise RuntimeError(f"Studio compatibility source changed: {module}: {before.strip()}")
                source = source.replace(before, after)
            self.loaders[module] = CompatSource(module, path, source)

    def find_spec(self, fullname, path=None, target=None):
        loader = self.loaders.get(fullname)
        if loader:
            return spec_from_file_location(fullname, loader.path, loader=loader)
        return None


def main():
    script = Path(__file__).resolve()
    oracle = runpy.run_path(str(script.with_name("preview-original.py")))
    start_flow = os.getenv("STUDIO_PYTHON_FLOW_AUTOSTART") == "1"

    def configure(app):
        sys.modules["studio_python_compat"] = sys.modules[__name__]
        sys.meta_path.insert(0, CompatImports(app))
        if start_flow:
            os.environ["FUMIAO_FLOW_AUTOSTART"] = "1"

    oracle["main"](
        runtime_directory=script.parents[1] / ".runtime-advanced" / "original",
        configure=configure,
        reuse_local_credentials=True,
        description=__doc__,
    )


if __name__ == "__main__":
    main()
