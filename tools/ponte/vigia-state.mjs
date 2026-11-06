import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { corpoNovo } from "./ler.mjs";
import { doDono } from "./dono.mjs";

export function gravarAtomico(path, value) {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, path);
}

/** Persists each authenticated owner request BEFORE advancing the monitor state. */
export function receberMensagens(messages, directory, state, log = () => {}) {
  const inbox = join(directory, "entrada");
  mkdirSync(inbox, { recursive: true, mode: 0o700 });
  let added = 0;
  for (const message of [...messages].sort((a, b) => a.recebido.localeCompare(b.recebido))) {
    if (!doDono(message)) continue;
    const id = message.id || createHash("sha256").update(JSON.stringify(message)).digest("hex");
    const filename = join(inbox, createHash("sha256").update(id).digest("hex") + ".json");
    if (!existsSync(filename)) {
      gravarAtomico(filename, { id, recebido: message.recebido, de: message.de, assunto: message.assunto, corpo: corpoNovo(message.raw), status: "aguardando_leitura", autenticado: true });
      log({ email_do_dono: true, id, recebido: message.recebido, fila_persistida: true });
      added++;
    }
  }
  const updated = { ...state, ultimaConsulta: new Date().toISOString(), ultimoErro: null, novos: added };
  gravarAtomico(join(directory, "vigia-health.json"), updated);
  return updated;
}
