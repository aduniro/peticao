/** Covers response body parsing as well as headers; works without AbortSignal.timeout. */
export async function boundedJsonRequest(url:string,init:RequestInit,transport:typeof fetch=fetch,timeoutMs=30_000) {
  const controller=typeof AbortController==='function'?new AbortController():null;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{controller?.abort();reject(new Error('request_timeout'));},timeoutMs);
  });
  try {
    return await Promise.race([(async()=>{
      const response=await transport(url,{...init,...(controller?{signal:controller.signal}:{})});
      return {response,data:await response.json()};
    })(),deadline]);
  }finally{if(timer)clearTimeout(timer);}
}
/** Cryptographically random UUID for older browsers without crypto.randomUUID. */
export function signupRequestKey():string {
  const bytes=new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
