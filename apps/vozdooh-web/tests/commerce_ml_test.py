"""Synthetic staging regressions; never reads or changes the live exchange."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('converter', Path(__file__).parents[1] / 'scripts/convert-commerce-ml.py')
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class StagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.exchange = self.root / 'exchange'
        self.exchange.mkdir()
        self.imp = self.exchange / 'import.xml'
        self.off = self.exchange / 'offers.xml'
        self.imp.write_text('<Root ДатаФормирования="2026-09-25"><Товар><Ид>id-1</Ид><Артикул>sku-1</Артикул><Наименование>Synthetic</Наименование></Товар></Root>')
        self.offer('2', '12.35')
        (self.exchange / 'imports.jsonl').write_text('\n'.join(json.dumps({'filename': name, 'state': 'staged'}) for name in ['import.xml', 'offers.xml']))
        self.output = self.root / 'snapshot.json'
        self.report = self.root / 'report.json'
        self.args = SimpleNamespace(exchange_root=str(self.exchange), output=str(self.output), report=str(self.report), warehouse_id='warehouse', price_type_id='price', publish_price=False)

    def offer(self, stock, price):
        self.off.write_text(f'<Root ДатаФормирования="2026-09-25"><Предложение><Ид>id-1</Ид><Склад ИдСклада="warehouse" КоличествоНаСкладе="{stock}"/><Цены><Цена><ИдТипаЦены>price</ИдТипаЦены><ЦенаЗаЕдиницу>{price}</ЦенаЗаЕдиницу></Цена></Цены></Предложение></Root>')

    def run_conversion(self):
        with patch.object(converter, 'parse_args', return_value=self.args), patch('builtins.print'):
            converter.main()

    def test_repeatable_audit_and_preserved_source(self):
        before = (self.imp.read_bytes(), self.off.read_bytes())
        self.run_conversion()
        first = self.output.read_bytes()
        self.run_conversion()
        self.assertEqual(first, self.output.read_bytes())
        self.assertEqual(before, (self.imp.read_bytes(), self.off.read_bytes()))
        product = json.loads(first)['products'][0]
        self.assertEqual(product['stock'], 2)
        self.assertIsNone(product['price'])
        self.assertEqual(json.loads(self.report.read_text())['import_sha256'], converter.source_digest(self.imp))
        self.assertFalse(list(self.root.glob('*.lock')))

    def test_bad_numbers_preserve_previous_publication(self):
        self.run_conversion()
        before = (self.output.read_bytes(), self.report.read_bytes())
        for stock, price in [('broken', '1'), ('NaN', '1'), ('Infinity', '1'), ('1', 'NaN'), ('1', '-2'), ('1', ''), ('1e30', '1')]:
            with self.subTest(stock=stock, price=price):
                self.offer(stock, price)
                with self.assertRaises(ValueError):
                    self.run_conversion()
                self.assertEqual(before, (self.output.read_bytes(), self.report.read_bytes()))

    def test_duplicate_and_missing_ids_fail(self):
        for path, tag in [(self.imp, 'Товар'), (self.off, 'Предложение')]:
            original = path.read_text()
            fragment = original[original.index(f'<{tag}>'):original.index(f'</{tag}>') + len(tag) + 3]
            path.write_text(original.replace('</Root>', fragment + '</Root>'))
            with self.assertRaises(ValueError):
                self.run_conversion()
            path.write_text(original)
        self.off.write_text(self.off.read_text().replace('id-1', 'id-2'))
        with self.assertRaisesRegex(ValueError, 'MISMATCHED'):
            self.run_conversion()
        self.assertFalse(self.output.exists())

    def test_sku_collision_and_unsafe_fallback_fail(self):
        for rows in [[{'article': 'same', 'source_id': 'id-1'}, {'article': '', 'source_id': 'same'}], [{'article': '', 'source_id': '../unsafe'}]]:
            with self.assertRaisesRegex(ValueError, 'SKU'):
                converter.choose_skus(rows)

    def test_lock_and_source_destination_protection(self):
        lock = self.output.with_name(self.output.name + '.lock')
        lock.write_text('active writer')
        with self.assertRaises(FileExistsError):
            self.run_conversion()
        self.assertEqual(lock.read_text(), 'active writer')
        self.args.report = str(lock)
        with self.assertRaisesRegex(ValueError, 'OVERWRITE'):
            self.run_conversion()
        self.args.report = str(self.report)
        self.args.output = str(self.imp)
        before = self.imp.read_bytes()
        with self.assertRaisesRegex(ValueError, 'OVERWRITE'):
            self.run_conversion()
        self.assertEqual(before, self.imp.read_bytes())

    def test_changed_source_during_conversion_preserves_previous_output(self):
        self.run_conversion()
        before = self.output.read_bytes()
        real_parse = converter.parse_offers
        def changed(*args):
            result = real_parse(*args)
            self.off.write_text(self.off.read_text() + ' ')
            return result
        with patch.object(converter, 'parse_offers', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'SOURCE_CHANGED'):
                self.run_conversion()
        self.assertEqual(before, self.output.read_bytes())

    def test_duplicate_selected_warehouse_and_price_fail(self):
        for tag in ['Склад', 'Цены']:
            self.offer('2', '12.35')
            original = self.off.read_text()
            if tag == 'Склад':
                fragment = '<Склад ИдСклада="warehouse" КоличествоНаСкладе="2"/>'
            else:
                fragment = '<Цены><Цена><ИдТипаЦены>price</ИдТипаЦены><ЦенаЗаЕдиницу>12.35</ЦенаЗаЕдиницу></Цена></Цены>'
            self.off.write_text(original.replace('</Предложение>', fragment + '</Предложение>'))
            with self.assertRaisesRegex(ValueError, 'DUPLICATE_SELECTED'):
                self.run_conversion()

    def test_reader_limits_preserve_previous_snapshot(self):
        self.run_conversion()
        before = self.output.read_bytes()
        for constant, limit in [('MAX_PRODUCTS', 0), ('MAX_SNAPSHOT_BYTES', 10)]:
            with patch.object(converter, constant, limit):
                with self.assertRaises(ValueError):
                    self.run_conversion()
            self.assertEqual(before, self.output.read_bytes())

    def test_existing_negative_stock_policy_and_fractional_stock(self):
        for stock, expected in [('-2', 0), ('0', 0), ('1.5', 1.5)]:
            self.offer(stock, '12.35')
            self.run_conversion()
            self.assertEqual(json.loads(self.output.read_text())['products'][0]['stock'], expected)


if __name__ == '__main__':
    unittest.main()
