import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync, lstatSync } from "node:fs";
import { join } from "node:path";

/**
 * Botão "Publicar" do painel. O site (usuário sem privilégio) só grava um arquivo-sinal com um id aleatório; quem publica é o serviço root
 * `peticao-publicar-executar` (deploy/21-publicar.sh), que roda SEMPRE o mesmo `peticao-deploy` sobre o que já está no peticao-stage.
 * O sinal nunca carrega comando. Estado e log vêm de uma pasta de dono root, que o site só lê.
 */
export const pedidoPath = () => process.env.PUBLICAR_PEDIDO ?? "/var/lib/peticao/publicar.pedido";
export const estadoDir = () => process.env.PUBLICAR_ESTADO_DIR ?? "/var/lib/peticao-publicar";
export const PEDIDO_VALE_S = 15 * 60, EXECUCAO_MAX_S = 30 * 60;

export type EstadoPublicacao = { estado: "executando" | "ok" | "falhou" | "recusado" | "expirado"; id: string; inicio: string; fim: string; codigo: number | null };
const lerEstado = (): EstadoPublicacao | null => { try { const j = JSON.parse(readFileSync(join(estadoDir(), "publicar.estado"), "utf8")); return j && typeof j.estado === "string" ? j : null; } catch { return null; } };
export const lerLog = (): string => { try { return readFileSync(join(estadoDir(), "publicar.log"), "utf8").slice(-4000); } catch { return ""; } };

/** Há um pedido esperando o serviço root? (arquivo recente) */
function pedidoPendente(): boolean {
  try { const s = lstatSync(pedidoPath()); return s.isFile() && Date.now() - s.mtimeMs < PEDIDO_VALE_S * 1000; } catch { return false; }
}

/** Situação da publicação: instalado (a pasta do executor existe), pedido pendente, última execução. */
export function situacaoPublicacao() {
  const instalado = existsSync(estadoDir());
  const ultimo = lerEstado();
  const emAndamento = !!ultimo && ultimo.estado === "executando" && Date.now() - new Date(ultimo.inicio).getTime() < EXECUCAO_MAX_S * 1000;
  return { instalado, pedidoPendente: pedidoPendente(), emAndamento, ultimo };
}

export type Pedido = { ok: true; id: string } | { ok: false; erro: "preview" | "nao_instalado" | "ja_pedido" | "em_andamento" | "gravar" };
/** Grava o sinal (atômico: arquivo temporário + rename). Recusa se já há pedido ou publicação em andamento. */
export function pedirPublicacao(por: string): Pedido {
  if (process.env.PREVIEW_MODE === "1") return { ok: false, erro: "preview" };
  const s = situacaoPublicacao();
  if (!s.instalado) return { ok: false, erro: "nao_instalado" };
  if (s.emAndamento) return { ok: false, erro: "em_andamento" };
  if (s.pedidoPendente) return { ok: false, erro: "ja_pedido" };
  const id = randomBytes(8).toString("hex");
  try {
    const tmp = `${pedidoPath()}.${id}.tmp`;
    writeFileSync(tmp, JSON.stringify({ id, por: por.replace(/[^\w.@+-]/g, "").slice(0, 80), em: new Date().toISOString() }) + "\n", { mode: 0o640, flag: "wx" });
    renameSync(tmp, pedidoPath());
    return { ok: true, id };
  } catch { return { ok: false, erro: "gravar" }; }
}
