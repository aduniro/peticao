# Current Civo development topology - intermediate source

Not deployable. No remote files, services, permissions, authority, queue or authentication changed. Santiago remains the actual legacy primary; Civo remains standby.

The new topology module explicitly selects Civo for future coordination, Santiago for recovery and Civo/Akamai for work. It preserves the existing queue path and separately lists all four potential writer/fencing nodes, including SP only for development fencing observation. It does not enable a primary or dispatch. Unknown hosts/peers, old SP replication, unsupported RPC actions, duplicate JSON keys and non-root topology controls are refused. IPv4 is the pinned administrative transport in this candidate; the existing IPv6/MagicDNS mesh is unchanged.

The gateway successor consumes this routing contract and removes inherited owner credentials/dispatch flags from child RPC. Its normal qualification entry remains blocked. Administrative replica ingest/fencing is explicitly denied until a native provider exists; the old weak unit-count assertion is not inherited. Replication routing is Civo to Santiago over a separately pinned service hostkey file; it does not send any bytes or load the identity. Qualification and genuine epoch validation precede private hostkey metadata access.

Nine parent files are retained by byte identity in runtime. The recovery/atomic-metadata owner-preservation fix3097 is included; its prior tests are not claimed as newly run. The old replication scheduler with SP destination and deletion-based retention is excluded. The copied coordinator is still the guarded legacy base: it MUST be composed with facade3233/paired guard before any activation. Source qualification hooks deliberately remain blocking.

27 tests ran locally in0.008s: negative local control-filesystem checks plus topology/gateway/routing tests with mocked subprocess/qualification where identified. They are not native SSH/sshd/queue/broker qualification. The separate capacity probe ran once on actual Civo via pinned tailnet SSH, read numeric kernel values only and changed no service. See the read-only evidence packet, not fixture data, for actual capacity.

Next: complete the current-topology migration/bootstrap and native recovery provider, integrate the real profile/runtime successor, review the complete closure, obtain the fresh Root window and own deploy/global-code lease, then execute and reconcile the migration. No cutover is authorized by this source artifact alone.
