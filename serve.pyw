# LexiMind local server. Started by LexiMind.bat; runs without a window.
# Serves this folder to this computer only (127.0.0.1) on LexiMind's own port, 8321.
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8321
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    # No console exists when run windowless, so the default request logging would crash every request.
    def log_message(self, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    # On Windows the default lets two programs listen on the same port, and then either may answer.
    # Refuse to share, so this port only ever serves LexiMind.
    allow_reuse_address = False


try:
    Server(("127.0.0.1", PORT), Handler).serve_forever()
except OSError:
    pass  # the port is taken: LexiMind is already running, nothing to do
