import contextlib
import importlib.util
import io
import json
import os

P = os.path.join(os.path.dirname(__file__), "win-cua-mcp.py")
spec = importlib.util.spec_from_file_location("adapter", P)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def test_handshake_mac():
    secret = bytes.fromhex("11" * 32)
    raw = json.loads(adapter.handshake(secret))
    assert raw["version"] == 1
    assert len(raw["mac"]) == 64


def test_loopback_port():
    assert adapter.PORT == 18765


def test_manifest_satisfies_hermes_runtime_contract():
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        adapter.manifest()
    manifest = json.loads(output.getvalue())
    assert manifest["binary_version"] == "0.23.2"
    assert manifest["mcp_invocation"]["args"] == ["mcp"]

    advertised = {
        command["name"]: {argument["name"] for argument in command["args"]}
        for command in manifest["subcommands"]
    }
    assert {"--socket", "--grant"} <= advertised["mcp"]
    assert {
        "--socket",
        "--permission-mode",
        "--capability-manifest",
        "--approve-capability-manifest",
        "--embedded",
    } <= advertised["serve"]
    assert {"--socket"} <= advertised["stop"]
