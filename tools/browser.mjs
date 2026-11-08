import { chromium } from "/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const root = "/mnt/dev/peticao-laboratorio";
const results = { cases: [], errors: [], normalization: ["reduced motion", "same local widget", "welcome dismissed", "tour disabled for automation", "caret hidden"] };
const browser = await chromium.launch({ headless: true, executablePath: "/home/barre/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome", args: ["--no-sandbox","--disable-dev-shm-usage"] });
const field = (p, n) => p.locator('form.form input[name="' + n + '"]');
const tab = (p, n) => p.locator("form.form [role=radio]").filter({ hasText: n }).click();
const submit = p => p.locator("form.form button[data-track=assinar]").click();
const close = p => p.locator("dialog[open] .modal-actions button").last().click();
async function context(version, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", locale: "pt-BR", timezoneId: "America/Porto_Velho" });
  await ctx.addInitScript(() => localStorage.setItem("welcome1", "1"));
  const p = await ctx.newPage();
  p.on("pageerror", e => results.errors.push({ version, message: e.message }));
  await ctx.route("**/*", route => {
    const u = new URL(route.request().url());
    if (u.hostname !== "127.0.0.1") return route.abort();
    if (u.pathname === "/api/tour") return route.fulfill({ json: { show: false } });
    return route.continue();
  });
  await p.goto("http://127.0.0.1:" + (version === "a" ? 3040 : 3041) + "/", { waitUntil: "networkidle", timeout: 90000 });
  await p.evaluate(() => document.fonts.ready);
  await p.locator("form.form").waitFor();
  return { ctx, p };
}
async function capture(p, version, name, whole = false) {
  const options = { path: root + "/reports/" + version + "-" + name + ".png", animations: "disabled", caret: "hide" };
  if (whole) await p.screenshot({ ...options, fullPage: true });
  else await p.locator("form.form").screenshot(options);
}
async function record(name, version, fn) {
  try { const detail = await fn(); results.cases.push({ name, version, status: "passed", detail }); console.log("PASS", version, name); }
  catch (e) { results.cases.push({ name, version, status: "failed", error: String(e) }); console.log("FAIL", version, name, String(e)); }
}
async function fillSupporter(p, name = "Pessoa Ficticia Teste", email = "qa-lab-browser@gmail.com") {
  await tab(p, "Apoiador(a)");
  await field(p, "name").fill(name); await field(p, "email").fill(email);
  await field(p, "cpf").fill("52998224725"); await field(p, "uf").fill("RO"); await field(p, "city").fill("Porto Velho");
  await p.locator("form.form input[name=consent]").check();
}
try {
  // Capture the same untouched fixtures before any submit changes the counters.
  for (const width of [390,768,1440]) for (const version of ["a","b"]) {
    const {ctx,p} = await context(version,width);
    try { await record("visual-"+width,version,async()=>{
      await capture(p,version,"home-"+width,true);
      await capture(p,version,"servidor-"+width);
      await tab(p,"Apoiador(a)");await capture(p,version,"apoiador-"+width);
      await tab(p,"Estrangeiro(a)");await capture(p,version,"estrangeiro-"+width);
      return { width, screenshots: 4 };
    }); } finally { await ctx.close(); }
  }
  for (const version of ["a","b"]) {
    const {ctx,p} = await context(version,390);
    try {
      await record("cpf-blur-focus-mathematical",version,async()=>{
        await field(p,"cpf").fill("123");await field(p,"name").focus();
        await p.waitForFunction(()=>document.querySelector('input[name=cpf]')?.getAttribute("aria-invalid")==="true");
        await capture(p,version,"cpf-incompleto-blur-390");
        await field(p,"cpf").focus();
        await p.waitForFunction(()=>document.querySelector('input[name=cpf]')?.getAttribute("aria-invalid")==="false");
        await capture(p,version,"cpf-incompleto-focus-390");
        await field(p,"cpf").fill("11111111111");
        await p.waitForFunction(()=>document.querySelector('input[name=cpf]')?.getAttribute("aria-invalid")==="true");
        await capture(p,version,"cpf-completo-invalido-390");
      });
      await record("category-reset-and-single-submit-modal",version,async()=>{
        await field(p,"name").fill("Pessoa Ficticia Teste");await field(p,"email").fill("qa-lab@unir.br");
        await tab(p,"Apoiador(a)");
        for(const n of ["name","email","cpf"])assert.equal(await field(p,n).inputValue(),"");
        await field(p,"email").fill("invalido");await field(p,"name").focus();
        assert.equal(await p.locator("dialog[open]").count(),0);
        await submit(p);await p.waitForSelector("dialog[open]");
        assert.equal(await p.locator("dialog[open]").count(),1);await capture(p,version,"erros-modal-390");await close(p);
      });
      await record("name-mismatch-and-focus",version,async()=>{
        await fillSupporter(p,"Pessoa Errada","qa-lab-mismatch@gmail.com");
        const pending=p.waitForResponse(r=>new URL(r.url()).pathname==="/api/assinar");
        await submit(p);const data=await(await pending).json();assert.ok(data.errors?.name,JSON.stringify(data));
        await p.waitForSelector("dialog[open]");await close(p);
        assert.equal(await field(p,"name").getAttribute("aria-invalid"),"true");
        await capture(p,version,"nome-mismatch-390");await field(p,"name").focus();
        await p.waitForFunction(()=>document.querySelector('input[name=name]')?.getAttribute("aria-invalid")==="false");
        await capture(p,version,"nome-correcao-focus-390");
      });
      await record("fetch-failure-preserves-fields",version,async()=>{
        await fillSupporter(p,"Pessoa Ficticia Teste","qa-lab-network@gmail.com");
        await p.route("**/api/assinar",r=>r.abort("failed"),{times:1});
        await submit(p);await p.waitForSelector("dialog[open]");
        assert.equal(await field(p,"name").inputValue(),"Pessoa Ficticia Teste");
        assert.equal(await field(p,"email").inputValue(),"qa-lab-network@gmail.com");
        assert.equal(await field(p,"cpf").inputValue(),"529.982.247-25");
        await capture(p,version,"rede-modal-390");await close(p);
      });
    } finally {await ctx.close();}
  }
  // Real backend routes, with synthetic adapters and completely separate databases.
  for (const version of ["a","b"]) {
    const base="http://127.0.0.1:"+(version==="a"?3040:3041);
    const post=async(path,body)=>{const r=await fetch(base+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
    await record("email-eligibility-api",version,async()=>{
      const values={};
      for(const [domain,category] of [["sou.ucpel.edu.br","servidor"],["sou.ucpel.edu.br","apoiador"],["saude.gov.br","servidor"],["ebserh.gov.br","servidor"],["hubrasil.gov.br","servidor"]]) {
        const r=await post("/api/email/validar",{email:"qa-lab@"+domain,category});
        values[domain+"/"+category]=r;
        if(version==="b")assert.equal(r.data.ok,category==="apoiador"||["ebserh.gov.br","hubrasil.gov.br"].includes(domain),JSON.stringify(r));
      }
      return values;
    });
    const input={name:"Pessoa Ficticia Teste",email:"qa-lab-honeypot@gmail.com",cpf:"11144477735",category:"apoiador",uf:"RO",city:"Porto Velho",consent:true,website:"autofill"};
    await record("honeypot-regression-observed",version,async()=>{
      const r=await post("/api/assinar",{...input,turnstileToken:"invalid-lab"});
      if(version==="a")assert.equal(r.data.ok,true,"Expected captured legacy false success");
      else {assert.equal(r.status,422);assert.equal(r.data.securityRetry,true);}
      return {expected_difference:true,...r};
    });
    await record("supporter-identity-complete",version,async()=>{
      const body={...input,email:"qa-lab-identity@gmail.com",cpf:"52998224725",website:"",turnstileToken:"valid-"+crypto.randomUUID()};
      const first=await post("/api/assinar",body);assert.equal(first.data.identityRequired,true,JSON.stringify(first));
      const final=await post("/api/assinar",{...body,ticket:first.data.ticket,securityProof:first.data.securityProof,turnstileToken:"valid-"+crypto.randomUUID(),identity:{method:"mae",value:"Ana Maria Da Conceicao"}});
      assert.equal(final.data.ok,true,JSON.stringify(final));return {first_status:first.status,final_status:final.status,registered:final.data.ok};
    });
  }
} finally {
  await browser.close();
  await fs.writeFile(root+"/reports/browser-results.json",JSON.stringify(results,null,2));
}
if(results.errors.length||results.cases.some(c=>c.status==="failed"))process.exitCode=1;
