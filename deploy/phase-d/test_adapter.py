import importlib.util, json, os
P=os.path.join(os.path.dirname(__file__),"win-cua-mcp.py")
s=importlib.util.spec_from_file_location("adapter",P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def test_handshake_mac():
 secret=bytes.fromhex("11"*32); raw=json.loads(m.handshake(secret)); assert raw["version"]==1; assert len(raw["mac"])==64
def test_loopback_port(): assert m.PORT==18765
