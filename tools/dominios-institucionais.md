# Coleta de domínios institucionais (selo "e-mail institucional confirmado")

O selo vale para e-mail de domínio de órgão/instituição pública ou de ensino superior. **Não prova que a pessoa é servidora.**

## Como o site decide
1. Sufixos de registro restrito, automáticos: `.gov.br`, `.edu.br` (**pode incluir instituições privadas**), `.leg.br`, `.jus.br`, `.mp.br`.
2. Tabela `institutional_domains` (aprovados pela ADUNIR; semente: `unir.br`). Rejeitar um domínio vence os sufixos.
3. `x.unir.br` conta como `unir.br`; `fakeunir.br` e `unir.br.evil.com` não. Provedores gratuitos e redes sociais nunca contam.
4. Subdomínios de discentes (`aluno.`, `discente.`, `estudante.`…) viram o tipo "discente", com contagem à parte.
5. Servidor com domínio desconhecido entra na fila **pendente**; a ADUNIR confere o site oficial e aprova em `/admin/dominios`
   (as assinaturas já feitas com esse domínio recebem o selo na hora).

## Importadores (sempre entram como PENDENTE; simulação por padrão)
| Fonte | Comando | Observação |
|---|---|---|
| SIORG (órgãos federais, API pública) | `npm run import:siorg` | Testado: 328 órgãos, 268 com contato, 60 domínios novos fora dos sufixos. Acrescente `-- --apply` para gravar. |
| e-MEC (IES) | `npm run import:emec -- --file=ies.csv --only-public` | Baixe o CSV em dados.gov.br (o portal bloqueia robôs). Confira colunas detectadas na simulação. |
| CNPJ da Receita | `npm run import:cnpj -- --empresas=E0.csv,E1.csv --estab=S0.csv,S1.csv` | Arquivos grandes, descompactados à mão. Natureza jurídica começando com 1 (administração pública) + e-mail cadastral. Muito ruído: revise. |
Reimporte mensalmente. Domínios de estatais (Correios, Telebras, bancos públicos) aparecem na fonte SIORG: a ADUNIR decide se contam.

## Atualizar a base de geolocalização do monitor de acessos
`scripts/update-geo-db.sh` (DB-IP Lite, CC BY 4.0, mantenha a atribuição).
