import fs from 'node:fs'
import path from 'node:path'
import type { OrderRequest } from './orderRequests'
import type { ParcelDimensions } from './ozonDeliveryBusiness'

type Row={sku:string,status:string,shipping:{weightG:number|null,lengthMm:number|null,widthMm:number|null,heightMm:number|null}}
type Data={records:Row[]}
export class LogisticsDataError extends Error { constructor(public code:string){super(code)} }

export function loadVerifiedLogistics(file=process.env.LOGISTICS_DATASET_PATH||path.resolve('research/data/logistics-dataset-real.json')){
  const data=JSON.parse(fs.readFileSync(file,'utf8')) as Data
  return new Map(data.records.filter(r=>r.status==='VERIFIED').map(r=>[r.sku,r.shipping]))
}

/** Product-only dimensions are safe only for a single physical unit. */
export function parcelForOrder(order:OrderRequest, rows=loadVerifiedLogistics()):ParcelDimensions{
  const units=order.lines.reduce((sum,line)=>sum+line.quantity,0)
  if(order.lines.length!==1||units!==1) throw new LogisticsDataError('LOGISTICS_MULTI_ITEM_UNSUPPORTED')
  const line=order.lines[0]
  const s=rows.get(line.sku)
  if(!s||![s.weightG,s.lengthMm,s.widthMm,s.heightMm].every(Number.isFinite)) throw new LogisticsDataError('LOGISTICS_SKU_NOT_VERIFIED')
  const parcel={weightG:s.weightG!,lengthMm:s.lengthMm!,widthMm:s.widthMm!,heightMm:s.heightMm!}
  if(!Object.values(parcel).every(Number.isSafeInteger)||Math.min(...Object.values(parcel))<=0) throw new LogisticsDataError('LOGISTICS_PARCEL_INVALID')
  return parcel
}
