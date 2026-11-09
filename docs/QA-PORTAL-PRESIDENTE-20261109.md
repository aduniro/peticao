# QA compilado do Portal Presidente

## Escopo e isolamento

Base exata `50e144d1e527e6346573cfc4fd4f5f1d9de1cd2d`, branch `qa/president-portal-20261109`, worktree `/mnt/dev/peticao/.cache/admin-integration/candidate-president-portal-qa-20261109`.

O contrato exercita a aplicação Next compilada, autenticação real do aplicativo e PostgreSQL novo/fictício em `127.0.0.1:54360`, HTTP `127.0.0.1:3039`, configuração vazia e provedor de e-mail de desenvolvimento. Não usa `.env`, segredos, dados de assinantes, VPS, deploy ou envio real. As dependências existentes são as de `peticao-admin-deps-preview-v1`; nenhum pacote foi instalado. O WIP interrompido de texto rico não está neste checkout nem foi executado.

Não houve alteração de código da aplicação nesta frente. O portal seleciona documentos por links “Abrir documento”; não há um seletor `select` a validar nesta página. A tabela e os links de seleção/paginação foram exercitados.

## Resultados

- Build próprio: exit0 e fontes rastreadas idênticas antes/depois. Log `/tmp/admin-president-isolated-08c1vc07/validation.log`.
- Testes dirigidos:11/11 passaram, incluindo concorrência/lease expirada, rollback de auditoria, snapshot adulterado e conta/permissão revogada. Log `/tmp/admin-president-isolated-77145g5h/validation.log`.
- Typecheck: exit0, sem diagnóstico. Log `/tmp/admin-president-isolated-9rz4nzt1/validation.log`.
- Contrato HTTP/browser final ampliado: exit0, fontes inalteradas. Log `/tmp/admin-president-isolated-px087qtw/validation.log`; relatório `president-portal.json` no mesmo diretório.
- Total sem confirmação extra é bloqueado; Edição e Leitura não acessam o portal/download; conta revogada é revalidada.
- Retomada rejeita corpo inesperado, ID não canônico e origem externa. Lote legado sem snapshot mostra impedimento e não oferece retomada.
- Um erro de auditoria fictício interrompe o preparo depois da reserva; a retomada pela interface usa o snapshot congelado. Alteração posterior no cadastro fictício não altera a lista reservada.
- Downloads original, prévia e variante técnica armazenada são comparados byte a byte, com `nosniff`, disposição correta e cache privado/sem armazenamento. A variante de teste não representa certificado ou assinatura jurídica.
- `PREVIEW_MODE=0` verifica a guarda ICP-Brasil de produção: tentativa de aprovar lote sem ICP é recusada, sem aprovar/enviar. Botões de aprovação, assinatura própria e gov.br permanecem indisponíveis.
- 56 documentos: 50 na primeira página e seis na seguinte; lote final mais antigo continua selecionável; links abrem o documento correspondente. IDs inválidos/inexistentes retornam404.
- Assinantes fictícios, após a alteração de fixture, permanecem idênticos antes/depois do exercício. Nenhuma linha em `mail_messages`, `mail_outbox` ou `batch_sends`; cadeia de auditoria válida; zero erro não tratado no navegador e zero requisição externa.
- Capturas em320,390,768,1024,1280,1440px. Inspeção visual direta em320,390,1280: conteúdo, tabela e controles cabem; navegação fixa original preservada. Nenhuma estética foi alterada.

## PDF

O PDF produzido pelo próprio app foi baixado e inspecionado com Poppler, sem editar seus bytes. `pdfinfo`: três páginas A4, sem JavaScript,73192bytes na rodada visual. Renderização/inspeção da página3 mostra “Pessoa Original QA”, cidade Porto Velho/RO e indicação de teste sem assinatura. Extração de texto confirma que o nome posterior não substituiu o snapshot. Os arquivos são artefatos fictícios privados, fora do Git.

## Falha inicial e ajuste do contrato

A primeira execução falhou ao exigir a string literal `private, no-store`. O HTTP compilado combina a política global de `next.config.mjs` e a da rota: `no-store, max-age=0, private, no-store`. Nenhum cache público foi habilitado. Corrigiu-se apenas o contrato para validar as diretivas `private`/`no-store` e ausência de `public`, preservando a falha inicial em `/tmp/admin-president-isolated-a30tojhv/validation.log`. As duas rodadas seguintes passaram. Nenhum ajuste no aplicativo foi necessário.

## Reprodução

Na worktree acima, executar sequencialmente:

```sh
python3 tools/admin-qa/president-local.py build
python3 tools/admin-qa/president-local.py types
python3 tools/admin-qa/president-local.py tests
python3 tools/admin-qa/president-local.py http
```

O runner recusa portas ocupadas e configurações de ambiente no checkout, mantém logs/manifests privados e encerra somente seu servidor/banco fictícios. Não se trata de aprovação para publicação ou validação de um certificado ICP real. A assinatura criptográfica e serviços externos não foram executados.

Portas3039/54360 verificadas fechadas depois da rodada. Checkpoint/evidências locais: `.cache/president-portal-qa/evidence/`.
