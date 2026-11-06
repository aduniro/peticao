# Regra automática de nome e CPF

A alteração vale para novas tentativas de assinatura e confirmação. Não reprocessa nomes, decisões locais ou assinaturas existentes.

- `site/src/lib/cpf-name.ts` compara palavras completas, na ordem. Acentos, caixa, espaços, partículas e pontuação de nomes são normalizados somente na comparação.
- Correspondência completa pode seguir sem desafio adicional quando o e-mail institucional dispensa esse desafio.
- Omissões compatíveis exigem nascimento ou mãe, inclusive com e-mail institucional. Não basta o par dos dois primeiros termos: é necessário também um termo posterior completo. A API não separa prenomes e sobrenomes; em casos ambíguos o assinante pode preencher o nome completo.
- Iniciais, grafias diferentes, termos contraditórios ou ordem invertida não aprovam. Acertar nascimento ou mãe não compensa essas incompatibilidades.
- WhatsApp exige nascimento ou mãe para brasileiros, independentemente do nome completo ou do interruptor geral do formulário. Estrangeiros continuam sem CPF.
- O ticket assinado permite continuar o desafio sem reutilizar o token antirrobô, que é de uso único. CPF/e-mail/ticket e os dados são conferidos novamente em cada tentativa.
- O cache criptografado continua com 30 dias. As tentativas continuam limitadas a cinco erros por CPF em 24 horas. Pedir o desafio para um nome parcial não conta como erro.

Testes novos: `cpf-name.test.ts`, `cpf-name-flow.test.ts`, `cpf-name-whatsapp.test.ts`. Dados fictícios, e-mail de desenvolvimento e provedores simulados; nenhuma consulta paga nos testes.

A publicação usa um pacote mínimo sobre uma cópia da produção atual, com manifesto antes/depois, backup privado da aplicação, stage e banco, compilação antes da troca e verificação de saúde. A interface e os avisos ao usuário podem mudar somente nos arquivos enumerados no manifesto aprovado; o inventário recusa qualquer arquivo alterado fora dele. Não sincronizar a árvore local inteira para a VPS. Esta etapa não altera esquema, registros, hashes, datas, horários ou decisões existentes; não inclui a integração do resolvedor de nomes à geração dos PDFs.

Para o ajuste de avisos do formulário, os arquivos públicos permitidos são `src/components/SignForm.tsx`, `src/components/GeoFields.tsx`, `src/app/globals.css` e as traduções `src/i18n/{pt,en,es,fr,de}.ts`, além do auxiliar `src/lib/form-validation-notice.ts`. Cada um precisa aparecer no manifesto com o hash de produção anterior e o hash do conteúdo testado. Alterações a textos fora desse conjunto são recusadas.
