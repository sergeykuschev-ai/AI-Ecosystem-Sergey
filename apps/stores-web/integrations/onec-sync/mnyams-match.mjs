import { validateOfficialMatch } from "./official-match.mjs";

function norm(v){return String(v??"").toLocaleLowerCase("ru-RU").replace(/ё/g,"е").replace(/[^a-zа-я0-9]+/gi," ").replace(/\s+/g," ").trim();}
const STOP=new Set(["лакомство","мнямс","для","собак","собаки","кошек","кошки","котят","щенков","корм","влажный","сухой","кусочки","сочные","нежные","гр","г","кг","шт","новый","линия","ферма","кота","федора"]);
function tokens(v){return norm(v).split(" ").filter(x=>x.length>=4&&!STOP.has(x)&&!/^[0-9]+$/.test(x));}
export function validateMnyamsMatch(localName, officialTitle){
  const base=validateOfficialMatch(localName,officialTitle);
  if(!base.ok) return base;
  const a=tokens(localName), b=new Set(tokens(officialTitle));
  const overlap=a.filter(x=>b.has(x));
  if(a.length>=2 && overlap.length===0) return {ok:false,reason:"distinctive title tokens do not overlap"};
  return {ok:true,reason:"exact SKU + attributes + title tokens match"};
}