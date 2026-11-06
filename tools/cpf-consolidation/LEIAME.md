# Consolidação das verificações de CPF

Ferramentas externas ao aplicativo. Não fazem chamadas à CPF-Brasil, não
recuperam novos CPFs e não publicam a versão local do app.

- `snapshot.py`: backup PostgreSQL em formato custom, PDFs dos lotes e cópias
  consistentes dos SQLite/CSV usados como evidência; snapshot de leitura sem
  importar o app. Executado como root na VPS, em diretório privado.
- `reconcile.py`: verifica os hashes do backup e cruza cadastro, CPF recuperado
  e retorno da API. Somente nome completo exato ou normalizado é elegível.
  Partículas, iniciais, omissões, divergências e cadastros substituídos ficam
  separados para revisão. Resultados são privados e ficam fora do repositório.
- `apply_verifications.py`: transação com comparação do registro inteiro antes
  de escrever; muda apenas `cpf_name_check`. Ignora cadastros alterados desde o
  snapshot. Registra execução e datas das consultas na cadeia de auditoria,
  sem gravar os dados cadastrais da API no banco do app. Sem `--commit`, desfaz
  a transação; esse ensaio ainda toma bloqueios e pode avançar a sequência da
  auditoria, portanto deve ser feito no banco isolado.
- `verify_database.py`: confirma preservação dos campos e valida toda a cadeia
  de auditoria. Alterações simultâneas em registros não atualizados são
  contabilizadas separadamente.
- `generate-pdfs.ts`: usa uma cópia do gerador de produção para gerar duas
  prévias, com seleção explícita e marca-d'água. Não cria nem substitui lotes.

## Execução de 06/11/2026

Identificador: `consolidacao-20261106T104518Z`.

Backups locais: `/mnt/dev/cpfs/backups/consolidacao-20261106T104518Z/`.
Relatórios e prévias: `/mnt/dev/cpfs/consolidacao-20261106T104518Z/`.
VPS: `/root/peticao-recovery/consolidacoes/consolidacao-20261106T104518Z/`.
Banco isolado restaurado: `cpf_audit_20261106_104518`, acesso público revogado.

Foram atualizadas 3.811 marcas (3.081 confirmadas e 730 pendentes), após ensaio
no banco restaurado. A confirmação das pendentes não foi alterada. A conferência
posterior verificou todos os campos protegidos e a cadeia completa de auditoria.
Os 17 lotes originais foram preservados; nenhuma mensagem foi enviada.

Restaurar o dump inteiro em produção sobrescreveria atividade posterior. Para
reversão seletiva, use o plano e a lista efetivamente aplicada, restaurando apenas
as marcas que ainda correspondam ao registro esperado e acrescentando novo evento
à auditoria; nunca apague o evento original. O backup integral foi restaurado e
testado somente no banco isolado.

## Testes fictícios

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s /mnt/dev/peticao/tools/cpf-consolidation -p 'test_*.py'
```

A liberação oficial depende da escolha do conjunto, da revisão dos PDFs e da
configuração de destinatários e validação de assinatura digital. As prévias não
podem ser enviadas como documentos finais.
