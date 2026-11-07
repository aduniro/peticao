import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, linkSync, unlinkSync, writeFileSync, lstatSync } from "node:fs";
import { join } from "node:path";

/**
 * Botão "Publicar" do painel. O site (usuário sem privilégio) só grava um arquivo-sinal com id e hash do candidato simulado; quem publica é o serviço root
 * `peticao-publicar-executar` (deploy/21-publicar.sh), que roda SEMPRE o mesmo `peticao-deploy` sobre o que já está no peticao-stage.
 * O sinal nunca carrega comando. Estado e log vêm de uma pasta de dono root, que o site só lê.
 */
export const pedidoPath = () => process.env.PUBLICAR_PEDIDO ?? "/var/lib/peticao/publicar.pedido";
export const estadoDir = () => process.env.PUBLICAR_ESTADO_DIR ?? "/var/lib/peticao-publicar";
export const PEDIDO_VALE_S = 15 * 60, EXECUCAO_MAX_S = 30 * 60;

export type EstadoPublicacao = { estado: "executando" | "ok" | "falhou" | "recusado" | "expirado"; id: string; inicio: string; fim: string; codigo: number | null };
const lerEstado = (): EstadoPublicacao | null => { try { const j = JSON.parse(readFileSync(join(estadoDir(), "publicar.estado"), "utf8")); return j && typeof j.estado === "string" ? j : null; } catch { return null; } };
export const lerLog = (): string => { try { return readFileSync(join(estadoDir(), "publicar.log"), "utf8").slice(-4000); } catch { return ""; } };

export type Candidato = { sha256: string; commit: string | null; prepared_at: string; arquivos: number };
/** Only a root-owned descriptor can identify a candidate in production. */
export function candidatoPreparado(): Candidato | null {
  try {
    const path = join(estadoDir(), "candidato.json"), info = lstatSync(path), parent = lstatSync(estadoDir());
    if (!info.isFile() || info.size > 2_000_000 || !parent.isDirectory()) return null;
    if (process.env.NODE_ENV === "production" && (info.uid !== 0 || parent.uid !== 0 || ((info.mode | parent.mode) & 0o022))) return null;
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (value.format !== 1 || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) || !Array.isArray(value.files) || !value.files.length || !Number.isFinite(Date.parse(value.prepared_at))) return null;
    if (value.commit !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit)) return null;
    return { sha256: value.sha256, commit: value.commit, prepared_at: value.prepared_at, arquivos: value.files.length };
  } catch { return null; }
}

/** Há um pedido esperando o serviço root? (arquivo recente) */
function pedidoPendente(): boolean {
  try { const s = lstatSync(pedidoPath()); return s.isFile() && Date.now() - s.mtimeMs < PEDIDO_VALE_S * 1000; } catch { return false; }
}

/** Situação da publicação: instalado (a pasta do executor existe), pedido pendente, última execução. */
export function situacaoPublicacao() {
  const instalado = existsSync(estadoDir());
  const ultimo = lerEstado();
  const emAndamento = !!ultimo && ultimo.estado === "executando" && Date.now() - new Date(ultimo.inicio).getTime() < EXECUCAO_MAX_S * 1000;
  return { instalado, pedidoPendente: pedidoPendente(), emAndamento, ultimo, candidato: candidatoPreparado() };
}

export type Pedido = { ok: true; id: string } | { ok: false; erro: "preview" | "nao_instalado" | "ja_pedido" | "em_andamento" | "gravar" };
/** Grava o sinal com exclusividade (arquivo temporário + link atômico). Recusa se já há pedido ou publicação em andamento. */
export function pedirPublicacao(por: string, candidato: string, requestId?: string): Pedido {
  if (process.env.PREVIEW_MODE === "1") return { ok: false, erro: "preview" };
  const s = situacaoPublicacao();
  if (!s.instalado) return { ok: false, erro: "nao_instalado" };
  if (s.emAndamento) return { ok: false, erro: "em_andamento" };
  if (s.pedidoPendente) return { ok: false, erro: "ja_pedido" };
  if (!/^[a-f0-9]{64}$/.test(candidato) || s.candidato?.sha256 !== candidato) return { ok: false, erro: "gravar" };
  if (requestId !== undefined && !/^[a-f0-9]{16}$/.test(requestId)) return { ok: false, erro: "gravar" };
  const id = requestId ?? randomBytes(8).toString("hex");
  const tmp = `${pedidoPath()}.${id}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ id, candidato, por: por.replace(/[^\w.@+-]/g, "").slice(0, 80), em: new Date().toISOString() }) + "\n", { mode: 0o640, flag: "wx" });
    linkSync(tmp, pedidoPath());
    return { ok: true, id };
  } catch (error) { return { ok: false, erro: (error as NodeJS.ErrnoException).code === "EEXIST" ? "ja_pedido" : "gravar" }; }
  finally { try { unlinkSync(tmp); } catch { /* File creation may itself have failed. */ } }
}
