# Neon INFRA same-session client TLS verification

Read-only follow-up of applied-partial notice3000/source d5808a10d7b8f266030dfe5c4ef1dcaa081af2c4. Original transfer succeeded (0700dir/0600pgpass) and API host binding passed. Original validator wrongly required server pg_stat_ssl=true; original error/receipt retained at /mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-neon-infra/ATTEMPT1-FINDING.json. No retransmission or retry of original apply.

This source reads existing binding metadata and lets libpq consume existing private pgpass. No remote files, configuration or credentials are written. One psql process, one connection: client \conninfo; BEGIN TRANSACTION READ ONLY; SELECT1/current_database/current_user/transaction_read_only; own backend pg_stat_ssl; ROLLBACK. Enforces verify-full with system CA, channel_binding=require and fixed infra/infra_owner; validates project endpoint host through existing API credential before SQL.

Client TLS1.2/1.3 and cipher must be positively present in same-process conninfo; identity/readOnly plus transaction statuses must match. Backend pg_stat_ssl is retained separately, including f|| if observed; never waive missing client TLS, and do not infer provider-internal link encryption from these results. Host direct/pooled context is identified without emitting its value.

Own manifest-bound TEST reservation, actual independent Root ACK, exact source freeze, once-only local journal, host-key-pinned SSH as civo UID1000. No sudo, credential copy/rotation, DDL/DML, application database or queue access. Raw connection output/errors suppressed to avoid credential/host disclosure. Local evidence is not a claim of write privileges or queue integration.

References: https://www.postgresql.org/docs/16/libpq-ssl.html and https://www.postgresql.org/docs/16/libpq-status.html; https://neon.com/docs/security/security-overview.
