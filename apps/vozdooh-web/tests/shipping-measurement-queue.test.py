import importlib.util
import unittest
from pathlib import Path

p = Path(__file__).resolve().parents[1] / 'scripts/build-shipping-measurement-queue.py'
spec = importlib.util.spec_from_file_location('shipping_queue', p)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class QueueTests(unittest.TestCase):
    def test_filters_out_of_stock_and_prioritizes_inventory_value(self):
        products = {'products': [
            {'sku':'a','name':'High','stock':2,'price':3000},
            {'sku':'b','name':'Low','stock':1,'price':100},
            {'sku':'c','name':'Sold out','stock':0,'price':99999},
            {'sku':'d','name':'Verified','stock':1,'price':99999},
        ]}
        records = {'records': [{'sku':'d','status':'VERIFIED','shipping':{'weightG':100,'lengthMm':100,'widthMm':100,'heightMm':100}}]}
        rows = module.build(products, records)
        self.assertEqual([r['sku'] for r in rows], ['a','b'])
        self.assertEqual([r['priority'] for r in rows], [1,2])
        self.assertEqual(rows[0]['stock_value_rub'], 6000)
        self.assertEqual(rows[0]['weight_g_measured'], '')

if __name__ == '__main__': unittest.main()
