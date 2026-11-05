#!/usr/bin/env bash
# Troca a senha do painel /admin SEM reiniciar o site. Pede a senha duas vezes (não aparece na tela nem fica no histórico).
# Grava só o hash scrypt em /etc/peticao/admin-password.hash; o app relê o arquivo no próximo login. Sessões abertas são encerradas.
# Uso (na VPS, como root):  bash 13-senha-admin.sh      (instalado também como /usr/local/sbin/peticao-senha-admin)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo)."; exit 1; }
F=/etc/peticao/admin-password.hash
read -rsp "Nova senha do painel: " P1; echo
read -rsp "Repita a senha: " P2; echo
[ "$P1" = "$P2" ] || { echo "As senhas não conferem. Nada foi alterado."; exit 1; }
[ "${#P1}" -ge 8 ] || { echo "Use pelo menos 8 caracteres. Nada foi alterado."; exit 1; }
H="$(printf '%s' "$P1" | node -e '
const c=require("node:crypto");let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
const N=32768,r=8,p=1,salt=c.randomBytes(16);
const h=c.scryptSync(s,salt,32,{N,r,p,maxmem:256*1024*1024});
process.stdout.write(`scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${h.toString("hex")}`);});')"
unset P1 P2
[[ "$H" == scrypt\$* ]] || { echo "Falha ao gerar o hash. Nada foi alterado."; exit 1; }
umask 027; printf '%s\n' "$H" > "$F.new"; chown root:peticao "$F.new"; chmod 0640 "$F.new"; mv -f "$F.new" "$F"
echo "Senha do painel trocada. Vale a partir do próximo login (o site não foi reiniciado)."
