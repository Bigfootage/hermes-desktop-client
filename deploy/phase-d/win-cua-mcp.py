#!/usr/bin/env python3
"""Hermes stdio adapter for the loopback-only Windows Cua bridge."""
import hashlib, hmac, json, os, secrets, socket, sys, threading, time
import yaml
PORT=18765
CONTEXT=b"hermes-desktop/phase-d-bridge/v1"

def api_key():
    value=os.environ.get("HERMES_API_KEY","").strip()
    if value: return value
    home=os.environ.get("HERMES_HOME",os.path.expanduser("~/.hermes"))
    path=os.path.join(home,"config.yaml")
    with open(path,encoding="utf-8") as stream:
        value=str((yaml.safe_load(stream) or {}).get("API_SERVER_KEY","")).strip()
    if not value: raise RuntimeError("Hermes API key is not configured")
    return value

def bridge_secret():
    value=api_key().encode()
    return hmac.new(value,CONTEXT,hashlib.sha256).digest()

def manifest():
    exe=os.environ.get("HERMES_WIN_CUA_ADAPTER","/opt/hermes/bin/win-cua-mcp")
    print(json.dumps({
        "schema_version":"1",
        "binary_version":"0.23.2",
        "mcp_invocation":{"command":exe,"args":["mcp"]},
        "subcommands":[
            {"name":"mcp","args":[{"name":"--socket"},{"name":"--grant"}]},
            {"name":"serve","args":[{"name":"--socket"},{"name":"--permission-mode"},{"name":"--capability-manifest"},{"name":"--approve-capability-manifest"},{"name":"--embedded"}]},
            {"name":"stop","args":[{"name":"--socket"}]}
        ]
    }))

def handshake(secret:bytes):
    fields={"version":1,"device_id":os.environ.get("HERMES_PHASE_D_DEVICE_ID","windows"),"timestamp":int(time.time()*1000),"nonce":secrets.token_hex(24),"adapter_pid":os.getpid()}
    canonical="\n".join(str(fields[k]) for k in ("version","device_id","timestamp","nonce","adapter_pid"))
    fields["mac"]=hmac.new(secret,canonical.encode(),hashlib.sha256).hexdigest()
    return (json.dumps(fields,separators=(",",":"))+"\n").encode()

def copy_stream(src, dst, name):
    """Copy data from src to dst, blocking I/O."""
    try:
        while True:
            data = src.recv(65536) if hasattr(src, 'recv') else os.read(src.fileno(), 65536)
            if not data:
                break
            if hasattr(dst, 'sendall'):
                dst.sendall(data)
            else:
                os.write(dst.fileno(), data)
    except (BrokenPipeError, ConnectionResetError, OSError):
        pass

def run():
    secret=bridge_secret()
    s=socket.create_connection(("127.0.0.1",PORT),timeout=10)
    s.sendall(handshake(secret))
    response=b""
    while not response.endswith(b"\n") and len(response)<64:
        chunk = s.recv(64-len(response))
        if not chunk:
            raise RuntimeError("bridge closed during handshake")
        response += chunk
    if response!=b"OK\n":
        raise RuntimeError(f"bridge authentication failed: {response!r}")

    # Bidirectional copy using threads (simple, reliable with blocking I/O)
    t1 = threading.Thread(target=copy_stream, args=(sys.stdin.buffer, s, "stdin->socket"), daemon=True)
    t2 = threading.Thread(target=copy_stream, args=(s, sys.stdout.buffer, "socket->stdout"), daemon=True)
    t1.start()
    t2.start()
    t1.join()
    # When stdin closes, shutdown the write side and wait for socket to drain
    try:
        s.shutdown(socket.SHUT_WR)
    except OSError:
        pass
    t2.join(timeout=5)
    s.close()

if __name__=="__main__":
    if len(sys.argv)>1 and sys.argv[1]=="manifest":manifest()
    elif len(sys.argv)>1 and sys.argv[1]=="mcp":run()
    else: raise SystemExit("usage: win-cua-mcp manifest|mcp")