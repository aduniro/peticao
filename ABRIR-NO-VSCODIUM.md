# Página principal no VSCodium

Abra o workspace com o comando absoluto:

```bash
/usr/bin/codium --new-window /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/peticao-principal.code-workspace
```

A pasta é o worktree isolado da consolidação. O branch aparece na barra inferior e no GitGraph. A versão foi validada em208testesbackend,35cenáriosnavegador e9comparaçõesvisuais e será aberta no ramo main local. O ramo consolidacao/pagina-principal-20261109 preserva a consolidação para consulta. A VPS não é atualizada por abrir ou editar aqui.

Para localizar textos, procure MUDAR AQUI (Ctrl+Shift+F) ou use TodoTree. Os comentários ficam em /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/i18n/pt.ts; não alterei seus valores. Os componentes ficam em /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/components/.

Ctrl+Shift+P → Tasks: Run Task abre o Vigia, a árvore Git e a prévia isolada. Ctrl+Shift+P → Git Graph: View Git Graph abre a árvore interativa. Para Markdown, Ctrl+Shift+V. Para comparar alterações, use Controle de Código-Fonte na barra lateral. A formatação automática ao salvar está desativada neste workspace para evitar mudanças não solicitadas.

As dependências locais do editor correspondem ao lockfile do projeto e ficam fora do Git. O runtime de validação usa Node20.19.2 em Docker, igual à VPS; o workspace não atualiza o Node do sistema. Nenhuma credencial de produção foi adicionada.

## Atalhos de validação

Em Tasks: Run Task, use Reconstruir prévia isolada (build + iniciar), Typecheck em QA isolado ou Testes backend em QA isolado. A prévia usa somente um banco fictício e rede Docker interna. Os testes dependem da reconstrução para incorporar suas edições. O controlador recusa testes sobrepostos, preserva a prévia-base na porta3061 e não limpa fixtures automaticamente. O comando fixtures é uma ação separada e apaga apenas dados fictícios; não há atalho automático para ele.

O contexto usa arquivos de site/ registrados no Git; ao criar arquivos novos, confira-os no Controle de Código-Fonte e adicione-os ao índice antes de reconstruir. Arquivos de ambiente, segredos e bancos não entram no contexto. Os logs ficam em /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109-qa/fix-fa25c04/reports/. Não execute testes contra a VPS.
