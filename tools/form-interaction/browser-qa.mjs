import {chromium} from '/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const out='/mnt/dev/peticao/.cache/form-interaction-20261107/visual';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/barre/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
const passed=[];const failures=[];
async function scenario(title,work,width=390) {
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
 await context.addInitScript(()=>localStorage.setItem('welcome1','1'));
 const errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();if(u.pathname==='/api/tour')return route.fulfill({json:{show:false}});if(u.pathname==='/api/sign-diagnostic')return route.fulfill({status:204});if(u.pathname==='/api/email/validar')return route.fulfill({json:{ok:true}});return route.continue();});
 try {await page.goto('http://127.0.0.1:3051/#assinar',{waitUntil:'networkidle'});await work(page,context);assert.deepEqual(errors,[]);passed.push(title);console.log('PASS',title);}catch(e){failures.push({title,error:String(e)});await page.screenshot({path:`${out}/failed-${passed.length}.png`});console.log('FAIL',title,String(e));}finally{await context.close();}
}
const field=(p,name)=>p.locator(`form.form input[name="${name}"]`);
const submit=p=>p.locator('form.form button.primary:not([type="button"])').click();
const tab=(p,name)=>p.locator('form.form [role="radio"]').filter({hasText:name}).click();
const invalid=async(p,name,yes)=>assert.equal(await field(p,name).getAttribute('aria-invalid'),String(yes));
const modal=async(p,yes)=>assert.equal(await p.locator('dialog[open]').count(),yes?1:0);
for(const category of ['Servidor(a)','Apoiador(a)']) await scenario(`${category}: CPF blur/focus/full invalid/full valid`,async p=>{
 if(category==='Apoiador(a)')await tab(p,category);
 await field(p,'cpf').fill('123');await field(p,'name').focus();await invalid(p,'cpf',true);await modal(p,false);
 await field(p,'cpf').focus();await invalid(p,'cpf',false);assert.equal(await p.locator('#cpf-erro').count(),0);
 await field(p,'cpf').fill('11111111111');await invalid(p,'cpf',true);assert.equal(await p.locator('#cpf-erro').textContent(),'CPF inválido.');
 assert.equal(await field(p,'cpf').evaluate(el=>getComputedStyle(el).borderTopWidth),'2px');
 await field(p,'cpf').fill('1234567890');await invalid(p,'cpf',false);
 await field(p,'cpf').fill('12345678909');await invalid(p,'cpf',false);await modal(p,false);
});
for(const category of ['Servidor(a)','Apoiador(a)']) await scenario(`${category}: mismatch preserves values, one submit modal, focus clears name`,async p=>{
 if(category==='Apoiador(a)')await tab(p,category);
 await p.route('**/api/assinar',r=>r.fulfill({status:422,json:{errors:{name:'name_cpf_mismatch'}}}));
 await field(p,'name').fill('Nome Ficticio Teste');await field(p,'email').fill(category==='Servidor(a)'?'qa@unir.br':'qa@gmail.com');await field(p,'cpf').fill('12345678909');
 await submit(p);await p.waitForSelector('dialog[open]');await modal(p,true);await invalid(p,'name',true);assert.equal(await field(p,'cpf').inputValue(),'123.456.789-09');
 await p.locator('dialog[open] button').click();await p.waitForTimeout(150);await invalid(p,'name',false);assert.equal(await field(p,'name').evaluate(el=>el===document.activeElement),true);
 await field(p,'email').focus();await invalid(p,'name',false);await modal(p,false);
 await submit(p);await p.waitForSelector('dialog[open]');await invalid(p,'name',true);
});
await scenario('Category reset clears values, consent and errors; same tab preserves data',async p=>{
 await field(p,'name').fill('Teste Usuario');await field(p,'email').fill('qa@unir.br');await field(p,'cpf').fill('123');await field(p,'name').focus();await p.locator('input[name="consent"]').check();await invalid(p,'cpf',true);
 await tab(p,'Servidor(a)');assert.equal(await field(p,'name').inputValue(),'Teste Usuario');
 await tab(p,'Apoiador(a)');for(const f of ['name','email','cpf'])assert.equal(await field(p,f).inputValue(),'');assert.equal(await p.locator('input[name="consent"]').isChecked(),false);await invalid(p,'cpf',false);
 await field(p,'name').fill('Outro Teste');await field(p,'email').fill('qa@gmail.com');await field(p,'cpf').fill('12345678909');await field(p,'uf').fill('RO');await field(p,'city').fill('Porto Velho');
 await tab(p,'Estrangeiro(a)');for(const f of ['name','email'])assert.equal(await field(p,f).inputValue(),'');assert.equal(await field(p,'cpf').count(),0);
 await tab(p,'Apoiador(a)');for(const f of ['name','email','cpf','uf','city'])assert.equal(await field(p,f).inputValue(),'');
 await tab(p,'Servidor(a)');for(const f of ['name','email','cpf','institution'])assert.equal(await field(p,f).inputValue(),'');await modal(p,false);
});
await scenario('Late email response cannot contaminate another category with identical email',async p=>{
 let release;let arrived;const received=new Promise(r=>arrived=r);const gate=new Promise(r=>release=r);
 await p.route('**/api/email/validar',async r=>{const {category}=r.request().postDataJSON();if(category==='servidor'){arrived();await gate;return r.fulfill({json:{ok:false,code:'email_institutional_invalid'}});}return r.fulfill({json:{ok:true}});});
 await field(p,'email').fill('qa@unir.br');await field(p,'name').focus();await received;
 await tab(p,'Apoiador(a)');await field(p,'email').fill('qa@unir.br');release();await p.waitForTimeout(200);await invalid(p,'email',false);await modal(p,false);
});
await scenario('Institutional examples and no personal suggestion; supporter prefix priority',async p=>{
 assert.match(await p.locator('form.form').innerText(),/universidade federal ou instituto federal \(unir.br, ufmg.br, ifro.edu.br\)/);
 await field(p,'email').fill('qa-sem-arroba');await field(p,'name').focus();await modal(p,false);const text=await p.locator('label[data-tour="email"]').innerText();assert.match(text,/nome@universidade.br ou nome@universidade.edu.br/);assert.doesNotMatch(text,/seunome@gmail|Você quis dizer.*gmail/);
 await tab(p,'Apoiador(a)');for(const [domain,target] of [['g.com','gmail.com'],['o.com','outlook.com'],['gmx.con','gmx.com']]){await field(p,'email').fill(`qa@${domain}`);await field(p,'name').focus();await p.waitForTimeout(50);assert.match(await p.locator('label[data-tour="email"]').innerText(),new RegExp(`Você quis dizer qa@${target.replaceAll('.','\\.')}\\?`));}await modal(p,false);
 await p.screenshot({path:`${out}/supporter-suggestion-390.png`});
});
await scenario('Multiple backend errors use a single modal and retain fields',async p=>{
 await p.route('**/api/assinar',r=>r.fulfill({status:422,json:{errors:{name:'name_cpf_mismatch',email:'email_institutional_invalid'}}}));
 await field(p,'name').fill('Nome Ficticio');await field(p,'email').fill('qa@unir.br');await field(p,'cpf').fill('12345678909');await submit(p);await p.waitForSelector('dialog[open]');await modal(p,true);await invalid(p,'name',true);await invalid(p,'email',true);await p.locator('dialog[open] button').click();await p.waitForTimeout(150);assert.equal(await field(p,'name').evaluate(e=>e===document.activeElement),true);
});
await scenario('Real compiled backend returns field errors and technical logging remains available',async p=>{
 await field(p,'name').fill('Nome Ficticio Teste');await field(p,'email').fill('qa@unir.br');await field(p,'cpf').fill('12345678909');
 const response=p.waitForResponse(r=>r.url().endsWith('/api/assinar'));await submit(p);const r=await response;assert.equal(r.status(),422);const data=await r.json();assert.ok(data.errors.institution);assert.ok(data.errors.consent);await p.waitForSelector('dialog[open]');await modal(p,true);await invalid(p,'institution',true);assert.equal(await field(p,'name').inputValue(),'Nome Ficticio Teste');
 const diagnostic=await p.request.post('http://127.0.0.1:3051/api/sign-diagnostic',{headers:{Origin:'http://127.0.0.1:3051'},data:{trace:'00000000-0000-4000-8000-000000000001',event:'client_invalid',field:'cpf'}});assert.equal(diagnostic.status(),204);
 const admin=await p.request.get('http://127.0.0.1:3051/api/admin/diagnosticos/assinaturas');assert.equal(admin.status(),401);
});
await scenario('Late submission error cannot reopen a modal after switching categories',async p=>{
 let release;let arrived;const gate=new Promise(r=>release=r);const received=new Promise(r=>arrived=r);
 await p.route('**/api/assinar',async r=>{arrived();await gate;await r.fulfill({status:422,json:{errors:{name:'name_cpf_mismatch'}}});});
 await field(p,'name').fill('Nome Ficticio Teste');await field(p,'email').fill('qa@unir.br');await field(p,'cpf').fill('12345678909');await submit(p);await received;await tab(p,'Apoiador(a)');release();await p.waitForTimeout(150);await modal(p,false);await invalid(p,'name',false);assert.equal(await field(p,'name').inputValue(),'');
});
await fs.writeFile(`${out}/browser-result.json`,JSON.stringify({passed,failures},null,2));await browser.close();if(failures.length)process.exitCode=1;
