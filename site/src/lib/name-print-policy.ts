/** Canonical name-selection policy; identity/CPF acceptance remains separate. */
import policy from "@/content/name-print-policy.json";
import dictionary from "@/content/name-dictionary.json";
import { titleCaseName } from "./name-case";
export const NAME_PRINT_POLICY = policy;
const PARTICLES = new Set(policy.particles);
const WORD = /\p{L}[\p{L}\p{M}]*(?:['’ʼ‘-][\p{L}\p{M}]+)*/gu;
const fold = (v: string) => v.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’ʼ‘]/g, "'").toLowerCase();
const words = (v: string) => v.normalize("NFC").match(WORD) ?? [];
const names = (v: string) => words(v).filter(w => !PARTICLES.has(fold(w)));
const full = (v: string) => names(v).filter(w => fold(w).length > 1);
const forms = new Map<string, Set<string>>();
for (const entry of dictionary.entries) { const k = fold(entry.form); if (!forms.has(k)) forms.set(k, new Set()); forms.get(k)!.add(entry.form); }
const preferred = dictionary.preferred as Record<string, string>;
const corrections = dictionary.probable_accent_errors as Record<string, { suggestion: string }>;
export function accentedName(value: string, evidence = ""): string {
  const accents = new Map<string, Set<string>>();
  for (const w of words(evidence)) if (w.normalize("NFD").match(/\p{M}/u)) { const k = fold(w); if (!accents.has(k)) accents.set(k,new Set()); accents.get(k)!.add(w); }
  return titleCaseName(value.normalize("NFC").replace(WORD, word => {
    const k = fold(word), variant = forms.get(k), supplied = accents.get(k);
    if (corrections[word.toLowerCase()]) return corrections[word.toLowerCase()].suggestion;
    if (/\p{M}/u.test(word.normalize("NFD"))) return word;
    if (supplied?.size === 1) return [...supplied][0];
    return preferred[k] ?? (variant?.size === 1 ? [...variant][0] : word);
  }), { final: true });
}
const subsequence = (a: string[], b: string[]) => { let i=0; for (const w of b) if (a[i]===w) i++; return i===a.length; };
function particlesFrom(base: string, evidence: string): string {
  const bw=words(base), ew=words(evidence), bn=bw.map((w,i)=>({i,w:fold(w)})).filter(x=>!PARTICLES.has(x.w)), en=ew.map((w,i)=>({i,w:fold(w)})).filter(x=>!PARTICLES.has(x.w));
  if (!en.length || !subsequence(en.map(x=>x.w),bn.map(x=>x.w))) return base;
  const anchors=new Map<number,number>(); let position=0;
  for (const e of en) { while (bn[position].w!==e.w) position++; anchors.set(e.i,bn[position].i); position++; }
  const inserts=new Map<number,string[]>(); let run:string[]=[];
  ew.forEach((w,i)=>{if(PARTICLES.has(fold(w))) {run.push(w.toLowerCase());return;}const target=anchors.get(i)!;if(run.length&&target>0&&!PARTICLES.has(fold(bw[target-1])))inserts.set(target,run);run=[];});
  return inserts.size ? bw.flatMap((w,i)=>[...(inserts.get(i)??[]),w]).join(" ") : base;
}
function oneEdit(a:string,b:string):boolean {
  if(a===b||Math.abs(a.length-b.length)>1)return false;
  if(a.length===b.length){const d=[...a].map((c,i)=>c===b[i]?-1:i).filter(i=>i>=0);return d.length===1||d.length===2&&d[1]===d[0]+1&&a[d[0]]===b[d[1]]&&a[d[1]]===b[d[0]];}
  if(a.length>b.length)[a,b]=[b,a];return [...b].some((_,i)=>b.slice(0,i)+b.slice(i+1)===a);
}
function extendedCorrection(entered:string,api:string):{name:string;corrections:{input:string;suggestion:string}[]} {
  const ew=words(entered), positions=ew.map((w,i)=>i).filter(i=>!PARTICLES.has(fold(ew[i])));let start=0,exact=0;
  const substitutions=new Map<number,string>(), found:{input:string;suggestion:string}[]=[];
  for(const expected of names(api)){
    const available=positions.map((_,j)=>j).filter(j=>j>=start), equal=available.filter(j=>fold(ew[positions[j]])===fold(expected));let j:number;
    if(equal.length){j=equal[0];exact++;}else{const possible=available.filter(j=>fold(ew[positions[j]]).length>=4&&fold(expected).length>=4&&!forms.has(fold(ew[positions[j]]))&&oneEdit(fold(ew[positions[j]]),fold(expected)));if(possible.length!==1)return {name:entered,corrections:[]};j=possible[0];found.push({input:ew[positions[j]],suggestion:expected});}
    substitutions.set(positions[j],expected);start=j+1;
  }
  if(!exact||!found.length)return {name:entered,corrections:[]};let i=-1;
  return {name:entered.replace(WORD,w=>substitutions.get(++i)??w),corrections:found};
}
function collapseSpacing(value:string,api:string):{name:string;corrections:{input:string;suggestion:string}[]} {
  const matches=[...value.matchAll(WORD)], targets=new Map(words(api).map(w=>[fold(w).replace(/['’ʼ‘-]/g,""),w]));
  let cursor=0,i=0;const out:string[]=[],corrections:{input:string;suggestion:string}[]=[];
  while(i<matches.length){let found:{count:number;target:string}|null=null;
    for(let count=Math.min(4,matches.length-i);count>=2;count--){const selected=matches.slice(i,i+count);if(selected.slice(1).some((m,j)=>value.slice(selected[j].index!+selected[j][0].length,m.index!).trim()))continue;
      const candidate=selected.map(m=>fold(m[0]).replace(/['’ʼ‘-]/g,"")).join("");if(targets.has(candidate)){found={count,target:targets.get(candidate)!};break;}}
    if(found){const start=matches[i].index!,last=matches[i+found.count-1],end=last.index!+last[0].length;out.push(value.slice(cursor,start),found.target);corrections.push({input:value.slice(start,end),suggestion:found.target});cursor=end;i+=found.count;}else i++;
  }
  out.push(value.slice(cursor));return {name:out.join(""),corrections};
}
export type PrintNameSuggestion = { proposed:string; source:"api"|"entered"; enteredResolved:string; apiResolved:string; policyVersion:string; special:boolean; majorDivergence:boolean; notificationRequired:boolean; typoCorrections:{input:string;suggestion:string}[]; spacingCorrections:{input:string;suggestion:string}[] };
export function resolvePrintName(entered:string,api:string,classification?:string):PrintNameSuggestion {
  let a=accentedName(entered),b=accentedName(api,a);const aligned=collapseSpacing(entered,api),spaced=collapseSpacing(a,b);a=spaced.name;const userLonger=!!api&&full(aligned.name).length>full(api).length;
  const corrected=userLonger?extendedCorrection(a,b):{name:a,corrections:[]};a=corrected.name;
  if(api)b=particlesFrom(b,a);if(userLonger)a=particlesFrom(a,b);
  const ak=names(aligned.name).map(fold),bk=names(api).map(fold),compatible=!!api&&(subsequence(ak,bk)||subsequence(bk,ak));
  const aa=new Map<string,number>(),bb=new Map<string,number>();for(const w of ak)aa.set(w,(aa.get(w)??0)+1);for(const w of bk)bb.set(w,(bb.get(w)??0)+1);
  const overlap=[...aa].reduce((n,[w,v])=>n+Math.min(v,bb.get(w)??0),0),sameBag=ak.length===bk.length&&overlap===ak.length,orderChanged=!!api&&sameBag&&ak.some((w,i)=>w!==bk[i]);
  const major=!!api&&(orderChanged||!compatible&&(overlap<2||overlap/Math.max(ak.length,bk.length,1)<.6))||ak.join(" ")!==bk.join(" ")&&["divergencia_forte","divergencia_relevante","ordem_diferente"].includes(classification??"");
  const source=!api||userLonger?"entered":"api";
  return {proposed:source==="api"?b:a,source,enteredResolved:a,apiResolved:b,policyVersion:policy.version,special:userLonger||!!api&&!compatible||!api,majorDivergence:major,notificationRequired:major,typoCorrections:corrected.corrections,spacingCorrections:spaced.corrections};
}
