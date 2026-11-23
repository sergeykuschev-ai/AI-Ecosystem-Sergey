import { readFile, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { CATALOG_STORES, catalogIndexable, displayPrice, displayStock, validateCatalogSnapshot, type CatalogStore } from '../../lib/store-catalog/core';
const dir=process.argv[2];
if(!dir||!isAbsolute(dir)){console.error('Usage: node --import tsx scripts/store-catalog/check-snapshots.ts /absolute/path');process.exit(2);}
async function main(){
  for(const store of Object.keys(CATALOG_STORES) as CatalogStore[]){
    try{
      const filename=join(dir,store+'.json');
      if((await stat(filename)).size>20*1024*1024)throw Error('File too large');
      const data=validateCatalogSnapshot(JSON.parse(await readFile(filename,'utf8')),store);
      console.log(JSON.stringify({store,verified:true,products:data.products.length,indexable:catalogIndexable(data),
        priced:data.products.filter(p=>displayPrice(p)!==null).length,stocked:data.products.filter(p=>displayStock(p)!==null).length,exportedAt:data.exportedAt}));
    }catch(err){const e=err as NodeJS.ErrnoException;
      if(e.code==='ENOENT')console.log(JSON.stringify({store,verified:false,products:0,reason:'no verified export'}));
      else{console.error(JSON.stringify({store,verified:false,reason:e.message}));process.exitCode=1;}
    }
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
