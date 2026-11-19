"""Authenticated rotations survive request contexts without overwriting browser imports."""
import asyncio,json,types,unittest
from unittest.mock import AsyncMock
from src.services.flow_client import FlowClient
from src.services.flow_cookies import FlowCookieJar
from src.services.token_manager import TokenManager


def jar(value):
 return json.dumps([{'name':'SID','value':'account','domain':'.google.com','path':'/'},
                    {'name':'OSID','value':value,'domain':'flow.google.com','path':'/','hostOnly':True}])

class Database:
 def __init__(self,current):self.current=current;self.calls=[];self.enabled=False
 async def update_token_if_cookie_matches(self,tid,expected,**values):
  self.calls.append(values)
  if self.current!=expected:return False
  self.current=values['google_cookies'];return True

class CookiePersistenceTests(unittest.IsolatedAsyncioTestCase):
 def setUp(self):
  self.old=jar('original');self.client=FlowClient(proxy_manager=None);self.db=Database(self.old)
  self.manager=TokenManager(self.db,self.client)
  self.token=types.SimpleNamespace(id=1,google_cookies=self.old,at=self.client.FRONTEND_ACCESS_TOKEN)
 async def test_rotated_cookie_survives_new_request_context(self):
  self.client._remember_flow_cookies(self.old,FlowCookieJar(jar('rotated')))
  latest=self.client.get_updated_flow_cookies(self.old)
  self.assertNotEqual(latest,self.old)
  self.assertTrue(await self.manager.persist_validated_flow_cookies(self.token))
  self.client._flow_cookie_storage_ctx.set(None)
  self.assertEqual(self.client.get_updated_flow_cookies(self.db.current),latest)
  self.assertEqual(self.db.calls[0]['last_st_refresh_result'],'success')
  self.assertNotIn('is_active',self.db.calls[0]);self.assertFalse(self.db.enabled)
 async def test_polling_subtask_cookie_rotation_reaches_parent(self):
  self.client.get_updated_flow_cookies(self.old)
  async def poll():
   self.client._remember_flow_cookies(self.old,FlowCookieJar(jar('poll-rotated')))
  await asyncio.wait_for(poll(),timeout=1)
  self.assertIn('poll-rotated',self.client.get_updated_flow_cookies(self.old))
  self.assertTrue(await self.manager.persist_validated_flow_cookies(self.token))
  self.assertIn('poll-rotated',self.db.current)
 async def test_other_account_subtask_cannot_overwrite_parent(self):
  self.client.get_updated_flow_cookies(self.old)
  other=jar('other-account')
  async def request():
   self.client.get_updated_flow_cookies(other)
   self.client._remember_flow_cookies(other,FlowCookieJar(jar('other-rotated')))
  await asyncio.wait_for(request(),timeout=1)
  self.assertEqual(self.client.get_updated_flow_cookies(self.old),self.old)
 async def test_concurrent_browser_import_is_not_overwritten(self):
  self.client._remember_flow_cookies(self.old,FlowCookieJar(jar('server-rotated')))
  self.db.current=jar('newer-browser-import')
  self.assertFalse(await self.manager.persist_validated_flow_cookies(self.token))
  self.assertEqual(self.db.current,jar('newer-browser-import'))
  self.assertNotIn(1,self.manager._at_validation_cache)
 async def test_deleted_or_incomplete_session_not_persisted(self):
  self.client._remember_flow_cookies(self.old,FlowCookieJar('[]'))
  self.assertFalse(await self.manager.persist_validated_flow_cookies(self.token))
  self.assertEqual(self.db.current,self.old);self.assertFalse(self.db.calls)
 async def test_legacy_oauth_token_not_extended(self):
  self.token.at='real-oauth-access-token-placeholder'
  self.assertFalse(await self.manager.persist_validated_flow_cookies(self.token))
  self.assertFalse(self.db.calls)
 async def test_successful_balance_validation_persists_cookie(self):
  async def credits(*args,**kwargs):
   self.client._remember_flow_cookies(self.old,FlowCookieJar(jar('balance-rotated')))
   return {'credits':100,'userPaygateTier':'PAYGATE_TIER_ONE'}
  self.client.get_credits=credits
  self.manager.ensure_valid_token=AsyncMock(return_value=self.token)
  self.db.get_token=AsyncMock(return_value=self.token);self.db.update_token=AsyncMock()
  self.assertEqual(await self.manager.refresh_credits(1,raise_on_error=True),100)
  self.assertIn('balance-rotated',self.db.current)

if __name__=='__main__':unittest.main()
