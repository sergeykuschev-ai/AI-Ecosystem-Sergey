import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE=Path(__file__).resolve().parents[1]/'scripts'/'audit-paid-stock.py'
SPEC=importlib.util.spec_from_file_location('paid_stock_audit',MODULE)
M=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)

class PaidStockAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.orders=self.root/'orders'
        self.orders.mkdir()
        self.catalog=self.root/'catalog.json'
        self.stock=1
    def write_catalog(self,stock=1):
        self.catalog.write_text(json.dumps({'products':[{'sku':'S1','stock':stock}]}))
    def write_order(self,state='PAID',qty=1,stock_at_request=1):
        self.orders.joinpath('order.json').write_text(json.dumps({'payment':{'status':state},
            'lines':[{'sku':'S1','quantity':qty,'stockAtRequest':stock_at_request}],
            'input':{'contact':{'name':'PRIVATE NAME','email':'secret@example.test'}}}))
    def test_paid_order_with_unchanged_stock_only_warns(self):
        self.write_catalog(1)
        self.write_order()
        result=M.audit(self.orders,self.catalog)
        self.assertEqual(result['paid_orders'],1)
        self.assertEqual(result['possible_unreconciled_lines'],1)
        self.assertNotIn('PRIVATE NAME',json.dumps(result))
        self.assertNotIn('secret@example.test',json.dumps(result))
    def test_decrease_in_imported_stock_is_not_flagged(self):
        self.write_catalog(0)
        self.write_order()
        self.assertEqual(M.audit(self.orders,self.catalog)['possible_unreconciled_lines'],0)
    def test_pending_payment_is_not_counted(self):
        self.write_catalog(1)
        self.write_order('PAYMENT_NEW')
        self.assertEqual(M.audit(self.orders,self.catalog)['paid_orders'],0)
    def test_restock_can_trigger_review_not_proof(self):
        self.write_catalog(5)
        self.write_order()
        result=M.audit(self.orders,self.catalog)
        self.assertEqual(result['possible_unreconciled_lines'],1)
        self.assertIn('nondefinitive',result['note'])
    def test_unknown_sku_warns(self):
        self.catalog.write_text(json.dumps({'products':[]}))
        self.write_order()
        self.assertEqual(M.audit(self.orders,self.catalog)['warnings'][0]['reason'],'not_in_latest_import')

if __name__=='__main__': unittest.main()
