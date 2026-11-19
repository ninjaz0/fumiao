"""Bounded, expiring administration sessions and login failure budgets."""
import hashlib
import math
import os
import time
from collections import OrderedDict, deque
from urllib.parse import urlsplit

ADMIN_ALLOWED_ORIGINS = tuple(dict.fromkeys([
    "https://backend.nvmes.com", "https://nvmes.com",
    *[v.strip().rstrip("/") for v in os.environ.get("FLOW_ADMIN_ALLOWED_ORIGINS", "").split(",") if v.strip()],
]))

class AdminSessions:
    def __init__(self, ttl=8*3600, idle=3600, capacity=1000, clock=time.monotonic):
        self.ttl, self.idle, self.capacity, self.clock = ttl, idle, capacity, clock
        self._entries = OrderedDict()
    @staticmethod
    def _key(token):
        return hashlib.sha256(token.encode()).digest()
    def _purge(self):
        now = self.clock()
        for key, (created, touched) in list(self._entries.items()):
            if now-created >= self.ttl or now-touched >= self.idle:
                self._entries.pop(key, None)
    def add(self, token):
        self._purge()
        if len(self._entries) >= self.capacity:
            self._entries.popitem(last=False)
        now = self.clock()
        self._entries[self._key(token)] = (now, now)
    def __contains__(self, token):
        if not isinstance(token, str) or not token:
            return False
        self._purge()
        key = self._key(token)
        entry = self._entries.get(key)
        if entry is None:
            return False
        self._entries[key] = (entry[0], self.clock())
        return True
    def discard(self, token):
        if isinstance(token, str):
            self._entries.pop(self._key(token), None)
    def clear(self):
        self._entries.clear()
    def __len__(self):
        self._purge()
        return len(self._entries)

class LoginFailures:
    def __init__(self, per_ip=5, total=50, window=300, capacity=1024, clock=time.monotonic):
        self.per_ip, self.total, self.window, self.capacity, self.clock = per_ip, total, window, capacity, clock
        self._ips, self._all = OrderedDict(), deque()
    def _prune(self):
        cutoff = self.clock()-self.window
        while self._all and self._all[0] <= cutoff:
            self._all.popleft()
        for ip, times in list(self._ips.items()):
            while times and times[0] <= cutoff:
                times.popleft()
            if not times:
                self._ips.pop(ip, None)
    def retry_after(self, ip):
        self._prune()
        times = self._ips.get(ip, ())
        blocked = []
        if len(times) >= self.per_ip:
            blocked.append(times[0]+self.window-self.clock())
        if len(self._all) >= self.total:
            blocked.append(self._all[0]+self.window-self.clock())
        return max(1, math.ceil(max(blocked))) if blocked else 0
    def failure(self, ip):
        self._prune()
        if ip not in self._ips and len(self._ips) >= self.capacity:
            self._ips.popitem(last=False)
        self._ips.setdefault(ip, deque()).append(self.clock())
        self._ips.move_to_end(ip)
        self._all.append(self.clock())
    def success(self, ip):
        self._ips.pop(ip, None)

def trusted_admin_origin(request, require=False):
    origin = request.headers.get("origin")
    if origin is None:
        referer = request.headers.get("referer")
        if referer:
            parsed = urlsplit(referer)
            origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin is None:
        return not require
    return origin in ADMIN_ALLOWED_ORIGINS
