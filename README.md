# Civo Neon INFRA read-only qualification

Exact Neon project lingering-shape-35933425, database infra, role infra_owner. Existing CLI9.5.0 at /home/civo/.local/bin/neon and API key already on Civo successfully read only this project. No new API keys, login, password rotation, resource, app DB or queue change.

This bounded operation reads the existing0600 owner connection envelope /mnt/apps/peticao-final/_ops/infra-coordenacao-20261112/distributed/cloud-execution-20261114/NEON-CONNECTION-RESULT.private.json within the local client process. No secret is emitted to terminal, argv, logs or Git. Transfers DB credential only over host-key-pinned encrypted SSH to civo UID1000, with private directory /home/civo/.config/peticao-neon-infra mode0700 and .pgpass/binding.json/receipt.json mode0600. Credential at rest is normal private libpq plaintext, not encrypted-at-rest; SSH provides encrypted transit. No API token is transferred. Existing destination is refused, no overwrite or blind retry.

Requires immutable manifest, real Root ACK and own exact manifest-bound deploy reservation. Before writing, remote operator validates project API access and that the exact host belongs to its endpoint list, account/hostname and trusted private parent. Rejects other project/database/role/port/host.

Only SQL: BEGIN TRANSACTION READ ONLY; SELECT1/current_database/current_user/transaction_read_only; own pg_stat_ssl TLS fields; ROLLBACK. Psql-X/no password prompt, clean env, PGSSLMODE=verify-full, explicit system CA, channel_binding=require, read-only default, bounded connect/query/lock timeouts. Password supplied by private pgpass, never argv/environment. Raw libpq stderr not recorded; reports only classification. No CREATE/ALTER/DROP/INSERT/UPDATE/DELETE or app-data queries.

CLI/API authentication, SQL read permission and installed binaries are separate results. Write capability is deliberately not tested; this is not proof of queue integration.

TLS reference: https://neon.com/docs/security/security-overview (verify-full supported); libpq https://www.postgresql.org/docs/current/libpq-ssl.html.
