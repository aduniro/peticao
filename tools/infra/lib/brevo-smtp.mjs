// Testa login SMTP no Brevo (só autentica; não envia e-mail). Porta 465 com TLS implícito. A chave nunca é impressa.
import tls from "node:tls";

export function testBrevoSmtp(login, key, { host = "smtp-relay.brevo.com", port = 465, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port, servername: host });
    let buf = "", step = 0;
    const done = (err, ok) => { clearTimeout(t); s.destroy(); err ? reject(err) : resolve(ok); };
    const t = setTimeout(() => done(new Error("tempo esgotado ao falar com o servidor SMTP do Brevo")), timeoutMs);
    s.setEncoding("utf8");
    s.on("error", (e) => done(new Error(`rede (${e.code ?? e.message})`)));
    s.on("data", (d) => {
      buf += d;
      const lines = buf.split("\r\n"); if (!lines.at(-1)) lines.pop();
      const last = lines.at(-1) ?? "";
      if (!/^\d{3} /.test(last)) return; // resposta multilinha ainda incompleta
      buf = "";
      const code = Number(last.slice(0, 3));
      if (step === 0) { if (code !== 220) return done(new Error(`banner inesperado: ${last.slice(0, 60)}`)); s.write("EHLO verifica.local\r\n"); step = 1; }
      else if (step === 1) { if (code !== 250) return done(new Error(`EHLO recusado: ${last.slice(0, 60)}`)); s.write(`AUTH PLAIN ${Buffer.from(`\0${login}\0${key}`).toString("base64")}\r\n`); step = 2; }
      else if (step === 2) {
        s.write("QUIT\r\n");
        if (code === 235) return done(null, true);
        if (code === 535) return done(new Error("O Brevo recusou o login SMTP (535): login ou chave SMTP errados. O login é o da conta SMTP (algo como xxxx@smtp-brevo.com), não o seu e-mail."));
        return done(new Error(`resposta inesperada ao login: ${last.slice(0, 80)}`));
      }
    });
  });
}
