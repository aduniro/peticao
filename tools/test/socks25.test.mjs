import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createSocks, isPrivate } from "../socks25.mjs";

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
/** Cliente SOCKS5 mínimo: devolve { code, sock } depois do pedido CONNECT. */
function connectVia(proxyPort, host, port) {
  return new Promise((resolve) => {
    const s = net.connect(proxyPort, "127.0.0.1");
    let stage = 0, buf = Buffer.alloc(0);
    s.on("error", () => resolve({ code: "erro", sock: s }));
    s.on("close", () => { if (stage < 2) resolve({ code: "fechado", sock: s }); });
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0 && buf.length >= 2) { stage = 1; buf = buf.subarray(2); const a = Buffer.from(host, "latin1"); s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, a.length]), a, Buffer.from([port >> 8, port & 255])])); }
      else if (stage === 1 && buf.length >= 10) { stage = 2; s.removeAllListeners("data"); resolve({ code: buf[1], sock: s }); }
    });
    s.write(Buffer.from([5, 1, 0]));
  });
}

test("SOCKS 25: destinos privados, portas e origens", () => {
  for (const ip of ["10.0.0.1", "127.0.0.1", "192.168.0.101", "172.16.5.4", "100.109.6.122", "169.254.1.1", "::1", "fd7a:115c:a1e0::1", "fe80::1", "::ffff:192.168.0.1"]) assert.ok(isPrivate(ip), ip);
  for (const ip of ["8.8.8.8", "142.250.0.1", "2800:3f0:4001::1", "216.128.169.215"]) assert.ok(!isPrivate(ip), ip);
});

test("SOCKS 25: encaminha para a porta permitida e responde (eco)", async () => {
  const echo = net.createServer((c) => c.on("data", (d) => c.write(Buffer.concat([Buffer.from("eco:"), d])))); const ep = await listen(echo);
  const proxy = createSocks({ allowFrom: ["127.0.0.1"], allowPorts: [ep], allowPrivate: true }); const pp = await listen(proxy);
  const { code, sock } = await connectVia(pp, "127.0.0.1", ep);
  assert.equal(code, 0);
  const got = await new Promise((r) => { sock.once("data", (d) => r(d.toString())); sock.write("oi"); });
  assert.equal(got, "eco:oi");
  sock.destroy(); proxy.close(); echo.close();
});

test("SOCKS 25: recusa porta diferente, destino privado e origem não autorizada", async () => {
  const echo = net.createServer((c) => c.end()); const ep = await listen(echo);
  const ev = [];
  // porta não permitida (443): reply 2 mesmo com destino alcançável
  let proxy = createSocks({ allowFrom: ["127.0.0.1"], allowPorts: [25], allowPrivate: true, onEvent: (e) => ev.push(e) }); let pp = await listen(proxy);
  assert.equal((await connectVia(pp, "127.0.0.1", ep)).code, 2); proxy.close();
  // destino privado (sua rede local): reply 2
  proxy = createSocks({ allowFrom: ["127.0.0.1"], allowPorts: [ep], allowPrivate: false, onEvent: (e) => ev.push(e) }); pp = await listen(proxy);
  assert.equal((await connectVia(pp, "127.0.0.1", ep)).code, 2); proxy.close();
  // origem fora da lista: a conexão é derrubada
  proxy = createSocks({ allowFrom: ["100.109.6.122"], allowPorts: [ep], allowPrivate: true, onEvent: (e) => ev.push(e) }); pp = await listen(proxy);
  assert.equal((await connectVia(pp, "127.0.0.1", ep)).code, "fechado"); proxy.close(); echo.close();
  assert.deepEqual(ev, ["recusado-porta", "recusado-destino-privado", "recusado-origem"]);
});
