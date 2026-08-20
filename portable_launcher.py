import socket
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from pathlib import Path
import tkinter as tk
from tkinter import messagebox

import uvicorn

from main import app, BASE_DIR


def app_folder():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


LOG_PATH = app_folder() / "SigmaSightExtra-startup.log"


def log(message):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    try:
        with LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class LocalServer(uvicorn.Server):
    def install_signal_handlers(self):
        return None


class ServerThread(threading.Thread):
    def __init__(self, port):
        super().__init__(daemon=True)
        self.port = port
        self.server = None
        self.error = None

    def run(self):
        try:
            log(f"Starting local server on 127.0.0.1:{self.port}")
            config = uvicorn.Config(
                app,
                host="127.0.0.1",
                port=self.port,
                log_level="warning",
                access_log=False,
            )
            self.server = LocalServer(config)
            self.server.run()
            log("Local server stopped.")
        except Exception as exc:
            self.error = exc
            log("Server startup failed:")
            log(traceback.format_exc())

    def stop(self):
        if self.server:
            self.server.should_exit = True


def wait_for_server(url, server, timeout=90):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        if server.error:
            return False, server.error
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return True, None
        except Exception as exc:
            last_error = exc
            time.sleep(0.5)
    return False, last_error


def check_bundled_files():
    required = ["index.html", "defects.html", "us.svg", "vendor/chart.umd.min.js"]
    missing = [name for name in required if not (BASE_DIR / name).exists()]
    if missing:
        raise RuntimeError(
            "Missing bundled app files: " + ", ".join(missing) + f". BASE_DIR={BASE_DIR}"
        )


def main():
    try:
        LOG_PATH.write_text("", encoding="utf-8")
    except Exception:
        pass

    try:
        log(f"Executable folder: {app_folder()}")
        log(f"Bundled app folder: {BASE_DIR}")
        check_bundled_files()

        port = find_free_port()
        url = f"http://127.0.0.1:{port}/"
        server = ServerThread(port)
        server.start()

        ready, error = wait_for_server(url, server)
        if not ready:
            detail = str(error) if error else "No response from local server."
            log(f"Startup wait failed: {detail}")
            messagebox.showerror(
                "SigmaSightExtra",
                "SigmaSightExtra could not start.\n\n"
                f"Reason: {detail}\n\n"
                f"A log file was created here:\n{LOG_PATH}",
            )
            return

        log(f"Opening browser at {url}")
        webbrowser.open(url)

        root = tk.Tk()
        root.title("SigmaSightExtra Portable")
        root.geometry("460x190")
        root.resizable(False, False)

        label = tk.Label(
            root,
            text="SigmaSightExtra is running offline on this computer.",
            font=("Segoe UI", 11, "bold"),
            pady=12,
        )
        label.pack()

        url_label = tk.Label(root, text=url, font=("Segoe UI", 10), fg="#0f766e")
        url_label.pack()

        note = tk.Label(
            root,
            text="Keep this window open while using the dashboard.\nClose it when you are finished.",
            font=("Segoe UI", 9),
            pady=10,
        )
        note.pack()

        def close_app():
            log("User stopped SigmaSightExtra.")
            server.stop()
            root.destroy()

        button = tk.Button(root, text="Stop SigmaSightExtra", command=close_app, width=22)
        button.pack(pady=4)
        root.protocol("WM_DELETE_WINDOW", close_app)
        root.mainloop()
    except Exception as exc:
        log("Launcher failed:")
        log(traceback.format_exc())
        messagebox.showerror(
            "SigmaSightExtra",
            "SigmaSightExtra could not start.\n\n"
            f"Reason: {exc}\n\n"
            f"A log file was created here:\n{LOG_PATH}",
        )


if __name__ == "__main__":
    main()
