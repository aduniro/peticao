import test from "node:test";
import assert from "node:assert/strict";
import { query } from "./db";
import { hmac } from "./security";
import { cifrar } from "./crypto-dados";
import { CSV_CABECALHO, entregasCsv, listarEntregas } from "./mail/entregas";

const DOM = "@entregas-teste.example";
const limpa = async () => {
  await query("DELETE FROM mail_engagement WHERE email LIKE $1", ["%" + DOM]);
  await query("DELETE FROM mail_events WHERE email LIKE $1", ["%" + DOM]);
  await query("DELETE FROM mail_log WHERE to_addr LIKE $1", ["%" + DOM]);
  await query("DELETE FROM signatures WHERE email LIKE $1", ["%" + DOM]);
};

test("entregas: traz nome e dados cadastrais, nunca CPF/IP/token; sem cadastro sai sem nome", async () => {
  await limpa();
  try {
    const ins = async (nome: string, mail: string, status: string, extra: { wa?: boolean } = {}) => {
      const r = await query<{ id: number }>(
        `INSERT INTO signatures(name,email,email_hash,cpf_hash,category,institution,role,campus,city,uf,text_version,consent_at,ip,user_agent,status,token_hash,confirmed_at,created_at)
         VALUES($1,$2,$3,$4,'servidor','UNIR','Professora','Campus Porto Velho','Porto Velho','RO','v','2026-11-01T10:00:00Z','203.0.113.9','agente-secreto',$5,$6,$7,'2026-11-01T10:00:00.000Z') RETURNING id`,
        [nome, mail, hmac("e:" + mail), hmac("c:" + mail), status, "token-" + mail, status === "confirmed" ? "2026-11-02T10:00:00.000Z" : null]);
      if (extra.wa) await query("UPDATE signatures SET wa_cipher=$2, wa_optin_at=now() WHERE id=$1", [r.rows[0].id, cifrar("+5569999990000", `wa:${r.rows[0].id}`)]);
      return r.rows[0].id;
    };
    await ins("Maria Fictícia", "maria" + DOM, "pending", { wa: true });
    await ins("João Fictício", "joao" + DOM, "confirmed");
    for (const m of ["maria", "joao", "avulso"]) await query("INSERT INTO mail_log(kind,provider,to_addr,status) VALUES('confirmacao','ses',$1,'sent')", [m + DOM]);
    await query("INSERT INTO mail_engagement(provider,email,delivered_at,opened_at) VALUES('mailersend',$1,now(),now())", ["maria" + DOM]);
    await query("INSERT INTO mail_events(ts,provider,type,email,reason) VALUES(now(),'ses','hard_bounce',$1,'caixa inexistente')", ["joao" + DOM]);

    const r = await listarEntregas({ busca: DOM.slice(1) });
    assert.equal(r.total, 3);
    const por = (m: string) => r.linhas.find((l) => l.email === m + DOM)!;
    const maria = por("maria");
    assert.equal(maria.nome, "Maria Fictícia");
    assert.equal(maria.instituicao, "UNIR"); assert.equal(maria.cargo, "Professora"); assert.equal(maria.cidadeUf, "Porto Velho/RO");
    assert.equal(maria.cadastro, "aguardando"); assert.equal(maria.situacao, "abriu"); assert.equal(maria.whatsapp, "+5569999990000");
    assert.equal(por("joao").situacao, "devolvido"); assert.equal(por("joao").devolucaoMotivo, "caixa inexistente"); assert.equal(por("joao").whatsapp, "");
    assert.equal(por("avulso").nome, ""); assert.equal(por("avulso").cadastro, ""); assert.equal(por("avulso").situacao, "sem_registro");

    const tudo = JSON.stringify(r.linhas) + (await entregasCsv({ busca: DOM.slice(1) })).csv;
    for (const proibido of ["203.0.113.9", "agente-secreto", "token-", hmac("c:maria" + DOM), "cpf_hash"]) assert.ok(!tudo.includes(proibido), "vazou: " + proibido);
    assert.ok(!CSV_CABECALHO.some((c) => /cpf|^ip$|agent|token/.test(c)));
    assert.ok(!Object.keys(maria).some((k) => /cpf|^ip$|agent|token/i.test(k)));

    assert.equal((await listarEntregas({ busca: DOM.slice(1), situacao: "devolvido" })).total, 1);
    assert.equal((await listarEntregas({ busca: DOM.slice(1), cadastro: "sem" })).total, 1);
    assert.equal((await listarEntregas({ busca: "maria fict" })).linhas[0]?.email, "maria" + DOM);
    assert.equal((await listarEntregas({ busca: DOM.slice(1), provedor: "ses", limite: 2 })).linhas.length, 2);
    assert.equal((await listarEntregas({ busca: DOM.slice(1), limite: 2, pagina: 2 })).linhas.length, 1);
    assert.equal((await listarEntregas({ busca: DOM.slice(1), provedor: "nenhum" })).total, 0);
  } finally { await limpa(); }
});
