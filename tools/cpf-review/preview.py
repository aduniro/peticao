"""Read-only, frozen local name-review preview. Never publishes or changes a signer."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import unicodedata
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / 'site/assets/fonts/NotoSans-Regular.ttf'
BOLD = ROOT / 'site/assets/fonts/NotoSans-SemiBold.ttf'


def digest(value):
  return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def source_revision(record):
  try:
    from name_review import source_revision as revision
  except ImportError:
    return digest([record.get('cpf_hash'), record.get('name'), record.get('nome_api')])
  return revision(record)


def snapshot(database):
  """Freeze approved values from one consistent, read-only SQLite transaction."""
  uri = Path(database).resolve().as_uri() + '?mode=ro'
  db = sqlite3.connect(uri, uri=True, timeout=30)
  db.row_factory = sqlite3.Row
  try:
    db.execute('PRAGMA query_only=ON')
    db.execute('BEGIN')
    names = {r['record_id']: dict(r) for r in db.execute('SELECT * FROM name_decisions')}
    verifications = {}
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='trt3_consultas'").fetchone():
      for proof in db.execute("""SELECT t.* FROM trt3_consultas t JOIN name_decisions n
        ON n.record_id=t.record_id AND n.version=t.nome_decisao_versao
        WHERE t.estado='aplicado' AND t.record_revision=n.record_revision
        AND t.nome_aprovado=n.selected_name ORDER BY t.consultado_em,t.rowid"""):
        verifications[proof['record_id']] = {key: proof[key] for key in (
          'consultado_em','data_local','hora_local','fuso_horario','codigo_verificador',
          'numero_certidao','expedido_em_trt3','auditoria_id')}
    accepted, excluded = [], Counter()
    for raw in db.execute('SELECT * FROM records ORDER BY id'):
      row = dict(raw)
      record = json.loads(row['data'])
      record['cpf_hash'] = row['cpf_hash']
      name = names.get(row['id'])
      if not row['present']:
        excluded['ausente_na_fonte'] += 1
      elif row['status'] != 'confirmed':
        excluded['assinatura_nao_confirmada'] += 1
      elif record.get('category') != 'estrangeiro' and row['decision'] != 'approved':
        excluded['cpf_nao_aprovado'] += 1
      elif not name or name['decision'] != 'approved':
        excluded['nome_nao_aprovado'] += 1
      elif name['record_revision'] != row['revision'] or name['name_revision'] != source_revision(record):
        excluded['decisao_de_nome_desatualizada'] += 1
      elif _policy_review_required(record,name):
        excluded['politica_de_nome_exige_revisao'] += 1
      elif not isinstance(name['selected_name'], str) or not name['selected_name'].strip():
        excluded['nome_aprovado_vazio'] += 1
      else:
        # Whitelist: no raw CPF, hashes, emails, API demographics, instructions or IPs.
        accepted.append({
          'id': row['id'], 'seq': record.get('seq'),
          'name': unicodedata.normalize('NFC', name['selected_name']),
          'category': record.get('category'), 'institution': record.get('institution') or record.get('university'),
          'role': record.get('role'), 'campus': record.get('campus'),
          'city': record.get('city'), 'uf': record.get('uf'), 'country': record.get('country'),
          'created_at': record.get('created_at'), 'confirmed_at': record.get('confirmed_at'),
          'consent_at': record.get('consent_at'),
          'api_name_check': record.get('cpf_name_check'),
          'verify_code': record.get('verify_code'),
          'campus_ibge': record.get('campus_ibge'),
          'email_domain_kind': record.get('email_domain_kind'),
          'name_decision_version': name['version'], 'record_revision': row['revision'],
          'name_revision': name['name_revision'],
          'trt3_consulta': verifications.get(row['id']),
        })
    db.execute('COMMIT')
    accepted.sort(key=lambda r: (r.get('confirmed_at') or '', r['id']))
    return accepted, dict(excluded)
  finally:
    db.close()


def _policy_review_required(record,decision):
  from name_policy import key,policy
  if decision.get('policy_version')==policy()['version']:
    return False
  from name_dictionary import suggest
  return key(decision.get('selected_name'))!=key(suggest(record)['proposed'])

def _fonts():
  from fontTools.ttLib import TTFont as FontCoverage
  from reportlab.pdfbase import pdfmetrics
  from reportlab.pdfbase.ttfonts import TTFont
  coverage = []
  for name, path in [('ReviewNoto', FONT), ('ReviewNotoBold', BOLD)]:
    font = FontCoverage(path)
    coverage.append(set(font.getBestCmap()))
    font.close()
    if name not in pdfmetrics.getRegisteredFontNames():
      pdfmetrics.registerFont(TTFont(name, str(path)))
  return set.intersection(*coverage)


def _shown(value):
  return str(value) if value is not None and value != '' else '-'


def _lines(record):
  category = {'servidor': 'Servidor', 'apoiador': 'Apoiador', 'estrangeiro': 'Exterior'}.get(record.get('category'), record.get('category'))
  location = ' / '.join(str(record[k]) for k in ('city', 'uf') if record.get(k)) or record.get('country')
  workplace = ' / '.join(str(record[k]) for k in ('institution', 'campus', 'role') if record.get(k))
  return [
    'Inscrição ' + _shown(record.get('seq')) + ' | ID ' + str(record['id']),
    record['name'],
    _shown(category) + ' | ' + _shown(workplace),
    _shown(location),
    'Cadastro (UTC): ' + _shown(record.get('created_at')),
    'Confirmação (UTC): ' + _shown(record.get('confirmed_at')),
    'Código de verificação: ' + _shown(record.get('verify_code')),
    'Conferência do nome pela API no aplicativo: ' + ('Registrada' if record.get('api_name_check') == 'match' else 'Não registrada'),
  ] + _trt3_lines(record)


def _trt3_lines(record):
  proof=record.get('trt3_consulta')
  if not proof:
    return []
  return [
    'Consulta do nome no TRT3: '+datetime.fromisoformat(proof['data_local']).strftime('%d/%m/%Y')+' '+str(proof['hora_local']).split('.')[0]+' ('+str(proof['fuso_horario'])+')',
    'Código de autenticidade TRT3: '+str(proof['codigo_verificador']),
    'Certidão TRT3: '+_shown(proof.get('numero_certidao'))+' | Expedição: '+_shown(proof.get('expedido_em_trt3')),
  ]


def _write_pdf(path, records, generated_at):
  from reportlab.lib import colors
  from reportlab.lib.enums import TA_CENTER
  from reportlab.lib.pagesizes import A4
  from reportlab.lib.styles import ParagraphStyle
  from reportlab.lib.units import mm
  from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, KeepTogether
  coverage = _fonts()
  texts = [text for record in records for text in _lines(record)]
  missing = sorted({ord(char) for text in texts for char in text if not char.isspace() and ord(char) not in coverage})
  if missing:
    codes = ', '.join('U+%04X' % code for code in missing)
    raise ValueError('Prévia bloqueada: a fonte não contém os caracteres aprovados: ' + codes)
  normal = ParagraphStyle('ReviewText', fontName='ReviewNoto', fontSize=9, leading=13, textColor=colors.HexColor('#263446'), spaceAfter=3, splitLongWords=True)
  name_style = ParagraphStyle('ReviewName', parent=normal, fontName='ReviewNotoBold', fontSize=11, leading=15, spaceAfter=6)
  heading = ParagraphStyle('ReviewHeading', parent=name_style, fontSize=17, leading=22, alignment=TA_CENTER, spaceAfter=12)
  doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=20*mm, leftMargin=20*mm, topMargin=23*mm, bottomMargin=21*mm, title='Prévia local de nomes revisados - NÃO ENVIAR', author='Revisão local da petição', pageCompression=1)
  story = [Paragraph('Prévia local de nomes revisados', heading), Paragraph('Documento de conferência. NÃO ENVIAR. Esta prévia não substitui os lotes oficiais nem confirma assinaturas pendentes.', normal), Paragraph('Gerada em ' + generated_at + ' | Assinaturas selecionadas: ' + str(len(records)), normal), Spacer(1, 7*mm)]
  for record in records:
    block = []
    for index, line in enumerate(_lines(record)):
      # Escape all signer content: ReportLab markup is never accepted from the DB.
      block.append(Paragraph(escape(line).replace('\n', '<br/>'), name_style if index == 1 else normal))
    block.extend([Spacer(1, 2*mm), HRFlowable(width='100%', thickness=.4, color=colors.HexColor('#CCD4DD')), Spacer(1, 5*mm)])
    # Keep an ordinary signer block together. Truly oversized blocks may still split;
    # no names are shortened to fit a page.
    height = sum(item.wrap(doc.width, doc.height)[1] + item.getSpaceBefore() + item.getSpaceAfter() for item in block)
    if height < doc.height:
      story.append(KeepTogether(block))
    else:
      story.extend(block)
  def decorate(canvas, document):
    canvas.saveState()
    canvas.setFillColor(colors.HexColor('#EEEEEE'))
    canvas.setFont('ReviewNotoBold', 43)
    canvas.translate(A4[0]/2, A4[1]/2)
    canvas.rotate(40)
    canvas.drawCentredString(0, 0, 'NÃO ENVIAR')
    canvas.restoreState()
    canvas.saveState()
    canvas.setFillColor(colors.HexColor('#607080'))
    canvas.setFont('ReviewNoto', 8)
    canvas.drawString(20*mm, 12*mm, 'Conferência local - nomes aprovados; dados originais preservados')
    canvas.drawRightString(A4[0]-20*mm, 12*mm, 'Página ' + str(document.page))
    canvas.restoreState()
  doc.build(story, onFirstPage=decorate, onLaterPages=decorate)


def generate(database, output):
  """Create one NEW private directory. Any failure keeps a diagnostic manifest only."""
  records, excluded = snapshot(database)
  if not records:
    raise ValueError('Nenhuma assinatura confirmada tem CPF e nome aprovados e atuais para esta prévia.')
  generated_at = datetime.now(timezone.utc).isoformat()
  output = Path(output).resolve()
  output.mkdir(parents=True, mode=0o700, exist_ok=False)
  output.chmod(0o700)
  frozen = output / 'selecao.json'
  pdf = output / 'previa-nomes-revisados.pdf'
  manifest_path = output / 'manifest.json'
  manifest = {'schema': 'name-review-preview-v1', 'generated_at': generated_at, 'records': len(records), 'excluded': excluded, 'selection_sha256': digest(records), 'official': False}
  try:
    raw = json.dumps(records, ensure_ascii=False, sort_keys=True, indent=2).encode()
    with frozen.open('xb') as stream:
      os.chmod(frozen, 0o600)
      stream.write(raw)
    manifest['files'] = {'selecao.json': hashlib.sha256(raw).hexdigest()}
    # Reserve destination exclusively; ReportLab receives a path owned by this run.
    with pdf.open('xb'):
      pdf.chmod(0o600)
    _write_pdf(pdf, records, generated_at)
    manifest['files'][pdf.name] = hashlib.sha256(pdf.read_bytes()).hexdigest()
    manifest['state'] = 'complete'
  except Exception:
    manifest['state'] = 'failed'
    if pdf.exists():
      pdf.unlink()
    raise
  finally:
    with manifest_path.open('x') as stream:
      manifest_path.chmod(0o600)
      json.dump(manifest, stream, ensure_ascii=False, sort_keys=True, indent=2)
  return {'directory': str(output), 'pdf': str(pdf), 'manifest': str(manifest_path), 'records': len(records), 'excluded': excluded}


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--database', required=True, type=Path)
  parser.add_argument('--output', required=True, type=Path)
  args = parser.parse_args()
  try:
    result = generate(args.database, args.output)
  except Exception as error:
    # Paths and aggregates only; no signer values in terminal diagnostics.
    raise SystemExit('Prévia não gerada: ' + str(error))
  print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
  main()
