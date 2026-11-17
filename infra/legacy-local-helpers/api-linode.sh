(
  set -e
  umask 077
  arquivo='/home/barre/Desktop/.txt files/api-tokens.txt'

  xdg-open 'https://cloud.linode.com/profile/tokens' >/dev/null 2>&1 || true
  read -rsp 'Crie o token no painel e cole aqui: ' linode_token
  printf '\n'
  [[ -n "$linode_token" ]]

  printf '\n# Linode — PAT peticao-final-linode — %s\nLINODE_API_TOKEN=%s\n' \
    "$(date -Iseconds)" "$linode_token" >> "$arquivo"
  chmod 600 "$arquivo"
  unset linode_token
  echo 'Token salvo com identificação.'
)
