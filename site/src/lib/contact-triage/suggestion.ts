import type { PoolClient } from "pg";
import { tx } from "../db";
import { hmac, safeEqual } from "../security";
import { analyze, ENGINE, type Analysis } from "./analyze";
import { collectEvidenceWith } from "./evidence";
import { analysisFingerprint, evidenceFingerprint } from "./fingerprint";
export const GENERATOR="contact-reply-rules-v1";
const validId=(id:unknown):id is number=>Number.isSafeInteger(id)&&Number(id)>0&&Number(id)<=2147483647;
const SUBJECT="Sobre seu contato com a petição";
/** Suggested body only: greeting/signature remain the responsibility of the existing preview composer. */
export function replyBody(a:Analysis) {
  if(a.reasons.includes("incomplete_evidence")||a.reasons.includes("multiple_registrations"))return "Obrigado pelo contato. Ainda precisamos conferir os registros relacionados ao seu relato antes de concluir a análise. Informe em qual etapa ocorreu a dificuldade e qual mensagem apareceu, sem enviar CPF, senhas, códigos ou documentos por e-mail.";
  if(a.category==="remover")return "Recebemos seu pedido de retirada ou anonimização do cadastro. Antes de qualquer alteração, precisamos confirmar que o pedido é do titular. Nossa equipe orientará essa conferência pelo canal adequado. Não envie CPF, senhas ou documentos nesta conversa.";
  if(a.category==="corrigir")return "Recebemos seu pedido de correção. Informe qual dado precisa ser ajustado e o e-mail utilizado no cadastro. Antes de alterar qualquer registro, precisamos conferir o controle do solicitante sobre ele. Não envie CPF, senhas, códigos ou documentos por e-mail.";
  if(a.category==="cpf")return "Obrigado pelo relato. Confira se informou seu nome completo, com a grafia correta, e se o CPF pertence a você. Se a dificuldade continuar, informe em qual etapa do formulário ela acontece e qual mensagem aparece. Não envie o número do CPF, data de nascimento, nome da mãe ou documentos por e-mail.";
  if(a.category==="campus")return "Para conferirmos a ausência do campus, informe a sigla da instituição, o nome oficial do campus, o município e a UF, além de um link da página oficial da instituição que confirme esses dados. A inclusão depende da conferência das informações; nenhum cadastro foi alterado por esta análise.";
  if(a.reasons.includes("no_registration_for_email"))return "Não localizamos um cadastro com o e-mail informado neste contato. Você pode confirmar o nome completo e qual e-mail utilizou no formulário? Não envie o número do CPF, senhas ou códigos de confirmação.";
  if(a.state==="resolved"&&a.reasons.includes("confirmed_after_report"))return "O cadastro informado consta como confirmado após o recebimento do seu relato. Se ainda houver alguma dificuldade, descreva qual tela ou mensagem aparece para que possamos conferir. Não envie CPF, senhas ou códigos nesta conversa.";
  if(a.category==="expirou")return "Recebemos seu relato sobre o link de confirmação. Vamos conferir a situação do cadastro antes de orientar o próximo passo. Esta resposta não significa que outro link já tenha sido enviado. Não envie senhas ou códigos de confirmação nesta conversa.";
  if(a.category==="nao_recebeu")return "Para confirmar a assinatura, é necessário abrir o link de confirmação. Verifique também as pastas de spam e lixo eletrônico do e-mail utilizado no cadastro. Nossa equipe está conferindo a situação do envio; um aceite do provedor não comprova a entrega na sua caixa de entrada. Não envie CPF ou códigos nesta conversa.";
  if(a.category==="email_recusado")return "Confira a grafia completa do endereço informado. Para cadastro de servidor, prefira o e-mail institucional. Informe qual mensagem de erro aparece no formulário, sem enviar senhas, códigos ou documentos, para conferirmos o caso.";
  if(a.category==="erro")return "Obrigado por relatar a dificuldade. Para conferirmos o problema, descreva a etapa em que ele ocorre, a mensagem exibida e o navegador utilizado. Se enviar uma captura de tela, oculte CPF, senhas, códigos e outros dados pessoais.";
  return "Obrigado pelo contato. Nossa equipe precisa ler a questão apresentada e conferir as informações necessárias antes de preparar uma orientação específica para o seu caso.";
}
async function freshContext(c:PoolClient,id:number) {
  const snapshot=await collectEvidenceWith(c,id);
  if(!snapshot)return{ok:false as const,error:"not_found"};
  const job=(await c.query("SELECT id,revision,engine,status,input_hash,evidence,analysis FROM contact_triage_jobs WHERE contact_id=$1 ORDER BY revision DESC LIMIT 1",[id])).rows[0];
  if(!job||job.status!=="complete"||!job.evidence||!job.analysis)return{ok:false as const,error:"analysis_pending"};
  if(job.engine!==ENGINE)return{ok:false as const,error:"engine_unsupported"};
  if(snapshot.evidence.signatures.some(s=>s.confirmed_at&&Date.parse(s.confirmed_at)>Date.parse(snapshot.evidence.snapshotAt)+1000))return{ok:false as const,error:"evidence_inconsistent"};
  const current=analyze(snapshot.evidence),evidence=evidenceFingerprint(snapshot.evidence),analysis=analysisFingerprint(current);
  if(job.input_hash!==snapshot.inputHash||evidenceFingerprint(job.evidence)!==evidence||analysisFingerprint(job.analysis)!==analysis)return{ok:false as const,error:"analysis_stale"};
  const proof=hmac("contact-reply-context-v1:"+JSON.stringify([id,job.id,job.revision,ENGINE,GENERATOR,snapshot.inputHash,evidence,analysis]));
  return{ok:true as const,proof,analysis:current,context:{contactId:id,jobId:job.id as number,revision:job.revision as number,engine:ENGINE,observedAt:snapshot.evidence.snapshotAt}};
}
/** Read-only suggestion. No operational draft/archive is saved and no retention policy is chosen. */
export async function suggestContactReply(id:unknown) {
  if(!validId(id))return{ok:false as const,error:"parameters"};
  return tx(async c=>{
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");await c.query("SET LOCAL statement_timeout='1500ms'");
    const state=await freshContext(c,id);if(!state.ok)return state;
    return{ok:true as const,generator:GENERATOR,source:"rules" as const,persisted:false,requiresHumanReview:true,requiresCompletion:["duvida","erro"].includes(state.analysis.category),context:state.context,proof:state.proof,draft:{assunto:SUBJECT,corpo:replyBody(state.analysis)}};
  });
}
/** Context binding only. It never grants permission, confirms identity, validates edited text or replaces the send-preview seal. */
export async function validateReplySuggestion(id:unknown,proof:unknown) {
  if(!validId(id)||typeof proof!=="string"||!/^[a-f0-9]{64}$/.test(proof))return{ok:false as const,error:"parameters"};
  return tx(async c=>{
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");await c.query("SET LOCAL statement_timeout='1500ms'");
    const state=await freshContext(c,id);if(!state.ok)return state;
    return safeEqual(state.proof,proof)?{ok:true as const,context:state.context}:{ok:false as const,error:"context_changed"};
  });
}
