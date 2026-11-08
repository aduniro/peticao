export const SIGNATURE_CORE_COLUMNS = ["id", "name", "cpf_hash", "email_hash", "seq", "created_at", "consent_at", "confirmed_at"];
export function coreFingerprintSQL(table) {
  if (!["public.signatures", "admin_mirror_live.signatures"].includes(table)) throw new Error("MIRROR_CORE_TABLE");
  return `SELECT 'mirror_signature_core'::text AS table_name,count(*)::int AS n,encode(sha256(convert_to(COALESCE(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'),'' ORDER BY t.id),''),'UTF8')),'hex') AS fingerprint FROM (SELECT ${SIGNATURE_CORE_COLUMNS.join(",")} FROM ${table}) t`;
}
