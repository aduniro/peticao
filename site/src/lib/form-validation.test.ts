import test from "node:test";
import assert from "node:assert/strict";
import { validate, type SignInput } from "./signatures";
import { findIfes, resolveCampus, IFES, campusCities } from "./ifes-data";
import { findMunicipality } from "./geo-data";
import { isCountryCode, COUNTRY_CODES } from "@/i18n/countries";
import domainCatalog from "../../public/data/institution-domain-catalog.json";
import { resolveServerInstitutionForEmail } from "./institution-domain-policy";

const CPF = "529.982.247-25";
const base = { name: "Maria da Silva", email: "maria@gmail.com", cpf: CPF, consent: true };
const ok = (r: ReturnType<typeof validate>): SignInput => { assert.equal(r.ok, true, JSON.stringify(r)); return (r as { ok: true; value: SignInput }).value; };
const err = (r: ReturnType<typeof validate>) => { assert.equal(r.ok, false); return (r as { ok: false; errors: Record<string, string> }).errors; };
const emailFor = (institution: NonNullable<ReturnType<typeof findIfes>>) => {
  const rule = domainCatalog.find((r) => r.status === "approved" && r.institutionId === institution.id && resolveServerInstitutionForEmail(`maria@${r.domain}`)?.institutionId === institution.id);
  assert.ok(rule, `domínio MEC aprovado obrigatório para fixture ${institution.s}`);
  return `maria@${rule.domain}`;
};

test("apoiador: UF × cidade ligadas e validadas", () => {
  const a = ok(validate({ ...base, category: "apoiador", uf: "RO", city: "Porto Velho" }));
  assert.deepEqual([a.city, a.uf, a.cityIbge], ["Porto Velho", "RO", 1100205]);
  const b = ok(validate({ ...base, category: "apoiador", uf: "ro", city: "ji parana" })); // sem acento, UF em minúscula
  assert.deepEqual([b.city, b.uf], ["Ji-Paraná", "RO"]);
  assert.equal(err(validate({ ...base, category: "apoiador", uf: "SP", city: "Porto Velho" })).city, "city_invalid"); // cidade existe, mas em outra UF
  assert.equal(err(validate({ ...base, category: "apoiador", uf: "RO", city: "Cidade Inventada" })).city, "city_invalid");
  assert.equal(err(validate({ ...base, category: "apoiador", uf: "XX", city: "Cidade Inventada" })).uf, "uf_invalid");
  const c = ok(validate({ ...base, category: "apoiador", uf: "", city: "Porto Velho" })); // cidade única no país: a UF é deduzida
  assert.equal(c.uf, "RO");
  assert.equal(err(validate({ ...base, category: "apoiador", uf: "", city: "Bom Jesus" })).uf, "city_ambiguous"); // homônimos exigem a UF
  assert.equal(err(validate({ ...base, category: "apoiador", uf: "RO", city: "" })).city, "city_required");
  assert.equal(ok(validate({ ...base, category: "apoiador", uf: "PI", city: "Bom Jesus" })).uf, "PI");
});

test("IFES: sigla ou nome, campi, campus livre", () => {
  assert.ok(IFES.length >= 100);
  assert.equal(findIfes("unir")?.s, "UNIR");
  assert.equal(findIfes("UNIR - Fundação Universidade Federal de Rondônia")?.s, "UNIR");
  assert.equal(findIfes("Fundação Universidade Federal de Rondônia")?.s, "UNIR");
  assert.equal(findIfes("Universidade Inventada"), null);
  const unir = findIfes("UNIR")!;
  assert.deepEqual(campusCities(unir).map((m) => m.name).sort(), ["Ariquemes", "Cacoal", "Guajará-Mirim", "Ji-Paraná", "Porto Velho", "Presidente Médici", "Rolim de Moura", "Vilhena"]);
  assert.deepEqual(resolveCampus(unir, "Campus de Ji-Paraná", null), { ibge: findMunicipality("RO", "Ji-Paraná")!.id, listed: true, name: "Ji-Paraná" });
  assert.equal(resolveCampus(unir, "vilhena", null)?.listed, true);
  assert.equal(resolveCampus(unir, "São Paulo", null)?.listed, false); // município real, mas não é campus conhecido da UNIR
  assert.deepEqual(resolveCampus(unir, "Fazenda Experimental", null), { ibge: null, listed: false, name: "Fazenda Experimental" }); // texto livre
  assert.equal(resolveCampus(unir, "", 9999999), null); // id inexistente
});

test("servidor: IFES, campus e checkbox de Amazônia Legal / faixa de fronteira", () => {
  const sv = { ...base, email: "maria@unir.br", category: "servidor", role: "docente", institution: "UNIR" };
  const a = ok(validate({ ...sv, campus: "Ji-Paraná", regionDeclared: true }));
  assert.deepEqual([a.institution, a.ifesListed, a.campus, a.campusListed, a.regionValidated, a.regionCriteria], ["UNIR", true, "Ji-Paraná", true, true, "amazonia_legal"]);
  assert.equal(ok(validate({ ...sv, campus: "Vilhena", regionDeclared: true })).regionCriteria, "ambos");
  assert.equal(err(validate({ ...sv, regionDeclared: true })).campus, "campus_required"); // declarou a região: precisa dizer onde está lotado
  assert.equal(ok(validate({ ...sv, campus: "Vilhena" })).regionDeclared, true); // UNIR: caixa automática no backend; lotação continua obrigatória
  const nd = ok(validate({ ...sv, email: emailFor(findIfes("UFPR")!), institution: "UFPR", campus: "Vilhena" })); // UFPR tem campi fora da região: pode não declarar; campus de outra instituição é ignorado
  assert.deepEqual([nd.regionValidated, nd.campus, nd.role], [false, undefined, "docente"]); // o cargo agora vale mesmo sem declarar a região
  // tentativa de burlar: declara região, mas o campus fica fora das listas oficiais
  assert.equal(err(validate({ ...sv, campus: "São Paulo", regionDeclared: true })).region, "region_not_eligible");
  assert.equal(err(validate({ ...sv, campus: "Fazenda Experimental", regionDeclared: true })).region, "region_not_eligible"); // campus livre, sem município
  assert.equal(err(validate({ ...sv, institution: "Instituto Inventado", regionDeclared: true })).region, "region_ifes_not_eligible"); // IFES fora da lista não marca a caixa
  const f = ok(validate({ ...sv, email: emailFor(findIfes("UNILA")!), institution: "UNILA", campus: "Foz do Iguaçu", regionDeclared: true })); // fora da Amazônia, mas faixa de fronteira
  assert.deepEqual([f.regionValidated, f.regionCriteria], [true, "faixa_fronteira"]);
  const nf = err(validate({ ...sv, institution: "Instituto Inventado" }));
  assert.equal(nf.institution, "ifes_required"); // instituição fora do catálogo é rejeitada também sem checkbox
  assert.equal(err(validate({ ...sv, role: "", campus: "Ji-Paraná", regionDeclared: true })).role, "role_required");
  assert.equal(err(validate({ ...sv, institution: "UFPR", role: "" })).role, "role_required"); // o cargo é obrigatório para todo servidor, mesmo sem declarar a região
  assert.equal(ok(validate({ ...sv, email: emailFor(findIfes("UFPR")!), institution: "UFPR", role: "tae" })).role, "tae");
  const mismatch = err(validate({ ...sv, institution: "UFPR", role: "tae" }));
  assert.equal(mismatch.email, "institution_email_mismatch");
  assert.equal(mismatch.institution, "institution_email_mismatch");
  assert.equal(err(validate({ ...sv, institution: "" })).institution, "ifes_required");
  assert.equal(err(validate({ ...sv, cpf: "111.111.111-11" })).cpf, "cpf_invalid");
});

test("região: só instituição federal da lista com sede ou campus na Amazônia Legal/faixa de fronteira marca a caixa, e só com campus dela na região", async () => {
  const { SERVER_INSTITUTIONS, ifesEligible, regionCampusIds } = await import("./ifes-data");
  const sv = { ...base, category: "servidor", role: "docente" };
  const inel = SERVER_INSTITUTIONS.find((i) => !ifesEligible(i))!; // instituição MEC sem nenhum campus na região
  assert.ok(inel, "esperava ao menos uma instituição inelegível nos dados");
  assert.equal(err(validate({ ...sv, email: emailFor(inel), institution: inel.s, campus: "Porto Velho", regionDeclared: true })).region, "region_ifes_not_eligible");
  // sem declarar a região, a instituição inelegível assina normalmente (como qualquer servidor)
  assert.equal(ok(validate({ ...sv, email: emailFor(inel), institution: inel.s })).regionValidated, false);
  // instituição elegível com campus fora da região: o campus não vale
  const mixed = SERVER_INSTITUTIONS.find((i) => ifesEligible(i) && i.id !== "org:ebserh" && i.c.some((id) => !regionCampusIds(i).includes(id)))!;
  const outId = mixed.c.find((id) => !regionCampusIds(mixed).includes(id))!;
  const { municipalityById } = await import("./geo-data");
  const out = municipalityById(outId)!;
  const e = err(validate({ ...sv, email: emailFor(mixed), institution: mixed.s, campus: out.name, campusIbge: outId, regionDeclared: true }));
  assert.equal(e.region, "region_not_eligible");
  // campus na região mas que não é da instituição
  const e2 = err(validate({ ...sv, email: "maria@unir.br", institution: "UNIR", campus: "Manaus", regionDeclared: true }));
  assert.ok(e2.campus === "campus_not_in_ifes" || e2.region, JSON.stringify(e2));
  // as instituições do Norte estão elegíveis
  for (const sg of ["UNIR", "UFAC", "UFAM", "UFPA", "IFRO", "IFAM"]) { const i = IFES.find((x) => x.s === sg); if (i) assert.ok(ifesEligible(i), sg + " deveria ser elegível"); }
});

test("estrangeiro: país, universidade e sem CPF", () => {
  const e = ok(validate({ name: "Anna Müller", email: "anna@uni-heidelberg.de", category: "estrangeiro", country: "de", university: "Universität Heidelberg", consent: true, locale: "de" }));
  assert.deepEqual([e.country, e.university, e.cpf, e.locale], ["DE", "Universität Heidelberg", undefined, "de"]);
  assert.equal(err(validate({ name: "Anna Müller", email: "a@b.de", category: "estrangeiro", country: "BR", university: "X Y", consent: true })).country, "country_invalid");
  assert.equal(err(validate({ name: "Anna Müller", email: "a@b.de", category: "estrangeiro", country: "ZZ", university: "X Y", consent: true })).country, "country_invalid");
  assert.equal(err(validate({ name: "Anna Müller", email: "a@b.de", category: "estrangeiro", country: "DE", university: "", consent: true })).university, "university_required");
  assert.equal(isCountryCode("de"), true); assert.equal(isCountryCode("XX"), false);
  assert.equal(new Set(COUNTRY_CODES).size, COUNTRY_CODES.length); // sem duplicatas
});
