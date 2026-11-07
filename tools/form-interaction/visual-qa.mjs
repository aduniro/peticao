import { chromium } from '/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const out='/mnt/dev/peticao/.cache/form-interaction-20261107/visual';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/barre/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',args:['--no-sandbox','--disable-dev-shm-usage']});const results=[];
for (const width of [360,390,768,1024,1440,1920])for(const category of ['Servidor(a)','Apoiador(a)','Estrangeiro(a)']){
 const snapshots=[];
 for(const [name,port] of [['baseline',3052],['candidate',3051]]) {
 const ctx=await browser.newContext({viewport:{width,height:1080},reducedMotion:'reduce'});await ctx.addInitScript(()=>localStorage.setItem('welcome1','1'));
 await ctx.route('**/*',r=>new URL(r.request().url()).hostname!=='127.0.0.1'?r.abort():new URL(r.request().url()).pathname==='/api/tour'?r.fulfill({json:{show:false}}):r.continue());
 const page=await ctx.newPage();await page.goto(`http://127.0.0.1:${port}/#assinar`,{waitUntil:'networkidle'});if(category!=='Servidor(a)')await page.locator('form.form [role="radio"]').filter({hasText:category}).click();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);
 const styles=await page.locator('form.form input[name="name"],form.form input[name="email"],form.form input[name="cpf"],form.form .form-title,form.form .segmented').evaluateAll(els=>els.map(el=>{const s=getComputedStyle(el);return {name:el.getAttribute('name')??el.className,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,lineHeight:s.lineHeight,letterSpacing:s.letterSpacing,color:s.color,background:s.backgroundColor,border:s.border,radius:s.borderRadius,padding:s.padding,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height};}));
 snapshots.push(styles);if(width===390||width===1440)await page.locator('form.form').screenshot({path:`${out}/${name}-${category.startsWith('Servidor')?'server':category.startsWith('Apoiador')?'supporter':'foreign'}-${width}.png`});await ctx.close();
 }
 assert.deepEqual(snapshots[1],snapshots[0],`${category} ${width}: unexpected visual change`);results.push({width,category,fieldTypographyColorsGeometryIdentical:true});console.log('PASS visual',width,category);
}
await browser.close();await fs.writeFile(`${out}/style-result.json`,JSON.stringify(results,null,2));
