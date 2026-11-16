#!/usr/bin/python3
"""Read operational metadata only. Never initialize the application or its DB."""
import collections
import datetime as dt
import json
import sqlite3
import subprocess
from pathlib import Path

PROJECT = Path("/mnt/apps/peticao-final/peticao")
STATE = Path("/mnt/apps/peticao-final/_externos/home/barre/.local/state/peticao-monitor")
PRIMARY = ("admin-v2-progresso-arvore", "admin-v2-govbr-base", "admin-v2-stage02", "deploy-pagina-revisada-20261109", "normalizacao-instituicoes", "consolidacao-pagina-principal", "instituicoes-siglas-dominios-20261109", "instituicoes-siglas-maiusculas-20261109", "ebserh-hospital-cidade-20261109", "seletores-clique-completo-20261109")
ACTIVE = {"running", "queued", "waiting", "interrupted"}
NOW = dt.datetime.now(dt.timezone.utc)


def query_monitor(path):
    conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA query_only=ON")
        conn.execute("BEGIN")
        tasks = [dict(x) for x in conn.execute("SELECT id,title,state,cwd,environment,scope,stage,eta,created_at,updated_at FROM tasks ORDER BY created_at")]
        steps = [dict(x) for x in conn.execute("SELECT task_id,id,parent,title,state,weight,started_at,finished_at,updated_at,eta FROM steps ORDER BY task_id,rowid")]
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        workflow = [dict(x) for x in conn.execute("SELECT task_id,id,title,state FROM workflow_steps ORDER BY task_id,position")] if "workflow_steps" in tables else []
        conn.rollback()
        return tasks, steps, workflow
    finally:
        conn.close()


def percentage(steps):
    parents = {s["parent"] for s in steps if s.get("parent")}
    leaves = [s for s in steps if s["id"] not in parents]
    total = sum(float(s.get("weight") or 0) for s in leaves)
    return round(100 * sum(float(s.get("weight") or 0) for s in leaves if s["state"] == "completed") / total, 1) if total > 0 else None


def age(value):
    try:
        timestamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=dt.timezone.utc)
        return max(0, int((NOW - timestamp).total_seconds()))
    except (ValueError, TypeError, AttributeError):
        return None


def git_metadata(directory):
    info = {"path": str(directory)}
    try:
        def git(*args):
            return subprocess.check_output(["/usr/bin/git", "-C", str(directory), *args], text=True, stderr=subprocess.DEVNULL, timeout=8).strip()
        info.update(branch=git("branch", "--show-current"), head=git("rev-parse", "HEAD"), subject=git("show", "-s", "--format=%s", "HEAD"), modified_app_paths=len(git("status", "--porcelain", "--", "site").splitlines()))
    except (OSError, subprocess.SubprocessError):
        info["unavailable"] = True
    return info


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def qa_metadata(directory):
    reports = directory / "reports"
    if not reports.is_dir():
        return None
    out = {"path": str(directory), "checks": {}}
    ref = directory / "source-ref.txt"
    if ref.is_file():
        out["source_reference"] = ref.read_text()[:300].strip()
    for key in ("build", "typecheck", "unit", "browser", "fixtures"):
        f = reports / (key + ".exit")
        if f.is_file():
            try:
                out["checks"][key] = {"exit_code": int(f.read_text().strip()), "recorded_at": dt.datetime.fromtimestamp(f.stat().st_mtime, dt.timezone.utc).isoformat()}
            except (OSError, ValueError):
                out["checks"][key] = {"unreadable": True}
    browser = read_json(reports / "browser-results.json")
    if isinstance(browser, dict):
        out["browser_cases_recorded"] = len(browser.get("cases", []))
        out["browser_errors_recorded"] = len(browser.get("errors", []))
    return out



def read_tree(pointer, tasks, steps):
    """Read reviewed milestone snapshot; overlay only current recorded states."""
    result = {"available": False, "reason": "Snapshot indisponível; nenhum percentual inventado."}
    try:
        folder = Path(pointer.read_text().strip()).resolve()
        allowed = (PROJECT / ".cache/admin-v2-retomada-20261109").resolve()
        if not folder.is_relative_to(allowed):
            return result
        path = folder / "progresso.json"
        if path.stat().st_size > 5 * 1024 * 1024:
            return result
        snapshot = json.loads(path.read_text())
        if not isinstance(snapshot.get("commit"), str) or len(snapshot["commit"]) != 40:
            return result
        own = {s["id"]: s for s in steps if s["task_id"] == "admin-v2-progresso-arvore"}
        task = next((t for t in tasks if t["id"] == "admin-v2-progresso-arvore"), {})
        rows = []
        def state(key, fallback):
            current = own.get(key)
            return STATES_TREE.get(current.get("state"), "parado") if current else ("planejado sem implementação iniciada" if fallback == 0 else "parado")
        def group_state(children):
            if any(x["state"] == "em execução registrada" for x in children):
                return "em execução registrada"
            if children and all(x["state"] == "planejado sem implementação iniciada" for x in children):
                return "planejado sem implementação iniciada"
            return "parado"
        sections = []
        for section in snapshot["sections"]:
            modules = []
            for module in section["modules"]:
                functions = []
                for f in module["functions"]:
                    criteria = f["criteria"]
                    if not isinstance(criteria, dict) or len(criteria) != 4 or not all(type(v) is bool for v in criteria.values()):
                        raise ValueError("invalid milestone criteria")
                    percent = 25 * sum(criteria.values())
                    functions.append({"id": f["id"], "title": f["title"], "percent": percent, "state": state("f-" + f["id"], percent), "note": f.get("note", ""), "evidence": f.get("evidence", [])})
                percent = sum(f["percent"] for f in functions) / len(functions)
                modules.append({"id": module["id"], "title": module["title"], "percent": percent, "state": group_state(functions), "functions": functions})
            percent = sum(m["percent"] for m in modules) / len(modules)
            sections.append({"id": section["id"], "title": section["title"], "percent": percent, "state": group_state(modules), "modules": modules})
        return {"available": True, "path": str(path), "snapshot_at": snapshot["at"], "commit": snapshot["commit"], "method": snapshot["method"], "percent": sum(s["percent"] for s in sections) / len(sections), "sections": sections, "recorded_at": task.get("updated_at"), "recorded_state": task.get("state"), "recorded_stale": age(task.get("updated_at")) is None or age(task.get("updated_at")) > 600, "state_policy": "Estados são registros atuais do Vigia, não comprovação de agente ativo. Percentuais e evidências pertencem ao snapshot identificado; HEAD posterior não está automaticamente homologado."}
    except (OSError, ValueError, TypeError, KeyError, ZeroDivisionError):
        return result


STATES_TREE = {"running": "em execução registrada", "queued": "planejado sem implementação iniciada", "completed": "parado", "waiting": "parado", "paused": "parado", "interrupted": "parado", "failed": "parado"}


def progress_index(rows):
    """Same weighted leaf rule as Store.progress, memoized; never constructs Store."""
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != len(rows):
        raise ValueError("duplicate step ID")
    children = collections.defaultdict(list)
    for row in rows:
        children[row.get("parent")].append(row["id"])
    memo, visiting = {}, set()
    def rollup(key):
        if key in memo:
            return memo[key]
        if key in visiting:
            raise ValueError("cyclic progress tree")
        visiting.add(key)
        sub = children.get(key, [])
        if sub:
            pairs = [rollup(child) for child in sub]
            value = (sum(x[0] for x in pairs), sum(x[1] for x in pairs))
        else:
            weight = float(by_id[key]["weight"])
            if not 0 < weight <= 100000:
                raise ValueError("invalid leaf weight")
            value = (weight if by_id[key]["state"] == "completed" else 0, weight)
        visiting.remove(key)
        memo[key] = value
        return value
    for key in by_id:
        rollup(key)
    return by_id, children, memo


def live_tree(tasks, steps):
    import re
    own = [row for row in steps if row["task_id"] == "admin-v2-progresso-arvore"]
    task = next((row for row in tasks if row["id"] == "admin-v2-progresso-arvore"), {})
    try:
        by_id, children, totals = progress_index(own)
        roots = sorted((r for r in own if r.get("parent") is None and re.fullmatch(r"s-[0-9]+", r["id"])), key=lambda r: int(r["id"][2:]))
        if not roots or any(row.get("parent") is not None and row["parent"] not in by_id for row in own):
            raise ValueError("incomplete tree hierarchy")
        def item(row, prefix):
            done, total = totals[row["id"]]
            percent = 100 if done == total else 100 * done / total
            state = "concluído localmente" if percent == 100 else "em execução registrada" if row["state"] == "running" else "planejado sem implementação iniciada" if percent == 0 and row["state"] == "queued" else "aguardando" if row["state"] == "waiting" else "parado"
            return {"id": row["id"][len(prefix):], "title": row["title"], "percent": percent, "state": state, "recorded_state": row["state"], "updated_at": row.get("updated_at"), "note": "Calculado dos marcos e pesos atuais do Vigia.", "evidence": []}
        sections, seen = [], set()
        for root in roots:
            section = item(root, "s-"); section["modules"] = []; seen.add(root["id"])
            for mid in sorted(children[root["id"]], key=lambda k: [int(x) for x in k[2:].split(".")]):
                module_row = by_id[mid]
                if not re.fullmatch(r"m-[0-9]+\.[0-9]+", mid):
                    raise ValueError("invalid module")
                module = item(module_row, "m-"); module["functions"] = []; seen.add(mid)
                for fid in sorted(children[mid], key=lambda k: [int(x) for x in k[2:].split(".")]):
                    if not re.fullmatch(r"f-[0-9]+\.[0-9]+\.[0-9]+", fid):
                        raise ValueError("invalid function")
                    function = item(by_id[fid], "f-"); module["functions"].append(function); seen.add(fid)
                    stack = list(children[fid])
                    while stack:
                        child = stack.pop(); seen.add(child); stack.extend(children[child])
                if not module["functions"]:
                    raise ValueError("empty module")
                if any(f["recorded_state"] == "running" and f["percent"] < 100 for f in module["functions"]): module["state"] = "em execução registrada"
                section["modules"].append(module)
            if any(m["state"] == "em execução registrada" for m in section["modules"]): section["state"] = "em execução registrada"
            sections.append(section)
        if seen != set(by_id):
            raise ValueError("unmapped tree rows")
        done = sum(totals[root["id"]][0] for root in roots); total = sum(totals[root["id"]][1] for root in roots)
        return {"available": True, "path": str(STATE / "monitor.sqlite"), "source": "vigia_sqlite_read_only", "snapshot_at": NOW.isoformat(), "commit": "não aplicável — marcos atuais do Vigia", "method": "Folhas concluídas × pesos / todos os pesos, recursivamente, como Store.progress; valores sem arredondamento intermediário. Não usa percentuais textuais nem snapshot antigo.", "percent": 100 * done / total, "sections": sections, "recorded_at": task.get("updated_at"), "recorded_state": task.get("state"), "recorded_stale": age(task.get("updated_at")) is None or age(task.get("updated_at")) > 600, "state_policy": "Estados e marcos são registros atuais do Vigia; não comprovam agente ativo, publicação ou homologação real. 100% significa conclusão local do escopo registrado."}
    except (KeyError, ValueError, TypeError, ZeroDivisionError):
        return {"available": False, "reason": "Árvore atual do Vigia inválida ou incompleta; nenhum percentual antigo foi usado."}


def collect():
    tasks, steps, workflow = query_monitor(STATE / "monitor.sqlite")
    for task in tasks:
        own = [s for s in steps if s["task_id"] == task["id"]]
        flow = [s for s in workflow if s["task_id"] == task["id"]]
        task["progress"] = round(100 * sum(s["state"] == "completed" for s in flow) / len(flow), 1) if flow else percentage(own)
        task["steps"] = own
        task["seconds_since_creation"] = age(task["created_at"])
        task["seconds_since_update"] = age(task["updated_at"])
        task["stale"] = task["seconds_since_update"] is None or task["seconds_since_update"] > 600
        if own:
            _, _, totals = progress_index(own)
            for step in own:
                done, total = totals[step["id"]]
                step["progress"] = round(100 * done / total, 1) if total else None
                step["seconds_since_start"] = age(step.get("started_at"))
    primary = [t for t in tasks if t["id"] in PRIMARY]
    active = any(t["state"] in ACTIVE for t in primary)
    normalization = PROJECT / ".cache/normalizacao-instituicoes-20261109"
    summaries = []
    for name in ("inventario.json", "plano-campus-regiao.json", "plano-campus-regiao-v2.json"):
        value = read_json(normalization / name)
        if isinstance(value, dict):
            counts = value.get("summary", value.get("counts", {}))
            summaries.append({"source": str(normalization / name), "snapshot_at": value.get("snapshot_at", counts.get("snapshot_at")), "counts": counts, "changes_applied": value.get("changes_applied", False)})
    qa = PROJECT / ".cache/consolidacao-pagina-principal-20261109-qa"
    qa_sources = [qa] + sorted((p for p in qa.glob("fix-*") if p.is_dir()), key=lambda p: p.name)
    return {
        "generated_at": NOW.isoformat(),
        "tree": live_tree(tasks, steps),
        "active": active,
        "primary_tasks": primary,
        "other_running": [t for t in tasks if t["id"] not in PRIMARY and t["state"] in {"running", "queued"}],
        "paused_waiting": [t for t in tasks if t["id"] not in PRIMARY and t["state"] in {"paused", "waiting", "interrupted"}],
        "git": git_metadata(PROJECT / ".cache/admin-v2-final-20261109"),
        "qa": [v for p in qa_sources if (v := qa_metadata(p))],
        "normalization": summaries,
        "source_policy": "Vigia aberto em SQLite mode=ro e query_only=ON. Somente metadados operacionais e contagens; nenhum cadastro individual, segredo ou log bruto é exportado. Não consulta nem modifica VPS/aplicação.",
    }


if __name__ == "__main__":
    print(json.dumps(collect(), ensure_ascii=False))
