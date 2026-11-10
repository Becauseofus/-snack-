# -*- coding: utf-8 -*-
"""贪吃蛇安装向导。

由 build_installer.py 打成单文件安装包。安装包里带上 贪吃蛇.exe，
向导只负责复制到用户选的目录，并创建开始菜单 / 桌面快捷方式。
"""
import os
import shutil
import subprocess
import sys
import tkinter as tk
from tkinter import filedialog, messagebox

APP_NAME = "贪吃蛇"
APP_VERSION = "2.0.0"

try:
    import ctypes
    if os.name == "nt":
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            try:
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass
except Exception:
    ctypes = None


def resource_path(name):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


def default_install_dir():
    return os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Programs", "SnakeGame")


def work_origin():
    if ctypes is None or os.name != "nt":
        return None
    try:
        class RECT(ctypes.Structure):
            _fields_ = [
                ("left", ctypes.c_long),
                ("top", ctypes.c_long),
                ("right", ctypes.c_long),
                ("bottom", ctypes.c_long),
            ]

        rect = RECT()
        ok = ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0)
        if ok:
            return rect.right - rect.left, rect.bottom - rect.top, rect.left, rect.top
    except Exception:
        return None
    return None


def create_shortcut(target, link_path, workdir):
    ps = (
        "$ws=New-Object -ComObject WScript.Shell; "
        f'$sc=$ws.CreateShortcut("{link_path}"); '
        f'$sc.TargetPath="{target}"; '
        f'$sc.WorkingDirectory="{workdir}"; '
        f'$sc.Description="{APP_NAME}"; '
        "$sc.Save()"
    )
    kwargs = {}
    if os.name == "nt":
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=False, **kwargs)


def do_install(dest_dir, add_desktop=True):
    src = resource_path("贪吃蛇.exe")
    if not os.path.isfile(src):
        raise FileNotFoundError("安装包内缺少 贪吃蛇.exe。请先运行 build_installer.py。")
    dest_dir = os.path.abspath((dest_dir or "").strip())
    if not dest_dir:
        raise ValueError("安装路径不能为空")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, "贪吃蛇.exe")
    shutil.copy2(src, dest)
    sm = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "Microsoft", "Windows", "Start Menu", "Programs")
    os.makedirs(sm, exist_ok=True)
    create_shortcut(dest, os.path.join(sm, f"{APP_NAME}.lnk"), dest_dir)
    if add_desktop:
        desks = {
            os.path.join(os.path.expanduser("~"), "Desktop"),
            os.path.join(os.environ.get("USERPROFILE", ""), "Desktop"),
            os.path.join(os.environ.get("PUBLIC", ""), "Desktop"),
        }
        for folder in desks:
            if folder and os.path.isdir(folder):
                create_shortcut(dest, os.path.join(folder, f"{APP_NAME}.lnk"), dest_dir)
    return dest


class SetupUI:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title(f"{APP_NAME} 安装向导")
        self.root.configure(bg="#f6f3fb")
        self.root.resizable(False, False)
        width, height = 560, 340
        area = work_origin()
        if area:
            ww, wh, wx, wy = area
        else:
            ww, wh, wx, wy = self.root.winfo_screenwidth(), self.root.winfo_screenheight(), 0, 0
        width = min(width, max(420, ww - 40))
        height = min(height, max(300, wh - 40))
        self.root.geometry(f"{width}x{height}+{wx + (ww - width) // 2}+{wy + (wh - height) // 2}")

        tk.Label(
            self.root, text=f"安装 {APP_NAME}",
            font=("Microsoft YaHei UI", 16, "bold"),
            bg="#f6f3fb", fg="#241433",
        ).pack(anchor="w", padx=28, pady=(22, 0))
        tk.Label(
            self.root,
            text=f"版本 {APP_VERSION}    动漫风桌面贪吃蛇，可自选安装文件夹",
            font=("Microsoft YaHei UI", 9),
            bg="#f6f3fb", fg="#6d6480",
        ).pack(anchor="w", padx=28, pady=(2, 12))

        path_frame = tk.Frame(self.root, bg="#f6f3fb")
        path_frame.pack(fill="x", padx=28)
        tk.Label(path_frame, text="安装路径", font=("Microsoft YaHei UI", 10), bg="#f6f3fb", fg="#241433").pack(anchor="w")
        row = tk.Frame(path_frame, bg="#f6f3fb")
        row.pack(fill="x", pady=(4, 0))
        self.path_var = tk.StringVar(value=default_install_dir())
        entry = tk.Entry(row, textvariable=self.path_var, font=("Microsoft YaHei UI", 10))
        entry.pack(side="left", fill="x", expand=True, ipady=3)
        tk.Button(row, text="浏览…", width=8, command=self.browse).pack(side="left", padx=(8, 0))

        self.desk = tk.BooleanVar(value=True)
        tk.Checkbutton(
            self.root, text="在桌面创建快捷方式（开始菜单总会创建）",
            variable=self.desk, font=("Microsoft YaHei UI", 10),
            bg="#f6f3fb", activebackground="#f6f3fb", fg="#241433",
        ).pack(anchor="w", padx=26, pady=(14, 4))
        tk.Label(
            self.root,
            text="默认在 %LOCALAPPDATA%\\Programs\\SnakeGame。装到 Program Files 可能需要管理员权限。",
            font=("Microsoft YaHei UI", 8), fg="#6d6480", bg="#f6f3fb",
            wraplength=500, justify="left",
        ).pack(anchor="w", padx=28)

        btns = tk.Frame(self.root, bg="#f6f3fb")
        btns.pack(pady=18)
        tk.Button(
            btns, text="安装", width=12, command=self.install,
            bg="#ff7eb6", fg="white", activebackground="#ff9ec8",
            relief="flat", font=("Microsoft YaHei UI", 10, "bold"),
        ).pack(side="left", padx=8)
        tk.Button(btns, text="取消", width=12, command=self.root.destroy).pack(side="left", padx=8)

    def browse(self):
        initial = self.path_var.get().strip() or default_install_dir()
        if not os.path.isdir(initial):
            initial = os.path.dirname(initial) or os.path.expanduser("~")
        chosen = filedialog.askdirectory(title="选择安装文件夹", initialdir=initial, mustexist=False)
        if chosen:
            self.path_var.set(chosen)

    def install(self):
        dest_dir = self.path_var.get().strip()
        dest = os.path.join(os.path.abspath(dest_dir), "贪吃蛇.exe") if dest_dir else ""
        if dest and os.path.isfile(dest):
            if not messagebox.askyesno(APP_NAME, f"该位置已有游戏，要覆盖吗？\n\n{dest}"):
                return
        try:
            path = do_install(dest_dir, self.desk.get())
        except Exception as exc:
            messagebox.showerror("安装失败", str(exc))
            return
        if messagebox.askyesno(APP_NAME, f"安装完成。\n\n{path}\n\n现在启动吗？"):
            subprocess.Popen([path], cwd=os.path.dirname(path))
        self.root.destroy()

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    SetupUI().run()
