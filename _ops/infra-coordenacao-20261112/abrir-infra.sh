#!/usr/bin/env bash
set -euo pipefail
exec /bin/bash -ic '
  cd /mnt/apps/peticao-final/_ops/infra-coordenacao-20261112 || exit
  infra_resume_prompt=()
  case "${1:-}" in
    --check)
      printf "Sessão: Petição — Infraestrutura\nHistórico: 01a1d130-2948-7140-bcfb-34696b20ab8d\nShell: bash interativo; .bashrc carregado\nConexão: servidor compartilhado local (unix://)\n"
      codex app-server daemon version
      codex login status
      exit $? ;;
    --atualizar-contexto)
      infra_resume_prompt=("Leia ATUALIZACAO-COORDENACAO-20261112.md e inbox/root-updates.jsonl, preservando AGENTS.md, HANDOFF.md e a skill peticao-infra. Atualize seu contexto pelas fontes referenciadas somente quando necessário. Não carregue o histórico completo de uma vez. Não execute tarefas, consultas externas, migrações ou planos. Responda em até três linhas confirmando que recebeu a atualização e aguarde instruções do dono, mantendo coordenação com root.")
      shift ;;
    --login)
      codex login || exit $?
      shift ;;
    "") ;;
    *) printf "Uso: abrir-infra.sh [--check|--login|--atualizar-contexto]\n" >&2; exit 64 ;;
  esac
  if ! codex login status >/dev/null 2>&1; then
    printf "Etapa: autenticar a conta escolhida, preservando o histórico.\n"
    codex login || exit $?
  fi
  exec 9>"${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/peticao-infra-01a1d130.lock"
  if ! flock -n 9; then
    printf "A sessão de infraestrutura já está aberta pelo lançador. Use a aba existente ou feche-a antes de abrir novamente.\n" >&2
    exit 75
  fi
  printf "Etapa: retomar a sessão de infraestrutura com comunicação concisa.\n"
  codex --remote unix:// resume --all --include-non-interactive --cd /mnt/apps/peticao-final/_ops/infra-coordenacao-20261112 --sandbox danger-full-access --ask-for-approval never -c '\''model_verbosity="low"'\'' -c '\''tool_output_token_limit=2000'\'' -c '\''hide_agent_reasoning=true'\'' -c '\''show_raw_agent_reasoning=false'\'' 01a1d130-2948-7140-bcfb-34696b20ab8d "${infra_resume_prompt[@]}"
' peticao-infra "$@"
