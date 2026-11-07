import { versaoImplantada } from "../versao";
import { lerLog, pedirPublicacao, situacaoPublicacao } from "../publicar";
import { ActionNotApplied, type Acao } from "./tipos";

export const publicarStatus: Acao<{}> = {
  id: "publicar.status", grupo: "publicar", titulo: "Ver a publicação",
  validar: () => ({ ok: true, p: {} }),
  descrever: () => "Mostra a versão em execução, se há publicação pedida ou em andamento e o resultado da última (com o final do registro). Não altera nada.",
  simular: async () => ({ ...versaoImplantada(), ...situacaoPublicacao(), registro: lerLog() }),
  executar: async () => ({ ...versaoImplantada(), ...situacaoPublicacao(), registro: lerLog() }),
};

export const publicarPedir: Acao<{ candidato?: string }> = {
  id: "publicar.pedir", grupo: "publicar", titulo: "Publicar a versão preparada no servidor", palavra: "PUBLICAR", aceite: true,
  validar: (input) => {
    if (input == null) return { ok: true, p: {} };
    if (typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "candidato")) return { ok: false, erro: "Parâmetros inválidos." };
    const candidato = (input as { candidato?: unknown }).candidato;
    if (candidato !== undefined && (typeof candidato !== "string" || !/^[a-f0-9]{64}$/.test(candidato))) return { ok: false, erro: "Parâmetros inválidos." };
    return { ok: true, p: { candidato: candidato as string | undefined } };
  },
  descrever: () => "Pede ao servidor que publique a versão que já está no diretório de preparação (peticao-stage), com o mesmo comando de sempre (peticao-deploy). O site reinicia por alguns segundos. O que está no stage vem do seu \"git push\" no ramo producao: o painel não envia código novo, só publica o que você já preparou.",
  simular: async () => ({ ...versaoImplantada(), ...situacaoPublicacao(), observacao: "Nada é enviado nesta simulação." }),
  executar: async (p, ctx) => {
    const r = pedirPublicacao(ctx.email, p.candidato ?? "", ctx.requestId);
    if (!r.ok) throw new ActionNotApplied({ preview: "Publicar fica desligado na pré-visualização.", nao_instalado: "O botão Publicar ainda não foi instalado no servidor (deploy/21-publicar.sh).", ja_pedido: "Já existe um pedido de publicação esperando.", em_andamento: "Já há uma publicação em andamento.", gravar: "Não consegui gravar o pedido." }[r.erro]);
    return { pedido: r.id, aviso: "Pedido enviado. Acompanhe em \"Ver a publicação\": o site reinicia durante a publicação." };
  },
};
