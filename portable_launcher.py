import socket
import threading
import time
import urllib.request
import webbrowser
import tkinter as tk
from tkinter import messagebox

import uvicorn

from main import app


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class ServerThread(threading.Thread):
    def __init__(self, port):
        super().__init__(daemon=True)
        self.port = port
        self.server = None

    def run(self):
        config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=self.port,
            log_level="warning",
            access_log=False,
        )
        self.server = uvicorn.Server(config)
        self.server.run()

    def stop(self):
        if self.server:
            self.server.should_exit = True


def wait_for_server(url, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1):
                return True
        except Exception:
            time.sleep(0.2)
    return False


def main():
    port = find_free_port()
    url = f"http://127.0.0.1:{port}/"
    server = ServerThread(port)
    server.start()

    if not wait_for_server(url):
        messagebox.showerror("SigmaSightExtra", "SigmaSightExtra could not start.")
        return

    webbrowser.open(url)

    root = tk.Tk()
    root.title("SigmaSightExtra Portable")
    root.geometry("420x170")
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
        server.stop()
        root.destroy()

    button = tk.Button(root, text="Stop SigmaSightExtra", command=close_app, width=22)
    button.pack(pady=4)
    root.protocol("WM_DELETE_WINDOW", close_app)
    root.mainloop()


if __name__ == "__main__":
    main()
