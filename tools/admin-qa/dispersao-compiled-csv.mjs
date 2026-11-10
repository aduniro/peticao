import assert from "node:assert/strict";
export const CSV_HEADERS = ["id","nome","email","categoria","instituicao_declarada","dominio_do_email","instituicao_pelo_email","selo_email","verificacao_identidade","situacao","assinou_em_brasilia","confirmou_em_brasilia","origem","codigo_de_origem","quem_indicou","geracao","convidou","convidou_e_confirmaram","confirmou_no_mesmo_aparelho"];
/** RFC4180 records, including quoted commas, escaped quotes and embedded newlines. */
export function parseDispersionCsv(bytes) {
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
  assert.deepEqual(records.shift(),CSV_HEADERS);assert.ok(records.every(row=>row.length===19));return records;
}
