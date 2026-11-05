#!/usr/bin/env node
// Proxy SOCKS5 mínimo, SÓ para SMTP (porta 25), para o Reacher da VPS verificar e-mails pela SUA CASA através da tailnet.
// Travas: escuta APENAS no IP da tailnet deste computador; aceita APENAS a VPS (100.109.6.122); só libera a porta 25;
// recusa destinos privados (sua rede local, tailnet, loopback); no máximo 8 conexões; 60 s de inatividade; sem registrar endereços.
// Uso: node socks25.mjs            (alias: socks25 on | off | status)
import dns from "node:dns/promises";
import net from "node:net";
import { fileURLToPath } from "node:url";

export const isPrivate = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const l = ip.toLowerCase();
  if (l.startsWith("::ffff:")) return isPrivate(l.slice(7));
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe8") || l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb") || l.startsWith("ff");
};

export function createSocks({ allowFrom, allowPorts = [25], maxConns = 8, idleMs = 60_000, allowPrivate = false, onEvent = () => {} }) {
  let open = 0;
  return net.createServer((c) => {
    const from = (c.remoteAddress ?? "").replace(/^::ffff:/, "");
    if (!allowFrom.includes(from)) { onEvent("recusado-origem"); return c.destroy(); }
    if (open >= maxConns) { onEvent("recusado-limite"); return c.destroy(); }
    open++; let closed = false; const done = () => { if (!closed) { closed = true; open--; } };
    c.setTimeout(idleMs, () => c.destroy()); c.on("close", done); c.on("error", () => c.destroy());
    let stage = 0, buf = Buffer.alloc(0);
    const reply = (code) => c.write(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]));
    c.on("data", async function onData(d) {
      buf = Buffer.concat([buf, d]);
      if (stage === 0) {
        if (buf.length < 2) return;
        if (buf[0] !== 5 || buf.length < 2 + buf[1]) return buf[0] !== 5 ? c.destroy() : undefined;
        const methods = [...buf.subarray(2, 2 + buf[1])];
        buf = buf.subarray(2 + buf[1]);
        if (!methods.includes(0)) { c.write(Buffer.from([5, 0xff])); return c.end(); }
        c.write(Buffer.from([5, 0])); stage = 1;
      }
      if (stage === 1) {
        if (buf.length < 5) return;
        if (buf[0] !== 5 || buf[1] !== 1) { reply(7); return c.end(); } // só CONNECT
        const atyp = buf[3]; let host, off;
        if (atyp === 1) { if (buf.length < 10) return; host = [...buf.subarray(4, 8)].join("."); off = 8; }
        else if (atyp === 3) { const n = buf[4]; if (buf.length < 7 + n) return; host = buf.subarray(5, 5 + n).toString("latin1"); off = 5 + n; }
        else if (atyp === 4) { if (buf.length < 22) return; const g = []; for (let i = 0; i < 8; i++) g.push(buf.readUInt16BE(4 + i * 2).toString(16)); host = g.join(":"); off = 20; }
        else { reply(8); return c.end(); }
        const port = buf.readUInt16BE(off);
        stage = 2; c.removeListener("data", onData); c.pause();
        if (!allowPorts.includes(port)) { onEvent("recusado-porta"); reply(2); return c.end(); }
        try {
          const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
          const ip = ips.find((a) => allowPrivate || !isPrivate(a));
          if (!ip) { onEvent("recusado-destino-privado"); reply(2); return c.end(); } // nunca para a rede local
          const t = net.connect({ host: ip, port, timeout: 15_000 });
          t.once("connect", () => { onEvent("conectado"); reply(0); t.setTimeout(idleMs, () => t.destroy()); c.pipe(t); t.pipe(c); c.resume(); });
          t.once("timeout", () => { reply(6); t.destroy(); c.end(); });
          t.once("error", () => { reply(5); c.end(); });
          t.on("close", () => c.destroy()); c.on("close", () => t.destroy());
        } catch { reply(4); c.end(); }
      }
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.SOCKS_BIND ?? "100.105.193.63", port = Number(process.env.SOCKS_PORT ?? 1080);
  const allow = (process.env.SOCKS_ALLOW ?? "100.109.6.122").split(",");
  if (!/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) { console.error("Por segurança, só escuta em IP da tailnet (100.64.0.0/10)."); process.exit(1); }
  let n = 0, nok = 0;
  const srv = createSocks({ allowFrom: allow, onEvent: (e) => { n++; if (e === "conectado") nok++; } });
  srv.listen(port, host, () => console.log(`SOCKS5 só para a porta 25, em ${host}:${port}, aceitando apenas ${allow.join(", ")}. Ctrl+C para parar.`));
  setInterval(() => { if (n) { console.log(`${new Date().toISOString().slice(11, 19)} eventos: ${n} (conexões feitas: ${nok})`); n = 0; nok = 0; } }, 60_000).unref();
}
