import test from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { importEntries, TTL } from "./seed-cache.mjs";

const pepper = "pepper-ficticio-de-testes", key = "chave-ficticia-exclusiva-do-cache-0123456789";
const cpf = "52998224725", now = Date.parse("2026-11-06T12:00:00Z");
const record = { cpf, cpf_hash:createHmac("sha256",pepper).update(cpf).digest("hex"), status:"ok", name:"MARIA SILVA", mother:"ANA SILVA", birth:"15/08/1985", sex:"F", queried_at:"2026-11-05T12:00:00Z" };

test("importação conserva os quatro campos e conta 30 dias da consulta original", () => {
  const [entry] = importEntries([record],pepper,key,now);
  assert.equal(Date.parse(entry.expires_at),Date.parse(record.queried_at)+TTL);
  const [v,iv,tag,data]=entry.payload.split(".");assert.equal(v,"v1");
  const d=createDecipheriv("aes-256-gcm",createHash("sha256").update(key).digest(),Buffer.from(iv,"base64url"));
  d.setAAD(Buffer.from(`cpf-cache:v1:${entry.cpf_hash}`));d.setAuthTag(Buffer.from(tag,"base64url"));
  const plain=JSON.parse(Buffer.concat([d.update(Buffer.from(data,"base64url")),d.final()]).toString());
  assert.deepEqual(plain,{nome:record.name,mae:record.mother,nasc:record.birth,sexo:record.sex});
  assert.equal(JSON.stringify(entry).includes(cpf),false);
});
test("importação recusa hash ou CPF retornado divergentes", () => {
  assert.throws(()=>importEntries([{...record,cpf_hash:"a".repeat(64)}],pepper,key,now));
  assert.throws(()=>importEntries([{...record,returned_cpf:"11144477735"}],pepper,key,now));
});
test("importação ignora vencidos e consultas sem sucesso; não renova o prazo", () => {
  assert.deepEqual(importEntries([{...record,queried_at:new Date(now-TTL).toISOString()},{...record,status:"nao_encontrado"}],pepper,key,now),[]);
  assert.throws(()=>importEntries([{...record,queried_at:new Date(now+1).toISOString()}],pepper,key,now));
});
