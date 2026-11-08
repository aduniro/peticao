/**
 * POLÍTICA CENTRAL — rodízio ("semeadura") entre serviços de e-mail: em vez de mandar tudo por um único serviço, cada mensagem começa por
 * um serviço diferente, na proporção dos pesos (MAIL_ROTATION="ses:6,sendpulse:3,mailersend:1"). Isso espalha a reputação, evita depender de
 * um só provedor e dá volume de teste a todos. O failover continua: se o escolhido falha, tenta os outros.
 *  - Disjuntor: um serviço que falhou várias vezes seguidas sai do rodízio por alguns minutos (volta sozinho).
 *  - "evitar": serviços que já enviaram a esta pessoa vão para o fim da fila (política de reenvio: usar OUTRO serviço).
 * Sem MAIL_ROTATION, a ordem da cadeia é mantida (comportamento antigo).
 */
export type Pesos = Record<string, number>;

export function parsePesos(raw: string | undefined | null): Pesos | null {
  if (!raw?.trim()) return null;
  const out: Pesos = {};
  for (const par of raw.split(",")) {
    const [p, n] = par.split(":").map((x) => x.trim());
    const peso = Number(n ?? 1);
    if (p && Number.isFinite(peso) && peso > 0) out[p.toLowerCase()] = peso;
  }
  return Object.keys(out).length ? out : null;
}

type Estado = { atual: Record<string, number>; falhas: Record<string, { n: number; ate: number }> };
const estados = new Map<string, Estado>();
const estadoDe = (canal: string): Estado => { let e = estados.get(canal); if (!e) { e = { atual: {}, falhas: {} }; estados.set(canal, e); } return e; };
export const _resetRodizio = () => estados.clear();

const FALHAS_PARA_ABRIR = 3;
const PAUSA_MS = 5 * 60_000;

/** Registra o resultado de uma tentativa (alimenta o disjuntor). */
export function registrar(canal: string, provedor: string, ok: boolean, agora = Date.now()) {
  const f = estadoDe(canal).falhas;
  if (ok) { delete f[provedor]; return; }
  const x = f[provedor] ?? { n: 0, ate: 0 };
  x.n++; if (x.n >= FALHAS_PARA_ABRIR) x.ate = agora + PAUSA_MS;
  f[provedor] = x;
}
export const aberto = (canal: string, provedor: string, agora = Date.now()) => (estadoDe(canal).falhas[provedor]?.ate ?? 0) > agora;

/** Ordem de tentativa para UMA mensagem. `cadeia` é a ordem configurada (usada como desempate e como reserva). */
export function ordemRodizio(canal: string, cadeia: string[], pesos: Pesos | null, o: { evitar?: string[]; agora?: number } = {}): string[] {
  const agora = o.agora ?? Date.now();
  const evitar = new Set((o.evitar ?? []).map((x) => x.toLowerCase()));
  if (!pesos) return cadeia;
  const e = estadoDe(canal);
  const elegiveis = cadeia.filter((p) => pesos[p] && !aberto(canal, p, agora) && !evitar.has(p));
  let escolhido: string | undefined;
  if (elegiveis.length) {
    // rodízio ponderado suave (nginx): proporção exata dos pesos, sem rajadas
    const total = elegiveis.reduce((a, p) => a + pesos[p], 0);
    for (const p of elegiveis) e.atual[p] = (e.atual[p] ?? 0) + pesos[p];
    escolhido = elegiveis.reduce((a, b) => (e.atual[b] > e.atual[a] ? b : a));
    e.atual[escolhido] -= total;
  }
  const resto = (lista: string[]) => lista.filter((p) => p !== escolhido);
  const saudaveis = resto(cadeia.filter((p) => !aberto(canal, p, agora) && !evitar.has(p)));
  const paus = resto(cadeia.filter((p) => aberto(canal, p, agora) && !evitar.has(p)));
  const jaUsados = resto(cadeia.filter((p) => evitar.has(p)));
  return [...(escolhido ? [escolhido] : []), ...saudaveis, ...paus, ...jaUsados];
}
