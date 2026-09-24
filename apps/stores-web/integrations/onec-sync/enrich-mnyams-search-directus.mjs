import { fetchMnyamsBySkus } from "./mnyams-search-source.mjs";
import { validateMnyamsMatch } from "./mnyams-match.mjs";
import { composePetProductDescription } from "./pet-content.mjs";
function cfg(){const base=(process.env.DIRECTUS_URL||"").replace(/\/$/,"");const token=process.env.DIRECTUS_ADMIN_TOKEN||"";if(!base||!token)throw new Error("Directus config required");return{base,token}}
async function req(c,m,p,b){const r=await fetch(c.base+p,{method:m,headers:{Authorization:"Bearer "+c.token,"Content-Type":"application/json"},body:b?JSON.stringify(b):undefined});if(!r.ok)throw new Error(m+" "+p+": "+r.status);return r.status===204?null:r.json()}
async function targets(c){
 const result=[];
 for(const brand of ["Мнямс","Ферма кота Федора"]){
  const q=new URLSearchParams({fields:"id,external_id,sku,barcode,name,brand,site_name,site_description,site_image,site_category,content_status","filter[brand][_eq]":brand,"filter[stock_quantity][_gt]":"0",limit:"-1"});
  result.push(...((await req(c,"GET","/items/miska_catalog_products?"+q))?.data??[]));
 }
 return result;
}
export async function enrichMnyams({dryRun=false}={}){
 const c=cfg();const all=await targets(c);const todo=all.filter(x=>x.content_status!=="ready");
 const official=await fetchMnyamsBySkus(todo.map(x=>x.sku),{concurrency:8});const matched=[],unmatched=[];
 for(const p of todo){const s=p.sku?official.bySku.get(String(p.sku).trim()):null;if(!s){unmatched.push({sku:p.sku,barcode:p.barcode,name:p.name,reason:p.sku?"exact official SKU not found":"no SKU"});continue}const v=validateMnyamsMatch(p.name,s.title);if(!v.ok){unmatched.push({sku:p.sku,barcode:p.barcode,name:p.name,officialTitle:s.title,reason:v.reason});continue}matched.push({p,s})}
 if(dryRun)return{targets:todo.length,matched:matched.length,unmatched,failures:official.failures,samples:matched.slice(0,12).map(x=>({sku:x.p.sku,local:x.p.name,official:x.s.title}))};
 const ts=new Date().toISOString();for(const {p,s} of matched){const name=p.site_name||s.title;const desc=p.site_description||composePetProductDescription({title:name,sourceDescription:s.description,siteCategory:p.site_category});await req(c,"PATCH","/items/miska_catalog_products/"+p.id,{brand:s.brand||p.brand,site_name:name,site_description:desc,content_source_url:s.sourceUrl,image_source_url:s.imageUrl||null,source_title:s.title,source_description:s.description,content_status:desc&&p.site_image?"ready":"enriching",content_synced_at:ts})}return{targets:todo.length,matched:matched.length,unmatched,failures:official.failures,updated:matched.length}
}
if(process.argv[1]?.endsWith("enrich-mnyams-search-directus.mjs"))console.log(JSON.stringify(await enrichMnyams({dryRun:process.argv.includes("--dry-run")}),null,2));