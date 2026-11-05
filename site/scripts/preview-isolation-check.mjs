// Roda DENTRO do sandbox e confirma o isolamento. Saída: PASS/FAIL por item.
import net from "node:net";
import { accessSync, constants, readdirSync, writeFileSync } from "node:fs";

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const tryConnect = (host, port) => new Promise((res) => {
  const s = net.connect({ host, port, timeout: 1500 });
  s.on("connect", () => { s.destroy(); res(true); });
  s.on("timeout", () => { s.destroy(); res(false); });
  s.on("error", () => res(false));
});
const exists = (p) => { try { accessSync(p, constants.F_OK); return true; } catch { return false; } };
const writable = (p) => { try { writeFileSync(p, "x"); return true; } catch { return false; } };

// controle positivo: o loopback INTERNO do sandbox funciona (senão os "não conecta" abaixo não provariam nada)
const srv = net.createServer((c) => c.end()).listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
check("controle: loopback interno funciona", await tryConnect("127.0.0.1", srv.address().port));
srv.close();
check("sem acesso à pasta /home", !exists("/home"));
check("sem acesso a /mnt, /media nem /root", !exists("/mnt") && !exists("/media") && !exists("/root"));
check("código do site é somente leitura", !writable("/app/package.json") && !writable("/app/pwned.txt"));
check("/usr é somente leitura", !writable("/usr/pwned.txt"));
check("/etc é somente leitura ou mínimo", !writable("/etc/pwned.txt"));
check("não conecta à internet (1.1.1.1:443)", !(await tryConnect("1.1.1.1", 443)));
check("não enxerga serviços do computador (127.0.0.1:5000)", !(await tryConnect("127.0.0.1", 5000)));
check("não enxerga o CUPS (127.0.0.1:631)", !(await tryConnect("127.0.0.1", 631)));
check("não enxerga o SMTP local (127.0.0.1:25)", !(await tryConnect("127.0.0.1", 25)));
check("não alcança a rede local (192.168.122.1:53)", !(await tryConnect("192.168.122.1", 53)));
check("não alcança a interface Tailscale (100.105.193.63)", !(await tryConnect("100.105.193.63", 22)));
const procs = readdirSync("/proc").filter((d) => /^\d+$/.test(d)).length;
check("poucos processos visíveis (namespace próprio)", procs < 25, `${procs} processos`);
console.log(results.every(Boolean) ? "\nISOLAMENTO OK" : "\nISOLAMENTO COM FALHAS");
process.exit(results.every(Boolean) ? 0 : 1);
