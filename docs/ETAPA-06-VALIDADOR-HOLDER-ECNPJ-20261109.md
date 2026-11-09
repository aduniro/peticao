# Validador ICP: JSON limitado e holder e-CNPJ ADUNIR

Prioridade imediata de documentos/aprovação. O proprietário confirmou que A1 é
**e-CNPJ da ADUNIR** em09/11/2026. Isso resolve a opção de identidade necessária:
veredito positivo semCNPJ retornado não basta para classificar comoICPdo sindicato.
Autorização institucional formal informada não foi interpretada como revogação
da guarda criptográfica. Não há publicação, chave, certificado ouVPS nesta mudança.

## Defeito e correção

A fonte8cdd97a aceitava `{valid:true}` semCNPJ; o teste antigo preservava essa
opcionalidade. A regressão executada contra essa fonte falhou como esperado:
validador semholder devolvia`valid:true` quando deveria falhar segundo a decisão
atual. O teste de booleano estrito agora incluiCNPJválido em sua fixture positiva;
a omissão possui caso próprio de recusa, em vez de apagar silenciosamente a prova.

`verifyIcpBrasil` passa a tratar a resposta comoJSONunknown: objeto, booleano
explícito, signeropcional string até500caracteres semcontroles, CNPJ presente de
tipo/string/formato corretos. Resposta lida em bytes reais limitada a64KiB, com
UTF8estrito; corpo excessivo/malformado falha fechado. Aprovação exige14dígitos ou
máscara canônica, comparados aoCNPJesperado. Ausente, malformado, diferente ou
configuração esperada inválida não promovem aICP. Não se usa coerção de`valid`.
Não há validação de certificado real porJSONmock; o adapter continua uma fronteira
que precisa homologação, cadeia e vínculo ao documento efetivamente recebido.

## Mensagens e decisão do dono

O novo aviso proposto foi **REJEITADO**. Não permanece pendente, não será exibido
nem reapresentado como pergunta. Conservadas as mensagens atuais: resposta
inválida usa a frase existente; CNPJdiferente conserva a mensagem anterior de
outroe-CNPJ. Códigos internos distinguem resposta inválida, identidade ausente e
configuração esperada inválida. Não foi acrescentado texto àinterface ou aviso
novo aos usuários. O contrato de upload continua admitindo um arquivo
estruturalmente aceito como`externa-nao-validada`; ele não se tornaICPpor esse aceite.

## Provas executadas

Node20.19.2 isolado, SHA256binário
`b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac`.
Unitários dirigidos:5/5 e tiposfocados0, comfetchfictício e regressão da fonte
original preservada. Evidência `/tmp/admin-validator-json-xngkkru3/`.

Seleção integrada final: **21/21 testes**, zero falhas/cancelados/ignorados,
saída0; tipos da seleção e dependências:0. Abrange validador, upload/gate, reserva
concorrente do documento e lotes existentes. Testa holder ausente/outro/malformado,
signercomtipo inválido, body/UTF8, comparação formatada, arquivo aceito comoexterno
sem serICP e guarda de produção recusando aprovação/envio. O caminho positivo
apenas simulaadapter comCNPJcorreto; não representa homologaçãoICP.

Os bytes originais/assinados e o histórico são preservados no teste. O guard de
prefixo exato permanece: upload regravado comoutroprefixo é recusado antes de
chamar o adapter. Isso documenta a compatibilidade exigida peloapp, não afirma
que todoPDF/PAdESválido no mundo mantém o prefixo. Nenhum validador remoto foi
consultado, nenhumemissor foi ativado e nenhum e-mail foi enviado.

Evidência final `/tmp/admin-validator-holder-flow-e091fytq/`; cópia/checksums em
`.cache/qa-validator-holder-flow-20261109/`. Configuração vazia, PGfictício54356 e
MAILdev, fetchinjetado. Fontes estáveis por execução, banco próprio encerrado.
Worktree `candidate-validator-json-20261109`, branch`admin-v2-validator-json-20261109`,
base8cdd97a. QAHTTPcompilado será coordenado com a frenteAPOIO após integração.
