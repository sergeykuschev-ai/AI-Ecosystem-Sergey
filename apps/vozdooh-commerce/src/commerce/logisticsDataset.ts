import fs from 'node:fs'
import path from 'node:path'
import type { OrderRequest } from './orderRequests'
import type { ParcelDimensions } from './ozonDeliveryBusiness'
import { packVerifiedUnits, PackingError, type VerifiedCarton } from './packing'

type Row={sku:string,status:string,shipping:{weightG:number|null,lengthMm:number|null,widthMm:number|null,heightMm:number|null}}
type Data={records:Row[]}
export class LogisticsDataError extends Error { constructor(public code:string){super(code)} }

export function loadVerifiedLogistics(file=process.env.LOGISTICS_DATASET_PATH||path.resolve('research/data/logistics-dataset-real.json')){
  const data=JSON.parse(fs.readFileSync(file,'utf8')) as Data
  return new Map(data.records.filter(r=>r.status==='VERIFIED').map(r=>[r.sku,r.shipping]))
}

export function loadVerifiedCartons(file=process.env.VERIFIED_CARTONS_PATH||path.resolve('research/data/verified-cartons.json')): VerifiedCarton[] {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { schemaVersion?: unknown; cartons?: unknown }
  if (data.schemaVersion !== 1 || !Array.isArray(data.cartons)) throw new LogisticsDataError('PACKING_CARTON_DATASET_INVALID')
  return data.cartons as VerifiedCarton[]
}

/** Single-unit product dimensions are historical behavior. Multi-item shipments
 * require measured cartons, including their tare weight and internal capacity. */
export function parcelForOrder(order:OrderRequest, rows=loadVerifiedLogistics(), cartons?: VerifiedCarton[]):ParcelDimensions{
  const units=order.lines.reduce((sum,line)=>sum+line.quantity,0)
  if(!Number.isSafeInteger(units)||units<=0||units>100) throw new LogisticsDataError('PACKING_UNIT_COUNT_UNSUPPORTED')
  const physical = [] as Array<{ sku: string; dimensions: ParcelDimensions }>
  for(const line of order.lines){
    const s=rows.get(line.sku)
    if(!s||![s.weightG,s.lengthMm,s.widthMm,s.heightMm].every(Number.isSafeInteger)) throw new LogisticsDataError('LOGISTICS_SKU_NOT_VERIFIED')
    const dimensions={weightG:s.weightG!,lengthMm:s.lengthMm!,widthMm:s.widthMm!,heightMm:s.heightMm!}
    if(Math.min(...Object.values(dimensions))<=0) throw new LogisticsDataError('LOGISTICS_PARCEL_INVALID')
    for(let i=0;i<line.quantity;i++) physical.push({sku:line.sku,dimensions})
  }
  if(units===1) return physical[0].dimensions
  try { return packVerifiedUnits(physical,cartons??loadVerifiedCartons()).parcel }
  catch(error) {
    if(error instanceof PackingError) throw new LogisticsDataError(error.code)
    throw error
  }
}
