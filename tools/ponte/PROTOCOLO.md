# Ponte de e-mail: protocolo

Endereço: `ponte@painel.sancionaintegral.org` (Cloudflare Email Routing → Worker `ponte-entrada` → KV `ponte-caixa`).

## Quem fala com o Claude por e-mail
Os três endereços do dono (lista em `dono.mjs`): operator-78ffa47eeb@example.invalid`, operator-1cb91886e8@example.invalid`, operator-b94fa2583e@example.invalid`.
Um e-mail só vale como pedido do dono se vier de um deles **com DKIM aprovado do mesmo domínio do endereço** (Gmail assina como `gmail.com`, o pm.me como `pm.me`, o Proton como `protonmail.com`). DKIM de domínio "parente", de outro domínio ou ausente é ignorado, assim como bounces e avisos de serviços. Não existe "cadastrar no DKIM": o DKIM é a assinatura que o provedor do remetente coloca; aqui apenas **conferimos** essa assinatura.

## Como funciona um pedido
1. **O dono escreve** para a ponte pedindo qualquer coisa (o mesmo que faria no terminal).
2. **O vigia** (`node tools/ponte/vigia.mjs`, rodando na sessão do Claude) avisa de cada e-mail novo do dono.
3. **Resposta ANTES de agir, como no modo `/plan`:** o Claude responde por e-mail (para o endereço que enviou) com o que vai fazer, os passos, os riscos e o que **não** vai fazer, com um código `AP-XXXXXX` (`aprovacao.mjs`, função `propor`). Pergunta só de leitura/pesquisa pode ser respondida direto.
4. **Decisão do dono**, na 1ª linha da resposta, mantendo o código no assunto: `APROVADO`, `MODIFICAR: <o que mudar>` (gera nova proposta) ou `CANCELAR`.
5. **Execução** só depois do `APROVADO`; o resultado vem por e-mail, como no chat.

## Limites
- As regras permanentes do dono continuam valendo (nunca e-mail de teste para operator-39089b8a18@example.invalid` nem para .gov/.leg/.jus.br; `HASH_PEPPER` intocado; não ler `secrets/`; datas originais das assinaturas intactas). Só o dono as levanta, expressamente.
- O classificador de permissões do Claude Code não aceita e-mail como autorização de escrita em produção (reenvio em massa, deploy). Nesses casos o Claude envia o **comando exato** (caminho completo) para o dono rodar.
- O vigia só funciona enquanto a sessão do Claude estiver aberta.
