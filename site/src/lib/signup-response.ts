/** Old tabs cannot render the new delivery states; avoid their unconditional sent modal. */
export function legacySignupResponse(json:Record<string,unknown>,hasRequestKey:boolean):Record<string,unknown> {
  if(hasRequestKey || json.ok!==true)return json;
  if(json.submission==='already_received')return {ok:false,errorCode:'already_received',error:'Já recebemos uma solicitação com esses dados. Confira as mensagens anteriores. Nenhum novo e-mail foi enviado.'};
  if(json.mail==='queued')return {ok:false,errorCode:'mail_queued',error:'Solicitação recebida. O e-mail está na fila de envio; aguarde a confirmação.'};
  return json;
}
