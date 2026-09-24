const ROOT = "https://www.premium-pet.com";

function decode(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"').replaceAll("&#34;", '"').replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&nbsp;", " ")
    .replaceAll("&#39;", "'").replaceAll("&apos;", "'");
}
function clean(value) {
  return decode(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
function attr(tag, name) {
  return tag.match(new RegExp(name + "=[\\\"']([^\\\"']*)[\\\"']", "i"))?.[1] ?? "";
}
function meta(html, key, value) {
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) ?? []) {
    if (attr(tag, key).toLowerCase() === value.toLowerCase()) return decode(attr(tag, "content"));
  }
  return "";
}
export function parsePremiumPetProductPage(html, url) {
  const source=String(html);
  const title = meta(source, "itemprop", "name") || clean(source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const sku = clean(source.match(/class=["'][^"']*article[^"']*["'][\s\S]{0,800}?itemprop=["']value["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ??
    source.match(/class=["'][^"']*article_block[^"']*["'][^>]*data-value=["']([^"']+)["']/i)?.[1] ?? "");
  const barcodeBlock = source.match(/itemprop=["']name["'][^>]*>\s*Штрихкод\s*<\/span>[\s\S]{0,1200}?itemprop=["']value["'][^>]*>([\s\S]*?)<\/span>/i);
  const barcode = clean(barcodeBlock?.[1] ?? "").match(/\d{8,14}/)?.[0] ?? "";
  const description = decode(meta(source, "itemprop", "description"));
  const imageUrl = meta(source, "property", "og:image");
  if (!title || !barcode || !imageUrl) throw new Error(url + ": incomplete Premium Pet product page");
  return { title, sku, barcode, description, imageUrl, sourceUrl: url };
}
function productLinks(html) {
  const links=[];
  for (const tag of String(html).match(/<a\b[^>]*class=["'][^"']*js-notice-block__title[^"']*["'][^>]*>/gi) ?? []) {
    const href=attr(tag,"href"); if (href) links.push(new URL(href, ROOT).href);
  }
  return [...new Set(links)];
}
async function fetchText(url) {
  const response=await fetch(url,{headers:{"User-Agent":"AmurskMarket-MiskaCatalog/1.0"},signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error(url+": HTTP "+response.status);
  return response.text();
}
async function candidateLinks(query) {
  if(!query) return [];
  return productLinks(await fetchText(ROOT+"/catalog/?q="+encodeURIComponent(query)));
}
export async function findPremiumPetProduct({sku, barcode}) {
  const queries=[sku,barcode].map(x=>String(x??"").trim()).filter(Boolean);
  const seen=new Set();
  for(const query of queries) {
    for(const url of await candidateLinks(query)) {
      if(seen.has(url)) continue; seen.add(url);
      try {
        const product=parsePremiumPetProductPage(await fetchText(url),url);
        if(String(product.barcode)===String(barcode)) return product;
      } catch {}
    }
  }
  return null;
}
async function mapLimit(items, limit, worker) {
  const out=new Array(items.length); let cursor=0;
  async function run(){ while(cursor<items.length){const i=cursor++; out[i]=await worker(items[i],i);} }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run)); return out;
}
export async function fetchPremiumPetProducts(targets,{concurrency=5}={}) {
  const failures=[];
  const rows=await mapLimit(targets,concurrency,async target=>{
    try { return {target,product:await findPremiumPetProduct(target)}; }
    catch(error){ failures.push({sku:target.sku,barcode:target.barcode,error:error instanceof Error?error.message:String(error)}); return {target,product:null}; }
  });
  return {rows,failures};
}
