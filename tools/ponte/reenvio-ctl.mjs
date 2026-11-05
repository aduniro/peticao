// Controle do reenvio por falha (produção, via SSH). Uso: node reenvio-ctl.mjs ativar <AP-código> | parar | status
import { execFileSync } from "node:child_process";
const psql = (sql) => execFileSync("ssh", ["-o", "BatchMode=yes", "peticao-root", "runuser -u postgres -- psql -d peticao -X -q -A -F ' | '"], { input: sql }).toString();
const cmd = process.argv[2];
if (cmd === "ativar") {
  const cod = process.argv[3]; if (!/^AP-[0-9A-F]{6}$/.test(cod ?? "")) throw new Error("informe o código da proposta aprovada");
  console.log(psql(`INSERT INTO settings(key,value) VALUES('reenvio_inicio','2026-11-04T04:00:00-03:00'),('reenvio_fim','2026-11-04T12:00:00-03:00'),('reenvio_lote','60'),('reenvio_ativo','${cod}') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value; SELECT key, value FROM settings WHERE key LIKE 'reenvio_%' ORDER BY key;`));
} else if (cmd === "parar") {
  console.log(psql(`UPDATE settings SET value='' WHERE key='reenvio_ativo'; SELECT key, value FROM settings WHERE key LIKE 'reenvio_%' ORDER BY key;`));
} else {
  console.log(psql(`SELECT status, COALESCE(provider,'-') servico, COUNT(*) FROM reenvio_falha GROUP BY 1,2 ORDER BY 3 DESC;
SELECT 'restantes' k, COUNT(*) FROM signatures s WHERE s.status='pending' AND s.created_at::timestamptz >= timestamptz '2026-11-04 04:00-03' AND s.created_at::timestamptz < timestamptz '2026-11-04 12:00-03' AND NOT EXISTS (SELECT 1 FROM reenvio_falha r WHERE r.signature_id=s.id) AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE lower(x.email)=lower(s.email));
SELECT 'ativo', value FROM settings WHERE key='reenvio_ativo';
SELECT 'confirmaram desde o reenvio', COUNT(*) FROM signatures s JOIN reenvio_falha r ON r.signature_id=s.id WHERE s.status='confirmed';`));
}
