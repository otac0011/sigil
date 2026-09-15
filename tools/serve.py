"""Local dev server for Sigil: serves the repo root with correct MIME types and no caching.

Windows' registry often maps .js to text/plain, and browsers refuse to run ES modules served that
way, so this handler pins the types the site uses.

Usage:  python tools/serve.py [port]      (default port 8137)
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".html": "text/html",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".md": "text/markdown",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Sigil dev server: http://localhost:{port}/  (root {ROOT})", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
