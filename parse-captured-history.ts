/** Pure parser proof after an actual bounded diagnostic exists; no app/DB/network. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { parseOwnHistory } from "./contracts/site__src__lib__president-own-history-client.ts";
const root="/mnt/apps/peticao-final/_ops/qa-r0014-own-document-browser-20261111";
const file=process.argv[2];assert.ok(typeof file==="string" && path.dirname(path.dirname(file))===root+"/runs" && /^[a-f0-9]{12}$/.test(path.basename(path.dirname(file))) && path.basename(file)==="history-diagnostic.json");
const info=fs.lstatSync(file);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.size<=131072&&fs.realpathSync(file)===file);
const captured=JSON.parse(fs.readFileSync(file,"utf8"));const parsed=parseOwnHistory(captured.wire,"artifacts",1);
console.log(JSON.stringify({classification:"PURE_CURRENT_F555_HISTORY_PARSER_ON_CAPTURED_AUXILIARY_RESPONSE",status:captured.status,parsed:parsed!==null,rows:parsed?.rows.length??null,kind:parsed?.kind??null,wireTopKeys:captured.wire&&typeof captured.wire==="object"?Object.keys(captured.wire).sort():null,uiQualified:false}));
