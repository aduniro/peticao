"""R2 visual/keyboard regressions against compiled isolated Next QA only.
Frontend API fixtures contain synthetic coordinates; separate HTTP/backend suites
exercise the real seeded backend. No writes, external network or real mail.
"""
import argparse
import ipaddress
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright, expect

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--base', default='http://127.0.0.1:3171')
p.add_argument('--cookies-file', type=Path, required=True)
p.add_argument('--output-dir', type=Path, required=True)
a = p.parse_args()
u = urlsplit(a.base)
assert u.scheme == 'http' and u.port == 3171 and ipaddress.ip_address(u.hostname).is_loopback
os.umask(0o077)
a.output_dir.mkdir(parents=True, exist_ok=True)
result = {'compiledNext': True, 'frontendFixtures': True, 'checks': [], 'pageErrors': [], 'blockedWrites': [], 'externalBlocked': 0}

def save():
    (a.output_dir / 'RESULTADO.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))

def passed(name, details=None):
    result['checks'].append({'name': name, 'pass': True, 'details': details})
    save()

def fixture(q):
    return {'ok': True, 'asOf': '2026-11-16T00:02:00.000Z', 'capabilities': {'contacts': False},
      'coverage': {'matched': 1, 'totalRowsReturned': 1, 'facetsComplete': True, 'mapComplete': True, 'complete': True},
      'total': 1, 'linhas': [{'id': 1, 'nome': 'Pessoa Fictícia de Nome Muito Extenso para Testar a Interface', 'categoria': 'apoiador', 'instituicao': '', 'cargo': '', 'regiao': '', 'campus': '', 'cidadeUf': 'Porto Velho/RO', 'pais': '', 'status': 'confirmed', 'criada': '2026-11-16T00:00:00.000Z', 'confirmada': '2026-11-16T00:01:00.000Z', 'cpf': False, 'whatsapp': '', 'waConfirmado': False}],
      'pontos': [{'chave': 'm:1100205', 'lat': -8.76, 'lon': -63.9, 'nome': 'Porto Velho', 'uf': 'RO', 'conf': 1, 'pend': 0, 'por': {'apoiador': {'conf': 1, 'pend': 0}}}],
      'facetas': {k: [] for k in ['instituicao', 'cargo', 'campus', 'pais', 'universidade', 'uf', 'cidade']},
      'totais': {'confirmadas': 1, 'pendentes': 0, 'servidores': 0, 'apoiadores': 1, 'estrangeiros': 0, 'cpfConferido': 0}, 'semLocal': 0, 'pagina': int(q.get('pagina', ['1'])[0]), 'limite': 50}

CONTRAST = r'''el => {
 const parse = s => {const n=s.match(/[\d.]+/g).map(Number);return [...n.slice(0,3), n.length>3?n[3]:1];};
 const mix=(f,b)=>f.slice(0,3).map((v,i)=>v*f[3]+b[i]*(1-f[3]));
 const bg=e=>e?mix(parse(getComputedStyle(e).backgroundColor), bg(e.parentElement)):[255,255,255];
 const lum=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);
 const b=bg(el), f=mix(parse(getComputedStyle(el).color),b), x=lum(b),y=lum(f);
 return {text:el.textContent.trim().slice(0,90), ratio:(Math.max(x,y)+.05)/(Math.min(x,y)+.05), background:b, foreground:f};
}'''

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, args=['--disable-dev-shm-usage'])
    try:
        for width in [320, 390, 768, 1024, 1280, 1440]:
            ctx = browser.new_context(viewport={'width': width, 'height': 900}, locale='pt-BR', service_workers='block')
            ctx.add_cookies([{'name': 'adm', 'value': json.loads(a.cookies_file.read_text())['token'], 'url': a.base, 'httpOnly': True, 'sameSite': 'Strict'}, {'name': 'lang', 'value': 'pt', 'url': a.base}])
            def intercept(route):
                req=route.request; url=urlsplit(req.url)
                if req.method not in ['GET', 'HEAD']:
                    result['blockedWrites'].append(url.path); route.abort(); return
                if url.netloc != u.netloc:
                    result['externalBlocked'] += 1; route.abort(); return
                if url.path == '/api/admin/assinaturas/explorar':
                    route.fulfill(json=fixture(parse_qs(url.query))); return
                if url.path == '/api/admin/assinaturas/visitas':
                    route.fulfill(json={'ok': True, 'pontos': [{'lat': -8.76, 'lon': -63.9, 'local': 'Local Fictício', 'visitas': 2, 'assinaramVisitantes': 1, 'confirmadas': 1, 'pendentes': 0, 'devolvidos': 0, 'bloqueios': 0}]}); return
                if url.path == '/api/admin/monitor':
                    route.fulfill(json={'requestPoints': [{'lat': -8.76, 'lon': -63.9, 'city': 'Local Fictício', 'region': 'RO', 'country': 'BR', 'confirmed': 1, 'pending': 0, 'invalid': 0, 'blocked': 0, 'queued': 0}]}); return
                route.continue_()
            ctx.route('**/*', intercept)
            page=ctx.new_page();page.on('pageerror', lambda e:result['pageErrors'].append(str(e)))
            page.goto(a.base+'/admin/mapa', wait_until='networkidle')
            toolbar=page.locator('.v2-mapa-barra')
            expect(toolbar).to_be_visible()
            expect(page.locator('.leaflet-interactive[role=button]')).to_have_count(1)
            ratios=[]
            for control in toolbar.locator('button, select').all():
                if control.is_visible():
                    ratio=control.evaluate(CONTRAST);assert ratio['ratio']>=4.5,ratio;ratios.append(ratio)
                    box=control.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width+1,box
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),width
            passed(f'{width}: toolbar contrast and controls in viewport',ratios)
            # Opening a nonmodal table transfers focus; Escape returns it.
            toggle=toolbar.get_by_role('button',name='Tabela',exact=True)
            toggle.focus();toggle.press('Enter')
            sheet=page.get_by_role('region',name='Tabela de assinaturas')
            close=sheet.get_by_role('button',name='Fechar ✕',exact=True)
            expect(close).to_be_focused();expect(sheet).to_contain_text('Pessoa Fictícia')
            page.screenshot(path=str(a.output_dir/f'table-{width}.png'),full_page=True,animations='disabled')
            close.press('Escape');expect(sheet).to_have_count(0);expect(toggle).to_be_focused()
            passed(f'{width}: table keyboard focus, close, Escape and return')
            # All three map layers and their period selector stay legible.
            for layer in ['Visitas (por IP)', 'Acessos e pedidos']:
                toolbar.get_by_role('button',name=layer,exact=True).click()
                select=toolbar.get_by_role('combobox',name='Período das visitas')
                expect(select).to_be_visible(); select.select_option('24h')
                ratio=select.evaluate(CONTRAST);assert ratio['ratio']>=4.5,ratio
            toolbar.get_by_role('button',name='Assinaturas (local declarado)',exact=True).click()
            marker=page.locator('.leaflet-interactive[role=button]').first
            expect(marker).to_have_attribute('tabindex','0')
            marker.focus();marker.press('Enter')
            popup=page.locator('.leaflet-popup')
            expect(popup).to_be_visible()
            filter_button=popup.get_by_role('button',name='Filtrar a tabela por este local')
            expect(filter_button).to_be_focused()
            filter_button.click(trial=True)
            for target in [page.locator('.leaflet-popup-content'),filter_button]:
                ratio=target.evaluate(CONTRAST);assert ratio['ratio']>=4.5,ratio
            page.screenshot(path=str(a.output_dir/f'popup-{width}.png'),full_page=True,animations='disabled')
            filter_button.press('Enter')
            expect(page).to_have_url(__import__('re').compile('cidade=1100205'))
            passed(f'{width}: real Leaflet marker, keyboard popup, contrast and filter callback')
            expect(popup).to_have_count(0)
            if width>992:
                filters=toolbar.get_by_role('button',name=__import__('re').compile('^Filtros'))
                filters.click();field=page.get_by_role('searchbox',name='Buscar por nome')
                expect(field).to_be_visible();field.focus();field.press('Escape')
                expect(filters).to_be_focused();expect(filters).to_have_attribute('aria-expanded','false')
                passed(f'{width}: filters Escape and focus return')
            else:
                # Real shell drawer must appear above the Leaflet map.
                filters=page.get_by_role('button',name=__import__('re').compile('^Filtros'))
                next(b for b in filters.all() if b.is_visible()).click()
                dialog=page.get_by_role('dialog',name='Filtros desta página')
                expect(dialog).to_be_visible();expect(dialog.get_by_role('searchbox',name='Buscar por nome')).to_be_visible()
                page.screenshot(path=str(a.output_dir/f'filters-{width}.png'),full_page=True,animations='disabled')
                dialog.get_by_role('button',name=__import__('re').compile('Fechar')).click()
                passed(f'{width}: mobile filter drawer over map')
            if width<=992:
                opener=page.get_by_role('button',name='Abrir o menu completo')
                opener.focus();opener.press('Enter')
                close_menu=page.get_by_role('button',name='Fechar o menu',exact=True)
                expect(close_menu).to_be_visible();close_menu.click(trial=True)
                page.screenshot(path=str(a.output_dir/f'menu-{width}.png'),full_page=True,animations='disabled')
                close_menu.press('Escape');expect(close_menu).not_to_be_visible()
                passed(f'{width}: shell menu reachable above map, keyboard open and Escape')
            else:
                menu=page.get_by_role('complementary',name='Menu do painel').get_by_role('button',name='Mapas',exact=True)
                menu.focus();menu.press('Enter')
                expect(page.get_by_role('menu',name='Mapas',exact=True)).to_be_visible()
                menu.press('Escape');expect(page.get_by_role('menu',name='Mapas',exact=True)).to_have_count(0)
                passed(f'{width}: desktop map menu keyboard and stacking')
            with page.expect_popup() as opened:
                toolbar.get_by_role('button',name='Tela cheia ↗',exact=True).click()
            full=opened.value;full.set_viewport_size({'width':width,'height':900})
            full.wait_for_load_state('networkidle')
            expect(full.locator('.leaflet-container')).to_be_visible()
            expect(full.locator('.leaflet-interactive[role=button]')).to_have_count(1)
            assert full.evaluate('document.documentElement.scrollWidth <= innerWidth')
            for control in full.locator('.v2-mapa-barra button').all():
                if control.is_visible():
                    ratio=control.evaluate(CONTRAST);assert ratio['ratio']>=4.5,ratio
            full_filters=full.locator('.v2-mapa-barra').get_by_role('button',name=__import__('re').compile('^Filtros'))
            expect(full_filters).to_be_visible();full_filters.click()
            full_field=full.get_by_role('searchbox',name='Buscar por nome')
            expect(full_field).to_be_visible()
            ratio=full_field.evaluate(CONTRAST);assert ratio['ratio']>=4.5,ratio
            full_field.focus();full_field.press('Escape')
            expect(full_filters).to_be_focused();expect(full_filters).to_have_attribute('aria-expanded','false')
            full.screenshot(path=str(a.output_dir/f'fullscreen-{width}.png'),full_page=True,animations='disabled')
            full.close();passed(f'{width}: fullscreen window keeps same filters, map and contrast')
            page.screenshot(path=str(a.output_dir/f'map-{width}.png'),full_page=True,animations='disabled')
            ctx.close()
        assert not result['pageErrors'],result['pageErrors']
        assert not result['blockedWrites'],result['blockedWrites']
        passed('no page errors or writes; external tiles blocked')
    except Exception as e:
        result['failure']=str(e);save();raise
    finally:
        browser.close();save()
