import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

temp = tempfile.TemporaryDirectory()
os.environ["FUMIAOCOLAB_HOME"] = temp.name
RESOURCES = Path(__file__).resolve().parents[1] / "Resources"
sys.path.insert(0, str(RESOURCES))
import bridge
import h3_engine


class BridgeTests(unittest.TestCase):
    def setUp(self):
        for p in Path(temp.name).glob("*.json"): p.unlink()
        self.helper = Mock()
        self.helper._has_valid_token.return_value = True
        self.session = SimpleNamespace(name="fumiao-1", endpoint="ours", url="https://test.invalid", token="test")
        self.state = Mock()
        self.state.sync_sessions.return_value = ({"fumiao-1": self.session}, [])
        self.record = {"owner_id": 1, "session_name": "fumiao-1", "endpoint": "ours", "node_name": "弗淼001"}

    def test_only_managed_runtime_is_released(self):
        bridge.save(bridge.ROOT / "managed.json", self.record)
        self.state.client.list_assignments.return_value = [SimpleNamespace(endpoint="unrelated-runtime")]
        self.assertTrue(bridge.stop(self.helper, self.state, {"owner_id": 1})["ok"])
        self.state.client.unassign.assert_called_once_with("ours")

    def test_other_fumiao_owner_cannot_release(self):
        bridge.save(bridge.ROOT / "managed.json", self.record)
        with self.assertRaisesRegex(ValueError, "另一个弗淼账号"):
            bridge.stop(self.helper, self.state, {"owner_id": 2})
        self.state.client.unassign.assert_not_called()

    def test_stale_name_cannot_adopt_different_endpoint(self):
        self.session.endpoint = "not-ours"
        self.assertIsNone(bridge.current_session(self.state, self.record))

    def test_network_failure_never_becomes_inactive(self):
        self.state.sync_sessions.side_effect = OSError("offline")
        with self.assertRaises(OSError): bridge.current_session(self.state, self.record)

    def test_rebind_is_blocked_with_live_runtime(self):
        bridge.save(bridge.ROOT / "managed.json", self.record)
        with self.assertRaisesRegex(ValueError, "先释放"):
            bridge.auth_url(self.helper, self.state)

    def test_bad_credentials_or_shell_payload_rejected_before_allocating(self):
        data = {"site": bridge.SITE, "owner_id": 1, "code": "x" * 43, "gpu": "G4", "node_name": "弗淼001", "idle_minutes": 30}
        bridge.validate_deployment(data)
        for change in ({"code": "x" * 43 + ";echo bad"}, {"site": "https://attacker.invalid"}, {"owner_id": 0}, {"gpu": "T4"}):
            with self.assertRaises(ValueError): bridge.deploy(self.helper, self.state, data | change)
        self.helper._allocate_fresh_session.assert_not_called()

    def test_failed_deploy_releases_its_allocated_runtime(self):
        self.state.sync_sessions.return_value = ({}, [])
        self.helper._allocate_fresh_session.return_value = self.session
        self.helper._wait_for_runtime_ready.return_value = False
        data = {"site": bridge.SITE, "owner_id": 1, "code": "x" * 43, "gpu": "G4", "node_name": "弗淼001", "idle_minutes": 30}
        with self.assertRaises(ValueError): bridge.deploy(self.helper, self.state, data)
        self.state.client.unassign.assert_called_once_with("ours")
        self.assertFalse((bridge.ROOT / "managed.json").exists())

    def test_failed_cleanup_preserves_recovery_record(self):
        self.state.sync_sessions.return_value = ({}, [])
        self.helper._allocate_fresh_session.return_value = self.session
        self.helper._wait_for_runtime_ready.return_value = False
        self.state.client.unassign.side_effect = OSError()
        data = {"site": bridge.SITE, "owner_id": 1, "code": "x" * 43, "gpu": "G4", "node_name": "弗淼001", "idle_minutes": 30}
        with self.assertRaisesRegex(ValueError, "释放未确认"): bridge.deploy(self.helper, self.state, data)
        self.assertTrue((bridge.ROOT / "managed.json").exists())

    def test_ram_tiers_keep_same_machine(self):
        torch = SimpleNamespace(bfloat16="bf16")
        self.assertEqual([x["offload_device"] for x in h3_engine.model_config(160, torch)], ["cpu"] * 3)
        self.assertEqual([x["offload_device"] for x in h3_engine.model_config(100, torch)], ["cpu", "disk", "cpu"])
        self.assertEqual([x["offload_device"] for x in h3_engine.model_config(60, torch)], ["disk"] * 3)

    def test_google_and_sessions_are_isolated(self):
        helper, state = bridge.initialize()
        import colab_cli.auth
        self.assertEqual(Path(colab_cli.auth.TOKEN_CONFIG_PATH).parent, bridge.ROOT)
        self.assertEqual(Path(state.store.path).parent, bridge.ROOT)
        self.assertFalse(helper._has_valid_token())


if __name__ == "__main__": unittest.main()
