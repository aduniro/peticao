/** Presentation-only break opportunities. Strings and payloads retain every original code point. */
export function pendingDetailParts(value:string):{text:string;breakAfter:boolean}[]{
 const parts:{text:string;breakAfter:boolean}[]=[];
 for(const token of value.split(/(\s+)/u)){
  const points=Array.from(token);
  if(points.length<=40||/^\s*$/u.test(token)){parts.push({text:token,breakAfter:false});continue;}
  let chunk="",width=0;
  for(const point of points){const cp=point.codePointAt(0)!,weight=cp>=0x2e80?2:1;
   if(width+weight>16){parts.push({text:chunk,breakAfter:true});chunk="";width=0;}
   chunk+=point;width+=weight;
  }
  if(chunk)parts.push({text:chunk,breakAfter:false});
 }
 return parts;
}
