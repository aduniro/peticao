// This fixture run must use explicit fetch mocks, never sockets or DNS.
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const dgram = require('node:dgram');
const deny = () => { throw Error('QA_GATES_RECOVERY_NETWORK_FORBIDDEN'); };
net.Socket.prototype.connect = deny;
net.Server.prototype.listen = deny;
tls.connect = deny;
for (const target of [dns, dns.promises]) {
  for (const key of Object.keys(target)) {
    if (key.startsWith('resolve') || ['lookup', 'reverse', 'lookupService'].includes(key)) target[key] = deny;
  }
}
dgram.Socket.prototype.send = deny;
dgram.Socket.prototype.bind = deny;
globalThis.fetch = deny;
require('node:module').syncBuiltinESMExports();
