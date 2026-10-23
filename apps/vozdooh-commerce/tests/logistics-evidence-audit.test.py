import importlib.util
import unittest
from pathlib import Path

p=Path(__file__).resolve().parents[1]/'scripts/audit-logistics-evidence.py'
spec=importlib.util.spec_from_file_location('evidence_audit',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class EvidenceTests(unittest.TestCase):
    def test_complete_evidence_is_only_for_manual_review(self):
        queue=[{'sku':'a','priority':1,'name':'Diffuser','stock_value_rub':1000}]
        evidence={'records':[{'sku':'a','status':'VERIFIED_RETAIL_PACKAGE','measurements':[{'weightG':700,'scope':'product','sourceUrl':'https://example.com/a'},{'dimensionsMm':[140,130,300],'scope':'retail_package','sourceUrl':'https://example.com/b'}]}]}
        result=m.analyze(queue,evidence)[0]
        self.assertEqual(result['review_category'],'DIFFERENT_MEASUREMENT_SCOPE')
        self.assertIn('before approving',result['review_action'])
        self.assertEqual(result['source_count'],2)
    def test_family_dimensions_cannot_qualify_exact_sku(self):
        queue=[{'sku':'a','priority':1,'name':'Diffuser','stock_value_rub':1000}]
        evidence={'records':[{'sku':'a','status':'VERIFIED_RETAIL_PACKAGE','measurements':[{'weightG':370,'scope':'product_or_item_weight','sourceUrl':'https://example.com/one'},{'dimensionsMm':[99,99,82],'scope':'retail_package_family_explicit','sourceUrl':'https://example.com/two'}]}]}
        result=m.analyze(queue,evidence)[0]
        self.assertEqual(result['review_category'],'FAMILY_REFERENCE_NOT_EXACT')
        self.assertIn('do not prove this exact SKU',result['review_action'])

    def test_conflicting_weights_block(self):
        queue=[{'sku':'a','priority':1,'name':'Diffuser','stock_value_rub':1000}]
        evidence={'records':[{'sku':'a','status':'PARTIAL','measurements':[{'weightG':700,'scope':'product'},{'weightG':800,'scope':'product'}]}]}
        self.assertEqual(m.analyze(queue,evidence)[0]['review_category'],'SOURCE_CONFLICT')
    def test_liquid_or_wax_fill_is_not_total_shipping_weight(self):
        queue=[{'sku':'a','priority':1,'name':'Candle','stock_value_rub':1000}]
        evidence={'records':[{'sku':'a','status':'PARTIAL','measurements':[{'weightG':180,'scope':'wax_fill_only'}]}]}
        self.assertEqual(m.analyze(queue,evidence)[0]['review_category'],'PHYSICAL_MEASUREMENT_REQUIRED')

if __name__=='__main__':unittest.main()
