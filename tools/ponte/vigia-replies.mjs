import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gravarAtomico } from "./vigia-state.mjs";
import { DONO } from "./lib.mjs";
import { ENDERECOS_DONO, enderecoDe } from "./dono.mjs";
const read = path => existsSync(path) ? JSON.parse(readFileSync(path,"utf8")) : null;
const first = text => text.split(/\r?\n/).find(line=>line.trim())?.trim() || "";


async function transmitir(path, state, send, now, conversations) {
  gravarAtomico(path,{ ...state, estado:"enviando" });
  let result;
  try { result = await send({ para:DONO, assunto:state.assunto, texto:state.texto }); }
  catch {
    const uncertain = { ...state, estado:"envio_inconclusivo", em:now() };
    gravarAtomico(path,uncertain); return uncertain;
  }
  const accepted = result.status >= 200 && result.status < 300;
  const updated = accepted
    ? { ...state, estado:"respondido", provedorId:result.id ?? null, em:now() }
    : { ...state, estado:"falha_envio", http:result.status ?? null, tentarEm:Date.parse(now())+300_000, em:now() };
  if (accepted && state.substituiCodigo) {
    const previousPath = join(conversations,state.substituiCodigo+".json");
    const previous = read(previousPath);
    if (previous?.estado === "aguardando_aprovacao") gravarAtomico(previousPath,{ ...previous, estado:"substituida", substituidaPor:state.codigo });
  }
  gravarAtomico(path,updated); return updated;
}

/** One durable response. No recipient or execution command can be chosen by the model. */
export async function responderPedido(message, directory, { generate, send, now = () => new Date().toISOString() }) {
  if (!message.autenticado || !ENDERECOS_DONO.includes(enderecoDe(message))) return { estado: "ignorado" };
  const responses = join(directory,"respostas"), conversations = join(directory,"conversas");
  for (const d of [responses,conversations]) mkdirSync(d,{recursive:true,mode:0o700});
  const path = join(responses,createHash("sha256").update(message.id).digest("hex")+".json");
  let state = read(path);
  if (state && ["respondido","enviando","envio_inconclusivo","historico"].includes(state.estado)) return state;
  if (state?.tentarEm > Date.parse(now())) return state;
  if (state?.estado === "falha_envio") return transmitir(path,state,send,now,conversations);
  const code = /\bAP-[A-F0-9]{6}\b/i.exec(message.assunto || "")?.[0].toUpperCase();
  const conversationPath = code ? join(conversations,code+".json") : null;
  const conversation = conversationPath ? read(conversationPath) : null;
  let body, subject, nextConversation, newCode = code;
  const decision = first(message.corpo || "");
  if (conversation && /^APROVAD[OA]\b/i.test(decision)) {
    if (conversation.estado !== "aguardando_aprovacao") {
      body = `A proposta ${code} já está no estado ${conversation.estado}. Não foi agendada uma segunda execução.`;
    } else {
      nextConversation = { ...conversation, estado:"aguardando_execucao", aprovadaEm:now(), mensagemAprovacao:message.id };
      body = `Aprovação registrada para ${code}. A tarefa está na fila aguardando o executor assumir; ainda não foi iniciada. Você receberá o informe de início e o resultado. Não é preciso aprovar novamente esta mesma proposta.`;
    }
    subject = `[${code}] Aprovação recebida`;
  } else if (conversation && /^CANCELAR\b/i.test(decision)) {
    nextConversation = { ...conversation, estado:"cancelado", canceladaEm:now() };
    body = `Cancelamento registrado para ${code}. Nenhuma ação foi iniciada por este assistente de e-mail.`;
    subject = `[${code}] Cancelamento recebido`;
  } else {
    const result = await generate({ message, conversation });
    if (!result || !["resposta","proposta","esclarecimento"].includes(result.tipo) || typeof result.assunto !== "string" || typeof result.resposta !== "string" || !result.resposta.trim() || result.resposta.length > 20000) throw new Error("Resposta estruturada inválida");
    body = result.resposta;
    subject = result.assunto.replace(/[\r\n]/g," ").slice(0,160);
    if (result.tipo === "proposta") {
      newCode = "AP-"+randomBytes(3).toString("hex").toUpperCase();
      nextConversation = { codigo:newCode, estado:"aguardando_aprovacao", criadaEm:now(), pedido:message.corpo, plano:body, origem:message.id };
      body += `\n\nPara autorizar, responda com APROVADO na primeira linha e mantenha ${newCode} no assunto. Para ajustar, responda MODIFICAR: e explique; para encerrar, CANCELAR. Nenhuma ação foi executada. Depois da aprovação, a tarefa será disponibilizada ao executor.`;
      subject = `[${newCode}] ${subject}`;
    }
  }
  state = { id:message.id, estado:"preparado", assunto:subject, texto:body, codigo:newCode, preparadaEm:now(), ...(conversation && nextConversation?.codigo !== code && nextConversation?.estado === "aguardando_aprovacao" ? { substituiCodigo:code } : {}) };
  if (nextConversation) gravarAtomico(join(conversations,nextConversation.codigo+".json"),nextConversation);
  return transmitir(path,state,send,now,conversations);
}
