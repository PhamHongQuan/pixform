"""Health-check endpoint (Vercel Python serverless function).

Image conversion happens entirely in the browser; this function never
receives or stores user files.
"""

import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(
            {
                "status": "ok",
                "service": "pixform",
                "processing": "client-side",
                "storage": "none",
                "time": datetime.now(timezone.utc).isoformat(),
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
