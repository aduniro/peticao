#!/usr/bin/env bash
# Atualiza o diretório de preparação do deploy (peticao-stage) a partir do ramo "producao" do repositório git da VPS.
# Chamado pelo gancho post-receive do repositório (e pode ser rodado à mão). NÃO faz o deploy: depois disso, rodar peticao-deploy como hoje.
# Variáveis (padrões para a VPS): BARE, CHECKOUT, STAGE, DEPLOY_USER, BRANCH.
set -euo pipefail
DEPLOY_USER="${DEPLOY_USER:-adunir}"; HOME_DIR="${HOME_DIR:-/home/$DEPLOY_USER}"
BARE="${BARE:-/srv/git/peticao.git}"; CHECKOUT="${CHECKOUT:-$HOME_DIR/peticao-checkout}"; STAGE="${STAGE:-$HOME_DIR/peticao-stage}"; BRANCH="${BRANCH:-producao}"
git --git-dir="$BARE" rev-parse --verify -q "refs/heads/$BRANCH" >/dev/null || { echo "ramo $BRANCH não existe em $BARE"; exit 1; }
mkdir -p "$CHECKOUT" "$STAGE/site" "$STAGE/deploy"
ANTES="$(cat "$STAGE/VERSAO" 2>/dev/null | head -c 40 || true)"   # versão que estava no stage antes desta atualização (para listar o que mudou)
git --git-dir="$BARE" --work-tree="$CHECKOUT" checkout -f "$BRANCH"
git --git-dir="$BARE" --work-tree="$CHECKOUT" clean -fdq
SHA="$(git --git-dir="$BARE" rev-parse "refs/heads/$BRANCH")"
CHOWN=(); [ "$(id -u)" = 0 ] && CHOWN=(--chown="$DEPLOY_USER:$DEPLOY_USER")
# O que não está no git (dados geográficos grandes, dados locais, segredos, build) fica como está no stage: nunca é apagado nem sobrescrito.
# Se o ramo não tiver uma das pastas (site/ ou deploy/), o stage dela fica como está (não apaga tudo por engano).
[ -d "$CHECKOUT/site" ] || { echo "o ramo $BRANCH não tem a pasta site/: nada atualizado"; exit 1; }
rsync -rlc --delete --omit-dir-times "${CHOWN[@]}" \
  --exclude node_modules --exclude /.next --exclude /.next-dev --exclude /.pgdata --exclude /data --exclude /geo-data \
  --exclude '.env*' --exclude /secrets --exclude /.npmrc --exclude /tsconfig.tsbuildinfo \
  "$CHECKOUT/site/" "$STAGE/site/"
[ -d "$CHECKOUT/deploy" ] && rsync -rlc --delete --omit-dir-times "${CHOWN[@]}" "$CHECKOUT/deploy/" "$STAGE/deploy/"
# VERSAO também dentro de site/: acompanha a publicação e a Central de Ações do painel mostra a versão implantada.
for f in "$STAGE/VERSAO" "$STAGE/site/VERSAO"; do echo "$SHA" > "$f"; [ "$(id -u)" = 0 ] && chown "$DEPLOY_USER:$DEPLOY_USER" "$f" || true; done
# MUDANCAS: o que entrou desde a versão anterior (ou as últimas 15 alterações, se não houver versão anterior); a Central de Ações mostra depois do deploy.
{ if [ -n "$ANTES" ] && git --git-dir="$BARE" cat-file -e "$ANTES^{commit}" 2>/dev/null; then git --git-dir="$BARE" log --format='%h %s' -n 40 "$ANTES..$SHA"; else git --git-dir="$BARE" log --format='%h %s' -n 15 "$SHA"; fi; } > "$STAGE/site/MUDANCAS" || true
[ "$(id -u)" = 0 ] && chown "$DEPLOY_USER:$DEPLOY_USER" "$STAGE/site/MUDANCAS" || true
echo "stage atualizado para $BRANCH @ ${SHA:0:12} ($(git --git-dir="$BARE" log -1 --format=%s "$SHA" | cut -c1-70))"
