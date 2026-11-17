"""R3 compiled UI and real HTTP checks. Only isolated loopback QA on port3191.
Synthetic fixture and guarded PostgreSQL54531 are required; never use production.
"""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--package-enabled', action='store_true')
parser.add_argument('--widths', type=int, nargs='+', default=[320,390,768,1024,1280,1440])
parser.add_argument('--base', default='http://127.0.0.1:3191')
parser.add_argument('--cookies-file', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, required=True)
args = parser.parse_args()
base = urlsplit(args.base)
assert base.scheme == 'http' and base.hostname == '127.0.0.1' and base.port == 3191 and base.path in ['', '/']
os.umask(0o077)
args.output_dir.mkdir(parents=True, exist_ok=False)
assert args.widths and all(width in [320,390,768,1024,1280,1440] for width in args.widths)
fixture = json.loads(args.cookies_file.read_text())
assert fixture['fictionalOnly'] is True
result = {'compiledNext': True, 'packageEnabled': args.package_enabled, 'syntheticOnly': True, 'apiFixtures': False, 'checks': [], 'pageErrors': [], 'externalBlocked': [], 'blockedWrites': []}

def save():
    (args.output_dir / 'RESULTADO.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))

def passed(name, details=None):
    result['checks'].append({'name': name, 'pass': True, 'details': details})
    save()

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
        for width in args.widths:
            context = browser.new_context(viewport={'width': width, 'height': 900}, locale='pt-BR', service_workers='block')
            context.add_cookies([{'name': 'adm', 'value': fixture['token'], 'url': args.base, 'httpOnly': True, 'sameSite': 'Strict'}, {'name': 'lang', 'value': 'pt', 'url': args.base}])
            def intercept(route):
                request = route.request
                url = urlsplit(request.url)
                if url.netloc != base.netloc:
                    result['externalBlocked'].append(url.netloc)
                    route.abort()
                elif request.method not in ['GET', 'HEAD']:
                    result['blockedWrites'].append(url.path)
                    route.abort()
                else:
                    route.continue_()
            context.route('**/*', intercept)
            page = context.new_page()
            page.on('pageerror', lambda error: result['pageErrors'].append(str(error)))
            page.goto(args.base + '/admin/lotes', wait_until='networkidle')
            expect(page.get_by_role('heading', name='Lotes', exact=True)).to_be_visible()
            expect(page.locator('#lote-acoes')).to_have_count(0)
            expect(page.get_by_role('button', name='Assinar com certificado A1', exact=True)).to_have_count(0)
            cards = page.locator('.v2-lotes-cartoes')
            table = page.locator('.v2-lotes-desktop')
            expect(cards if width <= 992 else table).to_be_visible()
            expect(table if width <= 992 else cards).to_be_hidden()
            scope = cards if width <= 992 else table
            for text in ['Preparado', 'Falha', 'Enviado', 'Cancelado']:
                expect(scope.get_by_text(text, exact=True).first).to_be_visible()
            passed(f'{width}: labelled cards/compact table, translated states and no repeated action widgets')
            scope.get_by_role('link', name='Abrir ações do lote 101', exact=True).click()
            expect(page.locator('#lote-acoes')).to_have_attribute('data-batch-id', '1')
            expect(page.get_by_role('heading', name='Ações do lote #101', exact=True)).to_be_visible()
            expect(page.get_by_role('button', name='Assinar com certificado A1', exact=True)).to_have_count(1)
            expect(page.get_by_label('PDF original do lote #101, após a assinatura')).to_be_visible()
            for action in (['assinado', 'cancelar'] if args.package_enabled else ['assinado', 'codigo', 'aprovar', 'cancelar']):
                expect(page.locator(f'#lote-acoes form[action="/api/admin/lotes/1/{action}"]')).to_have_count(1)
            expect(page.locator('#lote-acoes form[enctype="multipart/form-data"]')).to_have_count(1)
            if args.package_enabled:
                expect(page.locator('#lote-acoes a[href="/admin/presidente?lote=1"]')).to_have_text('Presidente da ADUNIR')
                expect(page.locator('#lote-acoes form[action$="/codigo"], #lote-acoes form[action$="/aprovar"]')).to_have_count(0)
            else:
                expect(page.get_by_label('Código do aprovador')).to_have_attribute('maxlength', '6')
            passed(f'{width}: exact batch selection, one A1/history set and unchanged form contracts')
            dimensions = page.evaluate('({width:innerWidth, scroll:document.documentElement.scrollWidth})')
            assert dimensions['scroll'] <= dimensions['width'] + 1, dimensions
            for selector in ['#lote-acoes', '#lote-acoes input[type=file]', '#lote-acoes button'] + ([] if args.package_enabled else ['#lote-acoes input[name=code]']):
                for element in page.locator(selector).all():
                    if not element.is_visible():
                        continue
                    box = element.bounding_box()
                    assert box and box['x'] >= -1 and box['x'] + box['width'] <= width + 1, (selector, box, width)
            passed(f'{width}: no page overflow or clipped controls', dimensions)
            contrast=[]
            for element in page.locator('.v2-lotes-status, #lote-acoes label, #lote-acoes .v2-btn, #lote-acoes button').all():
                if element.is_visible():
                    sample=element.evaluate(CONTRAST)
                    assert sample['ratio'] >= 4.5, sample
                    contrast.append(sample)
            passed(f'{width}: action labels and status contrast at least4.5', contrast)
            if width in [390, 1280]:
                page.locator('#lote-acoes').screenshot(path=str(args.output_dir / f'actions-{width}.png'))
            history = page.get_by_role('button', name='Histórico', exact=True)
            history.click()
            dialog = page.get_by_test_id('document-history')
            expect(dialog).to_be_visible()
            expect(dialog.get_by_role('heading', name='Documentos · 1', exact=True)).to_be_visible()
            expect(dialog.get_by_role('status')).to_have_count(0, timeout=15000)
            expect(dialog.get_by_role('alert')).to_have_count(0)
            page.keyboard.press('Escape')
            expect(dialog).to_be_hidden()
            expect(history).to_be_focused()
            passed(f'{width}: real history GET, keyboard close and focus restoration')
            trigger=page.get_by_role('button', name='Assinar com certificado A1', exact=True)
            trigger.click()
            a1dialog=page.get_by_role('dialog', name='Assinar com certificado A1 · 1', exact=True)
            expect(a1dialog).to_be_visible()
            box=a1dialog.bounding_box()
            assert box and box['x'] >= -1 and box['x']+box['width'] <= width+1, box
            page.keyboard.press('Escape')
            expect(a1dialog).to_be_hidden()
            expect(trigger).to_be_focused()
            passed(f'{width}: A1 dialog keeps the selected id, fits viewport and closes without POST')
            page.goto(args.base + '/admin/lotes?lote=5#lote-acoes', wait_until='networkidle')
            expect(page.locator('#lote-acoes')).to_have_attribute('data-batch-id', '5')
            expect(page.get_by_role('link', name='Abrir painel legado', exact=True)).to_be_visible()
            expect(page.locator('#lote-acoes form')).to_have_count(0)
            expect(page.get_by_role('button', name='Assinar com certificado A1', exact=True)).to_have_count(0)
            passed(f'{width}: legacy ownership remains read-only')
            for batch_id in [3, 4]:
                page.goto(args.base + f'/admin/lotes?lote={batch_id}#lote-acoes', wait_until='networkidle')
                expect(page.locator('#lote-acoes')).to_have_attribute('data-batch-id', str(batch_id))
                expect(page.locator('#lote-acoes form')).to_have_count(0)
            passed(f'{width}: sent and cancelled batches expose no mutation forms')
            page.goto(args.base + '/admin/lotes?lote=1&lote=2', wait_until='networkidle')
            expect(page.locator('#lote-acoes')).to_have_count(0)
            expect(page.locator('.v2-lotes [role=alert]')).to_have_text('Esse lote não está disponível. Escolha um lote da lista.')
            passed(f'{width}: ambiguous selection has a clear error and no accidental target')
            context.close()
        context = browser.new_context()
        context.add_cookies([{'name': 'adm', 'value': fixture['token'], 'url': args.base}])
        headers = {'Origin': args.base}
        response = context.request.post(args.base + '/api/admin/lotes/1/assinado', multipart={'file': {'name': 'empty-qa.pdf', 'mimeType': 'application/pdf', 'buffer': b''}}, headers=headers, max_redirects=0)
        assert response.status == 303, response.status
        location = response.headers['location']
        query = parse_qs(urlsplit(location).query)
        assert urlsplit(location).path == '/admin/lotes' and query['lote'] == ['1'] and query['msg'] == ['Escolha o PDF assinado.'], location
        page = context.new_page()
        page.goto(location)
        expect(page.locator('#lote-acoes')).to_have_attribute('data-batch-id', '1')
        expect(page.get_by_role('status').filter(has_text='Escolha o PDF assinado.')).to_be_visible()
        passed('HTTP: empty upload returns a visible error with the exact selected batch')
        response = context.request.post(args.base + '/api/admin/lotes/6/cancelar', form={}, headers=headers, max_redirects=0)
        assert response.status == 303
        query = parse_qs(urlsplit(response.headers['location']).query)
        assert query['lote'] == ['6'] and query['msg'] == ['Lote cancelado.']
        page.goto(response.headers['location'])
        expect(page.get_by_role('heading', name='Ações do lote #106', exact=True)).to_be_visible()
        expect(page.locator('#lote-acoes form')).to_have_count(0)
        passed('HTTP: successful cancellation persists and returns to batch6 without enabling further mutations')
        response = context.request.post(args.base + '/api/admin/lotes/5/cancelar', form={}, headers=headers, max_redirects=0)
        assert response.status == 303
        assert parse_qs(urlsplit(response.headers['location']).query)['msg'] == ['Não foi possível cancelar.']
        passed('HTTP: legacy mutation is refused by the backend independently of hidden controls')
        context.close()
        anonymous = browser.new_context()
        response = anonymous.request.post(args.base + '/api/admin/lotes/1/cancelar', form={}, headers=headers, max_redirects=0)
        assert response.status == 401
        anonymous.close()
        passed('HTTP: unauthenticated mutation remains unauthorized')
        assert not result['pageErrors'], result['pageErrors']
        assert not result['blockedWrites'], result['blockedWrites']
        result['allPassed'] = True
        save()
        print(json.dumps({'allPassed': True, 'checks': len(result['checks']), 'pageErrors': len(result['pageErrors']), 'externalBlocked': len(result['externalBlocked'])}))
    except BaseException as error:
        result['allPassed'] = False
        result['failure'] = str(error)
        save()
        raise
    finally:
        browser.close()
