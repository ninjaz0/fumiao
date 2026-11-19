import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException, Response
from starlette.requests import Request
from fastapi.testclient import TestClient
from src.api import admin
from src.core.admin_security import AdminSessions, LoginFailures

def request(method="POST", origin="https://backend.nvmes.com", cookie=""):
    headers=[]
    if origin is not None:headers.append((b"origin",origin.encode()))
    if cookie:headers.append((b"cookie",("admin_session="+cookie).encode()))
    return Request({"type":"http","method":method,"path":"/api/admin/login","root_path":"/flow","scheme":"https","headers":headers,"client":("203.0.113.8",1234),"server":("backend.nvmes.com",443),"query_string":b""})

class IntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.original=(admin.active_admin_tokens,admin.admin_login_failures,admin.db)
        admin.active_admin_tokens=AdminSessions();admin.admin_login_failures=LoginFailures()
        admin.db=SimpleNamespace(get_admin_config=AsyncMock(return_value=SimpleNamespace(username="test-admin")))
    async def asyncTearDown(self):
        admin.active_admin_tokens,admin.admin_login_failures,admin.db=self.original
    async def test_cookie_mutation_requires_trusted_origin(self):
        admin.active_admin_tokens.add("test-session")
        with self.assertRaises(HTTPException) as raised:
            await admin.verify_admin_token(request(origin="https://evil.invalid",cookie="test-session"),None)
        self.assertEqual(raised.exception.status_code,403)
        self.assertEqual(await admin.verify_admin_token(request(cookie="test-session"),None),"test-session")
        self.assertEqual(await admin.verify_admin_token(request(origin="https://evil.invalid"),"Bearer test-session"),"test-session")
    async def test_real_login_handler_throttles_failed_credentials(self):
        payload=admin.LoginRequest(username="test-admin",password="invalid")
        with patch.object(admin.AuthManager,"verify_admin",return_value=False):
            for _ in range(5):
                with self.assertRaises(HTTPException) as raised:await admin.admin_login(payload,Response(),request())
                self.assertEqual(raised.exception.status_code,401)
            with self.assertRaises(HTTPException) as raised:await admin.admin_login(payload,Response(),request())
            self.assertEqual(raised.exception.status_code,429)
            self.assertIn("Retry-After",raised.exception.headers)
    async def test_success_cookie_has_expiration_and_secure_flags(self):
        payload=admin.LoginRequest(username="test-admin",password="test-password");response=Response()
        with patch.object(admin.AuthManager,"verify_admin",return_value=True):
            result=await admin.admin_login(payload,response,request())
        self.assertIn(result["token"],admin.active_admin_tokens)
        cookie=response.headers["set-cookie"]
        for flag in ["HttpOnly","Secure","Max-Age=28800","Path=/flow"]:self.assertIn(flag,cookie)
    async def test_login_rejects_foreign_origin(self):
        with self.assertRaises(HTTPException) as raised:await admin.admin_login(admin.LoginRequest(username="test",password="test"),Response(),request(origin="https://evil.invalid"))
        self.assertEqual(raised.exception.status_code,403)

class CorsTests(unittest.TestCase):
    def test_real_cors_configuration(self):
        from src.main import app
        client=TestClient(app)
        trusted=client.options("/api/tokens",headers={"Origin":"https://backend.nvmes.com","Access-Control-Request-Method":"GET"})
        self.assertEqual(trusted.status_code,200);self.assertEqual(trusted.headers.get("access-control-allow-origin"),"https://backend.nvmes.com")
        foreign=client.options("/api/tokens",headers={"Origin":"https://evil.invalid","Access-Control-Request-Method":"GET"})
        self.assertEqual(foreign.status_code,400);self.assertNotIn("access-control-allow-origin",foreign.headers)
if __name__=='__main__':unittest.main()
