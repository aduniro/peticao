#!/usr/bin/env node
// Cria (ou refaz) o usuário DONO do painel, nível Total. Rode na VPS, depois do deploy que trouxe o login por usuário e de abrir o site uma vez:
//   ssh -t peticao-root 'cd /opt/peticao/app && node scripts/admin-dono.mjs operator-1608598f41@example.invalid "Nome do dono"'
// Pede a senha SEM eco (duas vezes). Nada passa por e-mail, argumento ou histórico do terminal. Em desenvolvimento: node scripts/with-db.mjs node scripts/admin-dono.mjs e-mail "Nome".
// Efeito: o primeiro usuário cadastrado desliga a senha única antiga do painel (ela só valia por transição). Se o e-mail já existir, a senha é trocada, o nível volta a Total e a conta é reativada.
import pg from "pg";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { askHidden, closePrompt } from "./lib-prompt.mjs";
import { ADMIN_PASSWORD_MIN_LENGTH, problemaNaSenha } from "../src/lib/admin-password-policy.mjs";

const [email0, ...resto] = process.argv.slice(2);
const email = (email0 ?? "").trim().toLowerCase(), nome = resto.join(" ").trim();
if (!/^[a-z0-9._+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || nome.length < 2) { console.error('Uso: node scripts/admin-dono.mjs e-mail "Nome completo"'); process.exit(1); }

// Só a DATABASE_URL é lida (do ambiente ou de /etc/peticao/app.env); nenhum outro segredo é lido nem mostrado.
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const f = process.env.APP_ENV_FILE ?? "/etc/peticao/app.env";
  if (!existsSync(f)) return null;
  const m = /^DATABASE_URL=(.*)$/m.exec(readFileSync(f, "utf8"));
  return m ? m[1].trim().replace(/^(['"])(.*)\1$/, "$2") : null;
}
const url = databaseUrl();
if (!url) { console.error("Não achei a DATABASE_URL (ambiente ou /etc/peticao/app.env)."); process.exit(1); }

const hash = (s) => { const sal = randomBytes(16); return `scrypt$16384$8$1$${sal.toString("hex")}$${scryptSync(s, sal, 32, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString("hex")}`; };

const senha = await askHidden(`Senha do dono (${ADMIN_PASSWORD_MIN_LENGTH}+ caracteres): `);
const problemaSenha = problemaNaSenha(senha, email);
if (problemaSenha) { closePrompt(); console.error(problemaSenha); process.exit(1); }
if ((await askHidden("Repita a senha: ")) !== senha) { closePrompt(); console.error("As senhas não são iguais. Nada foi gravado."); process.exit(1); }
closePrompt();

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const existe = await c.query("SELECT to_regclass('public.admin_users') t");
  if (!existe.rows[0].t) { console.error("A tabela admin_users ainda não existe: rode o deploy e abra o site uma vez, depois repita."); process.exit(1); }
  const r = await c.query(
    `INSERT INTO admin_users(email,nome,nivel,senha_hash,trocar_senha) VALUES($1,$2,'total',$3,false)
     ON CONFLICT (email) DO UPDATE SET senha_hash=EXCLUDED.senha_hash, nivel='total', ativo=true, trocar_senha=false, falhas=0, bloqueado_ate=NULL
     RETURNING id, (xmax = 0) AS novo`, [email, nome, hash(senha)]);
  await c.query("DELETE FROM admin_sessions WHERE user_id=$1", [r.rows[0].id]);
  console.log(r.rows[0].novo ? `Dono criado: ${email} (nível Total).` : `Dono atualizado: ${email} (senha trocada, nível Total, conta ativa, sessões antigas encerradas).`);
  console.log("A partir de agora o painel pede e-mail e senha; a senha única antiga deixou de valer.");
} finally { await c.end(); }
