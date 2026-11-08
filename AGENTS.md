# Repository Guidelines

## Execução de tarefas prioritárias

**NUNCA PARAR UMA TAREFA DADA COMO PRIORITÁRIA, A NÃO SER QUE SEJA SOLICITADA A INTERRUPÇÃO.**

Manter foco na tarefa prioritária até concluir o escopo aprovado. Perguntas, pedidos de status e tarefas secundárias não autorizam interrompê-la. Não encerrar o trabalho apenas por concluir uma etapa intermediária; continuar as etapas independentes enquanto aguarda aprovações. O admin-v2 completo é a prioridade número 1; a prévia isolada somente leitura já foi concluída e deve ser preservada para avaliação.

Registrar etapas, commits, testes e atividade real no Vigia. Se houver interrupção externa ou impedimento técnico, informar imediatamente, preservar um checkpoint e retomar assim que possível; nunca apresentar trabalho parado como execução em segundo plano. Seguir `docs/POLITICA-CENTRAL-EXECUCAO.md`. A prioridade não autoriza deploy ou merge sem permissão explícita.

## Project Structure & Module Organization
`site/` contains the Next.js 14, React, TypeScript, and PostgreSQL application. Routes and API handlers live in `site/src/app/`; reusable UI in `src/components/`; business logic in `src/lib/`; petition and sharing copy in `src/content/`; translations in `src/i18n/`. Paths in this sentence are relative to `site/` unless fully qualified. Assets live in `site/assets/` and `site/public/`.

`tools/preview/` manages the isolated preview; `tools/infra/` contains provider tooling. `deploy/` contains server provisioning and publication scripts. `material_base/` and `texto/` hold reference material and petition text.

## Build, Test, and Development Commands
Run application commands from `site/`:

- `npm ci`: install dependencies from the lockfile.
- `cp .env.example .env.local`: initialize local configuration; preserve existing settings.
- `npm run db:dev`: start embedded PostgreSQL on a POSIX filesystem; keep it running in another terminal.
- `npm run dev`: serve development pages at `http://localhost:3000`.
- `npm test`: run TypeScript tests, starting development PostgreSQL if needed.
- `npm run typecheck`: check strict TypeScript types.
- `npm run build` and `npm start`: build and serve production output.

Consult `tools/preview/LEIAME.md` for preview operations and `deploy/LEIAME.md` before publishing.

## Coding Style & Naming Conventions
Follow existing two-space indentation, double quotes, and semicolons. Use PascalCase component filenames and descriptive kebab-case library filenames. Prefer the configured `@/*` alias for imports from `site/src/`. TypeScript strict mode is enabled. No dedicated lint or formatting script is configured; match surrounding code.

## Testing Guidelines
Tests use `node:test` and `node:assert/strict`, executed through `tsx`. Place application tests beside modules as `*.test.ts` in `src/lib/` or `src/i18n/`. Add regression cases for changed validation, email, signature, and translation behavior. No coverage threshold is configured. Use fictitious signer data and development email delivery. From the repository root, tooling tests run with `node --test tools/test/*.test.mjs tools/infra/test/*.test.mjs`.

## Commit & Pull Request Guidelines
Git history is unavailable in this checkout. Recommended commits use concise imperative subjects, such as `Fix confirmation token expiry`. PRs should explain behavior changes, list validation results, link relevant issues, and include screenshots for UI changes.

## Security & Configuration
Never commit credentials, `.env.local`, database state, or signer exports. Treat `secrets/` and `preview-state/` as sensitive runtime data. Preserve email guards and approval checks; never change the production `HASH_PEPPER` after launch.
