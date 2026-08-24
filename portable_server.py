import socket
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

from main import app, BASE_DIR

APP_DIR = Path(__file__).resolve().parent
LOG_PATH = APP_DIR / "SigmaSightExtra-startup.log"


def log(message):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"[{timestamp}] {message}\n")


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class LocalServer(uvicorn.Server):
    def install_signal_handlers(self):
        return None


def wait_for_server(url, timeout=90):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return True, None
        except Exception as exc:
            last_error = exc
            time.sleep(0.5)
    return False, last_error


def check_files():
    required = ["index.html", "defects.html", "us.svg", "vendor/chart.umd.min.js"]
    missing = [name for name in required if not (BASE_DIR / name).exists()]
    if missing:
        raise RuntimeError("Missing files: " + ", ".join(missing) + f". BASE_DIR={BASE_DIR}")


def main():
    try:
        LOG_PATH.write_text("", encoding="utf-8")
        log(f"App folder: {APP_DIR}")
        log(f"Bundled app folder: {BASE_DIR}")
        check_files()

        port = find_free_port()
        url = f"http://127.0.0.1:{port}/"
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None, access_log=False)
        server = LocalServer(config)
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()

        ready, error = wait_for_server(url)
        if not ready:
            raise RuntimeError(str(error) if error else "No response from local server")

        log(f"Opening browser at {url}")
        webbrowser.open(url)
        print("SigmaSightExtra is running offline.")
        print(f"Dashboard: {url}")
        print("Keep this window open. Close it or press Ctrl+C when finished.")
        while thread.is_alive():
            time.sleep(1)
    except KeyboardInterrupt:
        print("Stopping SigmaSightExtra...")
    except Exception as exc:
        log("Startup failed:")
        log(traceback.format_exc())
        print("SigmaSightExtra could not start.")
        print(f"Reason: {exc}")
        print(f"Log file: {LOG_PATH}")
        input("Press Enter to close...")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
