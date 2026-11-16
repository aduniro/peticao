"""Static exposure guards, not a substitute for the installed Caddy validator."""
from pathlib import Path
import shlex
import unittest


CONFIG = Path(__file__).resolve().parents[1] / 'infra' / 'Caddyfile.exec-ingress'


def parse_profile(text):
    root = []
    stack = [root]
    for line in text.splitlines():
        words = shlex.split(line, comments=True)
        if not words:
            continue
        if words == ['}']:
            if len(stack) == 1:
                raise ValueError('unbalanced_config')
            stack.pop()
        elif words[-1] == '{':
            children = []
            stack[-1].append((words[:-1], children))
            stack.append(children)
        elif '{' in words or '}' in words:
            raise ValueError('unsupported_inline_block')
        else:
            stack[-1].append((words, None))
    if len(stack) != 1:
        raise ValueError('unbalanced_config')
    return root


def single(nodes, words):
    matches = [children for key, children in nodes if key == words]
    if len(matches) != 1:
        raise ValueError('required_unique_directive:' + ' '.join(words))
    return matches[0]


def guard_public_profile(text):
    tree = parse_profile(text)
    if len(tree) != 2:
        raise ValueError('one_global_block_and_one_host_required')
    global_options = single(tree, [])
    site = single(tree, ['exec.sancionaintegral.org'])
    if [key for key, _ in global_options] != [['admin', 'off'], ['log', 'default']]:
        raise ValueError('no_additional_admin_or_global_listener')
    runtime_log = single(global_options, ['log', 'default'])
    single(runtime_log, ['output', 'stderr'])
    single(runtime_log, ['level', 'INFO'])
    log_filter = single(runtime_log, ['format', 'filter'])
    single(log_filter, ['wrap', 'json'])
    fields = single(log_filter, ['fields'])
    if {tuple(key) for key, _ in fields} != {
        ('request', 'delete'), ('headers', 'delete'),
        ('resp_headers', 'delete'), ('body', 'delete'),
    }:
        raise ValueError('runtime_log_request_data_not_removed')
    if len(site) != 4:
        raise ValueError('no_additional_public_handler_or_access_log')
    single(site, ['header', 'Cache-Control', 'no-store'])
    matcher = single(site, ['@provider_inbound'])
    if {tuple(key) for key, _ in matcher} != {
        ('method', 'POST'), ('path', '/mailersend/inbound'),
    }:
        raise ValueError('exact_method_and_path_required')
    callback = single(site, ['handle', '@provider_inbound'])
    if len(callback) != 2:
        raise ValueError('no_callback_rewrite_or_other_effect')
    body_limit = single(callback, ['request_body'])
    if body_limit != [(['max_size', '262144'], None)]:
        raise ValueError('bounded_raw_body_required')
    proxy = single(callback, ['reverse_proxy', '127.0.0.1:8768'])
    if len(proxy) != 2:
        raise ValueError('one_fixed_upstream_without_header_manipulation')
    single(proxy, ['lb_retries', '0'])
    transport = single(proxy, ['transport', 'http'])
    if transport != [(['dial_timeout', '2s'], None), (['response_header_timeout', '10s'], None)]:
        raise ValueError('fixed_bounded_http_transport_required')
    if single(site, ['handle']) != [(['respond', '', '404'], None)]:
        raise ValueError('other_requests_must_not_proxy')


class PublicIngressProfileTests(unittest.TestCase):
    def setUp(self):
        self.text = CONFIG.read_text()

    def test_draft_only_exposes_exact_callback(self):
        guard_public_profile(self.text)

    def test_console_or_arbitrary_upstream_cannot_be_added(self):
        for port in ['8767', '3000', '2019']:
            with self.subTest(port=port), self.assertRaises(ValueError):
                guard_public_profile(self.text.replace('127.0.0.1:8768', '127.0.0.1:' + port))

    def test_broader_paths_methods_and_removed_body_limit_rejected(self):
        for changed in [
            self.text.replace('path /mailersend/inbound', 'path /mailersend/*'),
            self.text.replace('method POST', 'method GET POST'),
            self.text.replace('max_size 262144', 'max_size 1048576'),
        ]:
            with self.assertRaises(ValueError):
                guard_public_profile(changed)

    def test_disabled_redaction_or_admin_control_rejected(self):
        for changed in [
            self.text.replace('request delete', 'request replace retained'),
            self.text.replace('admin off', 'admin localhost:2019'),
        ]:
            with self.assertRaises(ValueError):
                guard_public_profile(changed)

    def test_header_rewrites_retries_or_extra_proxy_cannot_enter_profile(self):
        for changed in [
            self.text.replace('lb_retries 0', 'lb_retries 2'),
            self.text.replace('lb_retries 0', 'lb_retries 0\nheader_up -Signature'),
            self.text.replace('respond "" 404', 'reverse_proxy 127.0.0.1:8767'),
        ]:
            with self.assertRaises(ValueError):
                guard_public_profile(changed)


if __name__ == '__main__':
    unittest.main()
