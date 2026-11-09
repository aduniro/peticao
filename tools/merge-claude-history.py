#!/usr/bin/env python3
"""Unifica, num só arquivo, o histórico antigo (projeto em /media/barre/Expansion/peticao) e o novo
(/mnt/apps/peticao-final/peticao) da mesma sessão (mesmo session id), sem perder nenhuma linha.

Regras:
  * Linhas são tratadas como BYTES: nada é reinterpretado nem reescrito, exceto UM campo (parentUuid) da
    primeira(s) mensagem(ns) exclusiva(s) do ramo novo, que passa(m) a apontar para a ponta do ramo antigo.
    Isso transforma os dois ramos numa cadeia só, para `claude --resume` abrir com o contexto completo.
  * Resultado = linhas do antigo (todas, na ordem) + linhas exclusivas do novo (a partir da divergência).
  * Antes de substituir o arquivo novo, os dois originais são copiados para uma pasta de backup.
  * Depois de gravar, o script confere linha a linha e aborta (sem substituir) se algo não bater.

Uso: merge-claude-history.py <sessionId> [--dry-run]
"""
import hashlib, json, os, shutil, sys, time

OLD_DIR = os.path.expanduser("~/.claude/projects/-media-barre-Expansion-peticao")
NEW_DIR = os.path.expanduser("~/.claude/projects/-mnt-dev-peticao")
BACKUP_ROOT = "/mnt/apps/peticao-final/peticao/.cache/history-backup"
CHAIN_TYPES = ("user", "assistant", "system", "attachment")


def read_lines(path):
    with open(path, "rb") as fh:
        data = fh.read()
    lines = data.splitlines(keepends=True)
    return data, lines


def parse(line):
    try:
        return json.loads(line)
    except Exception:
        return None


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    sid = sys.argv[1]
    dry = "--dry-run" in sys.argv
    old_p = f"{OLD_DIR}/{sid}.jsonl"
    new_p = f"{NEW_DIR}/{sid}.jsonl"

    # 1) a sessão antiga precisa estar parada
    s1 = os.path.getsize(old_p); time.sleep(3); s2 = os.path.getsize(old_p)
    if s1 != s2:
        sys.exit("ABORTADO: o arquivo antigo ainda está sendo gravado.")

    old_data, old_lines = read_lines(old_p)
    new_data, new_lines = read_lines(new_p)
    if old_lines and not old_lines[-1].endswith(b"\n"):
        old_lines[-1] += b"\n"
    if new_lines and not new_lines[-1].endswith(b"\n"):
        new_lines[-1] += b"\n"

    # 2) prefixo comum
    k = 0
    for a, b in zip(old_lines, new_lines):
        if a != b:
            break
        k += 1
    new_only = new_lines[k:]
    print(f"antigo: {len(old_lines)} linhas | novo: {len(new_lines)} linhas | prefixo comum: {k} | exclusivas do novo: {len(new_only)}")

    # 3) ponta do ramo antigo (última linha encadeável, fora de sidechain)
    leaf = None
    old_uuids = set()
    for ln, l in enumerate(old_lines, 1):
        d = parse(l)
        if not d:
            continue
        if d.get("uuid"):
            old_uuids.add(d["uuid"])
        if d.get("type") in CHAIN_TYPES and d.get("uuid") and not d.get("isSidechain"):
            leaf = (ln, d["uuid"], d["type"], d.get("timestamp"))
    print("ponta do ramo antigo:", leaf)

    # 4) raiz(es) do ramo novo: linhas exclusivas cujo parentUuid existe no antigo (ponto de bifurcação)
    roots = []
    for i, l in enumerate(new_only):
        d = parse(l)
        if d and d.get("uuid") and d.get("parentUuid") in old_uuids:
            roots.append((i, d["parentUuid"], d["type"], d.get("timestamp")))
    print("raízes do ramo novo (índice, pai no antigo, tipo, hora):", roots)
    if not roots:
        sys.exit("ABORTADO: não achei onde o ramo novo se liga ao antigo.")
    fork = roots[0][1]
    if any(r[1] != fork for r in roots):
        sys.exit("ABORTADO: o ramo novo se liga ao antigo em mais de um ponto.")

    # 5) re-encadeia: parentUuid do fork -> ponta do antigo, SOMENTE nessas linhas, exatamente 1 ocorrência cada
    pat = b'"parentUuid":"' + fork.encode() + b'"'
    rep = b'"parentUuid":"' + leaf[1].encode() + b'"'
    edited = set()
    for i, *_ in roots:
        if new_only[i].count(pat) != 1:
            sys.exit(f"ABORTADO: padrão do parentUuid não aparece exatamente 1 vez na linha {i}.")
        new_only[i] = new_only[i].replace(pat, rep)
        edited.add(i)

    merged_lines = old_lines + new_only
    print(f"resultado: {len(merged_lines)} linhas ({len(old_lines)} + {len(new_only)}); linhas re-encadeadas: {len(edited)}")

    # 6) conferência em memória antes de escrever
    assert merged_lines[: len(old_lines)] == old_lines
    orig_new_only = new_lines[k:]
    assert len(orig_new_only) == len(new_only)
    for i, (a, b) in enumerate(zip(orig_new_only, new_only)):
        if i in edited:
            assert a.replace(pat, rep) == b
        else:
            assert a == b
    chain = {}
    for l in merged_lines:
        d = parse(l)
        if d and d.get("uuid"):
            chain[d["uuid"]] = d.get("parentUuid")
    tail = None
    for l in reversed(merged_lines):
        d = parse(l)
        if d and d.get("type") in CHAIN_TYPES and d.get("uuid") and not d.get("isSidechain"):
            tail = d["uuid"]; break
    steps, cur, seen, passes_leaf = 0, tail, set(), False
    while cur and cur in chain and cur not in seen:
        seen.add(cur); steps += 1
        if cur == leaf[1]:
            passes_leaf = True
        cur = chain[cur]
    print(f"cadeia da última mensagem até a raiz: {steps} mensagens; passa pela ponta do antigo: {passes_leaf}")
    if not passes_leaf:
        sys.exit("ABORTADO: a cadeia unificada não passa pela ponta do ramo antigo.")

    if dry:
        print("DRY-RUN: nada foi gravado."); return

    # modo --out <arquivo>: grava SÓ a cópia unificada num caminho separado; não toca em nenhum histórico existente
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
        os.makedirs(os.path.dirname(out), exist_ok=True)
        tmp_out = out + ".tmp"
        with open(tmp_out, "wb") as fh:
            fh.writelines(merged_lines)
            fh.flush(); os.fsync(fh.fileno())
        os.chmod(tmp_out, 0o600)
        got = open(tmp_out, "rb").read()
        assert got == b"".join(merged_lines), "conteúdo gravado diverge do esperado"
        os.replace(tmp_out, out)
        print(f"OK: cópia unificada gravada em {out} ({len(got.splitlines())} linhas, {len(got)} bytes)")
        print("sha256:", sha(got))
        print("Nenhum histórico existente foi alterado.")
        return

    # 7) backups
    stamp = time.strftime("%Y%m%d-%H%M%S")
    bdir = f"{BACKUP_ROOT}/{stamp}"
    os.makedirs(bdir, exist_ok=True)
    shutil.copy2(old_p, f"{bdir}/antigo-{sid}.jsonl")
    shutil.copy2(new_p, f"{bdir}/novo-{sid}.jsonl")
    assert sha(open(f"{bdir}/antigo-{sid}.jsonl", "rb").read()) == sha(old_data)
    assert sha(open(f"{bdir}/novo-{sid}.jsonl", "rb").read()) == sha(new_data)
    print("backups verificados em", bdir)

    # 8) grava num temporário no mesmo diretório do destino
    tmp = f"{new_p}.merge.tmp"
    with open(tmp, "wb") as fh:
        fh.writelines(merged_lines)
        fh.flush(); os.fsync(fh.fileno())
    # a sessão atual pode ter gravado no destino durante o processo: anexa o que chegou depois da leitura
    cur_size = os.path.getsize(new_p)
    if cur_size > len(new_data):
        with open(new_p, "rb") as fh:
            fh.seek(len(new_data)); delta = fh.read()
        with open(tmp, "ab") as fh:
            fh.write(delta); fh.flush(); os.fsync(fh.fileno())
        print(f"anexados {len(delta)} bytes gravados pela sessão atual durante a unificação")
    os.chmod(tmp, 0o600)

    # 9) conferência do arquivo gravado e troca atômica
    got = open(tmp, "rb").read()
    expect = b"".join(merged_lines)
    assert got.startswith(expect), "conteúdo gravado diverge do esperado"
    os.replace(tmp, new_p)
    print(f"OK: {new_p} agora tem {len(got.splitlines())} linhas ({len(got)} bytes)")
    print("sha256 do antigo (backup):", sha(old_data))


if __name__ == "__main__":
    main()
