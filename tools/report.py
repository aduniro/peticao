from pathlib import Path
import difflib,hashlib,html,json,re,subprocess
from PIL import Image,ImageChops
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/"reports";OUT.mkdir(exist_ok=True)
def inventory(root):
    return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob("*")
            if p.is_file() and not any(x in {".next",".next-dev","node_modules",".git","geo-data"} for x in p.relative_to(root).parts)}
a,b=ROOT/"app",ROOT/"formularios/app";ia,ib=inventory(a),inventory(b)
rows=[];patch=[]
known={"src/components/SignForm.tsx","src/lib/sign-flow.ts","src/lib/signup-diagnostics.ts","src/lib/email-sugestao.ts","src/lib/email-validate.ts",
       "src/lib/server-email-policy.ts","src/lib/signup-security-proof.ts","src/lib/supporter-known-domains.ts"}
for name in sorted(set(ia)|set(ib)):
    if ia.get(name)==ib.get(name):continue
    state="novo" if name not in ia else "ausente" if name not in ib else "alterado"
    classification="Teste de regressão" if ".test." in name else "Mudança solicitada" if name in known or name.startswith("src/i18n/") else "A revisar"
    rows.append({"file":name,"state":state,"classification":classification})
    if Path(name).suffix in {".ts",".tsx",".js",".mjs",".css",".json",".md"}:
        patch.extend(difflib.unified_diff((a/name).read_text().splitlines(True) if name in ia else [],
                                        (b/name).read_text().splitlines(True) if name in ib else [],fromfile="A/"+name,tofile="B/"+name))
(OUT/"source.diff").write_text("".join(patch))
screens=[];image_results=[]
reviews=json.loads((OUT/"visual-review.json").read_text()) if (OUT/"visual-review.json").exists() else {}
for image_a in sorted(OUT.glob("a-*.png")):
    name=image_a.name[2:];image_b=OUT/("b-"+name)
    if not image_b.exists():continue
    aa,bb=Image.open(image_a).convert("RGB"),Image.open(image_b).convert("RGB")
    if aa.size==bb.size:
        delta=ImageChops.difference(aa,bb);count=sum(p!=(0,0,0) for p in delta.getdata());percent=count*100/(aa.width*aa.height)
        delta.point(lambda n:min(255,n*4)).save(OUT/("diff-"+name));same=count==0
    else:count=None;percent=None;same=False
    review=reviews.get(name,{})
    reviewed=review.get("a_sha256")==hashlib.sha256(image_a.read_bytes()).hexdigest() and review.get("b_sha256")==hashlib.sha256(image_b.read_bytes()).hexdigest()
    classification="Idêntica" if same else review["classification"] if reviewed else "A revisar"
    image_results.append({"scenario":name,"same_size":aa.size==bb.size,"identical":same,"different_pixels":count,"percent":percent,"classification":classification})
    screens.append((name,image_a.name,image_b.name,("diff-"+name) if aa.size==bb.size else None,percent))
results=json.loads((OUT/"browser-results.json").read_text()) if (OUT/"browser-results.json").exists() else {"cases":[]}
unit={}
for version in ["a","b"]:
    path=OUT/("unit-"+version+".log")
    if path.exists():
        text=path.read_text()
        unit[version]={key:int(value) for key,value in re.findall(r"^# (tests|pass|fail|skipped|cancelled) (\d+)$",text,re.M)}
targeted={}
for version in ["a","b"]:
    path=OUT/("unit-targeted-"+version+".log")
    if path.exists():targeted[version]={key:int(value) for key,value in re.findall(r"^# (tests|pass|fail|skipped|cancelled) (\d+)$",path.read_text(),re.M)}
schema=json.loads((OUT/"schema-comparison.json").read_text()) if (OUT/"schema-comparison.json").exists() else {}
baseline=json.loads((OUT/"baseline-unit-failures.json").read_text()) if (OUT/"baseline-unit-failures.json").exists() else []
summary={"source_differences":rows,"images":image_results,"browser":results,"unit":unit,"targeted":targeted,"schema":schema,"baseline_test_findings":baseline,
         "invariants":{name:ia.get(name)==ib.get(name) for name in ["package-lock.json","src/app/page.tsx","src/app/globals.css","src/lib/db.ts","src/lib/cpf-name.ts"]}}
(OUT/"comparison.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
esc=html.escape
parts=['<!doctype html><html lang="pt-br"><meta charset="utf-8"><title>VPS × Formulários</title><style>body{font:16px system-ui;margin:2rem;color:#19312b}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.6rem;text-align:left}pre{white-space:pre-wrap}section{margin:2rem 0}.pair{display:flex;gap:1rem;overflow:auto}.pair img{max-width:46vw;object-fit:contain;object-position:top}code{overflow-wrap:anywhere}summary{cursor:pointer;padding:.7rem;background:#edf4f0}.ok{color:#075d3f}.bad{color:#b42318}</style><h1>Comparação local: VPS × candidato dos formulários</h1>',
       '<p><a href="http://127.0.0.1:3040/">Abrir A — VPS capturada</a> · <a href="http://127.0.0.1:3041/">Abrir B — formulários</a> · <a href="#imagens">Ver imagens</a> · <a href="source.diff">Patch completo</a></p>',
       '<p>Somente dados fictícios. Nenhuma conexão com produção ou provedores reais. Mesmos fixtures, chaves fictícias, navegador e configurações. Widget antirrobô substituído pelo mesmo simulador externo ao código das duas versões.</p>',
       '<h2>Diferenças esperadas</h2><ul><li>B corrige o falso sucesso do honeypot e preserva os campos em falhas de segurança.</li><li>B restringe Servidor a IFES aprovadas e à exceção EBSERH; reconhece UCPel no Apoiador.</li><li>B inclui prova de segurança para a segunda etapa de identidade; caminhos de API preservados.</li><li>Componentes visuais da página principal, estilos globais e esquema central do banco devem permanecer iguais.</li></ul>',
       '<h2>Invariantes de fonte</h2><pre>'+esc(json.dumps(summary["invariants"],ensure_ascii=False,indent=2))+'</pre>',
       '<h2>Resultados</h2><p><strong>Candidato B: '+str(unit.get("b",{}).get("pass","em execução"))+'/'+str(unit.get("b",{}).get("tests","?"))+' testes aprovados. Navegador: '+str(sum(c.get("status")=="passed" for c in results.get("cases",[])))+'/'+str(len(results.get("cases",[])))+' cenários aprovados. Esquema público: '+("idêntico" if schema.get("same_public_schema") else "conferir")+'.</strong></p><details><summary>Detalhes completos das baterias e respostas observadas</summary><pre>'+esc(json.dumps({"unit":unit,"targeted":targeted,"schema":schema,"browser":results},ensure_ascii=False,indent=2))+'</pre></details>',
       '<h2>Pontos de atenção</h2><p>A bateria original de A tem9 falhas registradas: uma dependência do ambiente foi corrigida e seu reteste4/4 passou; permanecem8 expectativas herdadas a revisar nos testes de campanha, CPF/servidor, estrangeiros, Reacher, identidade e nomes. A fonte de A foi preservada. Isso não é apresentado como aprovação integral da bateria original.</p>',
       '<p>Na rejeição normal do antirrobô (campo honeypot vazio), A e B mostram mensagem inline. O modal com preservação explícita dos campos de B é acionado pela recuperação do honeypot. Essa distinção existente foi registrada, sem alterar a interface.</p>',
       '<p>Os testes visuais estabilizam carrossel/transições, usam o mesmo simulador local e ocultam o cursor de texto. As imagens brutas são preservadas. As URLs3040/3041 diferem por configuração; a pequena sobreposição do botão fechar em uma captura foi conferida por outra captura com altura1600px, idêntica. Nenhuma fonte, tamanho ou layout da aplicação foi alterado.</p>',
       '<details><summary>'+str(len(rows))+' arquivos com diferença de conteúdo</summary><table><tr><th>Arquivo</th><th>Estado</th><th>Classificação</th></tr>']
for row in rows:parts.append("<tr>"+"".join("<td>"+esc(row[k])+"</td>" for k in ["file","state","classification"])+"</tr>")
parts.append('</table></details><h2 id="imagens">Capturas lado a lado</h2>')
for name,pa,pb,pd,percent in screens:
    parts.append('<section><details><summary>'+esc(name)+' — '+("dimensões diferentes" if percent is None else f"{percent:.4f}% de pixels diferentes")+'</summary><div class="pair"><figure><figcaption>A — VPS</figcaption><img src="'+pa+'"></figure><figure><figcaption>B — formulários</figcaption><img src="'+pb+'"></figure></div>')
    if pd:parts.append('<details><summary>Mostrar diferença ampliada</summary><img style="max-width:100%" src="'+pd+'"></details>')
    parts.append("</details></section>")
parts.append('<h2>Patch auditável</h2><details><summary>Ver alterações de código</summary><pre>'+esc("".join(patch))+'</pre></details></html>')
(OUT/"index.html").write_text("".join(parts))
print(json.dumps({"report":str(OUT/"index.html"),"source_differences":len(rows),"image_pairs":len(screens),"unit":unit}))
