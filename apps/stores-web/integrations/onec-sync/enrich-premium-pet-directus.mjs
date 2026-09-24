import { fetchPremiumPetProducts } from "./premium-pet-source.mjs";
import { composePetProductDescription } from "./pet-content.mjs";

function requireConfig() {
  const base=(process.env.DIRECTUS_URL||"").replace(/\/$/,"");
  const token=process.env.DIRECTUS_ADMIN_TOKEN||"";
  if(!base||!token) throw new Error("DIRECTUS_URL and DIRECTUS_ADMIN_TOKEN are required");
  return {base,token};
}
async function request(config,method,path,body) {
  const response=await fetch(config.base+path,{
    method,headers:{Authorization:"Bearer "+config.token,"Content-Type":"application/json"},
    body:body?JSON.stringify(body):undefined,
  });
  if(!response.ok) throw new Error(method+" "+path+": "+response.status+" "+await response.text());
  return response.status===204?null:response.json();
}
async function targets(config) {
  const q=new URLSearchParams({
    fields:"id,external_id,sku,barcode,name,site_name,site_description,site_image,site_category",
    "filter[brand][_eq]":"Момент счастья","filter[stock_quantity][_gt]":"0",limit:"-1",
  });
  return (await request(config,"GET","/items/miska_catalog_products?"+q))?.data??[];
}
export async function enrichPremiumPetMoment({dryRun=false}={}) {
  const config=requireConfig();
  const products=await targets(config);
  const official=await fetchPremiumPetProducts(products.map(p=>({sku:p.sku,barcode:p.barcode})));
  const matched=[],unmatched=[];
  for(let i=0;i<products.length;i++){
    const product=products[i], source=official.rows[i]?.product;
    if(!source){unmatched.push({externalId:product.external_id,sku:product.sku,barcode:product.barcode,name:product.name});continue;}
    if(String(source.barcode)!==String(product.barcode)){unmatched.push({externalId:product.external_id,sku:product.sku,barcode:product.barcode,name:product.name,reason:"barcode mismatch"});continue;}
    matched.push({product,source});
  }
  if(dryRun) return {brand:"Момент счастья",targets:products.length,matched:matched.length,unmatched,sourceFailures:official.failures,
    samples:matched.slice(0,10).map(({product,source})=>({local:product.name,official:source.title,sku:source.sku,barcode:source.barcode,hasImage:Boolean(source.imageUrl)})),dryRun:true};
  const syncedAt=new Date().toISOString();
  for(const {product,source} of matched){
    const name=product.site_name||source.title;
    const description=product.site_description||composePetProductDescription({title:name,sourceDescription:source.description,siteCategory:product.site_category});
    await request(config,"PATCH","/items/miska_catalog_products/"+product.id,{
      site_name:name,site_description:description,content_source_url:source.sourceUrl,image_source_url:source.imageUrl,
      source_title:source.title,source_description:source.description,content_status:description&&product.site_image?"ready":"enriching",content_synced_at:syncedAt,
    });
  }
  return {brand:"Момент счастья",targets:products.length,matched:matched.length,unmatched,sourceFailures:official.failures,updated:matched.length,contentSyncedAt:syncedAt};
}
if(process.argv[1]?.endsWith("enrich-premium-pet-directus.mjs")){
 console.log(JSON.stringify(await enrichPremiumPetMoment({dryRun:process.argv.includes("--dry-run")}),null,2));
}
