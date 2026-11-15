#!/usr/bin/env python3
"""Compiled application, actual seeded API and Leaflet; no explorer mocks."""
import argparse
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit



def main():
    from playwright.sync_api import sync_playwright, expect
    p = argparse.ArgumentParser()
    p.add_argument('--base', required=True)
    p.add_argument('--cookies-file', required=True, type=Path)
    p.add_argument('--output-dir', required=True, type=Path)
    p.add_argument('--chromium', required=True)
    a = p.parse_args()
    os.umask(0o077)
    a.output_dir.mkdir(parents=True, exist_ok=False)
    base = a.base.rstrip('/')
    if base != 'http://127.0.0.1:28452':
        raise ValueError('fixed_fixture_loopback_required')
    result = {'ok': False, 'explorerMocked': False, 'checks': [], 'pageErrors': [], 'externalRequestsBlocked': 0}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=a.chromium, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
            for width in [390, 1280]:
                c = browser.new_context(viewport={'width': width, 'height': 920}, locale='pt-BR')
                c.add_cookies([{'name': 'adm', 'value': json.loads(a.cookies_file.read_text())['token'], 'url': base, 'httpOnly': True, 'sameSite': 'Strict'}, {'name': 'lang', 'value': 'pt', 'url': base}])
                def route(r):
                    if r.request.method not in ['GET', 'HEAD']:
                        raise AssertionError('Unexpected write: ' + r.request.method)
                    if urlsplit(r.request.url).netloc != '127.0.0.1:28452':
                        result['externalRequestsBlocked'] += 1
                        r.abort()
                    else:
                        r.continue_()
                c.route('**/*', route)
                page = c.new_page()
                page.on('pageerror', lambda error: result['pageErrors'].append(str(error)))
                response = c.request.get(base + '/api/admin/assinaturas/explorar')
                assert response.status == 200
                data = response.json()
                assert data['total'] == 22 and len(data['linhas']) == 22
                page.goto(base + '/admin/mapa', wait_until='domcontentloaded')
                expect(page.locator('.leaflet-container')).to_be_visible(timeout=30000)
                assert page.locator('.leaflet-container').evaluate('(e) => e.clientWidth > 100 && e.clientHeight > 100')
                page.screenshot(path=str(a.output_dir / f'mapa-real-{width}.png'), full_page=True)
                page.goto(base + '/admin/assinaturas', wait_until='domcontentloaded')
                region = page.get_by_role('region', name='Explorador de assinaturas', exact=True)
                expect(region.get_by_role('link', name='Baixar CSV da consulta exibida', exact=True)).to_be_visible(timeout=30000)
                expect(region.get_by_text('Pessoa Fictícia de Teste 1', exact=True)).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                page.screenshot(path=str(a.output_dir / f'consulta-real-{width}.png'), full_page=True)
                result['checks'].append(f'compiled Leaflet + actual seeded22-row backend + table + CSV + no horizontal page overflow width{width}')
                c.close()
            browser.close()
        assert result['pageErrors'] == [], result['pageErrors']
        result['ok'] = True
    finally:
        (a.output_dir / 'RESULTADO.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(json.dumps({'ok': result['ok'], 'checks': len(result['checks']), 'evidence': str(a.output_dir / 'RESULTADO.json')}))


if __name__ == "__main__":
    main()
