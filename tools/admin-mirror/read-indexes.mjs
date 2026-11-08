const INDEXES = {
  signatures: [["email", ["email"], "lower(email)"], ["status", ["status", "category"], "status,category"], ["visitor", ["visitor_id"], "visitor_id"], ["ref", ["ref_code"], "ref_code"], ["confirmed", ["confirmed_at"], "confirmed_at"]],
  mail_log: [["recipient", ["to_addr", "ts"], "lower(to_addr),ts"]],
  mail_events: [["recipient", ["email", "ts"], "lower(email),ts"]],
  mail_outbox: [["recipient", ["to_addr"], "lower(to_addr)"]],
  mail_engagement: [["recipient", ["email"], "lower(email)"]],
  email_suppressions: [["recipient", ["email"], "lower(email)"]],
  events: [["visitor", ["visitor_id", "ts"], "visitor_id,ts"], ["time", ["ts"], "ts"], ["ref", ["ref_code", "type"], "ref_code,type"]],
  request_log: [["time", ["ts"], "ts"]],
  signup_diagnostics: [["time", ["ts", "id"], "ts DESC,id"], ["trace", ["trace_id", "ts"], "trace_id,ts"]],
};
function ident(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("MIRROR_INDEX_IDENTIFIER");
  return '"' + value + '"';
}
/** Fixed local read indexes; no production DDL or arbitrary source index definitions. */
export async function createReadIndexes(client, schema, table) {
  const cols = new Set(table.columns.map(c => c.name));
  const definitions = (INDEXES[table.name] ?? []).filter(([, required]) => required.every(c => cols.has(c)));
  for (const [label, , expression] of definitions) {
    await client.query(`CREATE INDEX IF NOT EXISTS ${ident(table.name + "_mirror_" + label)} ON ${ident(schema)}.${ident(table.name)} (${expression})`);
  }
  if (definitions.length) await client.query(`ANALYZE ${ident(schema)}.${ident(table.name)}`);
}
