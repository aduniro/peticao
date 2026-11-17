import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import worker

class CertificateValidityTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 12, tzinfo=timezone.utc)
        self.cert = SimpleNamespace(not_valid_before_utc=self.now-timedelta(days=1), not_valid_after_utc=self.now+timedelta(days=1))
    def test_current(self):
        worker.require_certificate_current(self.cert, self.now)
    def test_future(self):
        with self.assertRaisesRegex(worker.Refused, "certificate_not_yet_valid"):
            worker.require_certificate_current(self.cert, self.cert.not_valid_before_utc-timedelta(microseconds=1))
    def test_expired(self):
        with self.assertRaisesRegex(worker.Refused, "certificate_expired"):
            worker.require_certificate_current(self.cert, self.cert.not_valid_after_utc+timedelta(microseconds=1))
    def test_inclusive_boundaries(self):
        for moment in (self.cert.not_valid_before_utc, self.cert.not_valid_after_utc):
            worker.require_certificate_current(self.cert, moment)
    def test_expiry_during_work_is_refused_on_recheck(self):
        worker.require_certificate_current(self.cert, self.now)
        with self.assertRaisesRegex(worker.Refused, "certificate_expired"):
            worker.require_certificate_current(self.cert, self.now+timedelta(days=2))
    def test_naive_clock_refused(self):
        with self.assertRaisesRegex(worker.Refused, "certificate_time_invalid"):
            worker.require_certificate_current(self.cert, self.now.replace(tzinfo=None))
    def test_invalid_window_refused(self):
        self.cert.not_valid_before_utc = self.cert.not_valid_after_utc+timedelta(days=1)
        with self.assertRaisesRegex(worker.Refused, "certificate_time_invalid"):
            worker.require_certificate_current(self.cert, self.now)

if __name__ == "__main__": unittest.main()
