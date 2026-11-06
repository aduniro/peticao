import { versaoImplantada } from "../versao";
import { lerLog, pedirPublicacao, situacaoPublicacao } from "../publicar";
import type { Acao } from "./tipos";

export const publicarStatus: Acao<{}> = {
  id: "publicar.status", grupo: "publicar", titulo: "Ver a publicação",
  validar: () => ({ ok: true, p: {} }),
  descrever: () => "Mostra a versão em execução, se há publicação pedida ou em andamento e o resultado da última (com o final do registro). Não altera nada.",
  simular: async () => ({ ...versaoImplantada(), ...situacaoPublicacao(), registro: lerLog() }),
  executar: async () => ({ ...versaoImplantada(), ...situacaoPublicacao(), registro: lerLog() }),
};

export const publicarPedir: Acao<{}> = {
  id: "publicar.pedir", grupo: "publicar", titulo: "Publicar a versão preparada no servidor", palavra: "PUBLICAR",
  validar: () => ({ ok: true, p: {} }),
  descrever: () => "Pede ao servidor que publique a versão que já está no diretório de preparação (peticao-stage), com o mesmo comando de sempre (peticao-deploy). O site reinicia por alguns segundos. O que está no stage vem do seu \"git push\" no ramo producao: o painel não envia código novo, só publica o que você já preparou.",
  simular: async () => ({ ...versaoImplantada(), ...situacaoPublicacao(), observacao: "Nada é enviado nesta simulação." }),
  executar: async (_p, ctx) => {
    const r = pedirPublicacao(ctx.email);
    if (!r.ok) throw new Error({ preview: "Publicar fica desligado na pré-visualização.", nao_instalado: "O botão Publicar ainda não foi instalado no servidor (deploy/21-publicar.sh).", ja_pedido: "Já existe um pedido de publicação esperando.", em_andamento: "Já há uma publicação em andamento.", gravar: "Não consegui gravar o pedido." }[r.erro]);
    return { pedido: r.id, aviso: "Pedido enviado. Acompanhe em \"Ver a publicação\": o site reinicia durante a publicação." };
  },
};
