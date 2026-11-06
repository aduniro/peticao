"use client";
import { useState } from "react";

type Previa = { para: string; primeiroNome: string; codigoPessoal: string | null; texto: { assunto: string; texto: string }; card: { assunto: string; html: string; texto: string } | null; selo: string };
const ERROS: Record<string, string> = { assunto: "Escreva o assunto (mínimo 3 letras).", corpo: "Escreva a mensagem (mínimo 10 letras).", ja_respondida: "Esta mensagem já foi respondida. Use \"Responder de novo\" se for mesmo necessário.", selo: "O texto mudou depois da prévia. Veja a prévia de novo.", falhou: "O envio falhou.", nao_existe: "Mensagem não encontrada." };

/** Editor de resposta: escreve, vê a prévia dos dois e-mails e só então envia. Só aparece para o nível total (a rota confere de novo, com a confirmação extra). */
export default function ResponderContato({ contactId, assuntoInicial, jaRespondida }: { contactId: number; assuntoInicial: string; jaRespondida: boolean }) {
  const [aberto, setAberto] = useState(false), [assunto, setAssunto] = useState(assuntoInicial), [corpo, setCorpo] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null), [ok, setOk] = useState(false), [erro, setErro] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null), [ocupado, setOcupado] = useState(false);
  const chamar = async (modo: "previa" | "enviar") => {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/admin/contato/responder", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ contactId, modo, assunto, corpo, selo: previa?.selo, nova: jaRespondida }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 403 && j.erro === "stepup") { window.location.assign("/admin/confirmar?volta=/admin/contato"); return null; }
      if (!r.ok) { setErro((ERROS[j.erro] ?? "Não foi possível.") + (j.detalhe ? ` (${j.detalhe})` : "")); return null; }
      return j;
    } finally { setOcupado(false); }
  };
  const ver = async () => { const j = await chamar("previa"); if (j) { setPrevia(j.previa); setOk(false); } };
  const enviar = async () => {
    const j = await chamar("enviar");
    if (j) { setMsg(`Enviado: e-mail só de texto ${j.texto === "enviado" ? "enviado agora" : "na fila de reenvio"}; ${j.card === "agendado" ? "e-mail com o card agendado para cerca de 1 minuto depois" : "sem card (a pessoa não tem código pessoal)"}. Recarregue a página para ver o histórico.`); setAberto(false); setPrevia(null); }
  };
  if (msg) return <p className="box ok" role="status">{msg}</p>;
  if (!aberto) return <p><button type="button" onClick={() => setAberto(true)}>{jaRespondida ? "Responder de novo" : "Responder"}</button></p>;
  return (
    <div className="form" style={{ maxWidth: 720 }}>
      <label>Assunto<input value={assunto} onChange={(e) => { setAssunto(e.target.value); setPrevia(null); }} maxLength={150} /></label>
      <label>Mensagem (a saudação "Olá, Nome," e a assinatura "ADUNIR · ANDES-SN" entram sozinhas; separe os parágrafos com uma linha em branco)
        <textarea value={corpo} onChange={(e) => { setCorpo(e.target.value); setPrevia(null); }} rows={9} maxLength={5000} /></label>
      <p><button type="button" onClick={ver} disabled={ocupado}>Ver a prévia dos e-mails</button> <button type="button" className="link" onClick={() => setAberto(false)}>Cancelar</button></p>
      {previa ? (
        <div className="box">
          <p className="small">Para: <strong>{previa.para}</strong> (cópia oculta para a caixa da ADUNIR)</p>
          <h3>1º e-mail: só texto, enviado agora</h3>
          <p className="small">Assunto: {previa.texto.assunto}</p>
          <pre style={{ whiteSpace: "pre-wrap" }}>{previa.texto.texto}</pre>
          <h3>2º e-mail: com o card de divulgação, cerca de 1 minuto depois</h3>
          {previa.card ? (<><p className="small">Assunto: {previa.card.assunto} · código pessoal {previa.codigoPessoal}</p><iframe title="Prévia do e-mail com o card" sandbox="" srcDoc={previa.card.html} style={{ width: "100%", height: 560, border: "1px solid #d5e0da", borderRadius: 8, background: "#fff" }} /></>) : <p className="small">Não sai: esta pessoa não tem cadastro com código pessoal de divulgação.</p>}
          <p><label><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Li a prévia e quero enviar {previa.card ? "os dois e-mails" : "o e-mail"} para {previa.para}</label></p>
          <button type="button" onClick={enviar} disabled={!ok || ocupado}>Enviar</button>
        </div>
      ) : null}
      {erro ? <p className="err" role="alert">{erro}</p> : null}
    </div>
  );
}
