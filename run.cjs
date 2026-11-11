const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=__dirname,SOURCE='/mnt/apps/peticao-final/_ops/drafts/materials-layout-20261111';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(process.versions.node,'20.19.2');assert.equal(sha(fs.readFileSync(process.execPath)),'b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac');
assert.equal(process.env.MATERIALS_LAYOUT_MANIFEST_SHA256,sha(fs.readFileSync(ROOT+'/manifest.json')));
const pins=JSON.parse(fs.readFileSync(ROOT+'/manifest.json'));for(const[n,h]of Object.entries(pins.files))assert.equal(sha(fs.readFileSync(ROOT+'/'+n)),h);
fs.writeFileSync(ROOT+'/execution.started',JSON.stringify({at:new Date().toISOString(),mode:'OFFLINE_MATERIALS_LAYOUT_FIRST_DIAGNOSTIC'}),{flag:'wx',mode:0o600});
const {renderMaterialPreview}=require('./compiled/materials-render.js'),{assessMaterialLayout}=require('./compiled/materials-layout.js'),{collectMaterialLayout}=require('./compiled/materials-dom-collector.js');
const CHROME='/home/barre/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',CHROME_SHA='481fea1516a1f2b76454664272f12cd9dd1f20117b21e1f1498e08bc7f872c00';assert.equal(sha(fs.readFileSync(CHROME)),CHROME_SHA);
const {chromium}=require('/home/barre/pdf_temp/scribdl-py/venv/lib/python3.12/site-packages/playwright/driver/package');
const tmp=fs.mkdtempSync('/run/user/'+process.getuid()+'/ml-');fs.chmodSync(tmp,0o700);
const resourcePins={};for(const name of ['adunir','adunir-andes','andes'])resourcePins['/logos/'+name+'.png']=sha(fs.readFileSync(SOURCE+'/site/public/logos/'+name+'.png'));
const result={classification:'OFFLINE_REAL_DOM_MEASUREMENT_NOT_EXPORT',sourceCommit:'3f96a06a8e3557099c94df19e1b95a3496496bfe',cases:[],unexpectedRequests:[],requestsForwarded:0,appOrDatabaseExecuted:false,exportImplemented:false,exit:1};let browser,closed=false;
async function fonts(context,page){
 const session=await context.newCDPSession(page);try{await session.send('DOM.enable');await session.send('CSS.enable');const {root}=await session.send('DOM.getDocument');const {nodeIds}=await session.send('DOM.querySelectorAll',{nodeId:root.nodeId,selector:'h1,.body,.action,.footer'});const names=new Map();
 for(const nodeId of nodeIds){const data=await session.send('CSS.getPlatformFontsForNode',{nodeId});for(const font of data.fonts){assert.equal(font.isCustomFont,false);assert.ok(font.postScriptName&&font.glyphCount>0);names.set(font.postScriptName,font.familyName);}}
 assert.ok(names.size>0&&names.size<=16);const records=[];for(const[postScriptName,familyName]of [...names].sort()){
  const lines=cp.execFileSync('/usr/bin/fc-match',['-f','%{file}\n%{postscriptname}\n',':postscriptname='+postScriptName],{encoding:'utf8',timeout:5000}).trim().split('\n');assert.equal(lines[1],postScriptName);const file=fs.realpathSync(lines[0]);assert.ok(file.startsWith('/usr/share/fonts/'));assert.ok(fs.statSync(file).size<=32*1024*1024);records.push({postScriptName,familyName,file,sha256:sha(fs.readFileSync(file))});}
 return records;
 }finally{await session.detach();}
}
async function main(){try{
 browser=await chromium.launch({executablePath:CHROME,headless:true,chromiumSandbox:true,timeout:30000,proxy:{server:'http://127.0.0.1:9'},env:{PATH:'/usr/bin:/bin',HOME:tmp,TMPDIR:tmp,LANG:'C.UTF-8'},args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--dns-prefetch-disable']});
 const cases=[];for(const template of ['poster-a4-v1','flyer-mono-cut-v1','social-square-v1'])for(const assetKey of ['adunir','adunir-andes','andes'])cases.push({template,assetKey,overflow:false});cases.push({template:'poster-a4-v1',assetKey:'adunir-andes',overflow:true});
 for(const[caseIndex,c]of cases.entries()){
  const name='case-'+caseIndex,content={template:c.template,assetKey:c.assetKey,title:'Petição: material de divulgação',body:c.overflow?'texto '.repeat(1000):'Conteúdo fictício para conferir a diagramação.\nTexto completo, sem publicação ou envio.',callToAction:'Participe da campanha',footer:'ADUNIR — Modelo fictício'};
  const rendered=renderMaterialPreview(content),viewport=c.template==='social-square-v1'?{width:1080,height:1080}:{width:850,height:1200};const context=await browser.newContext({viewport,deviceScaleFactor:1,javaScriptEnabled:false});const page=await context.newPage();const errors=[];page.on('pageerror',()=>errors.push('page_error'));
  await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url());if(req.method()==='GET'&&u.origin==='http://materials-measure.invalid'&&u.pathname==='/'+name&&!u.search)return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:rendered.html});if(req.method()==='GET'&&u.origin==='http://materials-measure.invalid'&&rendered.requiredAssets.includes(u.pathname)&&!u.search){const bytes=fs.readFileSync(SOURCE+'/site/public'+u.pathname);assert.equal(sha(bytes),resourcePins[u.pathname]);return route.fulfill({status:200,contentType:'image/png',body:bytes});}result.unexpectedRequests.push({method:req.method(),origin:u.origin,path:u.pathname});return route.abort();});
  const row={name,...c};try{
   await page.goto('http://materials-measure.invalid/'+name,{waitUntil:'networkidle',timeout:20000});await page.evaluate(()=>document.fonts.ready.then(()=>undefined));
   const a=await page.evaluate(collectMaterialLayout);await new Promise(resolve=>setTimeout(resolve,100));const b=await page.evaluate(collectMaterialLayout);row.samples=[a,b];
   row.fontResources=await fonts(context,page);const assets=rendered.requiredAssets.map(path=>({path,sha256:resourcePins[path]}));
   row.manifest={version:1,materialVersionId:'20261111-2222-4222-8222-222222222222',template:c.template,contentSha256:rendered.contentSha256,htmlSha256:sha(Buffer.from(rendered.html)),rendererSha256:JSON.parse(fs.readFileSync(ROOT+'/source-manifest.json')).files['site/src/lib/materials-render.ts'].sourceSha256,assetSetSha256:sha(Buffer.from(JSON.stringify(assets))),fontSetSha256:sha(Buffer.from(JSON.stringify(row.fontResources))),browserSha256:CHROME_SHA,media:'screen',deviceScaleFactor:1,viewport};
   row.fit=assessMaterialLayout(row.manifest,row.samples);row.errors=errors;row.imageStyle=await page.locator('img').first().evaluate(el=>{const s=getComputedStyle(el);return{overflowX:s.overflowX,overflowY:s.overflowY,objectFit:s.objectFit,clip:s.clip,clipPath:s.clipPath,filter:s.filter};});
   row.expectedFit=!c.overflow;row.passed=row.fit.fitPassed===row.expectedFit&&errors.length===0;
   await page.screenshot({path:ROOT+'/artifacts/'+name+'.png',fullPage:true,timeout:10000});row.screenshotSha256=sha(fs.readFileSync(ROOT+'/artifacts/'+name+'.png'));
  }catch(e){row.error=String(e);row.passed=false;}
  fs.writeFileSync(ROOT+'/artifacts/'+name+'.json',JSON.stringify(row,null,2));result.cases.push(row);await context.close();
 }
 for(const[path,h]of Object.entries(resourcePins))assert.equal(sha(fs.readFileSync(SOURCE+'/site/public'+path)),h);result.assetsStable=true;result.exit=result.cases.length===10&&result.cases.every(c=>c.passed)&&result.unexpectedRequests.length===0?0:1;
 }catch(e){result.error=String(e);}finally{if(browser){await browser.close();closed=true;}if(closed){fs.rmSync(tmp,{recursive:true});result.browserTempRemoved=true;}fs.writeFileSync(ROOT+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({exit:result.exit,cases:result.cases.map(c=>({name:c.name,passed:c.passed,error:c.error,fit:c.fit,reasons:c.fit?.reasons,imageStyle:c.imageStyle})),requestsForwarded:0,unexpectedRequests:result.unexpectedRequests,browserTempRemoved:result.browserTempRemoved}));process.exitCode=result.exit;}}
main().catch(e=>{console.error(String(e));process.exitCode=1;});
