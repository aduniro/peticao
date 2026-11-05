"use client";
import { useEffect, useMemo, useState } from "react";
import Help from "./Help";
import Combobox, { type Option } from "./Combobox";
import { useI18n } from "@/i18n/client";
import { countryName } from "@/i18n";
import { FOREIGN_COUNTRY_CODES } from "@/i18n/countries";
import { loadGeo, loadIfes, norm, rank, squash, type Geo, type Ifes, type Mun } from "@/lib/datasets-client";

const UF_NAMES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão",
  MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};
const UFS = Object.keys(UF_NAMES);

function useGeo(): Geo | null {
  const [g, setG] = useState<Geo | null>(null);
  useEffect(() => { let on = true; loadGeo().then((x) => on && setG(x)).catch(() => {}); return () => { on = false; }; }, []);
  return g;
}
const Err = ({ msg }: { msg?: string }) => (msg ? <span className="err">{msg}</span> : null);

/** Apoiador: UF à esquerda, Cidade à direita, ligadas. A UF filtra as cidades; escolher a cidade preenche a UF. */
export function UfCityFields({ uf, city, setUf, setCity, errors }: { uf: string; city: string; setUf: (v: string) => void; setCity: (v: string) => void; errors: Record<string, string> }) {
  const { t } = useI18n();
  const geo = useGeo();
  const ufOk = UFS.includes(uf);
  const ufOptions: Option[] = useMemo(() => rank(UFS.map((u) => ({ key: u, label: u, hint: UF_NAMES[u] })), uf, (o) => `${o.label} ${o.hint}`, 27), [uf]);
  const cityOptions: Option[] = useMemo(() => {
    if (!geo) return [];
    const pool = ufOk ? geo.muns.filter((m) => m.uf === uf) : geo.muns;
    return rank(pool, city, (m) => m.name, 60).map((m) => ({ key: String(m.id), label: m.name, hint: ufOk ? undefined : m.uf }));
  }, [geo, uf, ufOk, city]);
  const changeCity = (v: string) => {
    setCity(v);
    if (geo && v.trim().length > 2 && !ufOk) {
      const q = squash(v);
      const same = geo.muns.filter((m) => squash(m.name) === q);
      const longer = geo.muns.some((m) => squash(m.name) !== q && squash(m.name).startsWith(q)); // "Porto" ainda pode virar "Porto Velho"
      if (same.length === 1 && !longer) setUf(same[0].uf);
    }
  };
  return (
    <div className="row uf-city" data-tour="ufcity">
      <label className="uf">{t("f.uf")}
        <Combobox name="uf" value={uf} placeholder={t("f.ufPlaceholder")} options={ufOptions} invalid={!!errors.uf} ariaLabel={t("f.uf")} inputMode="search"
          onChange={(v) => { const u = v.toUpperCase().slice(0, 20); setUf(u); if (geo && UFS.includes(u) && city) { const there = geo.muns.some((m) => m.uf === u && squash(m.name) === squash(city)); const elsewhere = geo.muns.some((m) => squash(m.name) === squash(city)); if (!there && elsewhere) setCity(""); } }}
          onPick={(o) => { setUf(o.key); if (geo && city) { const m = geo.muns.find((x) => x.uf === o.key && squash(x.name) === squash(city)); if (!m) setCity(""); } }} />
        <Err msg={errors.uf} /></label>
      <label className="city">{t("f.city")}
        <Combobox name="city" value={city} placeholder={ufOk ? t("f.cityPlaceholder") : t("f.cityPickUf")} options={cityOptions} invalid={!!errors.city} ariaLabel={t("f.city")} emptyText={t("f.cityNone")} autoComplete="off"
          onChange={changeCity} onPick={(o) => { const m = geo?.byId.get(Number(o.key)); setCity(o.label); if (m) setUf(m.uf); }} />
        <Err msg={errors.city} /></label>
    </div>
  );
}

export type ServerState = { institution: string; ifes: Ifes | null; role: string; campus: string; campusIbge: number | null; region: boolean };

/** Servidor: IFES (digitável por sigla), "Campus de:" filtrado pela IFES e o checkbox da Amazônia Legal / Faixa de Fronteira. */
export function IfesCampusFields({ s, set, errors }: { s: ServerState; set: (p: Partial<ServerState>) => void; errors: Record<string, string> }) {
  const { t } = useI18n();
  const geo = useGeo();
  const [all, setAll] = useState<Ifes[]>([]);
  useEffect(() => { let on = true; loadIfes().then((x) => on && setAll(x)).catch(() => {}); return () => { on = false; }; }, []);
  const ifesOptions: Option[] = useMemo(() => rank(all, s.institution, (i) => `${i.s} ${i.n}`, 60).map((i) => ({ key: i.s, label: i.s, hint: i.n })), [all, s.institution]);
  const findIfes = (text: string) => { const head = text.trim().split(/\s[-–—]\s/)[0]; return all.find((i) => squash(i.s) === squash(head)) ?? all.find((i) => squash(i.n) === squash(text)) ?? null; };
  // Locais da instituição (sede e campi) que estão na Amazônia Legal e/ou na faixa de fronteira: só eles contam para a caixa e para "Lotado em".
  const regionMuns: Mun[] = useMemo(() => {
    if (!geo || !s.ifes) return [];
    const ids = [...new Set([s.ifes.m, ...s.ifes.c])].filter((id) => geo.al.has(id) || geo.ff.has(id));
    return ids.map((id) => geo.byId.get(id)).filter((m): m is Mun => !!m).sort((a, b) => a.name.localeCompare(b.name, "pt"));
  }, [geo, s.ifes]);
  // Todos os campi da instituição aparecem na lista; os que ficam fora da região vêm marcados e não contam como lotação na região (a assinatura vale do mesmo jeito).
  const inRegion = (id: number) => !!geo && (geo.al.has(id) || geo.ff.has(id));
  const allMuns: Mun[] = useMemo(() => {
    if (!geo || !s.ifes) return [];
    return [...new Set([s.ifes.m, ...s.ifes.c])].map((id) => geo.byId.get(id)).filter((m): m is Mun => !!m).sort((a, b) => a.name.localeCompare(b.name, "pt"));
  }, [geo, s.ifes]);
  const campusOptions: Option[] = useMemo(() => rank(allMuns, s.campus, (m) => m.name, 60).map((m) => ({ key: String(m.id), label: m.name, hint: inRegion(m.id) ? m.uf : `${m.uf} · ${t("f.campusOutside")}` })), [allMuns, s.campus, geo]); // eslint-disable-line react-hooks/exhaustive-deps
  const campusOutside = !!s.campusIbge && !inRegion(s.campusIbge) && allMuns.some((m) => m.id === s.campusIbge);
  const eligible = !!s.ifes && regionMuns.length > 0;
  const mustRegion = !!geo && !!s.ifes && [...new Set([s.ifes.m, ...s.ifes.c])].every((id) => geo.al.has(id)); // todos os campi na Amazônia Legal: marcar é obrigatório
  useEffect(() => { if (geo && !eligible && s.region) set({ region: false, campus: "", campusIbge: null }); }, [eligible, geo]); // eslint-disable-line react-hooks/exhaustive-deps
  const why = !s.ifes ? t("f.region.noIfes") : !geo ? "" : !eligible ? t("f.region.ineligible") : t("f.region.eligibleN", { n: regionMuns.length });

  return (
    <>
      <label data-tour="ifes">{t("f.ifes")}
        <Combobox name="institution" value={s.institution} placeholder={t("f.ifesPlaceholder")} options={ifesOptions} invalid={!!errors.institution} ariaLabel={t("f.ifes")} inputMode="search"
          onChange={(v) => set({ institution: v, ifes: findIfes(v), campus: findIfes(v)?.s === s.ifes?.s ? s.campus : "", campusIbge: null })}
          onPick={(o) => { const i = all.find((x) => x.s === o.key) ?? null; set({ institution: o.key, ifes: i, campus: "", campusIbge: null }); }} />
        <span className="hint">{t("f.ifesHint")}</span><Err msg={errors.institution} /></label>
      <label data-tour="role">{t("f.role")}
        <select name="role" required value={s.role} onChange={(e) => set({ role: e.target.value })} aria-invalid={!!errors.role}>
          <option value="" disabled>{t("f.roleSelect")}</option>
          <option value="docente">{t("f.roleDocente")}</option>
          <option value="tae">{t("f.roleTae")}</option>
        </select><Err msg={errors.role} /></label>
      <div className={`region${eligible ? "" : " off"}`} data-tour="region">
        <label className="check"><input type="checkbox" name="region" required={mustRegion} aria-required={mustRegion} checked={s.region} disabled={!eligible} onChange={(e) => set(e.target.checked ? { region: true, ...(campusOutside ? { campus: "", campusIbge: null } : {}) } : { region: false, campus: "", campusIbge: null })} /> <span>{t("f.region")}<Help text={t("help.region")} /></span></label>
        <small className={eligible ? "ok" : ""}>{why}{mustRegion && <> <strong>{t("f.region.required")}</strong></>}</small>
        <Err msg={errors.region} />
      </div>
      {(s.region || campusOutside) && (
        <>
          <label data-tour="campus">{t("f.campus")}<Help text={t("help.campus")} />
            <Combobox name="campus" value={s.campus} placeholder={s.ifes ? t("f.campusPlaceholder") : t("f.campusPickIfes")} options={campusOptions} invalid={!!errors.campus} ariaLabel={t("f.campus")}
              emptyText={t("f.campusNone")} disabled={!s.institution.trim()}
              onChange={(v) => set({ campus: v, campusIbge: null })} onPick={(o) => { const id = Number(o.key); set(inRegion(id) ? { campus: o.label, campusIbge: id } : { campus: o.label, campusIbge: id, region: false }); }} />
            <span className="hint">{t("f.campusHint")}</span><Err msg={errors.campus} /></label>
          {campusOutside && <span className="hint" role="status">{t("f.campusOutsideNote")}</span>}
        </>
      )}
    </>
  );
}

/** Estrangeiro: país da instituição (todos, menos o Brasil, nomes no idioma da tela) e universidade digitável com sugestões da base mundial. */
export function CountryUniversityFields({ country, setCountry, university, setUniversity, errors }: { country: string; setCountry: (v: string) => void; university: string; setUniversity: (v: string) => void; errors: Record<string, string> }) {
  const { t, lang } = useI18n();
  const [uniOpts, setUniOpts] = useState<Option[]>([]);
  const countries = useMemo(() => FOREIGN_COUNTRY_CODES.map((c) => ({ c, n: countryName(c, lang) })).sort((a, b) => a.n.localeCompare(b.n, lang)), [lang]);
  useEffect(() => {
    if (!country) { setUniOpts([]); return; }
    const ctl = new AbortController();
    const h = setTimeout(() => {
      fetch(`/api/universidades?c=${country}&q=${encodeURIComponent(university)}`, { signal: ctl.signal }).then((r) => r.json()).then((d) => setUniOpts((d.items as { name: string; domain: string }[]).map((x) => ({ key: x.name, label: x.name, hint: x.domain })))).catch(() => {});
    }, 180);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [country, university]);
  return (
    <>
      <label data-tour="country">{t("f.country")}
        <span className="country-select">
          {country && <img src={`/flags/${country.toLowerCase()}.svg`} alt="" width={22} height={16} />}
          <select name="country" value={country} onChange={(e) => { setCountry(e.target.value); setUniversity(""); }} aria-invalid={!!errors.country}>
            <option value="" disabled>{t("f.countrySelect")}</option>
            {countries.map((x) => <option key={x.c} value={x.c}>{x.n}</option>)}
          </select>
        </span><Err msg={errors.country} /></label>
      <label data-tour="university">{t("f.university")}<Help text={t("help.university")} />
        <Combobox name="university" value={university} placeholder={country ? t("f.universityPlaceholder") : t("f.universityPickCountry")} options={uniOpts} invalid={!!errors.university} ariaLabel={t("f.university")} disabled={!country}
          onChange={setUniversity} onPick={(o) => setUniversity(o.label)} />
        <span className="hint">{t("f.universityHint")}</span><Err msg={errors.university} /></label>
    </>
  );
}
