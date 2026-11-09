# Página principal no VSCodium

Abra o workspace com o comando absoluto:

```bash
/usr/bin/codium --new-window /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/peticao-principal.code-workspace
```

A pasta é o worktree isolado da consolidação. O branch aparece na barra inferior e no GitGraph. Enquanto a validação não terminar, é consolidacao/pagina-principal-20261109; a promoção para main local só ocorrerá após os testes. A VPS não é atualizada por abrir ou editar aqui.

Para localizar textos, procure MUDAR AQUI (Ctrl+Shift+F) ou use TodoTree. Os comentários ficam em /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/i18n/pt.ts; não alterei seus valores. Os componentes ficam em /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/components/.

Ctrl+Shift+P → Tasks: Run Task abre o Vigia, a árvore Git e a prévia isolada. Ctrl+Shift+P → Git Graph: View Git Graph abre a árvore interativa. Para Markdown, Ctrl+Shift+V. Para comparar alterações, use Controle de Código-Fonte na barra lateral. A formatação automática ao salvar está desativada neste workspace para evitar mudanças não solicitadas.

As dependências locais do editor correspondem ao lockfile do projeto e ficam fora do Git. O runtime de validação usa Node20.19.2 em Docker, igual à VPS; o workspace não atualiza o Node do sistema. Nenhuma credencial de produção foi adicionada.
