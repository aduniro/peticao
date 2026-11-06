// Triagem das mensagens de contato dos usuários: funções PURAS (sem rede, sem banco), para testar sem tocar em produção.
// Entrada: a mensagem + as evidências lidas do servidor (cadastro, e-mails enviados, devoluções, supressão, fila, saúde do app).
// Saída: tipo do relato, veredito (procede ou não e por quê), causa, proposta de resolução e rascunho de resposta à pessoa.
// REGRAS: nunca usa nem mostra CPF; nunca envia nada à pessoa (o rascunho de resposta vai só ao dono, que decide); regras simples e declaradas:
// quando as evidências não bastam, o veredito é "INCONCLUSIVO" e pede leitura humana, em vez de chutar.

const sem = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const BRT = "America/Porto_Velho";
export const fmt = (d) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: BRT, dateStyle: "short", timeStyle: "short" }) : "—");
export const primeiroNome = (n) => { const p = String(n ?? "").trim().split(/\s+/)[0] ?? ""; return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : "tudo bem"; };

/** Tira de textos de log/erro o que identifica pessoas: e-mails, IPs, CPFs, códigos longos. */
export const mascarar = (t) => String(t ?? "")
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-mail]")
  .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]")
  .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
  .replace(/\b[0-9a-f:]{16,}\b/gi, "[código]")
  .replace(/[A-Za-z0-9_-]{32,}/g, "[código]");

/** Esconde CPFs que a própria pessoa escreveu na mensagem (o relatório cita o texto; CPF nunca vai para o e-mail). */
export const semCpf = (t) => String(t ?? "").replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF omitido]");

/** Natureza do relato, por palavras-chave (sem acento). A ordem importa: o que é mais sensível vem primeiro. */
export function tipoDoRelato(texto, kind = "") {
  const t = sem(texto);
  if (/(remov|exclu|apag|cancel|retir)\w*.{0,40}(assinatura|dados|cadastro|nome|e-?mail)|lgpd|nao quero mais (assin|constar|participar)/.test(t)) return "remover";
  if (/\bcpf\b|nome nao confere|nao confere com|receita federal/.test(t)) return "cpf";
  if (/expir|link (invalido|vencido)|token/.test(t)) return "expirou";
  if (/corrig|errei|digitei errad|troc\w* (o |meu )?(nome|e-?mail)|alter\w* (o |meu )?(nome|e-?mail|dados)|(nome|e-?mail) errad/.test(t)) return "corrigir";
  if (/(nao|n)\w* (esta |estao )?(aceit|permit|reconhec)\w*.{0,40}e-?mail|e-?mail.{0,50}(invalido|nao (e )?aceit|recusad|rejeitad|nao passa)|dominio.{0,30}(nao|invalid)/.test(t)) return "email_recusado";
  if (/(nao|n) (recebi|chegou|chega|chegaram|encontr|veio|vieram)|nenhum e-?mail|sem e-?mail|spam|lixo eletronico|caixa de entrada|e-?mail de confirmacao|link de confirmacao|confirmar (a |minha )?assinatura|demora/.test(t)) return "nao_recebeu";
  if (kind === "bug" || /erro|bug|travou|nao (consigo|funciona|abre|carrega|aparece)|tela|pagina|botao|formulario|navegador|celular/.test(t)) return "erro";
  return "duvida";
}
export const ROTULO_TIPO = { remover: "Pedido de remoção/cancelamento (LGPD)", cpf: "Problema com CPF/nome", expirou: "Link expirado ou inválido", corrigir: "Correção de dados do cadastro", nao_recebeu: "Não recebeu o e-mail de confirmação", email_recusado: "E-mail não aceito pelo formulário", erro: "Possível erro na página", duvida: "Dúvida ou outro assunto" };

export const VEREDITOS = {
  PROCEDE: "PROCEDE (falha do nosso lado)",
  PARCIAL: "PROCEDE EM PARTE",
  NAO: "NÃO PROCEDE (causa do lado do usuário ou do provedor dele)",
  RESOLVIDO: "JÁ ESTÁ RESOLVIDO",
  INCONCLUSIVO: "INCONCLUSIVO (precisa de leitura humana)",
  NAO_E_ERRO: "NÃO É ERRO (dúvida ou pedido)",
  PRIORIDADE: "PRIORIDADE (pedido que exige decisão sua)",
};

const ASSINATURA = "Um abraço,\nADUNIR · ANDES-SN\nPetição pela sanção integral do PLV nº 12/2026";
const resp = (nome, corpo) => `Olá, ${primeiroNome(nome)},\n\n${corpo.trim()}\n\n${ASSINATURA}`;
const dominioDe = (e) => String(e ?? "").split("@")[1]?.toLowerCase() ?? "";
const institucional = (e, c) => /\.(edu|gov|leg|jus|mil)\.br$/.test(dominioDe(e)) || /instit|gov|edu/.test(String(c?.email_domain_kind ?? ""));

/** Resumo da saúde do app (quando houve consulta ao servidor): lista o que merece atenção, ou diz que nada anormal foi visto. */
export function alertasDoApp(s) {
  if (!s) return ["Não foi possível consultar o servidor agora; a análise usou só o que estava no banco."];
  const a = [];
  if (s.servico && Object.values(s.servico).some((v) => v && v !== "active")) a.push(`Serviço(s) fora do ar: ${Object.entries(s.servico).filter(([, v]) => v !== "active").map(([k, v]) => `${k}=${v}`).join(", ")}.`);
  if (s.erros24h > 0) a.push(`${s.erros24h} linha(s) de erro no registro do servidor nas últimas 24 h. Mais frequentes: ${(s.padroes ?? []).slice(0, 3).map((p) => `"${mascarar(p.msg).slice(0, 110)}" (${p.n}x)`).join("; ") || "sem detalhe"}.`);
  if (s.outbox && (s.outbox.failed > 0 || s.outbox.pending > 5)) a.push(`Fila de e-mails: ${s.outbox.pending} pendente(s) e ${s.outbox.failed} que desistiu(ram) após 48 h.`);
  const e = s.envios24h; if (e && e.sent + e.failed > 0 && e.failed / (e.sent + e.failed) > 0.1) a.push(`${Math.round((e.failed / (e.sent + e.failed)) * 100)}% das tentativas de envio de e-mail falharam nas últimas 24 h (${e.failed} de ${e.sent + e.failed}); o rodízio de serviços pode estar compensando, mas vale conferir.`);
  return a.length ? a : ["Nada anormal: serviços ativos, sem erros recentes no registro do servidor, fila de e-mails em ordem."];
}
const appOk = (s) => !!s && alertasDoApp(s)[0].startsWith("Nada anormal");

/** Analisa UMA mensagem com as evidências. Devolve tipo, veredito, motivos, causa, resolução proposta e rascunho de resposta. */
export function analisar(ev) {
  const m = ev.msg, c = ev.cadastro, agora = new Date(ev.agora ?? Date.now());
  const tipo = tipoDoRelato(m.message, m.kind);
  const envios = ev.envios ?? [], devol = ev.devolucoes ?? [];
  const enviados = envios.filter((x) => x.status === "sent"), falhos = envios.filter((x) => x.status === "failed"), fila = envios.filter((x) => x.status === "queued");
  const out = { id: m.id, tipo, rotuloTipo: ROTULO_TIPO[tipo], veredito: VEREDITOS.INCONCLUSIVO, causa: "indefinida", confianca: "baixa", motivos: [], resolucao: [], resposta: "", alertasApp: alertasDoApp(ev.saude) };
  const R = (corpo) => (out.resposta = resp(m.name, corpo));
  const cad = c ? `Cadastro: ${c.status === "confirmed" ? `confirmado em ${fmt(c.confirmed_at)}` : `pendente (criado em ${fmt(c.created_at)})`}${c.category ? `, categoria ${c.category}` : ""}.` : "Não há cadastro com o e-mail informado na mensagem.";
  out.motivos.push(cad);
  if (ev.supressao) out.motivos.push(`O endereço está na lista de bloqueio (${ev.supressao.reason}${ev.supressao.detail ? `: ${mascarar(ev.supressao.detail).slice(0, 120)}` : ""}) desde ${fmt(ev.supressao.created_at)}.`);
  if (envios.length) out.motivos.push(`E-mails ao endereço (14 dias): ${enviados.length} enviado(s), ${fila.length} na fila, ${falhos.length} com falha${enviados[0] ? `; último enviado por ${enviados[0].provider} em ${fmt(enviados[0].ts)}` : ""}.`);
  else out.motivos.push("Nenhum e-mail registrado para este endereço nos últimos 14 dias.");
  if (devol.length) out.motivos.push(`Devoluções registradas: ${devol.map((d) => `${d.type} (${d.provider}, ${fmt(d.ts)})`).join("; ")}.`);
  if (ev.reenvio) out.motivos.push(`Esta pessoa entrou no reenvio por falha (${ev.reenvio.status}${ev.reenvio.provider ? `, por ${ev.reenvio.provider}` : ""}, em ${fmt(ev.reenvio.enviado_em)}).`);
  const expirou = c?.status === "pending" && c.token_expires_at && new Date(c.token_expires_at) < agora;
  if (expirou) out.motivos.push(`O link de confirmação enviado venceu em ${fmt(c.token_expires_at)}.`);

  const antes = c && m.created_at && c.created_at && new Date(m.created_at) < new Date(c.created_at);
  if (antes) out.motivos.push(`A mensagem (${fmt(m.created_at)}) é anterior ao cadastro atual (${fmt(c.created_at)}): a pessoa pode ter tentado antes, não conseguido, e recomeçado.`);
  const resolvidoDepois = c?.status === "confirmed" && c.confirmed_at && m.created_at && new Date(c.confirmed_at) > new Date(m.created_at);
  if (resolvidoDepois && ["erro", "email_recusado", "nao_recebeu", "expirou", "duvida"].includes(tipo)) {
    out.veredito = VEREDITOS.RESOLVIDO; out.causa = "indefinida"; out.confianca = "média";
    out.motivos.push(`A assinatura foi confirmada em ${fmt(c.confirmed_at)}, DEPOIS da mensagem: a pessoa conseguiu concluir (o problema relatado provavelmente já passou ou foi corrigido).`);
    out.resolucao.push("Provavelmente nada a corrigir. Se o relato indicar um problema que possa atingir outras pessoas (ex.: um domínio de e-mail recusado), confira se a correção já está no ar.", "Responder confirmando que a assinatura está contada.");
    R(`Obrigado por avisar! Conferimos aqui e a sua assinatura foi confirmada em ${fmt(c.confirmed_at)}, então já está contada. Se algo ainda não estiver funcionando para você, responda esta mensagem.`);
    return out;
  }
  if (tipo === "remover") {
    out.veredito = VEREDITOS.PRIORIDADE; out.causa = "indefinida"; out.confianca = "alta";
    out.motivos.push("O texto pede remoção, cancelamento ou apagar dados: é um pedido de titular (LGPD) e não deve esperar.");
    out.resolucao.push("Você decide: remover ou anonimizar o cadastro (a petição já enviada em lote não muda). Registre a data do pedido e a resposta.", "Se for removido, a assinatura deixa de contar nos próximos lotes; avise a pessoa quando concluir.");
    R("Recebemos o seu pedido e vamos tratá-lo com prioridade. Para garantir que estamos falando com a pessoa certa, confirme por favor o nome completo e o e-mail usados na assinatura. Assim que confirmarmos, avisamos aqui quando o pedido for concluído.");
    return out;
  }
  if (tipo === "cpf") {
    out.confianca = "média";
    if (!c) { out.veredito = VEREDITOS.INCONCLUSIVO; out.resolucao.push("Pedir o e-mail e o nome usados no cadastro."); R("Obrigado pelo contato. Para olharmos o seu caso, informe por favor o e-mail e o nome completo que você usou ao assinar. Seu CPF não precisa ser enviado e nunca deve ser escrito nesta conversa."); return out; }
    if (c.cpf_name_check === "match") { out.veredito = VEREDITOS.RESOLVIDO; out.causa = "usuario"; out.confianca = "alta"; out.motivos.push("O nome do cadastro foi conferido com o CPF (confere)."); out.resolucao.push("Nada a corrigir; apenas responder."); R(`Verificamos o seu cadastro: o nome e o CPF conferem e a assinatura ${c.status === "confirmed" ? "está confirmada" : "só depende de você abrir o link de confirmação enviado ao seu e-mail"}. Seu CPF não é exibido nem divulgado.`); return out; }
    out.veredito = VEREDITOS.PARCIAL; out.causa = "ambos";
    out.motivos.push(`A conferência de nome com o CPF ficou como "${c.cpf_name_check ?? "não conferido"}".`);
    out.resolucao.push("Confirmar com a pessoa o nome completo como consta na Receita; se for o caso, orientar a assinar como apoiador ou corrigir o nome manualmente (mantendo as datas originais).");
    R("Obrigado por avisar. A conferência do nome com o CPF usa a base da Receita Federal e às vezes diverge por acentos, abreviações ou nome social. Pode nos enviar o nome completo exatamente como consta no seu CPF (sem enviar o número)? Com isso corrigimos o cadastro, e a sua assinatura segue valendo.");
    return out;
  }
  if (tipo === "corrigir") {
    out.veredito = VEREDITOS.NAO_E_ERRO; out.causa = "usuario"; out.confianca = "alta";
    out.resolucao.push("Corrigir o dado no painel (nível Edição), mantendo as datas originais do cadastro; conferir o e-mail novo antes de reenviar qualquer link.");
    R("Podemos corrigir. Envie por favor o dado correto (nome completo ou e-mail) e o e-mail que está hoje no cadastro. Depois de confirmar, atualizamos e avisamos por aqui. A data da sua assinatura permanece a original.");
    return out;
  }

  if (tipo === "nao_recebeu" || tipo === "expirou") {
    if (!c) {
      out.veredito = VEREDITOS.INCONCLUSIVO; out.causa = "usuario"; out.confianca = "média";
      out.motivos.push("Sem cadastro com este e-mail: a pessoa pode ter usado outro e-mail, digitado errado ou não ter concluído o formulário.");
      out.resolucao.push("Pedir o nome completo e os e-mails que ela pode ter usado; procurar por nome no painel.");
      R("Obrigado pelo contato. Não encontramos um cadastro com este e-mail. Pode ser que a assinatura tenha sido feita com outro endereço ou que o formulário não tenha sido concluído. Envie por favor o seu nome completo e outros e-mails que possa ter usado, e conferimos. Se preferir, você pode assinar de novo em sancionaintegral.org (leva cerca de 1 minuto).");
      return out;
    }
    if (c.status === "confirmed") {
      out.veredito = VEREDITOS.RESOLVIDO; out.causa = "usuario"; out.confianca = "alta";
      out.motivos.push("A assinatura já foi confirmada: o e-mail chegou e foi usado.");
      out.resolucao.push("Nada a corrigir; responder e, se quiser, informar o código de verificação da assinatura.");
      R(`Boas notícias: a sua assinatura foi confirmada em ${fmt(c.confirmed_at)} e já está contada. Não precisa fazer mais nada. Se quiser ajudar a divulgar, o e-mail com o seu cartaz pessoal (QR Code) também deve ter chegado.`);
      return out;
    }
    // cadastro pendente
    if (ev.supressao) {
      out.veredito = VEREDITOS.PROCEDE; out.causa = "sistema"; out.confianca = "alta";
      out.motivos.push("O endereço está bloqueado para envio, então a pessoa NÃO recebe nossos e-mails (isso é regra de proteção da reputação do domínio).");
      out.resolucao.push("Conferir se o endereço está correto; se for válido, remover o bloqueio (decisão sua) e reenviar o link; se estiver errado, pedir o e-mail correto e corrigir o cadastro.");
      R("Obrigado por avisar. Encontramos o motivo: o nosso sistema bloqueou o envio para este endereço de e-mail por ter recebido uma devolução antes. Confirme por favor se o e-mail está escrito corretamente (ou nos passe outro) para que possamos corrigir e enviar um novo link de confirmação.");
      return out;
    }
    if (devol.some((d) => d.type === "hard_bounce" || d.type === "blocked")) {
      out.veredito = VEREDITOS.NAO; out.causa = "usuario"; out.confianca = "alta";
      out.motivos.push("O servidor de e-mail da pessoa recusou a mensagem (endereço inexistente ou bloqueado por ele).");
      out.resolucao.push("Pedir um e-mail alternativo e corrigir o cadastro; se for e-mail institucional, sugerir um pessoal.");
      R("Obrigado por avisar. O servidor do seu e-mail recusou a nossa mensagem, o que costuma acontecer com endereços digitados errado ou com filtros rígidos. Pode nos informar outro e-mail (um Gmail ou Outlook funciona do mesmo jeito) ou conferir se este está correto? Atualizamos o cadastro e enviamos um novo link.");
      return out;
    }
    if (expirou && enviados.length) {
      out.veredito = VEREDITOS.PARCIAL; out.causa = "ambos"; out.confianca = "alta";
      out.motivos.push("O e-mail foi enviado, mas o link venceu antes de a pessoa confirmar.");
      out.resolucao.push("Reenviar um link novo (a data original do cadastro permanece).", "Se muitos casos assim aparecerem, vale avaliar aumentar a validade do link.");
      R("Obrigado por avisar. O e-mail com o link foi enviado, mas o prazo de validade do link já passou. Vamos enviar um link novo para o mesmo endereço. Se não aparecer em alguns minutos, olhe também a caixa de spam. Sua data de assinatura continua a original.");
      return out;
    }
    if (enviados.length) {
      const inst = institucional(m.email, c);
      out.veredito = VEREDITOS.NAO; out.causa = "usuario"; out.confianca = inst ? "alta" : "média";
      out.motivos.push(`O e-mail saiu pelo provedor (${enviados[0].provider}) e não há devolução registrada: a falha provável é de recebimento do lado do destinatário${inst ? ", e este é um domínio institucional (filtros de spam/quarentena costumam segurar remetentes novos)" : " (caixa de spam, promoções ou quarentena)"}.`);
      out.resolucao.push("Reenviar um link novo por OUTRO serviço de e-mail (o reenvio já faz rodízio); sugerir conferir spam/quarentena e, se for institucional, um e-mail pessoal.", "Se vários relatos vierem do mesmo domínio, pedir à TI da instituição que libere o remetente.");
      R(`Obrigado por avisar. Verificamos aqui: o nosso sistema enviou o e-mail de confirmação para este endereço em ${fmt(enviados[0].ts)} e o servidor dele aceitou. ${inst ? "E-mails institucionais costumam ter filtro de spam ou quarentena que segura mensagens de remetentes novos. " : ""}Veja por favor a caixa de spam, lixo eletrônico e promoções (procure por \"sancionaintegral\" ou \"petição\"). Se não achar, responda aqui que enviamos um novo link, ou assine com um e-mail pessoal (Gmail, Outlook), que vale do mesmo jeito.`);
      return out;
    }
    if (fila.length || (ev.fila?.pendentes ?? 0) > 0) {
      out.veredito = VEREDITOS.PARCIAL; out.causa = "sistema"; out.confianca = "média";
      out.motivos.push("O e-mail ficou na fila de reenvio (nenhum serviço conseguiu enviar na hora); ele sai sozinho, com atraso.");
      out.resolucao.push("Conferir se a fila andou; se continuar parada, investigar os serviços de e-mail; se a pessoa precisa agora, reenviar manualmente.");
      R("Obrigado por avisar. O seu e-mail de confirmação ficou em uma fila de reenvio por uma instabilidade temporária dos nossos serviços de e-mail e deve chegar em instantes. Se até o fim do dia não chegar, responda aqui que enviamos um link novo.");
      return out;
    }
    out.veredito = VEREDITOS.PROCEDE; out.causa = "sistema"; out.confianca = falhos.length ? "alta" : "média";
    out.motivos.push(falhos.length ? "Todas as tentativas de envio falharam: a pessoa realmente não recebeu por falha nossa." : "Não há nenhum e-mail registrado para este cadastro: o envio pode ter se perdido.");
    out.resolucao.push("Reenviar o link agora (reenvio por falha ou pelo painel); investigar a causa nos registros do servidor e dos serviços de e-mail no horário do cadastro.", falhos[0]?.error ? `Erro registrado no envio: ${mascarar(falhos[0].error).slice(0, 160)}` : "Conferir o horário do cadastro contra falhas de e-mail registradas.");
    R("Obrigado por avisar, e desculpe o transtorno: o seu e-mail de confirmação não saiu por uma falha nossa. Já estamos reenviando um link novo para este mesmo endereço. A data da sua assinatura continua a original.");
    return out;
  }

  if (tipo === "email_recusado") {
    out.veredito = VEREDITOS.PARCIAL; out.causa = "sistema"; out.confianca = "média";
    out.motivos.push("O formulário valida o e-mail (sintaxe, domínio e política de domínios institucionais) e pode ter recusado este endereço ou o domínio da instituição.");
    out.resolucao.push("Abrir /admin/dominios e conferir se o domínio da pessoa está aprovado (se for instituição pública legítima, aprovar); conferir se o endereço foi digitado certo.", "Se houver mais de um relato do mesmo domínio, tratar como defeito de cadastro de domínio.");
    R("Obrigado por avisar. Estamos conferindo se o domínio do seu e-mail institucional está na nossa lista de instituições aceitas. Para não perder tempo, você pode assinar agora com um e-mail pessoal (Gmail, Outlook), que vale do mesmo jeito. Se preferir usar o institucional, nos diga exatamente qual é o endereço (o que aparece depois do @) e avisamos assim que estiver liberado.");
    return out;
  }
  if (tipo === "erro") {
    const probs = (ev.saude?.erros24h ?? 0) > 0;
    out.confianca = "baixa";
    if (probs) { out.veredito = VEREDITOS.PARCIAL; out.causa = "sistema"; out.motivos.push("Há erros no registro do servidor nas últimas 24 h; podem ou não ser o mesmo problema relatado."); out.resolucao.push("Abrir os registros do servidor no horário da mensagem e comparar com os erros listados no relatório; reproduzir no celular e no computador."); }
    else { out.veredito = VEREDITOS.INCONCLUSIVO; out.causa = appOk(ev.saude) ? "usuario" : "indefinida"; out.motivos.push(appOk(ev.saude) ? "Sem erros no servidor nas últimas 24 h: o problema pode ser local (navegador, conexão) ou já ter passado." : "Não foi possível confirmar a saúde do servidor."); out.resolucao.push("Pedir modelo do aparelho, navegador e uma foto da tela; tentar reproduzir."); }
    R("Obrigado por avisar. Para identificarmos o problema, conte por favor: (1) qual aparelho e navegador você usa, (2) em que passo da página aconteceu e (3) se aparece alguma mensagem de erro (uma foto da tela ajuda muito). Enquanto isso, tente de novo por outro navegador ou pelo computador.");
    return out;
  }

  out.veredito = VEREDITOS.NAO_E_ERRO; out.causa = "usuario"; out.confianca = "média";
  out.motivos.push("O texto parece uma dúvida ou comentário, sem sinal de falha.");
  out.resolucao.push("Ler a mensagem e responder; se for uma dúvida recorrente, avaliar incluir a resposta no FAQ da página.");
  R("Obrigado pelo contato! [Escreva aqui a resposta à dúvida: leia a mensagem original acima e responda de forma direta.]");
  return out;
}

/** Marco da primeira execução: o que chegou ANTES disto já foi lido e tratado à mão (05/11/2026 às 12h, horário de Rondônia); só entra o que veio depois. */
export const DESDE_PADRAO = "2026-11-05T12:00:00-03:00";
/** Primeira execução: processa as mensagens criadas a partir de `desde` e marca como já vistas as anteriores. */
export function baseDaPrimeiraExecucao(mensagens, desde = DESDE_PADRAO) {
  if (!mensagens.length) return { ultimoId: 0, processar: [] };
  const limite = new Date(desde).getTime();
  const novas = mensagens.filter((x) => new Date(x.created_at).getTime() >= limite);
  const maxId = Math.max(...mensagens.map((x) => x.id));
  return novas.length ? { ultimoId: Math.min(...novas.map((x) => x.id)) - 1, processar: novas.map((x) => x.id) } : { ultimoId: maxId, processar: [] };
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Monta o e-mail ao dono com todos os relatórios desta rodada (um e-mail por rodada). */
export function montarRelatorio(itens, { saude, geradoEm = new Date().toISOString() } = {}) {
  const lista = itens.slice(0, 12), resto = itens.length - lista.length;
  const urgente = itens.some((i) => i.analise.veredito === VEREDITOS.PRIORIDADE || i.analise.veredito === VEREDITOS.PROCEDE);
  const assunto = `${urgente ? "[ATENÇÃO] " : ""}Triagem: ${itens.length} mensagem(ns) de contato nova(s) — ${[...new Set(itens.map((i) => i.analise.veredito.split(" (")[0]))].join(", ")}`;
  const L = [];
  L.push(`RELATÓRIO DE TRIAGEM — ${fmt(geradoEm)}`, "", `${itens.length} mensagem(ns) de contato nova(s) analisada(s). O texto de resposta de cada caso é só uma PROPOSTA: nada foi enviado às pessoas.`, "");
  lista.forEach((it, n) => {
    const a = it.analise, m = it.msg;
    L.push(`────────── Caso ${n + 1} de ${itens.length} · mensagem nº ${m.id} ──────────`, `De: ${m.name} <${m.email}> · recebida em ${fmt(m.created_at)} · tipo informado: ${m.kind}`, `O que a pessoa escreveu:`, `"${semCpf(String(m.message)).slice(0, 900)}"`, "",
      `NATUREZA: ${a.rotuloTipo}`, `VEREDITO: ${a.veredito}`, `CAUSA PROVÁVEL: ${a.causa === "sistema" ? "nosso sistema" : a.causa === "usuario" ? "lado do usuário/provedor dele" : a.causa === "ambos" ? "os dois lados" : "não determinada"} · confiança ${a.confianca}`, "", "Por quê (evidências):", ...a.motivos.map((x) => `  • ${x}`), "", "Proposta de resolução:", ...a.resolucao.map((x) => `  • ${x}`), "", "Proposta de resposta à pessoa (revise antes de enviar):", ...a.resposta.split("\n").map((x) => `  | ${x}`), "");
  });
  if (resto > 0) L.push(`(+ ${resto} mensagem(ns) não detalhadas neste e-mail; veja o painel de contato.)`, "");
  L.push("────────── Saúde do app (últimas 24 h) ──────────", ...alertasDoApp(saude).map((x) => `  • ${x}`), "", "Como enviar a resposta: pelo painel, em /admin/contato → Responder (prévia dos dois e-mails e envio com um clique), ou pelo seu e-mail, usando o rascunho acima.", "Limites desta análise: regras automáticas sobre os dados do servidor; quando está INCONCLUSIVO, leia a mensagem original.");
  const texto = L.join("\n");
  const corVer = (v) => (v.startsWith("PROCEDE (") || v.startsWith("PRIORIDADE") ? "#b42318" : v.startsWith("PROCEDE EM") ? "#b54708" : v.startsWith("NÃO PROCEDE") || v.startsWith("JÁ") ? "#067647" : "#475467");
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:760px;color:#14231d;line-height:1.5"><h2 style="margin:0 0 4px">Relatório de triagem</h2><p style="margin:0 0 14px;color:#475467">${esc(fmt(geradoEm))} · ${itens.length} mensagem(ns) de contato. As respostas são só <b>propostas</b>: nada foi enviado às pessoas.</p>`
    + lista.map((it, n) => { const a = it.analise, m = it.msg; return `<div style="border:1px solid #d5e0da;border-radius:12px;padding:14px 16px;margin:0 0 14px"><div style="color:#475467;font-size:13px">Caso ${n + 1} de ${itens.length} · mensagem nº ${m.id} · ${esc(fmt(m.created_at))}</div><div style="font-weight:700;margin:2px 0">${esc(m.name)} &lt;${esc(m.email)}&gt;</div><blockquote style="margin:6px 0 10px;padding:6px 12px;border-left:3px solid #9fb8ab;background:#f4f8f6;white-space:pre-wrap">${esc(semCpf(String(m.message)).slice(0, 900))}</blockquote><div><b>Natureza:</b> ${esc(a.rotuloTipo)}</div><div style="margin:4px 0"><span style="display:inline-block;padding:3px 10px;border-radius:99px;background:${corVer(a.veredito)};color:#fff;font-weight:700;font-size:13px">${esc(a.veredito)}</span> <span style="color:#475467;font-size:13px">causa: ${esc(a.causa === "sistema" ? "nosso sistema" : a.causa === "usuario" ? "usuário/provedor" : a.causa === "ambos" ? "ambos" : "indeterminada")} · confiança ${esc(a.confianca)}</span></div><b>Por quê</b><ul style="margin:4px 0 8px">${a.motivos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><b>Proposta de resolução</b><ul style="margin:4px 0 8px">${a.resolucao.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><b>Proposta de resposta à pessoa</b> <span style="color:#475467;font-size:13px">(revise antes de enviar)</span><pre style="white-space:pre-wrap;background:#f4f8f6;border-radius:8px;padding:10px 12px;margin:6px 0 0;font:inherit">${esc(a.resposta)}</pre></div>`; }).join("")
    + (resto > 0 ? `<p>(+ ${resto} mensagem(ns) não detalhadas; veja o painel de contato.)</p>` : "")
    + `<h3 style="margin:18px 0 6px">Saúde do app (últimas 24 h)</h3><ul>${alertasDoApp(saude).map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p style="color:#475467;font-size:13px">Para responder: painel → Contato → Responder (prévia e envio), ou pelo seu e-mail com o rascunho acima. Análise por regras automáticas sobre os dados do servidor; se estiver INCONCLUSIVO, leia a mensagem original.</p></div>`;
  return { assunto, texto, html };
}
