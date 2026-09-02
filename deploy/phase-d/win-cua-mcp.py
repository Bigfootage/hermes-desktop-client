#!/usr/bin/env python3
"""Hermes stdio adapter for the loopback-only Windows Cua bridge."""
import hashlib, hmac, json, os, secrets, selectors, socket, sys, time
PORT=18765
MAX_BUFFER=1024*1024

def manifest():
    exe=os.environ.get("HERMES_WIN_CUA_ADAPTER","/opt/hermes/bin/win-cua-mcp")
    print(json.dumps({"schema_version":"1","mcp_invocation":{"command":exe,"args":["mcp"]}}))

def handshake(secret:bytes):
    fields={"version":1,"device_id":os.environ.get("HERMES_PHASE_D_DEVICE_ID","windows"),"timestamp":int(time.time()*1000),"nonce":secrets.token_hex(24),"adapter_pid":os.getpid()}
    canonical="\n".join(str(fields[k]) for k in ("version","device_id","timestamp","nonce","adapter_pid"))
    fields["mac"]=hmac.new(secret,canonical.encode(),hashlib.sha256).hexdigest()
    return (json.dumps(fields,separators=(",",":"))+"\n").encode()

def run():
    path=os.environ.get("HERMES_PHASE_D_SECRET_FILE","/etc/hermes/phase-d.secret")
    secret=bytes.fromhex(open(path,encoding="ascii").read().strip())
    s=socket.create_connection(("127.0.0.1",PORT),timeout=10);s.sendall(handshake(secret))
    response=b""
    while not response.endswith(b"\n") and len(response)<64: response+=s.recv(64-len(response))
    if response!=b"OK\n": raise RuntimeError("bridge authentication failed")
    s.setblocking(False);sel=selectors.DefaultSelector();sel.register(s,selectors.EVENT_READ,"socket");sel.register(sys.stdin.buffer,selectors.EVENT_READ,"stdin")
    while True:
        for key,_ in sel.select(timeout=60):
            if key.data=="stdin":
                data=os.read(sys.stdin.fileno(),65536)
                if not data: s.shutdown(socket.SHUT_WR);sel.unregister(sys.stdin.buffer)
                else: s.sendall(data)
            else:
                data=s.recv(65536)
                if not data:return
                os.write(sys.stdout.fileno(),data)

if __name__=="__main__":
    if len(sys.argv)>1 and sys.argv[1]=="manifest":manifest()
    elif len(sys.argv)>1 and sys.argv[1]=="mcp":run()
    else: raise SystemExit("usage: win-cua-mcp manifest|mcp")
