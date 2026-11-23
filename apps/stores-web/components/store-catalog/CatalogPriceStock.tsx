import { displayPrice, displayStock, type CatalogProduct } from '@/lib/store-catalog/core';
const currency = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
export function CatalogPriceStock({ product }: { product: CatalogProduct }) {
  const price=displayPrice(product), stock=displayStock(product);
  return <div className="catalog-price-stock">
    <span>{price===null?'Цена уточняется':currency.format(price)}</span>
    <span>{stock===null?'Наличие уточняется':stock===0?'Нет в наличии по последней проверке':'По последней проверке: '+stock+' '+(product.unit??'шт.')}</span>
  </div>;
}
