#!/usr/bin/env bash
# Instala na VPS o git do projeto (rode UMA vez, como root):
#   scp /mnt/dev/peticao-parcial/deploy/20-git-vps.sh /mnt/dev/peticao-parcial/deploy/peticao-atualizar-stage.sh peticao-root:/root/ && ssh peticao-root 'bash /root/20-git-vps.sh'
# Cria: (1) repositório que recebe os "git push" (/srv/git/peticao.git, só avanço, sem apagar ramos); (2) clone de trabalho /home/adunir/peticao, para modificar o projeto de lá;
# (3) o gancho que, a cada push no ramo "producao", atualiza o diretório de preparação do deploy (peticao-stage) pelo script /usr/local/sbin/peticao-atualizar-stage.
# NÃO altera o site em execução nem o peticao-deploy: depois de um push, o deploy continua sendo o comando de sempre. Idempotente.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }
DEPLOY_USER="${DEPLOY_USER:-adunir}"; HOME_DIR="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
BARE="${BARE:-/srv/git/peticao.git}"; WORK="${WORK:-$HOME_DIR/peticao}"; AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$AQUI/peticao-atualizar-stage.sh" ] || { echo "Falta $AQUI/peticao-atualizar-stage.sh (copie os dois arquivos juntos)."; exit 1; }
command -v git >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y git
command -v rsync >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y rsync
install -m 755 -o root -g root "$AQUI/peticao-atualizar-stage.sh" /usr/local/sbin/peticao-atualizar-stage
if [ ! -d "$BARE" ]; then
  install -d -m 2775 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$(dirname "$BARE")"
  git init --bare --initial-branch=producao --shared=group "$BARE"
fi
git --git-dir="$BARE" config receive.denyNonFastForwards true   # só avanço: ninguém reescreve o histórico da produção
git --git-dir="$BARE" config receive.denyDeletes true
git --git-dir="$BARE" config core.sharedRepository group
cat > "$BARE/hooks/post-receive" <<'HOOK'
#!/usr/bin/env bash
# Depois de um push no ramo producao, atualiza o peticao-stage (não faz deploy).
while read -r _ _ ref; do
  [ "$ref" = "refs/heads/producao" ] && /usr/local/sbin/peticao-atualizar-stage
done
exit 0
HOOK
chmod 755 "$BARE/hooks/post-receive"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$BARE"; chmod -R g+rwX "$BARE"; find "$BARE" -type d -exec chmod g+s {} +
if [ ! -d "$WORK/.git" ] && git --git-dir="$BARE" rev-parse --verify -q refs/heads/producao >/dev/null; then
  runuser -u "$DEPLOY_USER" -- git clone -q -b producao "$BARE" "$WORK"
  runuser -u "$DEPLOY_USER" -- git -C "$WORK" config user.name "Petição (VPS)"; runuser -u "$DEPLOY_USER" -- git -C "$WORK" config user.email "adunir@sancionaintegral.org"
fi
echo "== git instalado na VPS"
echo "   repositório que recebe pushes: $BARE"
echo "   clone de trabalho: $WORK $( [ -d "$WORK/.git" ] && echo '(criado)' || echo '(será criado no primeiro push: rode este script de novo depois dele)')"
echo "   atualizador do stage: /usr/local/sbin/peticao-atualizar-stage"
echo "   Próximo passo, na SUA máquina:  git -C /mnt/dev/peticao-parcial remote add vps peticao-root:/srv/git/peticao.git ; git -C /mnt/dev/peticao-parcial push vps producao"
