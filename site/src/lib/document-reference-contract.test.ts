import test from "node:test";
import assert from "node:assert/strict";
import { documentReferenceUrl, validDocumentReference } from "./document-reference-contract";
const id="11111111-1111-4111-8111-111111111111";
test("opaque URL has no final hash, batch id or personal identity", () => {
 const url=documentReferenceUrl("https://documentos.example.org/",id); assert.equal(url,`https://documentos.example.org/api/documentos/referencia/${id}`);
 assert.ok(validDocumentReference(id)); assert.equal(validDocumentReference("1"),false);
});
test("trusted origin policy rejects credentials, IP, paths, suffixes, query and unsafe ports", () => {
 for(const origin of ["http://example.org/","https://user:password@example.org/","https://127.0.0.1/","https://[::1]/","https://example.local/","https://example.internal/","https://example.test/","https://localhost/","https://example.org./","https://example.org:444/","https://example.org/path","https://example.org/?x=1","https://example.org/#x"," https://example.org/","https://example.org/\n"]) assert.equal(documentReferenceUrl(origin,id),null,origin);
 assert.equal(documentReferenceUrl("https://example.org/","not-a-uuid"),null);
 assert.equal(documentReferenceUrl("https://example.org:443/",id),`https://example.org/api/documentos/referencia/${id}`);
});
