"""Small bounded HTTPS transport; no cookies, ambient proxies or redirects."""

from dataclasses import dataclass
import http.client
import ssl
import time
import urllib.error
import urllib.request


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: dict[str, str]
    body: bytes


class TransportError(Exception):
    """Deliberately omits URLs, credentials and upstream response contents."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class UrllibTransport:
    def __init__(self):
        self._opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPSHandler(context=ssl.create_default_context()),
            NoRedirect(),
        )

    def request(self, *, method, url, headers, body, timeout_seconds, max_bytes):
        # The caller admits only fixed API URLs or explicit provider storage hosts.
        # A new request carries exactly its headers: bearer credentials never go
        # to storage. Socket timeout plus elapsed checks bound the read loop.
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        started = time.monotonic()
        try:
            try:
                response = self._opener.open(request, timeout=timeout_seconds)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                content_length = response.headers.get("Content-Length")
                if content_length is not None:
                    try:
                        if int(content_length) < 0 or int(content_length) > max_bytes:
                            raise TransportError("response_too_large")
                    except ValueError:
                        raise TransportError("invalid_content_length") from None
                chunks, size = [], 0
                while True:
                    if time.monotonic() - started >= timeout_seconds:
                        raise TransportError("request_timeout")
                    reader = getattr(response, "read1", response.read)
                    chunk = reader(min(65536, max_bytes + 1 - size))
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_bytes:
                        raise TransportError("response_too_large")
                    chunks.append(chunk)
                if time.monotonic() - started >= timeout_seconds:
                    raise TransportError("request_timeout")
                if content_length is not None and size != int(content_length):
                    raise TransportError("incomplete_response")
                return HttpResponse(response.status, dict(response.headers.items()), b"".join(chunks))
        except TransportError:
            raise
        except (OSError, urllib.error.URLError, http.client.HTTPException, ValueError):
            raise TransportError("request_failed") from None
