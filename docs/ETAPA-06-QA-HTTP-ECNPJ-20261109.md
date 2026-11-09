# Etapa 06 — QA HTTP compilado de upload/aprovação e-CNPJ

Unidade de QA sobre a fonte integrada **0335b1d9ed0f01e4bc3c58da2f15c2f3ccbc9a04**, incluindo a correção de validação do titular `ae17f0c`. Cópia limpa `candidate-president-ecnpj-http-0335b1d-20261109`; nenhum arquivo da aplicação, `signed-pdf` ou seus testes foi alterado. O roteiro anterior de portal também permanece intacto. Este marco testa o fluxo existente; não instala/integraliza A1, gov.br ou assinatura própria, não insere QR/avisos e não é homologação criptográfica PAdES.

## Ambiente e isolamento

Nodev20.19.2 no runtime já pinado, SHA-256 `b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac`. Um worker de build, heap1536, telemetria desligada, ambiente filtrado e pastas vazias de segredos/configuração. App só127.0.0.1:3048; PostgreSQL próprio54363; validador mock só127.0.0.1:3848. As três portas precisam estar livres antes do início. Não existe chamada ao VALIDAR/ITI ou outro provedor.

Produção simulada (`NODE_ENV=production`, `PREVIEW_MODE=0`, `SIGNER=none`) preserva a guarda ICP. Os únicos provedores de email são `MAIL_PROVIDER=dev` e `MAIL_PROVIDERS=dev`, com remetente/aprovador `.example.test` e destino exclusivo `qa-authority@example.test`. O CNPJ esperado é a constante pública do e-CNPJ alvo já usada no código; nenhum certificado, chave ou registro real foi consultado. Todos os usuários, corpos, assinantes e documentos são fictícios.

O responsável autorizou uma aprovação positiva somente DEV na configuração temporária desta fixture. O gate começa pausado, é aberto apenas na base fictícia para testar as recusas ICP e a aprovação DEV explícita e volta à pausa em finally. Não há configuração/gate real ou VPS envolvida. Upload, sozinho, não solicita código nem envia lote.

## Cenários preparados

1. Página existente de presidente e download/upload exigem Total e confirmação extra; demais papéis e ausência de sessão são recusados. PDF original e prévia devolvem bytes exatos e cabeçalhos previstos.
2. Primeiro processo sem `ICP_VALIDATOR_URL`: upload estruturalmente aceito fica `externa-nao-validada`; preserva o original, guarda a variante/histórico e não cria qualquer envio. Código legítimo da caixa DEV é usado para provar pausa e guarda ICP, sem admissão do lote.
3. Processo reiniciado com o mesmo artefato compilado e mock loopback: `valid:true` sem CNPJ e com CNPJ diverso continuam externos não validados; CNPJ correto passa a `icp-brasil` **somente no contexto desse mock**. O mock calcula SHA-256 dos bytes efetivamente recebidos, comparando com o upload do cenário. Nenhum status de assinatura real é inferido.
4. Cada variante é baixada e seu hash/bytes conferidos. O histórico preserva original mais quatro variantes. Originais, snapshot de preparo e assinantes ficam iguais; novas tentativas não substituem versões anteriores.
5. Código válido da fase correta admite um único envio DEV ao endereço fictício autorizado. Spool registra tamanho/hash do anexo; arquivo cifrado de conteúdo do próprio email DEV é lido na fixture para comparar os mesmos bytes, e o journal/attempt registra providerdev/accepted. Isso significa aceitação local DEV, não entrega a autoridade real.
6. Replay não cria outro transporte; depois de aprovado, novo upload não muda o PDF congelado/histórico. Pausa é restaurada e servidor/mock/PG próprios são encerrados. A cadeia de auditoria precisa permanecer íntegra.

O pseudo-PAdES é construído acrescentando sintaxe de teste ao PDF gerado pelo fluxo existente; não contém CMS/certificado real. O JSON do validador é deliberadamente controlado para provar a política/HTTP do app. Resultado positivo dessa fixture não comprova cadeia, revogação, MDP ou conformidade ICP de um certificado verdadeiro.

## Execução reproduzível

Da worktree `candidate-inbox-read-20261109`:

```
python3 tools/admin-qa/president-ecnpj-local.py build 0335b1d9ed0f01e4bc3c58da2f15c2f3ccbc9a04
python3 tools/admin-qa/president-ecnpj-local.py http 0335b1d9ed0f01e4bc3c58da2f15c2f3ccbc9a04
```

O runner exige a cópia correspondente limpa, fixa o commit/Node/hash e verifica todos os fontes rastreados antes/depois. O modo HTTP exige BUILD_ID da própria cópia. São GETs/POSTs reais contra Next compilado, incluindo formulário multipart, download, código e aprovação; não substitui os handlers por mocks.

## Observação de implantação informada pelo principal

O principal informou inspeção remota somente leitura: serviço ativo, ambiente inicial de produção e prévia desabilitada; no ambiente inicial/procMainPID inspecionado não encontrou ICP_VALIDATOR_URL nem SIGNER diferente do modo none. **Isso não prova ausência absoluta de configuração**, pois o processo pode carregar configuração após startup. Esta frente não entrou na VPS nem abriu env, logs, certificados ou segredos. Registra-se somente a necessidade de configurar/homologar o validador para a automação futura, sem promessa de A1 pronto em determinado prazo.

Resultados e evidências finais constam abaixo; nenhum dado runtime/cookie, certificado, PDF pessoal ou configuração real entra no Git.

## Resultado final observado

**Build saída0 e HTTP saída0**, Nodev20.19.2/SHA pinado, snapshot0335b1d estável e cópia limpa. Quatro grupos de provas agregam os seis cenários descritos acima. O mock recebeu três uploads (CNPJ ausente, incorreto e correto) e comparou os hashes exatos; a fase sem validador não usou esse serviço. Uma única mensagem de lote foi aceita pelo provedorDEV, exclusivamente para qa-authority@example.test; anexo cifrado/spool/journal conferidos com os bytes/hash esperados, sem entrega real. Gate restaurado à pausa e portas3048/54363/3848 verificadas livres após cleanup.

Evidências originais: build `/tmp/admin-president-ecnpj-r5olagt6`; HTTP final `/tmp/admin-president-ecnpj-yqwn0c1r`. Cópias privadas e hashes em `.cache/qa-president-ecnpj-20261109/`.

As duas execuções HTTP anteriores falharam por preparação do roteiro, não pela regra e-CNPJ: primeiro o parser procurava o título do corpo do email em vez do assunto real; depois o seed criava uma assinatura confirmada sem seq/verify_code, que o bootstrap normal completou após reinício. Corrigiu-se apenas a fixture: assunto exato, ordenação do spool e registro confirmado sintético já completo. A comparação integral dos campos de assinatura foi preservada, assim como as expectativas de rejeição/guarda. Logs iniciais em `/tmp/admin-president-ecnpj-xx67quwz` e `/tmp/admin-president-ecnpj-b_u4fk1c`, também copiados. Nenhum teste/aplicação/aviso existente foi enfraquecido ou modificado.

O build mantém avisos CSS/Autoprefixer existentes; nenhum ajuste visual foi feito. Esta prova não substitui homologação criptográfica real, testes de todos os perfis PAdES ou validação do A1. O commit desta unidade contém somente roteiro, runner e documentação de QA.
