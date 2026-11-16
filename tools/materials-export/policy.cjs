"use strict";
const LOGOS=new Set(["/logos/adunir.png","/logos/adunir-andes.png","/logos/andes.png"]);
/** Fixed offline content policy, never a URL proxy or caller-defined asset source. */
function classifyResource(method,url,requiredAssets){
 try{const u=new URL(url);if(method!=="GET"||u.origin!=="http://materials-export.invalid"||u.username||u.password||u.search||u.hash)return"deny";
 if(u.pathname==="/document")return"document";
 return LOGOS.has(u.pathname)&&Array.isArray(requiredAssets)&&requiredAssets.includes(u.pathname)?"asset":"deny";
 }catch{return"deny";}
}
module.exports={classifyResource};
