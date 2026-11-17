import importlib.util
import pathlib
import unittest

SPEC = importlib.util.spec_from_file_location('renderer', pathlib.Path(__file__).resolve().parents[1] / 'scripts/render_node.py')
renderer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(renderer)


class RenderTests(unittest.TestCase):
    def test_overlapping_host_routes_block_configuration(self):
        for network in ['10.240.0.0/16', '10.241.0.128/25', '10.0.0.0/8']:
            with self.assertRaises(ValueError):
                renderer.render('local', 32 * 2**30, 8, [{'dst': network}])
        renderer.render('local', 32 * 2**30, 8, [{'dst': 'default'}, {'dst': '172.17.0.0/16'}])

    def test_insufficient_host_capacity_is_not_silently_overcommitted(self):
        with self.assertRaises(ValueError):
            renderer.render('santiago', 2 * 2**30, 1, [])
