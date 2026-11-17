import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildMailDeliveryCsv, MAIL_DELIVERY_CSV_HEADERS } from "./mail-delivery-csv";
import type { MailDeliveryRow } from "./mail-delivery-admin-contract";

const fixture = (id: number): MailDeliveryRow => ({ recordKey: `registration:${id}`, rowKind: "registration", cadastroId: id, email: "same@example.test", nome: '=QA "Nome",\nLinha', categoria: "servidor", instituicao: "UNIR", cargo: "Docente", campus: "Porto Velho", universidade: "", cidadeUf: "Porto Velho/RO", pais: "BR", cadastro: "aguardando", cadastradoEm: "2026-11-10T12:00:00.123456Z", confirmadoEm: "", whatsapp: "", envios: 1, ultimoEnvio: "2026-11-10T13:00:00.000000Z", ultimoTipo: "confirmacao", provedores: "dev", situacao: "aceito", entregueEm: "", abertoEm: "", clicouEm: "", devolucao: "", devolucaoMotivo: "", devolucaoEm: "", evidence: { scope: "address_aggregate", registrationLink: "email_only", messageKinds: "all", providerScope: null, providersAll: ["dev"], lastSignal: { state: "accepted", at: "2026-11-10T13:00:00.000000Z", provider: "dev", source: "legacy_log" }, relationToCurrentConfirmation: "not_proven", timestamps: "earliest_recorded_history", legacyEngagementFirstOnly: false, acceptedLogRecords: 1, acceptedJournalAttempts: 0, sendCountMeaning: "legacy_accepted_log_records_not_unique_messages", contactState: "absent" } });
test("delivery CSV retains twenty-four columns, Brasília, escapes and each registration sharing an address", () => {
  const rows = [fixture(1), fixture(2)], csv = buildMailDeliveryCsv(rows, 2), body = csv.body.toString("utf8");
  assert.equal(MAIL_DELIVERY_CSV_HEADERS.length, 24); assert.ok(body.startsWith("\uFEFFemail,nome,categoria,"));
  assert.ok(body.includes('"\'=QA ""Nome"",\nLinha"')); assert.ok(body.includes('"10/11/2026 09:00:00"'));
  assert.equal(csv.rows, 2); assert.equal(csv.bytes, csv.body.length); assert.equal(csv.sha256, createHash("sha256").update(csv.body).digest("hex"));
  assert.equal(body.includes("relationToCurrentConfirmation"), false); assert.equal(body.includes("content_cipher"), false);
  assert.throws(() => buildMailDeliveryCsv([fixture(1), fixture(1)], 2), /key/); assert.throws(() => buildMailDeliveryCsv(rows, 3), /incomplete/);
  assert.throws(() => buildMailDeliveryCsv([{ ...fixture(3), evidence: { ...fixture(3).evidence, contactState: "unavailable" } }], 1), /contact_unavailable/);
});
test("delivery CSV includes row50001 rather than stopping at the legacy cap", () => {
  const rows = Array.from({ length: 50001 }, (_, i) => ({ ...fixture(i + 1), nome: "QA " + (i + 1) }));
  const csv = buildMailDeliveryCsv(rows, rows.length); assert.equal(csv.rows, 50001); assert.ok(csv.body.toString("utf8").includes('"QA 50001"'));
});
