// Repasse mínimo, FORA do sandbox: 127.0.0.1:PORTA (TCP) -> socket Unix do sandbox. Não interpreta HTTP.
import net from "node:net";
const [sock, port] = [process.argv[2], Number(process.argv[3] ?? 3100)];
if (!sock) { console.error("uso: node forward.mjs <socket> [porta]"); process.exit(1); }
net.createServer((c) => {
  const u = net.connect(sock);
  c.setTimeout(120_000, () => c.destroy());
  c.pipe(u); u.pipe(c);
  const end = () => { c.destroy(); u.destroy(); };
  c.on("error", end); u.on("error", end); c.on("close", end); u.on("close", end);
}).listen(port, "127.0.0.1", () => console.log(`repasse em 127.0.0.1:${port} -> ${sock}`));
