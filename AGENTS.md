# Repository Guidelines

## Project Structure & Module Organization

This directory is a CPF recovery, comparison, and review workspace. No usable Git history, dependency manifest, README, or test suite was found here.

- `revisar-cpfs` is the Python launcher for the local review interface. Its server implementation lives outside this workspace at `/mnt/dev/peticao/tools/cpf-review/server.py`.
- `revisao/` holds review state, SQLite files, logs, authentication material, and dated source snapshots under `fontes/`.
- `.execucoes/` and `.validacoes/` contain execution-specific Python workers.
- Root CSV, SQLite, JSON manifests, and summaries are generated artifacts. `consolidacao-*`, `complemento-*`, and `previa-revisada-*` hold staged results; `backups/` preserves earlier state.

## Development Commands

Run commands from `/mnt/dev/cpfs`:

- `./revisar-cpfs`: start the review server if needed and open the authenticated interface with `xdg-open`.
- `./revisar-cpfs --no-open`: start or check the server without opening a browser.
- `CPF_REVIEW_PORT=8765 ./revisar-cpfs`: select the port used by the launcher; verify the external server uses matching configuration before changing it.

The launcher requires Python 3, the external server, and existing review authentication material. No build or package-install command is established here.

## Coding Style & Naming Conventions

For new Python code, use four-space indentation, `snake_case` names, and explicit imports. These are recommendations; no formatter or linter configuration was found. Preserve Portuguese artifact prefixes and timestamp/run identifiers, such as `manifest-<run-id>.json`. Keep reusable application changes in the owning source project rather than silently changing archived workers.

## Testing & Data Validation

No testing framework or coverage threshold is configured locally. Verify launcher changes against the local interface and inspect `revisao/servidor.log` for failures. Validate generated outputs on copies: check CSV headers, row counts, duplicates, empty fields, and correspondence with manifests. Preserve CPF values as strings, including leading zeros. Avoid validation that mutates live databases.

## Commits & Pull Requests

Git conventions could not be established. If changes are submitted through the owning repository, use descriptive imperative commit messages. Include the affected scripts, behavior change, validation results, and external dependencies in the PR description.

## Data & Configuration Safety

Preserve originals and backups. Never include CPF records, authentication tokens, private databases, or authenticated URLs in commits, screenshots, or review descriptions. Coordinate database changes with active review processes; do not remove lock files or SQLite sidecars as routine cleanup.
