"""Native urllib checks against loopback only; no YouCam requests or live keys."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from provider.transport import TransportError, UrllibTransport


class Handler(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *_):
        pass

    def do_GET(self):
        self.__class__.calls.append(self.path)
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/must-not-fetch")
            self.end_headers()
        elif self.path == "/large-length":
            self.send_response(200)
            self.send_header("Content-Length", "1000000")
            self.end_headers()
        elif self.path == "/large-body":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"x" * 1024)
        elif self.path == "/truncated":
            self.send_response(200)
            self.send_header("Content-Length", "50")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        elif self.path == "/error":
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":401}')
        else:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')


class NativeTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self):
        Handler.calls = []
        self.transport = UrllibTransport()

    def request(self, path, limit=100):
        return self.transport.request(method="GET", url=self.base + path, headers={}, body=None,
                                      timeout_seconds=2, max_bytes=limit)

    def test_real_urllib_never_follows_redirect(self):
        response = self.request("/redirect")
        self.assertEqual(response.status, 302)
        self.assertEqual(Handler.calls, ["/redirect"])

    def test_declared_and_streamed_response_limits(self):
        for path in ("/large-length", "/large-body"):
            with self.subTest(path=path), self.assertRaises(TransportError):
                self.request(path)

    def test_http_failure_keeps_status_and_bounded_body(self):
        response = self.request("/error")
        self.assertEqual(response.status, 401)
        self.assertEqual(response.body, b'{"status":401}')

    def test_truncated_http_body_is_an_uncertain_transport_failure(self):
        with self.assertRaises(TransportError):
            self.request("/truncated")

    def test_success_uses_native_transport(self):
        response = self.request("/ok")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.body, b'{"ok":true}')


if __name__ == "__main__":
    unittest.main(verbosity=2)
