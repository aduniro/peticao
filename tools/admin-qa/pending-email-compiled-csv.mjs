import assert from "node:assert/strict";
export const CSV_HEADERS = ["id", "nome", "email", "categoria", "instituicao", "solicitada_em_brasilia", "dominio", "ultimo_sinal_registrado", "sinal_registrado_em_brasilia", "provedor_do_sinal", "fonte_do_sinal", "escopo_da_evidencia", "vinculo_da_evidencia", "aceite_registrado_em_brasilia", "entrega_registrada_em_brasilia", "abertura_registrada_em_brasilia", "clique_registrado_em_brasilia", "tipo_adverso_registrado", "evento_adverso_em_brasilia", "provedor_adverso", "detalhe_adverso", "agregado_legado_retem_primeiro_horario", "suprimido", "motivo_supressao", "na_fila", "fontes_da_fila", "possui_registro_de_aceite", "possui_evento_adverso", "ultima_mensagem_registrada_status", "ultima_mensagem_registrada_criada_em_brasilia", "sugestao_local", "motivo_sugestao", "fonte_sugestao", "observacao_sugestao"];
/** RFC4180 records, including quoted commas, escaped quotes and embedded newlines. */
export function parsePendingEmailCsv(bytes) {
  const input = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  const records = [];let record = [], field = "", quoted = false, closed = false;
  for (let i=0;i<input.length;i++) {
    const c=input[i];
    if(quoted){if(c==='"'){if(input[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(c==='"'){assert.equal(field,"");assert.equal(closed,false);quoted=true;continue;}
    if(c===','||c==='\n'){record.push(field);field="";closed=false;if(c==='\n'){records.push(record);record=[];}continue;}
    if(c==='\r'&&input[i+1]==='\n')continue;
    assert.equal(closed,false,"unexpected characters after a closed CSV field");field+=c;
  }
  assert.equal(quoted,false);if(field!==""||record.length){record.push(field);records.push(record);}assert.ok(records.length);
  assert.deepEqual(records.shift(),CSV_HEADERS);assert.ok(records.every(row=>row.length===34));return records;
}
