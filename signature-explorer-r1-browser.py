"""Real explorer/client regressions, usable with fixture or compiled Next QA.

Only QA port3184; no writes and no production hosts. Optionally supply an
isolated fixture cookie file containing the fictional `token` for compiled QA.
Playwright and Chromium are operator-provided, never installed by this script.
"""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import parse_qs, urlencode, urlsplit

if os.environ.get("QA_PLAYWRIGHT_PYTHON_PATH"):
    import sys
    sys.path.insert(0, os.environ["QA_PLAYWRIGHT_PYTHON_PATH"])
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base", default="http://127.0.0.1:3184")
parser.add_argument("--output-dir", type=Path, required=True)
parser.add_argument("--cookies-file", type=Path)
parser.add_argument("--chromium", required=True)
parser.add_argument("--mode", choices=["development-fixture", "compiled-next"], required=True)
args = parser.parse_args()
base = args.base.rstrip("/")
parsed_base = urlsplit(base)
assert parsed_base.scheme == "http" and parsed_base.port == 3184
address = ipaddress.ip_address(parsed_base.hostname)
assert address.is_loopback or address in ipaddress.ip_network("100.64.0.0/10")
os.umask(0o077)
args.output_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
results = {"mode": args.mode, "base": base, "checks": [], "pageErrors": [], "blockedWrites": [], "externalRequestsBlocked": 0}


def fixture(query, total=1, name="QA R1", status="confirmed"):
    page = int(query.get("pagina", ["1"])[0])
    limit = 50
    count = min(limit, max(0, total - (page - 1) * limit))
    rows = [{"id": (page - 1) * limit + i + 1, "nome": name, "categoria": "apoiador", "instituicao": "", "cargo": "", "regiao": "", "campus": "", "cidadeUf": "Porto Velho/RO", "pais": "", "status": status, "criada": "2026-11-14T00:00:00.000Z", "confirmada": "2026-11-14T00:01:00.000Z" if status == "confirmed" else None, "cpf": False, "whatsapp": "", "waConfirmado": False} for i in range(count)]
    return {"ok": True, "asOf": "2026-11-14T00:02:00.000Z", "capabilities": {"contacts": False}, "coverage": {"matched": total, "totalRowsReturned": count, "facetsComplete": True, "mapComplete": True, "complete": True}, "total": total, "linhas": rows, "pontos": [], "facetas": {k: [] for k in ["instituicao", "cargo", "campus", "pais", "universidade", "uf", "cidade"]}, "totais": {"confirmadas": total if status == "confirmed" else 0, "pendentes": total if status == "pending" else 0, "servidores": 0, "apoiadores": total, "estrangeiros": 0, "cpfConferido": 0}, "semLocal": total, "pagina": page, "limite": limit}


def save():
    (args.output_dir / "RESULTADO.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=args.chromium, args=["--disable-dev-shm-usage", "--renderer-process-limit=2", "--js-flags=--max-old-space-size=256"])

    def open_case(handler, full=False, width=1280, initial="q=QA-A"):
        context = browser.new_context(viewport={"width": width, "height": 900}, locale="pt-BR", service_workers="block")
        if args.cookies_file:
            token = json.loads(args.cookies_file.read_text())["token"]
            context.add_cookies([{"name": "adm", "value": token, "url": base, "httpOnly": True, "sameSite": "Strict"}, {"name": "lang", "value": "pt", "url": base}])
        def intercept(route):
            request = route.request
            url = urlsplit(request.url)
            if request.method not in ["GET", "HEAD"]:
                results["blockedWrites"].append({"method": request.method, "path": url.path})
                route.abort(); return
            if url.netloc != parsed_base.netloc:
                results["externalRequestsBlocked"] += 1
                route.abort(); return
            if url.path == "/api/admin/assinaturas/explorar":
                handler(route, parse_qs(url.query)); return
            route.continue_()
        context.route("**/*", intercept)
        page = context.new_page()
        page.on("pageerror", lambda error: results["pageErrors"].append(str(error)))
        page.goto(base + ("/admin/mapa" if full else "/admin/assinaturas") + "?" + initial, wait_until="domcontentloaded")
        region = page.get_by_role("region", name="Explorador de assinaturas", exact=True)
        expect(region).to_be_visible()
        if full:
            page.get_by_role("button", name="Tabela", exact=True).click()
        return context, page, region

    def search(page, text):
        field = page.get_by_role("searchbox", name="Buscar por nome")
        if not field.is_visible():
            buttons = page.get_by_role("button", name=re.compile(r"^Filtros(?: \(\d+\))?$"))
            next(button for button in buttons.all() if button.is_visible()).click()
        field.fill(text)
        dialog = page.get_by_role("dialog", name="Filtros desta página")
        if dialog.count() and dialog.is_visible():
            dialog.get_by_role("button", name=re.compile("Fechar")).click()

    def passed(name):
        results["checks"].append({"name": name, "pass": True})
        save()

    try:
        for full in [False, True]:
            prefix = "mapa" if full else "tabela"
            pending = []
            def first_pending(route, query): pending.append((route, query))
            context, page, region = open_case(first_pending, full)
            for _ in range(50):
                if pending: break
                page.wait_for_timeout(20)
            assert pending
            expect(region).to_contain_text("Carregando")
            expect(region.get_by_role("alert")).to_have_count(0)
            for route, query in pending: route.fulfill(json=fixture(query, name="QA carregado"))
            expect(region.get_by_role("cell", name="QA carregado", exact=True)).to_be_visible()
            expect(region).not_to_contain_text("Carregando")
            passed(prefix + ": carregamento inicial apenas enquanto o pedido está pendente")
            context.close()

            for status in [400, 401, 403, 429, 500, 503]:
                def response(route, query, status=status): route.fulfill(status=status, content_type="application/json", body='{"ok":false}')
                context, page, region = open_case(response, full)
                expect(region.get_by_role("alert")).to_be_visible()
                expect(region).not_to_contain_text("Carregando")
                expect(region).not_to_contain_text("consulta anterior")
                expect(region).not_to_contain_text("0 assinatura")
                expect(region.get_by_role("link", name="Baixar CSV da consulta exibida")).to_have_count(0)
                expect(region.get_by_role("button", name="Tentar consulta novamente")).to_be_enabled()
                passed(f"{prefix}: primeira falha HTTP{status} sem falso carregamento/zero/prévio/CSV")
                context.close()

            def network(route, query): route.abort("failed")
            context, page, region = open_case(network, full)
            expect(region.get_by_role("alert")).to_contain_text("Não foi possível consultar")
            expect(region).not_to_contain_text("Carregando")
            passed(prefix + ": primeira falha de rede recuperável")
            context.close()

            pending = []
            state = {"hold": False}
            def retry_pending(route, query):
                if state["hold"]: pending.append((route, query))
                else: route.fulfill(status=503, json={"ok": False})
            context, page, region = open_case(retry_pending, full)
            expect(region.get_by_role("alert")).to_be_visible()
            state["hold"] = True
            region.get_by_role("button", name="Tentar consulta novamente").click()
            expect(region).to_contain_text("Carregando")
            expect(region.get_by_role("alert")).to_have_count(0)
            for _ in range(50):
                if pending: break
                page.wait_for_timeout(20)
            assert pending
            for route, query in pending: route.fulfill(json=fixture(query, name="QA recuperado"))
            expect(region.get_by_role("cell", name="QA recuperado", exact=True)).to_be_visible()
            expect(region).not_to_contain_text("Carregando")
            passed(prefix + ": retry limpa erro anterior durante pedido real e recupera resultado")
            context.close()

            def empty(route, query): route.fulfill(json=fixture(query, total=0))
            context, page, region = open_case(empty, full)
            expect(region).to_contain_text("Nenhuma assinatura encontrada na consulta exibida.")
            expect(region.get_by_role("alert")).to_have_count(0)
            expect(region).not_to_contain_text("Carregando")
            passed(prefix + ": zero válido distinto de falha")
            context.close()

            state = {"fault": False, "pending": []}
            def previous(route, query):
                if state["fault"]: route.fulfill(status=503, json={"ok": False})
                else: route.fulfill(json=fixture(query, name="QA-A", status="pending"))
            context, page, region = open_case(previous, full)
            expect(region.get_by_role("cell", name="QA-A", exact=True)).to_be_visible()
            expect(region.get_by_role("cell", name="Aguardando confirmação", exact=True)).to_be_visible()
            state["fault"] = True
            search(page, "QA-B")
            expect(region.get_by_role("alert")).to_be_visible()
            expect(region).to_contain_text("Exibindo a consulta anterior")
            expect(region).to_contain_text("Nome: QA-A")
            href = region.get_by_role("link", name="Baixar CSV da consulta exibida").get_attribute("href")
            csv = parse_qs(urlsplit(href).query)
            assert csv["q"] == ["QA-A"] and csv["formato"] == ["csv"] and "pagina" not in csv and "limite" not in csv
            expect(region.get_by_role("cell", name="QA-A", exact=True)).to_be_visible()
            expect(region).not_to_contain_text("Carregando")
            state["fault"] = False
            region.get_by_role("button", name="Tentar consulta novamente").click()
            expect(region.get_by_role("alert")).to_have_count(0)
            expect(region).not_to_contain_text("Exibindo a consulta anterior")
            csv = parse_qs(urlsplit(region.get_by_role("link", name="Baixar CSV da consulta exibida").get_attribute("href")).query)
            assert csv["q"] == ["QA-B"]
            passed(prefix + ": resultado/filtros/CSV anteriores preservados e retry atualizado")
            context.close()

            state = {"fault": False}
            def same_query(route, query):
                if state["fault"]: route.fulfill(status=500, json={"ok": False})
                else: route.fulfill(json=fixture(query, name="QA atual"))
            context, page, region = open_case(same_query, full)
            expect(region.get_by_role("cell", name="QA atual", exact=True)).to_be_visible()
            state["fault"] = True
            search(page, "Outra")
            expect(region.get_by_role("alert")).to_be_visible()
            search(page, "QA-A")
            expect(region).to_contain_text("Exibindo o último resultado obtido para esta consulta")
            expect(region).not_to_contain_text("filtros atuais ainda não foram confirmados")
            passed(prefix + ": erro com mesmo filtro usa aviso coerente")
            context.close()

            for bad in [401, 403, "invalid"]:
                state = {"fault": False}
                def clears(route, query, bad=bad):
                    if state["fault"]:
                        route.fulfill(status=200 if bad == "invalid" else bad, json={"ok": True} if bad == "invalid" else {"ok": False})
                    else: route.fulfill(json=fixture(query, name="QA anterior"))
                context, page, region = open_case(clears, full)
                expect(region.get_by_role("cell", name="QA anterior", exact=True)).to_be_visible()
                state["fault"] = True
                search(page, "Nova")
                expect(region.get_by_role("alert")).to_be_visible()
                expect(region.get_by_role("cell", name="QA anterior", exact=True)).to_have_count(0)
                expect(region.get_by_role("link", name="Baixar CSV da consulta exibida")).to_have_count(0)
                expect(region).not_to_contain_text("consulta anterior")
                passed(f"{prefix}: {bad} remove dados prévios e CSV")
                context.close()

            waiting = []
            def out_of_order(route, query):
                if query.get("q") == ["Lenta"]: waiting.append((route, query))
                else: route.fulfill(json=fixture(query, name=query.get("q", ["QA"])[0]))
            context, page, region = open_case(out_of_order, full)
            expect(region.get_by_role("cell", name="QA-A", exact=True)).to_be_visible()
            search(page, "Lenta")
            
            for _ in range(50):
                if waiting: break
                page.wait_for_timeout(20)
            assert waiting
            search(page, "Rapida")
            expect(region.get_by_role("cell", name="Rapida", exact=True)).to_be_visible()
            for route, query in waiting:
                try: route.fulfill(json=fixture(query, name="Lenta"))
                except Exception: pass  # Browser may already have canceled the old request.
            page.wait_for_timeout(100)
            expect(region.get_by_role("cell", name="Lenta", exact=True)).to_have_count(0)
            expect(region.get_by_role("cell", name="Rapida", exact=True)).to_be_visible()
            passed(prefix + ": resposta atrasada não substitui consulta mais recente")
            context.close()

            state = {"failPageTwo": True}
            def pagination(route, query):
                number = int(query.get("pagina", ["1"])[0])
                if number == 2 and state["failPageTwo"]: route.fulfill(status=503, json={"ok": False})
                else: route.fulfill(json=fixture(query, total=101, name=f"QA página {number}"))
            context, page, region = open_case(pagination, full)
            expect(region.get_by_role("cell", name="QA página 1", exact=True).first).to_be_visible()
            region.get_by_role("button", name="Próxima ›", exact=True).click()
            expect(region.get_by_role("alert")).to_be_visible()
            expect(region).to_contain_text("Página 1 de 3")
            expect(region.get_by_role("cell", name="QA página 1", exact=True).first).to_be_visible()
            state["failPageTwo"] = False
            region.get_by_role("button", name="Tentar consulta novamente").click()
            expect(region.get_by_role("cell", name="QA página 2", exact=True).first).to_be_visible()
            expect(region).to_contain_text("Página 2 de 3")
            expect(region.get_by_role("alert")).to_have_count(0)
            passed(prefix + ": falha de paginação preserva página exibida e retry conclui página solicitada")
            context.close()

        for width in [320, 390, 768, 1024, 1280, 1440]:
            def success(route, query): route.fulfill(json=fixture(query, name="QA responsivo"))
            context, page, region = open_case(success, width=width)
            # Mobile CSS makes the existing column labels visible in each cell.
            expect(region.get_by_role("cell", name=re.compile(r"^(?:Nome\s+)?QA responsivo$"))).to_be_visible()
            expect(region.get_by_role("cell", name=re.compile(r"^(?:Status\s+)?Confirmada$"))).to_be_visible()
            if args.mode == "compiled-next":
                assert not page.evaluate("document.documentElement.scrollWidth > innerWidth + 2")
            page.screenshot(path=str(args.output_dir / f"consulta-{width}.png"))
            passed(f"largura{width}: consulta e rótulo confirmada")
            context.close()
        assert not results["pageErrors"], results["pageErrors"]
        assert not results["blockedWrites"], results["blockedWrites"]
        results["status"] = "PASS"
    except Exception as error:
        results["status"] = "FAIL"
        results["failure"] = {"type": type(error).__name__, "message": str(error)[:2000]}
        save()
        raise
    finally:
        save()
        browser.close()
print(json.dumps({"status": results["status"], "checks": len(results["checks"]), "evidence": str(args.output_dir / "RESULTADO.json")}))
