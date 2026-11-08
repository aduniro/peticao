# Petição PLV 12/2026 — site

Next.js 14 + PostgreSQL. Texto da petição em `src/content/peticao.ts`.

## Rodar (desenvolvimento)
1. `npm install` (o `.npmrc` já manda cache e temporários para `../.cache`, porque `/` está quase cheio)
2. `cp .env.example .env.local`
3. `npm run db:dev` (terminal 1): Postgres embutido, dados persistentes em `site/.pgdata` (precisa de sistema de arquivos POSIX, como ext4).
4. `npm run dev` (terminal 2) → http://localhost:3000 · e-mails de teste em `/dev/outbox` · painel em `/admin` (senha `ADMIN_PASSWORD`) · lotes em `/admin/lotes`
- Testes: `npm test` (sobe o Postgres de dev sozinho) · `npm run typecheck` · `npm run build`
- PDF de exemplo com nomes fictícios: `npx tsx scripts/sample-pdf.ts saida.pdf`

## Produção
`DATABASE_URL` de um Postgres de verdade, `HASH_PEPPER` (≥ 32 chars), `ADMIN_PASSWORD`, `APP_URL`, `MAIL_PROVIDER` (`smtp` ou `brevo`) + `MAIL_FROM` com domínio autenticado (SPF/DKIM/DMARC), `APPROVER_EMAIL`, `RECIPIENTS` (endereços confirmados em fonte oficial), `CRON_SECRET`, `SIGNER=icp`.
Agendador do servidor: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/tick` a cada ~10 min (fecha o lote final em `FINAL_AT`).

## Segurança de envio
- `src/lib/mail/guard.ts`: fora de produção bloqueia operator-39089b8a18@example.invalid` e `.gov.br/.leg.br/.jus.br`.
- `src/lib/signer.ts`: em produção só envia PDF com assinatura ICP-Brasil (hoje só existe o modo `none`, de teste).
- Envio de lote exige: login no painel + código de 6 dígitos enviado ao aprovador. Há botão de pausa global e de cancelamento.

## Pendente
Domínio/remetente · assinatura e-CNPJ + carimbo do tempo (`SIGNER=icp`) · Turnstile · hospedagem · revisão jurídica · confirmar destinatários oficiais.

## Recursos
- **Assinatura** com duas categorias (servidor de IFES e apoiador), e-mail de confirmação, selo de e-mail institucional (`/admin/dominios`).
- **Identidade** para quem não usa e-mail institucional: janela pedindo data de nascimento (máscara + calendário) **ou** nome da mãe, conferidos com o cadastro do CPF (cpf-brasil.org). Nada disso é gravado. Máx. 5 erros por CPF a cada 24 h.
- **Indicações**: cada assinante confirmado ganha link, QR e cartaz próprios (`/meu/<token>`, `/r/<código>`, `/api/cartaz/<código>`); painel `/admin/indicacoes`.
- **Compartilhamento** por WhatsApp, e-mail, copiar link e menu nativo do celular (`src/content/compartilhar.ts`).
- **Monitor de acessos** com mapa Leaflet (`/admin/monitor`): IP, IPv4/IPv6, cidade, estado, provedor, aparelho, páginas, cliques, assinou ou não. Geolocalização offline (DB-IP Lite).
- **Interface de app** no celular (barra inferior, folhas deslizantes, estilos iOS/Android, modo escuro) e instalável (manifesto).
- **Lotes** com PDF, aprovação por senha + código, upload do PDF assinado (`/admin/lotes`).

## Comandos de segredos (rode você mesmo; nada aparece na tela)
    npm run chave:cpf                 # chave da CPF Brasil (dev/produção)
    npm run chave:cpf -- --preview    # chave para a pré-visualização isolada
    npm run chave:turnstile           # chave secreta do Cloudflare Turnstile
    npm run preview:senha             # senha da página da pré-visualização (qualquer formato, sem mínimo)

## Novidades desta rodada
- **Capa** no topo (`public/capa/`, gerada de `assets/capa_peticao.png` por `python3 scripts/prepare-cover.py`; WebP responsivo, altura limitada no celular). A imagem de pré-visualização do link (WhatsApp) é `public/capa/og.jpg`.
- **Tema claro por padrão**, com botão de alternância (lua/sol) na barra; a escolha fica no aparelho.
- **Últimas assinaturas ao vivo** na página inicial (`/api/ultimas`): só primeiro nome e inicial do sobrenome (ex.: "Maria S."). O consentimento menciona essa exibição.
- **Horário de Brasília** em todas as telas, planilhas, PDF e e-mails (o banco guarda UTC; `src/lib/time.ts`).
- **Dispersão da campanha** (`/admin/dispersao`): origem de cada assinante (direto, organização ou indicação de quem), geração na cadeia, alcance de cada pessoa, árvore de indicações e indício de repasse do e-mail. Base interna completa em CSV (com e-mail e instituição pelo e-mail institucional; NÃO enviar às autoridades).
- **Máscara do CPF** `999.999.999-99` na digitação.
- **Diagnóstico do CPF sem expor dados:** `npm run cpf:diagnostico` (consulta a API real e diz o que veio e se o que você digitaria confere, sem mostrar valores). Suporte: `/admin` tem "Liberar CPF" para zerar tentativas erradas.
- O servidor de desenvolvimento usa `.next-dev`; o build de produção usa `.next` (um não quebra o outro).

## Verificação de layout
Roteiro automatizado (Firefox + puppeteer-core em `../.cache/qa/layout-qa.mjs`): 15 tamanhos de tela, páginas públicas e do painel, folhas, janela de identidade, calendário e tema escuro. Último resultado: 215 verificações, 0 falhas.
