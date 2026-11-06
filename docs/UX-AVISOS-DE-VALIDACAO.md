# Avisos de validação do formulário

Requisitos aprovados pelo responsável em 06/11/2026. Aplicam-se aos formulários
de Servidor(a) e Apoiador(a), sem modificar os textos de privacidade ou as regras
de validação já definidas.

## Comportamento obrigatório

- Cada erro permanece visível logo abaixo do campo correspondente e marca o
  próprio controle com contorno vermelho. Campos inválidos mantêm o contorno
  vermelho mesmo quando recebem foco. Checkboxes inválidos recebem destaque
  acessível equivalente.
- Uma tentativa que devolva um ou vários erros abre **uma única** janela modal.
  Ela resume o problema e, quando houver mais de um, inclui os avisos relevantes;
  os avisos de cada campo continuam visíveis na página.
- O botão de correção usa “Corrigir” nos avisos gerais. Ao fechar a janela, a
  página rola até e foca o primeiro campo inválido na ordem visual do formulário.
- Erro de nome: usar exatamente “Confira a grafia e informe o seu nome completo.”
  Não explicar no aviso as regras internas de comparação, partículas ou
  quantidade de palavras.
- Erros de e-mail também abrem modal. Erros locais, validação remota e respostas
  da API mantêm o aviso sob o e-mail e seu contorno vermelho.
- Quando a instituição atende à condição regional já documentada no app,
  deixar desmarcada a declaração obrigatória da Amazônia Legal/faixa de fronteira
  exibe erro sob a caixa, contorno vermelho na caixa e modal único que explica
  que a declaração deve ser marcada.

## Revisão antes de publicar

Validar nome divergente nos formulários de Servidor e Apoiador; erros simultâneos
de dois ou mais campos; e-mail inválido; e a caixa regional obrigatória. Em cada
caso, confirmar mensagem curta, avisos sob os controles, bordas vermelhas,
apenas um modal e foco/rolagem para o primeiro campo inválido após “Corrigir”.
Também confirmar que o texto de privacidade e os valores válidos não mudaram.

## Correção emergencial de transporte — 06/11/2026

O envio inicial e a confirmação de identidade deixavam uma rejeição de `fetch`
propagar até o React. Agora `sign-request.ts` transforma falha de rede ou resposta
ilegível em resultado tratado. Não há reenvio automático, limpeza dos campos ou
persistência adicional dos dados digitados. O botão volta a permitir tentativa;
a confirmação de identidade mantém seu formulário aberto e libera o botão.
O aviso reutiliza a mensagem existente de indisponibilidade temporária.
A origem da desconexão não pode ser determinada apenas pela pilha do navegador.
A tela de desenvolvimento do Next não prova falha no servidor de produção.

Publicação mínima: somente `SignForm.tsx` e `sign-request.ts`, com manifesto sobre
os arquivos em produção. Nenhuma mudança no banco ou nas regras nome/CPF.

## Prioridade emergencial — blur e dicas de e-mail, 06/11/2026

Pedido posterior do responsável: modais de validação somente após clicar em
Assinar; sair do campo mostra apenas erro inline vermelho e contorno. Para e-mail,
o texto vermelho é somente “E-mail inválido”, preservando a dica já existente da
categoria. Removidas as sugestões de correção/exemplos de Gmail da apresentação
junto ao campo, inclusive “Usar este”. A consulta remota no blur permanece, sem
abrir modal. Não foram alteradas as regras do backend de e-mail/CPF.

CPF incompleto ou inválido passa a permanecer destacado após o primeiro blur,
mesmo com menos de 11 dígitos. Corrigir para um CPF matematicamente válido remove
o erro local. A validação ao enviar permanece; campos e consentimento são
preservados. Modais de ajuda acionados expressamente pelo usuário não são erros
automáticos de blur.

A integração administrativa foi interrompida para esta prioridade. Pacote de
produção limitado a `src/components/SignForm.tsx`, preparado sobre a fonte atual
da VPS. QA local intercepta `/api/assinar` e `/api/email/validar`, usando dados
fictícios, sem criar assinatura ou consumir consulta paga.

## Recomposição autorizada após auditoria — 06/11/2026

Autorizado restaurar a interação anterior de e-mail sem desfazer as correções
solicitadas. Recuperados os blocos de orientação, “Você quis dizer…?”, “Usar este”,
a lista de provedores para apoiador e o motivo específico de conflito de categoria.
As dicas ficam em bloco informativo; o alerta de sintaxe/provedor permanece curto.
Servidor e estrangeiro não recebem sugestões de provedores pessoais. Nenhum
endereço é corrigido sem clicar em “Usar este”. O botão do modal institucional
mantém nome/e-mail/CPF/consentimento e retira o erro da categoria anterior ao
mudar para Servidor. Preservados: CPF incompleto destacado, ausência de modais
no blur, modal único após envio, foco e preservação de preenchimento.

Pacote mínimo: `SignForm.tsx` + `email-feedback.ts`, sobre a produção atual.
Backend, traduções, dados e regras de validação permanecem os existentes.
Testes devem comprovar também IFC e domínio institucional, provedor de apoiador,
e-mail institucional em apoiador, ausência de troca automática e comportamento
de erro/rede já aprovado. A auditoria anterior é mantida como registro do defeito.

Publicação da recomposição concluída em 06/11/2026, às 21:58 UTC, pelo pacote
`/root/peticao-recovery/name-rule-deploys/restore-email-20261106/` (commit de código
`57e10aa`). Vinte e um testes de lógica, tipos e build aprovados. QA de navegador
aprovado localmente e na interface publicada: orientação institucional, IFC,
provedor de apoiador, “Usar este” explícito, lista de provedores, institucional em
apoiador, CPF incompleto, modal só após envio e preservação de campos/consentimento.
No QA de interface, as APIs de validação/envio foram interceptadas: não comprova
entrega real de e-mail, não cria assinatura e não consome consulta de CPF.
Verificação externa: página e contador HTTP 200; serviço ativo. Esquema e
configuração preservados, sem atualização em massa de assinantes. A integração
do admin permanece pausada.
