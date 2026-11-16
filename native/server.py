#!/usr/bin/env python3
"""Loopback-only, single-session bridge to the patched llama.cpp runner."""
import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import threading
import uuid

ROOT = Path(__file__).resolve().parents[1]


def serve(model, port):
    runner = ROOT / "build/attention-runner"
    process = subprocess.Popen([str(runner), str(Path(model).resolve())], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
    lock = threading.Lock()
    session = None

    def exchange(request):
        if process.poll() is not None:
            raise RuntimeError("model runner exited; restart the server")
        process.stdin.write(json.dumps(request) + "\n")
        process.stdin.flush()
        response = process.stdout.readline()
        if not response:
            raise RuntimeError("model runner closed; inspect the server log")
        result = json.loads(response)
        if "error" in result:
            raise ValueError(result["error"])
        return result

    ready = json.loads(process.stdout.readline())
    if not ready.get("ready"):
        raise RuntimeError("model failed to load")

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT / "dist"), **kwargs)

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/api/health":
                return self.reply(200, {**ready, "ready": process.poll() is None,
                                        "model": Path(model).name, "mechanism": "pre-softmax key-position bias"})
            if self.path == "/":
                self.send_response(302)
                self.send_header("Location", "/index.html?local=true")
                self.end_headers()
                return
            super().do_GET()

        def do_POST(self):
            nonlocal session
            # Same-origin browser calls only. No remote bind or wildcard CORS.
            allowed = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
            origin = self.headers.get("Origin")
            if origin and origin not in allowed:
                return self.reply(403, {"error": "use the demo on the local server"})
            try:
                size = int(self.headers.get("Content-Length", 0))
                if not 0 < size <= 65536:
                    raise ValueError("request must be 1..65536 bytes")
                body = json.loads(self.rfile.read(size))
                with lock:
                    if self.path == "/api/init":
                        session = None
                        result = exchange({"op": "init", "prompt": body["prompt"]})
                        session = uuid.uuid4().hex
                        result["session"] = session
                    elif self.path == "/api/step":
                        if not session or body.get("session") != session:
                            return self.reply(409, {"error": "session changed; load the prompt again"})
                        result = exchange({"op": "step", "bias": body.get("bias", [])})
                    else:
                        return self.reply(404, {"error": "unknown endpoint"})
                self.reply(200, result)
            except (ValueError, KeyError, TypeError) as error:
                self.reply(400, {"error": str(error)})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as error:
                self.reply(500, {"error": str(error)})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Local attention demo: http://127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        process.terminate()
        process.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--port", type=int, default=8088)
    args = parser.parse_args()
    serve(args.model, args.port)
