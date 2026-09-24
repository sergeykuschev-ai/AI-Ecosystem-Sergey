import { fetchAvzBarsByBarcodes } from "./avz-bars-source.mjs";

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
    "filter[brand][_eq]":"Барс","filter[stock_quantity][_gt]":"0",limit:"-1",
  });
  return (await request(config,"GET","/items/miska_catalog_products?"+q))?.data??[];
}
function description(source) {
  const title=String(source.title||"").replace(/[.\s]+$/g,"");
  return title+". Перед применением ознакомьтесь с инструкцией и противопоказаниями; при необходимости проконсультируйтесь с ветеринарным специалистом.";
}
export async function enrichAvzBars({dryRun=false}={}) {
  const config=requireConfig();
  const products=await targets(config);
  const official=await fetchAvzBarsByBarcodes(products.map((item)=>item.barcode));
  const matched=[],unmatched=[];
  for(const product of products){
    const source=product.barcode?official.byBarcode.get(String(product.barcode)):null;
    if(!source){unmatched.push({externalId:product.external_id,sku:product.sku,barcode:product.barcode,name:product.name});continue;}
    matched.push({product,source});
  }
  if(dryRun) return {
    brand:"Барс",targets:products.length,matched:matched.length,unmatched,sourceFailures:official.failures,dryRun:true,
    samples:matched.map(({product,source})=>({local:product.name,official:source.title,variant:source.expectedVariant,barcode:product.barcode,hasImage:Boolean(source.imageUrl)})),
  };
  const syncedAt=new Date().toISOString();
  for(const {product,source} of matched){
    const siteDescription=product.site_description||description(source);
    await request(config,"PATCH","/items/miska_catalog_products/"+product.id,{
      site_name:product.site_name||source.title,
      site_description:siteDescription,
      content_source_url:source.sourceUrl,
      image_source_url:source.imageUrl,
      source_title:source.title,
      source_description:source.description,
      content_status:siteDescription&&product.site_image?"ready":"enriching",
      content_synced_at:syncedAt,
    });
  }
  return {brand:"Барс",targets:products.length,matched:matched.length,unmatched,sourceFailures:official.failures,updated:matched.length,contentSyncedAt:syncedAt};
}
if(process.argv[1]?.endsWith("enrich-avz-bars-directus.mjs")){
  console.log(JSON.stringify(await enrichAvzBars({dryRun:process.argv.includes("--dry-run")}),null,2));
}
