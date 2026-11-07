/** Bound bytes before JSON parsing. Content-Length alone is not trusted. */
export async function readLimitedText(req: Request, maximum=200_000): Promise<{ok:true;raw:string}|{ok:false;status:400|413}> {
  if (!req.body) return {ok:true,raw:""};
  const reader=req.body.getReader();let length=0;const chunks:Uint8Array[]=[];
  try {
    while (true) {
      const chunk=await reader.read();if(chunk.done)break;
      length+=chunk.value.byteLength;if(length>maximum)return{ok:false,status:413};chunks.push(chunk.value);
    }
    try {return{ok:true,raw:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks))};}catch{return{ok:false,status:400};}
  } catch {return{ok:false,status:400};}
  finally {void reader.cancel().catch(()=>{});}
}
