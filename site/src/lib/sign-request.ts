import { diagnosticTrace, emitSignDiagnostic, finishSignDiagnostic } from "./sign-diagnostic-client";
import { boundedJsonRequest,signupRequestKey } from "./bounded-json-request";
/** Network failures must not escape into React or trigger an automatic resubmission. */
export async function signRequest(body: Record<string, unknown>, transport: typeof fetch = fetch, options:{onPending?:()=>void;isCurrent?:()=>boolean}={}) {
  let recoveryKey:string|undefined;
  const send=async (snapshot:Record<string,unknown>,requestKey:string)=> {
    const {response,data}=await boundedJsonRequest('/api/assinar',{method:'POST',headers:{'content-type':'application/json','idempotency-key':requestKey,...(diagnosticTrace()?{'x-sign-attempt':diagnosticTrace()!}:{})},body:JSON.stringify(snapshot)},transport,45_000);
    if (!data || typeof data!=='object' || Array.isArray(data)) throw new Error('Invalid response');
    return {status:response.status,data:data as Record<string,any>};
  };
  try {
    const key=signupRequestKey();recoveryKey=key;
    const snapshot=JSON.parse(JSON.stringify(body));
    let result=await send(snapshot,key);
    if (result.data.validationPending && typeof result.data.ncpfToken==='string') {
      options.onPending?.();
      const token=result.data.ncpfToken,deadline=Date.now()+260_000;
      while(Date.now()<deadline && options.isCurrent?.()!==false) {
        await new Promise(resolve=>setTimeout(resolve,3000));
        if (options.isCurrent?.()===false) break;
        const {data:state}=await boundedJsonRequest('/api/assinar/validacao',{headers:{authorization:`Bearer ${token}`},cache:'no-store'},transport,10_000);
        if (state.state==='ready' && options.isCurrent?.()!==false) { recoveryKey=signupRequestKey(); result=await send({...snapshot,ncpfToken:token},recoveryKey);break; }
        if (state.state==='rejected') return {status:422,data:{errors:{name:'name_cpf_mismatch'},errorCode:'name_cpf_mismatch',ncpfRejected:true} as Record<string,any>};
        if (state.state==='expired' || state.state==='unavailable') return {status:503,data:{errorCode:'cpf_check_unavailable',verificationUnavailable:true} as Record<string,any>};
      }
      if (result.data.validationPending) return {status:202,data:{validationPending:true,errorCode:'validation_pending'} as Record<string,any>};
    }
    const {data}=result;
    emitSignDiagnostic("client_result", { outcome: data.identityRequired ? "identity_required" : data.ok === true ? "accepted" : "rejected" });
    if (data.ok === true) finishSignDiagnostic();
    return result;
  } catch {
    emitSignDiagnostic("client_result", { outcome: "network_error" });
    try {
      if(!recoveryKey)throw new Error('no_submitted_request');
      const {data:recovered}=await boundedJsonRequest('/api/assinar/resultado',{headers:{authorization:`Bearer ${recoveryKey}`},cache:'no-store'},transport,10_000);
      if (recovered?.json && typeof recovered.status==='number' && recovered.json.resultUnknown!==true) return {status:recovered.status,data:recovered.json as Record<string,any>};
    } catch { /* No automatic POST retry after an uncertain result. */ }
    return { status: 503, data: { transportError: true, resultUnknown:true,errorCode: "result_unknown" } as Record<string, any> };
  }
}
