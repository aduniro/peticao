"""Process-bound sd-bus unit references, source only; host test still required.

No short-lived busctl invocation can provide this lifetime. The executor/broker
must retain this object and its connection from launch through storage cleanup.
Missing/recreated units are still refused; this is not attempt2 reconciliation.
"""
import ctypes as C
import os
from pathlib import Path
import re

UNIT = re.compile(r'admin-dev-[a-f0-9]{32}-g[1-9][0-9]*\.service\Z')
UNIQUE = re.compile(r':[0-9]+\.[0-9]+\Z')
MANAGER_PATH = b'/org/freedesktop/systemd1'
MANAGER_INTERFACE = b'org.freedesktop.systemd1.Manager'


class ReferenceUncertain(RuntimeError):
    pass


class BusError(C.Structure):
    _fields_ = [('name', C.c_char_p), ('message', C.c_char_p), ('need_free', C.c_int)]


def current_boot():
    return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


class LibSystemdBus:
    """Only fixed manager RefUnit/UnrefUnit/Ping and GetNameOwner calls."""
    backend_kind = 'libsystemd-sd-bus'

    def __init__(self):
        if os.geteuid() != 0:
            raise PermissionError('root_unit_reference_client_required')
        self.lib = C.CDLL('libsystemd.so.0', use_errno=True)
        v, s, i = C.c_void_p, C.c_char_p, C.c_int
        signatures = {
            'sd_bus_open_system': ([C.POINTER(v)], i),
            'sd_bus_set_method_call_timeout': ([v, C.c_uint64], i),
            'sd_bus_get_unique_name': ([v, C.POINTER(s)], i),
            'sd_bus_get_fd': ([v], i),
            'sd_bus_call_method': ([v, s, s, s, s, C.POINTER(BusError), C.POINTER(v), s], i),
            'sd_bus_message_read': ([v, s], i),
            'sd_bus_message_get_sender': ([v], s),
            'sd_bus_message_unref': ([v], v),
            'sd_bus_error_free': ([C.POINTER(BusError)], None),
            'sd_bus_close': ([v], None),
            'sd_bus_unref': ([v], v),
        }
        for name, (args, result) in signatures.items():
            f = getattr(self.lib, name); f.argtypes = args; f.restype = result
        self.bus = v(); self.closed = False
        try:
            self._ok(self.lib.sd_bus_open_system(C.byref(self.bus)))
            self._ok(self.lib.sd_bus_set_method_call_timeout(self.bus, 10_000_000))
            self.client = self._unique()
            self.socket_identity = self._socket()
            self.manager = self._call(b'org.freedesktop.DBus', b'/org/freedesktop/DBus',
                b'org.freedesktop.DBus', b'GetNameOwner', b'org.freedesktop.systemd1', string=True)
            if not UNIQUE.fullmatch(self.manager):
                raise ReferenceUncertain('systemd_unique_owner_required')
            self.check()
        except BaseException:
            self.close(); raise

    def _ok(self, result):
        if result < 0:
            # Do not echo raw bus error messages or untrusted payloads.
            raise ReferenceUncertain('unit_reference_bus_error')
        return result

    def _unique(self):
        out = C.c_char_p()
        self._ok(self.lib.sd_bus_get_unique_name(self.bus, C.byref(out)))
        value = out.value.decode('ascii') if out.value else ''
        if len(value) > 255 or not UNIQUE.fullmatch(value):
            raise ReferenceUncertain('bus_client_identity_required')
        return value

    def _socket(self):
        fd = self._ok(self.lib.sd_bus_get_fd(self.bus)); info = os.fstat(fd)
        return (info.st_dev, info.st_ino)

    def _call(self, destination, path, interface, member, argument=None, string=False):
        if self.closed:
            raise ReferenceUncertain('unit_reference_connection_closed')
        error, reply = BusError(), C.c_void_p()
        signature = b's' if argument is not None else b''
        args = [self.bus, destination, path, interface, member, C.byref(error), C.byref(reply), signature]
        if argument is not None:
            args.append(C.c_char_p(argument))
        try:
            self._ok(self.lib.sd_bus_call_method(*args))
            if not reply.value:
                raise ReferenceUncertain('unit_reference_reply_required')
            sender = self.lib.sd_bus_message_get_sender(reply)
            if destination.startswith(b':') and sender != destination:
                raise ReferenceUncertain('systemd_owner_changed')
            if string:
                value = C.c_char_p()
                if self._ok(self.lib.sd_bus_message_read(reply, b's', C.byref(value))) <= 0 or not value.value:
                    raise ReferenceUncertain('bus_string_reply_required')
                result = value.value.decode('ascii')
                if len(result) > 255:
                    raise ReferenceUncertain('bounded_bus_identity_required')
                return result
            return None
        finally:
            if reply.value:
                self.lib.sd_bus_message_unref(reply)
            self.lib.sd_bus_error_free(C.byref(error))

    def check(self):
        if self.closed or self._unique() != self.client or self._socket() != self.socket_identity:
            raise ReferenceUncertain('unit_reference_connection_replaced')
        self._call(self.manager.encode(), MANAGER_PATH, b'org.freedesktop.DBus.Peer', b'Ping')
        if self._unique() != self.client or self._socket() != self.socket_identity:
            raise ReferenceUncertain('unit_reference_connection_replaced')

    def ref(self, unit):
        self.check()
        self._call(self.manager.encode(), MANAGER_PATH, MANAGER_INTERFACE, b'RefUnit', unit.encode())
        self.check()

    def unref(self, unit):
        self.check()
        self._call(self.manager.encode(), MANAGER_PATH, MANAGER_INTERFACE, b'UnrefUnit', unit.encode())
        self.check()

    def close(self):
        if not self.closed:
            if self.bus.value:
                self.lib.sd_bus_close(self.bus); self.lib.sd_bus_unref(self.bus)
            self.closed = True


class UnitReferences:
    """One acquisition per own unit per process lifetime; uncertainty is latched.

Injected factories/PID/boot callbacks are local test seams. The real host harness
must instantiate the default backend, not a fake factory, and prove retention.
"""
    def __init__(self, factory=LibSystemdBus, pid=os.getpid, boot=current_boot):
        self.pid_reader, self.boot_reader = pid, boot
        self.pid, self.boot = pid(), boot()
        self.records = {}; self.lost = False; self.closed = False
        self.bus = factory()
        try:
            self.check()
        except BaseException:
            self.bus.close(); self.closed = True
            raise

    def check(self):
        if self.closed or self.lost or self.pid_reader() != self.pid or self.boot_reader() != self.boot:
            self.lost = True
            raise ReferenceUncertain('process_bound_unit_reference_lost')
        try:
            self.bus.check()
        except BaseException:
            self.lost = True
            raise ReferenceUncertain('unit_reference_connection_uncertain') from None

    def _identity(self, unit, invocation):
        if not isinstance(unit, str) or not UNIT.fullmatch(unit) or not isinstance(invocation, str) or not re.fullmatch('[a-f0-9]{32}', invocation):
            raise PermissionError('own_unit_invocation_reference_required')

    def acquire(self, unit, invocation):
        self._identity(unit, invocation); self.check()
        if unit in self.records:
            raise PermissionError('unit_reference_already_attempted_no_replay')
        record = self.records[unit] = {'invocation_id': invocation, 'state': 'acquire_intent'}
        try:
            self.bus.ref(unit); self.check()
        except BaseException:
            record['state'] = 'uncertain'; self.lost = True
            raise ReferenceUncertain('unit_reference_acquisition_uncertain_no_replay') from None
        record['state'] = 'held'
        return self.snapshot(unit)

    def assert_held(self, unit, invocation):
        self._identity(unit, invocation); self.check()
        record = self.records.get(unit)
        if not record or record['state'] != 'held' or record['invocation_id'] != invocation:
            raise PermissionError('matching_held_unit_reference_required')
        return self.snapshot(unit)

    def release(self, unit, invocation):
        self.assert_held(unit, invocation)
        record = self.records[unit]; record['state'] = 'release_intent'
        try:
            self.bus.unref(unit); self.check()
        except BaseException:
            record['state'] = 'uncertain'; self.lost = True
            raise ReferenceUncertain('unit_reference_release_uncertain_no_replay') from None
        record['state'] = 'released'
        return self.snapshot(unit)

    def snapshot(self, unit):
        record = self.records.get(unit)
        if record is None:
            raise PermissionError('own_unit_reference_record_required')
        return {'unit': unit, 'invocation_id': record['invocation_id'], 'state': record['state'],
                'process_id': self.pid, 'worker_boot_id': self.boot, 'connection_uncertain': self.lost,
                'backend': self.bus.backend_kind}

    def close(self):
        if any(r['state'] != 'released' for r in self.records.values()):
            raise PermissionError('unreleased_unit_references_require_reconciliation')
        self.bus.close(); self.closed = True
