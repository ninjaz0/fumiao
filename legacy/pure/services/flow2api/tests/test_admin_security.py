import unittest
from types import SimpleNamespace
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src/core"))
from admin_security import AdminSessions, LoginFailures, trusted_admin_origin

class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.now=0.0
    def clock(self):return self.now
    def test_idle_and_absolute_expiry(self):
        s=AdminSessions(ttl=100,idle=30,clock=self.clock);s.add('secret')
        for t in [20,40,60,80]:
            self.now=t;self.assertIn('secret',s)
        self.now=100;self.assertNotIn('secret',s)
        s.add('other');self.now=131;self.assertNotIn('other',s)
    def test_revocation_and_capacity(self):
        s=AdminSessions(capacity=2,clock=self.clock)
        for t in ['one','two','three']:s.add(t)
        self.assertNotIn('one',s);self.assertIn('three',s)
        self.assertNotIn('three',s._entries)
        s.discard('three');self.assertNotIn('three',s)
        s.clear();self.assertEqual(len(s),0)
    def test_per_ip_limit_and_recovery(self):
        f=LoginFailures(clock=self.clock)
        for _ in range(5):f.failure('one')
        self.assertEqual(f.retry_after('one'),300);self.assertEqual(f.retry_after('two'),0)
        self.now=300;self.assertEqual(f.retry_after('one'),0)
    def test_global_limit_survives_ip_rotation(self):
        f=LoginFailures(total=3,clock=self.clock)
        for ip in ['a','b','c']:f.failure(ip)
        self.assertGreater(f.retry_after('new'),0)
        f.success('a');self.assertGreater(f.retry_after('new'),0)
    def test_origins_match_exactly(self):
        for headers,allowed in [({'origin':'https://backend.nvmes.com'},True),({'origin':'https://backend.nvmes.com.evil.invalid'},False),({'origin':'null'},False),({'referer':'https://backend.nvmes.com/flow/'},True),({},False)]:
            self.assertEqual(trusted_admin_origin(SimpleNamespace(headers=headers),require=True),allowed)
if __name__=='__main__':unittest.main()
