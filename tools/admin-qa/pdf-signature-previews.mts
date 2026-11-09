import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const source = "/mnt/dev/peticao/.cache/admin-integration/candidate-cumulative-8cdd97a-20261109";
const target = "/mnt/dev/peticao/output/pdf/previas-assinaturas-20261109";
assert.equal(process.cwd(), join(source, "site"));
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim(), "8cdd97a0484d22cb5e7907e956bdcf42f0f851fe");
const require = createRequire(join(source, "site/package.json"));
const { PDFDocument, rgb, degrees } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const generatorFile = join(source, "site/src/lib/pdf.ts");
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const generatorBefore = hash(await readFile(generatorFile));
const { buildBatchPdf } = await import(generatorFile);
const green = rgb(5/255,56/255,42/255), yellow = rgb(245/255,197/255,24/255), ink = rgb(.1,.17,.14), muted = rgb(.36,.42,.39), soft = rgb(.93,.96,.94), red = rgb(.72,.12,.12), white = rgb(1,1,1), line = rgb(.8,.85,.82);
const regularBytes = await readFile(join(source,"site/assets/fonts/NotoSans-Regular.ttf"));
const boldBytes = await readFile(join(source,"site/assets/fonts/NotoSans-SemiBold.ttf"));
const nameBytes = await readFile(join(source,"site/assets/fonts/NotoSans-ExtraBold.ttf"));
const { qrMatrix } = await import(join(source,"site/src/lib/card.ts"));
const rows = [1,2,3,4].map(n => ({ name: "PESSOA FICTÍCIA " + String(n).padStart(2,"0") + " PARA PRÉVIA", category: "apoiador", role: null, institution: null, city: "Cidade de exemplo", uf: "XX", seq: n, verify_code: "PREVIA00000" + n, confirmed_at: "2026-11-09T12:00:00Z" }));
const base = await buildBatchPdf(rows, { seq: 1, kind: "final", generatedAt: "2026-11-09T12:00:00Z", listHash: hash(Buffer.from(JSON.stringify(rows))), nServidor: 0, nApoiador: 4, signedNote: "SIMULAÇÃO - NÃO ASSINADO", origin: "https://example.test", preview: undefined });
await writeFile(join(target,"tmp/pdfs/base-gerador-existente.pdf"), base);
const original = await PDFDocument.load(base);
assert.equal(original.getPageCount(),3,"The last page must be a clean signature-list page, not petition text");
const options = [
 { file:"01-a1-icp-simulada.pdf",title:"ICP-Brasil A1",kind:"a1" },
 { file:"02-presidente-modelo-site.pdf",title:"Presidência - modelo do site",kind:"site" },
 { file:"03-a1-e-presidente-simuladas.pdf",title:"A1 + presidência",kind:"both" },
 { file:"04-govbr-simulada.pdf",title:"gov.br",kind:"govbr" }
];
const standalone: {filename:string;bytes:Uint8Array}[] = [];
const drawWrapped = (page:any, text:string, font:any, x:number, y:number, width:number, size=9, color=ink) => {
 let current="", cursor=y;
 for(const word of text.split(/\s+/)) { const trial=current ? current+" "+word : word; if(font.widthOfTextAtSize(trial,size)>width && current) { page.drawText(current,{x,y:cursor,size,font,color});cursor-=size+4;current=word; }else current=trial; }
 if(current)page.drawText(current,{x,y:cursor,size,font,color});return cursor-size-7;
};
for(let i=0;i<options.length;i++) {
 const option=options[i];const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const regular=await doc.embedFont(regularBytes,{subset:true}), bold=await doc.embedFont(boldBytes,{subset:true}), nameFont=await doc.embedFont(nameBytes,{subset:true});
 const [page]=await doc.copyPages(original,[original.getPageCount()-1]);doc.addPage(page);
 doc.setTitle("SIMULAÇÃO SEM VALIDADE - "+option.title);doc.setAuthor("ADUNIR - prévia técnica local");doc.setSubject("Comparação visual fictícia. Nenhuma assinatura digital aplicada.");doc.setProducer("Prévia local - não assinada");doc.setCreationDate(new Date("2026-11-09T12:00:00Z"));doc.setModificationDate(new Date("2026-11-09T12:00:00Z"));
 page.drawText("SIMULAÇÃO - DADOS FICTÍCIOS - SEM VALIDADE",{x:46,y:810,size:8.3,font:bold,color:red});
 page.drawText("PRÉVIA",{x:150,y:200,size:90,font:nameFont,color:green,opacity:.035,rotate:degrees(35)});
 page.drawRectangle({x:46,y:465,width:503,height:4,color:yellow});
 page.drawText("OPÇÃO "+(i+1)+" | "+option.title,{x:46,y:442,size:15,font:bold,color:green});
 const panel=(top:number)=>{page.drawRectangle({x:46,y:top-112,width:503,height:112,color:soft,borderColor:line,borderWidth:.8});page.drawRectangle({x:46,y:top-112,width:3.5,height:112,color:green});};
 const a1=(top:number)=>{
  panel(top);page.drawRectangle({x:59,y:top-89,width:51,height:60,color:green});
  page.drawText("A1",{x:70,y:top-54,size:21,font:bold,color:white});page.drawText("e-CNPJ",{x:66,y:top-75,size:8,font:bold,color:white});
  const x=125;page.drawText("Assinatura digital ICP-Brasil A1 - modelo",{x,y:top-20,size:10.4,font:bold,color:green});
  page.drawText("Titular: ADUNIR - Seção Sindical do ANDES-SN",{x,y:top-39,size:8.5,font:regular,color:ink});
  page.drawText("e-CNPJ: 15.883.671/0001-15",{x,y:top-55,size:8.5,font:regular,color:ink});
  page.drawText("Data/hora: 09/11/2026, 10:00 (EXEMPLO)",{x,y:top-71,size:8.5,font:regular,color:ink});
  page.drawText("AC: preenchida pelo assinador",{x,y:top-87,size:8.5,font:regular,color:muted});
 };
 const president=(top:number)=>{
  panel(top);const qr=qrMatrix("https://example.test/verificar/PRESIDENTE-EXEMPLO"),size=62,qx=58,qy=top-88,m=size/qr.n;
  for(let r=0;r<qr.n;r++)for(let c=0;c<qr.n;c++)if(qr.on(r,c))page.drawRectangle({x:qx+c*m,y:qy+size-(r+1)*m,width:m+.01,height:m+.01,color:green});
  const x=134;page.drawText("código PRES-EXEMPLO",{x:421,y:top-14,size:7.1,font:regular,color:muted});
  page.drawText("NOME DO PRESIDENTE (EXEMPLO)",{x,y:top-32,size:12.2,font:nameFont,color:green});
  page.drawText("Presidente da ADUNIR",{x,y:top-47,size:9.5,font:regular,color:ink});
  page.drawText("Registro no site: 09/11/2026, 10:00 (EXEMPLO)",{x,y:top-64,size:7.5,font:regular,color:muted});
  page.drawText("Evidência ilustrativa: aceite e registro eletrônico do documento.",{x,y:top-78,size:7.3,font:regular,color:muted});
  page.drawText("example.test/verificar/PRESIDENTE-EXEMPLO",{x,y:top-100,size:7,font:regular,color:muted});
 };
 const govbr=(top:number)=>{
  panel(top);page.drawText("Assinatura via gov.br - modelo",{x:60,y:top-21,size:10.5,font:bold,color:green});
  page.drawText("NOME DO SIGNATÁRIO (EXEMPLO)",{x:60,y:top-44,size:12,font:nameFont,color:green});
  page.drawText("Data/hora: 09/11/2026, 10:00 (EXEMPLO)",{x:60,y:top-64,size:8.5,font:regular,color:ink});
  page.drawText("Documento abrangido: somente este arquivo de exemplo.",{x:60,y:top-84,size:8.5,font:regular,color:muted});
  page.drawText("FLUXO EXTERNO",{x:448,y:top-20,size:7,font:regular,color:muted});
 };
 if(option.kind==="a1")a1(410);else if(option.kind==="site")president(410);else if(option.kind==="both"){a1(410);president(282);}else govbr(410);
 page.drawRectangle({x:0,y:0,width:595,height:40,color:white});
 page.drawText("Prévia visual; nenhuma assinatura real aplicada",{x:46,y:24,size:7.5,font:regular,color:muted});
 const bytes=await doc.save();await writeFile(join(target,option.file),bytes);standalone.push({filename:option.file,bytes});
}
const combined=await PDFDocument.create();
combined.setTitle("Quatro prévias de assinatura - SIMULAÇÃO SEM VALIDADE");combined.setAuthor("ADUNIR - prévia técnica local");combined.setSubject("Comparativo visual fictício, sem certificado ou assinatura aplicada.");combined.setProducer("Prévia local - não assinada");
for(let i=0;i<standalone.length;i++){const single=await PDFDocument.load(standalone[i].bytes);const [page]=await combined.copyPages(single,[0]);combined.addPage(page);}
const comparison=await combined.save();await writeFile(join(target,"comparativo-quatro-opcoes.pdf"),comparison);
const files=[...standalone.map(x=>({filename:x.filename,bytes:x.bytes})),{filename:"comparativo-quatro-opcoes.pdf",bytes:comparison}];
const manifest={sourceCommit:"8cdd97a0484d22cb5e7907e956bdcf42f0f851fe",sourceGenerator:generatorFile,sourceGeneratorSha256:generatorBefore,sourceGeneratorUnchanged:generatorBefore===hash(await readFile(generatorFile)),method:"Last-page copy from existing project generator, with explicit non-cryptographic simulation blocks. Generic A1 tile, institutional e-CNPJ from existing project metadata, example president/site card and generic gov.br block. No certificate, signature image, official gov.br logo, private key, validator, database or mail.",sampleData:"Four explicitly fictitious supporters to force a clean final list page; displayed supporters02,03,04; example.test QR target; no CPF/email/identifiable person",options:options.map(x=>({filename:x.file,title:x.title})),files:files.map(x=>({filename:x.filename,sha256:hash(x.bytes),bytes:x.bytes.length})),fonts:{regular:hash(regularBytes),semibold:hash(boldBytes),extraBold:hash(nameBytes)}};
assert.ok(manifest.sourceGeneratorUnchanged);await writeFile(join(target,"manifesto.json"),JSON.stringify(manifest,null,2)+"\n");console.log(JSON.stringify({files:manifest.files,sourceGeneratorUnchanged:manifest.sourceGeneratorUnchanged}));
