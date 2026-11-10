import assert from "node:assert/strict";
export const CSV_HEADERS = ["Nome", "Categoria", "Instituição", "Cargo", "Amazônia Legal/Fronteira", "Campus", "Cidade/UF", "País", "Status", "Criada em", "Confirmada em"];
/** RFC4180 records, including quoted commas, escaped quotes and embedded newlines. */
export function parseSignatureExplorerCsv(bytes) {
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
  assert.deepEqual(records.shift(),CSV_HEADERS);assert.ok(records.every(row=>row.length===11));return records;
}
