# -*- coding: utf-8 -*-
"""贪吃蛇 — 动漫风桌面版。

窗口策略（请保留）：
- 不用 overrideredirect。无边框靠 Win32 去掉标题栏，并强制 WS_EX_APPWINDOW，
  这样任务栏仍有按钮。
- 布局用工作区（不含任务栏）和 DPI，控件不会被挤出屏幕。
"""
from __future__ import annotations

import datetime
import json
import math
import os
import random
import struct
import time
import tkinter as tk
import tkinter.font as tkfont
from tkinter import messagebox

try:
    import ctypes
except Exception:  # pragma: no cover
    ctypes = None

APP_NAME = "贪吃蛇"
APP_VERSION = "2.0.0"
HISTORY_MAX = 10

# speed slider 1..10 → 步进间隔（毫秒）。数字越小越快。
SPEED_SLOW_MS, SPEED_FAST_MS = 160, 45

RES_PRESETS = [
    ("1280×720 (720p)", 1280, 720),
    ("1600×900", 1600, 900),
    ("1920×1080 (1080p)", 1920, 1080),
    ("1920×1200", 1920, 1200),
    ("2560×1440 (2K)", 2560, 1440),
    ("2560×1600", 2560, 1600),
    ("3840×2160 (4K)", 3840, 2160),
]

MODES = ("classic", "zen", "challenge")
MODE_NAME = {"classic": "经典", "zen": "禅意", "challenge": "挑战"}
MODE_BLURB = {
    "classic": "撞墙结束，速度完全由滑条决定",
    "zen": "穿墙环绕，节奏更从容",
    "challenge": "撞墙结束，越吃越快，特殊果更多",
}

BG = "#140c24"
FIELD_TOP = "#160a2e"
FIELD_BOT = "#3b1d78"
TEXT = "#fff6fb"
MUTED = "#cbbbe8"
ACCENT = "#ff7eb6"
ACCENT_SOFT = "#ff9ec8"
HEAD = "#8dffc6"
HEAD_HI = "#f3fff8"
BODY_A = "#6cf0b4"
BODY_B = "#1c8f62"
OUTLINE = "#10241c"
GOLD = "#ffd56a"
CYAN = "#7eecff"
VIOLET = "#c9a6ff"
BERRY = "#ff6b9d"
PANEL = "#120818"
FRAME = "#8b7cff"
BTN = "#3a2a70"
BTN_HOVER = "#4e3a8c"

PAD_X = 16
PAD_TOP = 8
PAD_MID = 6
PAD_BOT = 10

DIR_KEYS = {
    "up": (0, -1), "w": (0, -1),
    "down": (0, 1), "s": (0, 1),
    "left": (-1, 0), "a": (-1, 0),
    "right": (1, 0), "d": (1, 0),
}

FOOD_SCORE = {"berry": 10, "star": 30, "slow": 5, "mult": 5}
FOOD_LABEL = {"berry": "浆果", "star": "星果", "slow": "时砂", "mult": "莲灯"}


def _win32():
    if ctypes is None or os.name != "nt":
        return None
    try:
        return ctypes.windll
    except Exception:
        return None


def enable_dpi_awareness():
    windll = _win32()
    if not windll:
        return
    try:
        windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE
    except Exception:
        try:
            windll.user32.SetProcessDPIAware()
        except Exception:
            pass


enable_dpi_awareness()


def screen_size():
    """物理像素屏幕大小。非 Windows 返回 None，交给 Tk。"""
    windll = _win32()
    if not windll:
        return None
    try:
        user32 = windll.user32
        return int(user32.GetSystemMetrics(0)), int(user32.GetSystemMetrics(1))
    except Exception:
        return None


def work_area():
    """可用桌面（去掉任务栏），物理像素：(宽, 高, 左, 上)。"""
    windll = _win32()
    if not windll:
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
        ok = windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0)
        if ok:
            return rect.right - rect.left, rect.bottom - rect.top, rect.left, rect.top
    except Exception:
        pass
    return None


def dpi_scale():
    windll = _win32()
    if not windll:
        return 1.0
    try:
        return float(windll.user32.GetDpiForSystem()) / 96.0
    except Exception:
        try:
            dc = windll.user32.GetDC(0)
            dpi = windll.gdi32.GetDeviceCaps(dc, 88)  # LOGPIXELSX
            windll.user32.ReleaseDC(0, dc)
            return float(dpi) / 96.0
        except Exception:
            return 1.0


def win_hwnd(root):
    windll = _win32()
    if not windll:
        return None
    root.update_idletasks()
    hwnd = windll.user32.GetParent(root.winfo_id())
    return hwnd or root.winfo_id()


def ensure_taskbar(root):
    """强制 APPWINDOW，避免无边框窗口从任务栏消失。不要改成 overrideredirect。"""
    windll = _win32()
    if not windll:
        try:
            root.deiconify()
            root.lift()
        except Exception:
            pass
        return
    try:
        user32 = windll.user32
        hwnd = win_hwnd(root)
        GWL_EXSTYLE = -20
        WS_EX_APPWINDOW, WS_EX_TOOLWINDOW = 0x00040000, 0x00000080
        style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        style = (style & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW
        user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style)
        root.withdraw()
        root.update_idletasks()
        root.deiconify()
        root.lift()
        root.focus_force()
    except Exception:
        try:
            root.deiconify()
            root.lift()
        except Exception:
            pass


def set_native_borderless(root, enabled):
    """去掉/恢复标题栏，但保留任务栏按钮所需的扩展样式。"""
    windll = _win32()
    if not windll:
        try:
            root.overrideredirect(False)
        except Exception:
            pass
        return
    try:
        user32 = windll.user32
        hwnd = win_hwnd(root)
        GWL_STYLE = -16
        WS_CAPTION, WS_THICKFRAME = 0x00C00000, 0x00040000
        WS_MINIMIZEBOX, WS_MAXIMIZEBOX, WS_SYSMENU = 0x00020000, 0x00010000, 0x00080000
        style = user32.GetWindowLongW(hwnd, GWL_STYLE)
        if enabled:
            style &= ~(WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU)
        else:
            style |= WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX
            style &= ~WS_THICKFRAME
        user32.SetWindowLongW(hwnd, GWL_STYLE, style)
        # SWP_NOSIZE|NOMOVE|NOZORDER|FRAMECHANGED
        user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0020)
    except Exception:
        try:
            root.overrideredirect(False)
        except Exception:
            pass


def config_dir():
    if os.name == "nt":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
    else:
        base = os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config"))
    return os.path.join(base, "SnakeGame")


CONFIG_DIR = config_dir()
CONFIG_PATH = os.path.join(CONFIG_DIR, "settings.json")


def default_cfg():
    return {
        "preset": "2560×1600",
        "width": 2560,
        "height": 1600,
        "best": 0,
        "best_by_mode": {"classic": 0, "zen": 0, "challenge": 0},
        "history": [],
        "display": "window",
        "speed": 5,
        "mode": "classic",
        "sound": True,
    }


def sanitize_cfg(raw):
    d = default_cfg()
    if isinstance(raw, dict):
        d.update(raw)
    try:
        d["width"] = int(d.get("width", 1280))
        d["height"] = int(d.get("height", 720))
    except Exception:
        d["width"], d["height"] = 1280, 720
    if not (640 <= d["width"] <= 8000 and 480 <= d["height"] <= 8000):
        d["width"], d["height"] = 1280, 720
    try:
        d["speed"] = max(1, min(10, int(d.get("speed", 5))))
    except Exception:
        d["speed"] = 5
    try:
        d["best"] = max(0, int(d.get("best", 0)))
    except Exception:
        d["best"] = 0
    if d.get("display") not in ("window", "borderless", "fullscreen"):
        d["display"] = "window"
    if d.get("mode") not in MODES:
        d["mode"] = "classic"
    d["sound"] = bool(d.get("sound", True))
    modes = d.get("best_by_mode")
    clean_modes = {"classic": 0, "zen": 0, "challenge": 0}
    if isinstance(modes, dict):
        for key in clean_modes:
            try:
                clean_modes[key] = max(0, int(modes.get(key, 0)))
            except Exception:
                clean_modes[key] = 0
    d["best_by_mode"] = clean_modes
    hist = []
    if isinstance(d.get("history"), list):
        for item in d["history"]:
            if isinstance(item, dict):
                hist.append(item)
    d["history"] = hist[:HISTORY_MAX]
    names = {n for n, _, _ in RES_PRESETS}
    if d.get("preset") not in names and d.get("preset") != "适应屏幕":
        d["preset"] = "2560×1600"
    return d


def load_cfg():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return sanitize_cfg(json.load(f))
    except Exception:
        return sanitize_cfg(None)


def save_cfg(d):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(sanitize_cfg(d), f, ensure_ascii=False, indent=2)


def usable_presets(sw, sh):
    out = [(n, w, h) for n, w, h in RES_PRESETS if w <= sw and h <= sh]
    if out:
        return out
    return [("适应屏幕", min(1280, max(800, sw)), min(720, max(600, sh)))]


def mix_hex(a, b, t):
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    ai, bi = int(a[1:], 16), int(b[1:], 16)
    ar, ag, ab = (ai >> 16) & 255, (ai >> 8) & 255, ai & 255
    br, bg, bb = (bi >> 16) & 255, (bi >> 8) & 255, bi & 255
    r = int(ar + (br - ar) * t)
    g = int(ag + (bg - ag) * t)
    bl = int(ab + (bb - ab) * t)
    return f"#{r:02x}{g:02x}{bl:02x}"


def speed_to_ms(level):
    level = max(1, min(10, int(level)))
    t = (level - 1) / 9
    return int(SPEED_SLOW_MS + (SPEED_FAST_MS - SPEED_SLOW_MS) * t)


def fit_grid(avail_w, avail_h):
    """在可用像素里放下一张不溢出的场地。格子够大，蛇头才像角色而不是细线。"""
    avail_w = max(96, int(avail_w))
    avail_h = max(96, int(avail_h))
    cell = int(min(avail_w / 24, avail_h / 15))
    cell = max(18, min(cell, 64))
    cols = max(12, avail_w // cell)
    rows = max(10, avail_h // cell)
    if cols * cell > avail_w:
        cols = max(8, avail_w // cell)
    if rows * cell > avail_h:
        rows = max(8, avail_h // cell)
    cell = min(cell, avail_w // max(1, cols), avail_h // max(1, rows))
    cell = max(8, int(cell))
    cols = max(8, min(cols, avail_w // cell))
    rows = max(8, min(rows, avail_h // cell))
    return cols, rows, cell


def choose_font(root):
    families = set(tkfont.families(root))
    for name in (
        "Microsoft YaHei UI",
        "Microsoft YaHei",
        "PingFang SC",
        "Noto Sans CJK SC",
        "Source Han Sans SC",
        "WenQuanYi Micro Hei",
        "Droid Sans Fallback",
    ):
        if name in families:
            return name
    return "TkDefaultFont"


def _wav_bytes(samples, rate=22050):
    frames = bytearray()
    for s in samples:
        v = int(max(-1.0, min(1.0, s)) * 32767)
        frames += struct.pack("<h", v)
    data_size = len(frames)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        rate,
        rate * 2,
        2,
        16,
        b"data",
        data_size,
    )
    return header + bytes(frames)


def _tone(notes, vol=0.22, rate=22050):
    out = []
    for freq, length in notes:
        n = max(1, int(rate * length))
        for i in range(n):
            t = i / rate
            env = math.exp(-3.2 * t / max(0.04, length))
            s = math.sin(2 * math.pi * freq * t)
            s += 0.22 * math.sin(2 * math.pi * freq * 2 * t)
            out.append(s * env * vol)
    return out


class Sounds:
    """短促合成音。只有 Windows 的 winsound 能响；缺了就静音，不报错。"""

    def __init__(self):
        self.enabled = True
        self.available = False
        self._ws = None
        self._hold = None
        self._cache = {}
        try:
            import winsound
            self._ws = winsound
            self.available = True
        except Exception:
            return
        bank = {
            "eat": ([(660, 0.045), (880, 0.07)], 0.20),
            "star": ([(660, 0.04), (880, 0.04), (1180, 0.09)], 0.22),
            "slow": ([(520, 0.07), (390, 0.11)], 0.18),
            "mult": ([(700, 0.05), (1040, 0.09)], 0.20),
            "die": ([(420, 0.07), (300, 0.09), (196, 0.16)], 0.22),
            "start": ([(523, 0.05), (784, 0.09)], 0.18),
            "pause": ([(620, 0.035)], 0.12),
            "record": ([(784, 0.05), (988, 0.05), (1318, 0.12)], 0.22),
        }
        for name, (notes, vol) in bank.items():
            self._cache[name] = _wav_bytes(_tone(notes, vol=vol))

    def play(self, name):
        if not self.enabled or not self.available:
            return
        data = self._cache.get(name)
        if not data or self._ws is None:
            return
        self._hold = data  # SND_ASYNC 期间不能被回收
        try:
            self._ws.PlaySound(
                data,
                self._ws.SND_ASYNC | self._ws.SND_MEMORY | self._ws.SND_NODEFAULT,
            )
        except Exception:
            self.available = False


class SnakeWorld:
    """格子上的规则。画面插值由界面按 direction / pending_grow 来做。

    转向进队列，当前这一格走完才换方向，所以视觉上会贴着路口转弯，不会中途跳开。
    """

    def __init__(self, cols, rows, mode="classic", rng=None, allow_special=True):
        self.cols = cols
        self.rows = rows
        self.mode = mode if mode in MODES else "classic"
        self.rng = rng or random.Random()
        self.allow_special = allow_special
        self.reset()

    def reset(self):
        cx = min(self.cols - 2, max(4, self.cols // 3))
        cy = self.rows // 2
        self.snake = [(cx - i, cy) for i in range(5)]
        self.direction = (1, 0)
        self.queue = []
        self.score = 0
        self.eaten = 0
        self.alive = True
        self.won = False
        self.pending_grow = 0
        self.slow_left = 0.0
        self.mult = 1
        self.mult_left = 0
        self.berry = None
        self.special = None  # (x, y, kind, ttl)
        self.death_face = (1, 0)
        self.death_grow = False
        self._spawn_berry()
        self._maybe_special()

    def turn(self, dx, dy):
        if not self.alive or self.won:
            return False
        if (dx, dy) not in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            return False
        last = self.queue[-1] if self.queue else self.direction
        if (dx, dy) == last or (dx, dy) == (-last[0], -last[1]):
            return False
        if len(self.queue) >= 2:
            return False
        self.queue.append((dx, dy))
        return True

    def glance(self):
        """眼睛看的方向：下一笔已经接受的转向，否则是当前前进方向。"""
        if self.queue:
            return self.queue[0]
        return self.direction

    def motion(self):
        """当前这一格要走进去的格子。本格开始后方向已锁定，队列不影响它。"""
        dx, dy = self.direction
        hx, hy = self.snake[0]
        nx, ny = hx + dx, hy + dy
        outside = False
        if self.mode == "zen":
            nx %= self.cols
            ny %= self.rows
        else:
            outside = not (0 <= nx < self.cols and 0 <= ny < self.rows)
        will_eat = (not outside) and self._kind_at(nx, ny) is not None
        will_grow = (not outside) and (will_eat or self.pending_grow > 0)
        fatal = outside
        if not outside:
            tail_safe = (not will_grow) and len(self.snake) > 1
            body = self.snake[:-1] if tail_safe else self.snake
            if (nx, ny) in body:
                fatal = True
        return {
            "dir": (dx, dy),
            "nx": nx,
            "ny": ny,
            "outside": outside,
            "will_eat": will_eat,
            "will_grow": will_grow,
            "fatal": fatal,
        }

    def step(self):
        if not self.alive or self.won:
            return []
        m = self.motion()
        if m["fatal"]:
            self.alive = False
            self.death_face = m["dir"]
            self.death_grow = m["will_grow"]
            return [{"type": "die", "x": m["nx"], "y": m["ny"]}]
        nx, ny = m["nx"], m["ny"]
        kind = self._kind_at(nx, ny)
        self.snake.insert(0, (nx, ny))
        events = []
        if kind:
            self._award(kind, events, nx, ny)
            if kind == "star":
                self.pending_grow += 1
        elif self.pending_grow > 0:
            self.pending_grow -= 1
        else:
            self.snake.pop()
        self._consume_turn()
        if self.berry is None and not self.won:
            self._spawn_berry()
        if kind == "berry" and not self.won and self.special is None:
            self._maybe_special()
        if self.won:
            events.append({"type": "win"})
        return events

    def tick_time(self, dt):
        if not self.alive or self.won:
            return
        if self.slow_left > 0:
            self.slow_left = max(0.0, self.slow_left - dt)
        if self.special:
            x, y, kind, ttl = self.special
            ttl -= dt
            if ttl <= 0:
                self.special = None
            else:
                self.special = (x, y, kind, ttl)

    def _consume_turn(self):
        while self.queue:
            nd = self.queue.pop(0)
            if nd != self.direction and nd != (-self.direction[0], -self.direction[1]):
                self.direction = nd
                return

    def _kind_at(self, x, y):
        if self.berry and (self.berry[0], self.berry[1]) == (x, y):
            return "berry"
        if self.special and (self.special[0], self.special[1]) == (x, y):
            return self.special[2]
        return None

    def _award(self, kind, events, x, y):
        if kind == "berry":
            self.berry = None
        else:
            self.special = None
        base = FOOD_SCORE[kind]
        gained = base * self.mult
        self.score += gained
        self.eaten += 1
        if self.mult_left > 0:
            self.mult_left -= 1
            if self.mult_left <= 0:
                self.mult = 1
        if kind == "slow":
            self.slow_left = max(self.slow_left, 4.5)
        elif kind == "mult":
            self.mult = 2
            self.mult_left = 3
        events.append({"type": "eat", "kind": kind, "x": x, "y": y, "amount": gained})

    def _free_cells(self):
        taken = set(self.snake)
        if self.berry:
            taken.add((self.berry[0], self.berry[1]))
        if self.special:
            taken.add((self.special[0], self.special[1]))
        return [
            (x, y)
            for y in range(self.rows)
            for x in range(self.cols)
            if (x, y) not in taken
        ]

    def _front(self):
        hx, hy = self.snake[0]
        dx, dy = self.direction
        nx, ny = hx + dx, hy + dy
        if self.mode == "zen":
            nx %= self.cols
            ny %= self.rows
        return nx, ny

    def _pick_cell(self):
        cells = self._free_cells()
        if not cells:
            return None
        front = self._front()
        choices = [c for c in cells if c != front]
        return self.rng.choice(choices or cells)

    def _spawn_berry(self):
        cell = self._pick_cell()
        if cell is None:
            self.berry = None
            self.won = True
            return
        self.berry = cell

    def _maybe_special(self):
        if not self.allow_special or self.special is not None or self.won:
            return
        chance = {"classic": 0.22, "zen": 0.14, "challenge": 0.40}[self.mode]
        if self.rng.random() >= chance:
            return
        cell = self._pick_cell()
        if cell is None:
            return
        kind = self.rng.choices(["star", "slow", "mult"], weights=[4, 3, 3], k=1)[0]
        self.special = (cell[0], cell[1], kind, 9.0)


class FX:
    def __init__(self):
        self.particles = []
        self.popups = []

    def burst(self, x, y, color, n=12, speed=170, life=0.42):
        for _ in range(n):
            ang = random.random() * math.tau
            spd = speed * random.uniform(0.35, 1.0)
            self.particles.append({
                "x": x, "y": y,
                "vx": math.cos(ang) * spd,
                "vy": math.sin(ang) * spd,
                "life": life * random.uniform(0.75, 1.15),
                "age": 0.0,
                "r": random.uniform(1.6, 3.4),
                "vr": 0.0,
                "color": color,
                "kind": "dot",
            })

    def ring(self, x, y, color):
        self.particles.append({
            "x": x, "y": y, "vx": 0.0, "vy": 0.0,
            "life": 0.38, "age": 0.0, "r": 8.0, "vr": 110.0,
            "color": color, "kind": "ring",
        })

    def popup(self, x, y, text, color):
        self.popups.append({
            "x": x, "y": y - 8, "vy": -38.0,
            "text": text, "color": color,
            "age": 0.0, "life": 0.75,
        })
        if len(self.popups) > 6:
            self.popups = self.popups[-6:]

    def update(self, dt):
        alive = []
        for p in self.particles:
            p["age"] += dt
            if p["age"] >= p["life"]:
                continue
            p["x"] += p["vx"] * dt
            p["y"] += p["vy"] * dt
            if p["kind"] == "dot":
                p["vy"] += 30 * dt
            else:
                p["r"] += p["vr"] * dt
            alive.append(p)
        self.particles = alive[-220:]
        pops = []
        for p in self.popups:
            p["age"] += dt
            if p["age"] >= p["life"]:
                continue
            p["y"] += p["vy"] * dt
            pops.append(p)
        self.popups = pops

    def draw(self, canvas, ox, oy):
        for p in self.particles:
            k = 1.0 - p["age"] / max(0.001, p["life"])
            x, y = p["x"] + ox, p["y"] + oy
            if p["kind"] == "ring":
                r = p["r"]
                canvas.create_oval(x - r, y - r, x + r, y + r, outline=p["color"], width=2, tags="dyn")
            else:
                r = max(0.6, p["r"] * (0.45 + 0.55 * k))
                canvas.create_oval(x - r, y - r, x + r, y + r, fill=p["color"], outline="", tags="dyn")


def _dedupe(pts, min_d=1.2):
    if not pts:
        return []
    out = [pts[0]]
    for p in pts[1:]:
        if abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) >= min_d:
            out.append(p)
    return out


def _split_runs(pts, limit):
    if not pts:
        return []
    runs = [[pts[0]]]
    for p in pts[1:]:
        q = runs[-1][-1]
        if abs(p[0] - q[0]) > limit or abs(p[1] - q[1]) > limit:
            runs.append([p])
        else:
            runs[-1].append(p)
    return runs


def round_path(pts, radius):
    """把直角收成一小段圆弧，身子仍然贴着原来的格子，不会被样条甩出去。"""
    if len(pts) < 3 or radius <= 0:
        return list(pts)
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        v1 = (b[0] - a[0], b[1] - a[1])
        v2 = (c[0] - b[0], c[1] - b[1])
        l1 = math.hypot(*v1)
        l2 = math.hypot(*v2)
        if l1 < 1 or l2 < 1:
            out.append(b)
            continue
        dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)
        if dot > 0.82:
            out.append(b)
            continue
        r = min(radius, l1 * 0.46, l2 * 0.46)
        u1 = (v1[0] / l1, v1[1] / l1)
        u2 = (v2[0] / l2, v2[1] / l2)
        p1 = (b[0] - u1[0] * r, b[1] - u1[1] * r)
        p2 = (b[0] + u2[0] * r, b[1] + u2[1] * r)
        out.append(p1)
        for s in (0.35, 0.65):
            u = 1 - s
            out.append((
                u * u * p1[0] + 2 * u * s * b[0] + s * s * p2[0],
                u * u * p1[1] + 2 * u * s * b[1] + s * s * p2[1],
            ))
        out.append(p2)
    out.append(pts[-1])
    return out


def _round_points(x1, y1, x2, y2, r, n=5):
    r = max(2, min(r, (x2 - x1) / 2, (y2 - y1) / 2))
    centers = [
        (x2 - r, y1 + r, -math.pi / 2, 0),
        (x2 - r, y2 - r, 0, math.pi / 2),
        (x1 + r, y2 - r, math.pi / 2, math.pi),
        (x1 + r, y1 + r, math.pi, math.pi * 1.5),
    ]
    pts = []
    for cx, cy, a0, a1 in centers:
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            pts.extend((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def _star_points(cx, cy, r_out, r_in, rot=-math.pi / 2):
    pts = []
    for i in range(10):
        ang = rot + i * math.pi / 5
        r = r_out if i % 2 == 0 else r_in
        pts.extend((cx + math.cos(ang) * r, cy + math.sin(ang) * r))
    return pts


class SnakeApp:
    def __init__(self, root):
        self.root = root
        self.font_family = choose_font(root)
        root.title(APP_NAME)
        root.configure(bg=BG)
        self.sounds = Sounds()
        self.cfg = load_cfg()
        self.best = int(self.cfg["best"])
        self.best_by_mode = dict(self.cfg["best_by_mode"])
        self.history = list(self.cfg["history"])
        self.display_mode = self.cfg["display"]
        self.speed_level = int(self.cfg["speed"])
        self.mode = self.cfg["mode"]
        self.pending_mode = None
        self.sound = bool(self.cfg["sound"]) and self.sounds.available
        self.sounds.enabled = self.sound
        self.state = "menu"  # menu | playing | paused | dying | over
        self.help = False
        self.world = None
        self.cols, self.rows, self.cell = 20, 14, 32
        self._acc = 0.0
        self.progress = 0.0
        self.clock = 0.0
        self._last = time.perf_counter()
        self._running = True
        self._suspended = False
        self._recorded = False
        self.victory = False
        self.new_record = False
        self.new_mode_record = False
        self.result_score = 0
        self.result_len = 0
        self.result_mode = self.mode
        self.happy = 0.0
        self.shake = 0.0
        self._die_left = 0.0
        self.fx = FX()
        self._bg_key = None
        self._twinkles = []
        self._flash_gen = 0
        self._build_menu()
        self._build_widgets()
        self._screens = self._read_screens()
        self._ensure_preset()
        self.apply_display()
        self._sync_buttons()
        self._style_modes()
        self._sync_hud()
        self.draw()
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.root.bind("<KeyPress>", self.on_key)
        self.root.after(20, self.tick)
        self.root.after(80, self._settle_taskbar)

    # ----- window chrome -----

    def _read_screens(self):
        self.root.update_idletasks()
        sz = screen_size()
        if not sz:
            sz = (self.root.winfo_screenwidth(), self.root.winfo_screenheight())
        wa = work_area()
        if not wa:
            wa = (sz[0], sz[1], 0, 0)
        return {"screen": sz, "work": wa, "dpi": dpi_scale()}

    def _ensure_preset(self):
        sw, sh = self._screens["screen"]
        usable = usable_presets(sw, sh)
        names = {n for n, _, _ in usable}
        if self.cfg.get("preset") not in names:
            # 默认想要大图；当前屏幕装不下就取能用的最大档
            n, w, h = usable[-1]
            self.cfg.update({"preset": n, "width": w, "height": h})

    def _target_window(self):
        sw, sh = self._screens["screen"]
        ww, wh, wx, wy = self._screens["work"]
        if self.display_mode == "fullscreen":
            return sw, sh, 0, 0
        if self.display_mode == "borderless":
            # 无边框贴工作区，任务栏留在外面，仍然有任务栏按钮
            return ww, wh, wx, wy
        win_w = min(int(self.cfg["width"]), ww)
        win_h = min(int(self.cfg["height"]), wh)
        win_w = max(min(960, ww), min(win_w, ww))
        win_h = max(min(640, wh), min(win_h, wh))
        ox = wx + max(0, (ww - win_w) // 2)
        oy = wy + max(0, (wh - win_h) // 2)
        return win_w, win_h, ox, oy

    def _apply_window_style(self):
        try:
            self.root.overrideredirect(False)
        except Exception:
            pass
        try:
            self.root.attributes("-fullscreen", False)
        except Exception:
            pass
        set_native_borderless(self.root, False)
        win_w, win_h, ox, oy = self._target_window()
        if self.display_mode == "fullscreen":
            self.root.resizable(True, True)
            self.root.geometry(f"{win_w}x{win_h}+{ox}+{oy}")
            set_native_borderless(self.root, True)
            try:
                self.root.attributes("-fullscreen", True)
            except Exception:
                try:
                    self.root.state("zoomed")
                except Exception:
                    pass
        elif self.display_mode == "borderless":
            self.root.resizable(True, True)
            self.root.geometry(f"{win_w}x{win_h}+{ox}+{oy}")
            set_native_borderless(self.root, True)
        else:
            self.root.resizable(False, False)
            ww, wh, _, _ = self._screens["work"]
            self.root.maxsize(ww, wh)
            self.root.geometry(f"{win_w}x{win_h}+{ox}+{oy}")
        return win_w, win_h

    def apply_display(self):
        self._apply_window_style()
        self.layout_field()
        self.cfg["display"] = self.display_mode
        self._save()
        self.root.after(30, self._settle_taskbar)

    def _settle_taskbar(self):
        if not self._running:
            return
        ensure_taskbar(self.root)
        # withdraw/deiconify 可能把窗口位置打回原点，再写一次
        self._apply_window_style()
        self.layout_field()

    def layout_field(self):
        win_w, win_h, _, _ = self._target_window()
        self.hint.configure(wraplength=max(420, win_w - PAD_X * 2 - 8))
        self.speed_scale.configure(length=200 if win_w >= 1100 else 130)
        self.canvas.config(width=32, height=32)
        self.root.update_idletasks()
        chrome_h = self.root.winfo_reqheight() - self.canvas.winfo_reqheight()
        avail_w = max(120, win_w - PAD_X * 2)
        avail_h = max(120, win_h - max(chrome_h, 1))
        # 窗口模式如果预设比内容矮，把窗口长高到能放下，但不超过工作区
        if self.display_mode == "window":
            ww, wh, wx, wy = self._screens["work"]
            need_h = chrome_h + max(180, min(avail_h, 15 * 36))
            if win_h < chrome_h + 160 and wh > win_h:
                win_h = min(wh, max(win_h, chrome_h + 160))
                win_w = min(win_w, ww)
                ox = wx + max(0, (ww - win_w) // 2)
                oy = wy + max(0, (wh - win_h) // 2)
                self.root.geometry(f"{win_w}x{win_h}+{ox}+{oy}")
                avail_h = max(120, win_h - chrome_h)
        cols, rows, cell = fit_grid(avail_w, avail_h)
        # 再收缩，保证像素不超出可用区域
        while rows * cell > avail_h and rows > 8:
            rows -= 1
        while cols * cell > avail_w and cols > 8:
            cols -= 1
        self.cols, self.rows, self.cell = cols, rows, cell
        self.canvas.config(width=cols * cell, height=rows * cell)
        self._bg_key = None
        self._reconcile_world()
        self._sync_hud()

    def _reconcile_world(self):
        w = self.world
        if w is None:
            return
        fits = all(0 <= x < self.cols and 0 <= y < self.rows for x, y in w.snake)
        foods_ok = True
        if w.berry and not (0 <= w.berry[0] < self.cols and 0 <= w.berry[1] < self.rows):
            foods_ok = False
        if w.special and not (0 <= w.special[0] < self.cols and 0 <= w.special[1] < self.rows):
            foods_ok = False
        if fits and self.state in ("playing", "paused", "dying", "over"):
            w.cols, w.rows = self.cols, self.rows
            if not foods_ok:
                if w.berry and not (0 <= w.berry[0] < self.cols and 0 <= w.berry[1] < self.rows):
                    w.berry = None
                    if w.alive and not w.won:
                        w._spawn_berry()
                if w.special and not (0 <= w.special[0] < self.cols and 0 <= w.special[1] < self.rows):
                    w.special = None
            return
        if self.state != "menu":
            self.show_menu()
        else:
            self.world = None

    # ----- widgets -----

    def _build_menu(self):
        mb = tk.Menu(self.root, tearoff=0)
        m1 = tk.Menu(mb, tearoff=0)
        m1.add_command(label="分辨率…", command=self.open_res)
        m1.add_command(label="显示模式…", command=self.open_display)
        m1.add_command(label="历史最高分…", command=self.open_history)
        m1.add_separator()
        m1.add_command(label="退出", command=self.close)
        mb.add_cascade(label="设置", menu=m1)
        m2 = tk.Menu(mb, tearoff=0)
        m2.add_command(label="操作说明", command=self.toggle_help)
        m2.add_command(label="关于", command=self.open_about)
        mb.add_cascade(label="帮助", menu=m2)
        self.root.config(menu=mb)

    def _button(self, parent, text, command, primary=False):
        bg = ACCENT if primary else BTN
        btn = tk.Button(
            parent, text=text, command=command,
            bg=bg, fg="white",
            activebackground=ACCENT_SOFT if primary else BTN_HOVER,
            activeforeground="white",
            relief="flat", bd=0, padx=12, pady=4,
            font=(self.font_family, 10, "bold"),
            takefocus=0, cursor="hand2",
            highlightthickness=0,
        )
        hover = ACCENT_SOFT if primary else BTN_HOVER
        btn.bind("<Enter>", lambda e, b=btn, c=hover: b.configure(bg=c))
        btn.bind("<Leave>", lambda e, b=btn, c=bg: b.configure(bg=c))
        return btn

    def _build_widgets(self):
        self.shell = tk.Frame(self.root, bg=BG)
        self.shell.pack(fill="both", expand=True)

        self.hud = tk.Frame(self.shell, bg=BG)
        self.hud.pack(fill="x", padx=PAD_X, pady=(PAD_TOP, 0))
        self.title_lbl = tk.Label(
            self.hud, text=APP_NAME, fg=ACCENT, bg=BG,
            font=(self.font_family, 15, "bold"),
        )
        self.title_lbl.pack(side="left")
        self.score_lbl = tk.Label(
            self.hud, text="分数 0", fg=TEXT, bg=BG,
            font=(self.font_family, 15, "bold"),
        )
        self.score_lbl.pack(side="left", padx=(16, 0))
        self.best_lbl = tk.Label(
            self.hud, text="最高 0", fg=MUTED, bg=BG,
            font=(self.font_family, 11),
        )
        self.best_lbl.pack(side="left", padx=(14, 0))
        self.len_lbl = tk.Label(
            self.hud, text="长度 —", fg=MUTED, bg=BG,
            font=(self.font_family, 11),
        )
        self.len_lbl.pack(side="left", padx=(14, 0))
        self.mode_lbl = tk.Label(
            self.hud, text="经典", fg=TEXT, bg=BG,
            font=(self.font_family, 11, "bold"),
        )
        self.mode_lbl.pack(side="left", padx=(14, 0))
        self.buff_lbl = tk.Label(
            self.hud, text="", fg=GOLD, bg=BG,
            font=(self.font_family, 11, "bold"),
        )
        self.buff_lbl.pack(side="right")

        sep = tk.Frame(self.shell, bg="#3a2a66", height=1)
        sep.pack(fill="x", padx=PAD_X, pady=(6, 0))
        sep.pack_propagate(False)

        self.stage = tk.Frame(self.shell, bg=BG)
        self.stage.pack(fill="both", expand=True, padx=PAD_X, pady=(PAD_MID, PAD_MID))
        self.canvas = tk.Canvas(self.stage, bg=FIELD_TOP, highlightthickness=0, bd=0)
        self.canvas.pack(expand=True)
        self.canvas.bind("<Button-1>", lambda e: self.root.focus_set())

        self.footer = tk.Frame(self.shell, bg=BG)
        self.footer.pack(fill="x", padx=PAD_X, pady=(0, PAD_BOT))

        row1 = tk.Frame(self.footer, bg=BG)
        row1.pack(fill="x")
        tk.Label(row1, text="模式", fg=MUTED, bg=BG, font=(self.font_family, 9)).pack(side="left")
        self.mode_buttons = {}
        for key in MODES:
            b = tk.Button(
                row1, text=MODE_NAME[key], takefocus=0, cursor="hand2",
                command=lambda k=key: self.select_mode(k),
                relief="flat", bd=0, padx=10, pady=2,
                font=(self.font_family, 9, "bold"),
                highlightthickness=0,
            )
            b.pack(side="left", padx=(6, 0))
            self.mode_buttons[key] = b
        self.desc_lbl = tk.Label(
            row1, text="", fg=MUTED, bg=BG, anchor="w",
            font=(self.font_family, 9),
        )
        self.desc_lbl.pack(side="left", padx=(12, 8), fill="x", expand=True)
        self.sound_var = tk.BooleanVar(value=self.sound)
        sound_text = "音效" if self.sounds.available else "音效（系统不支持）"
        self.sound_chk = tk.Checkbutton(
            row1, text=sound_text, variable=self.sound_var,
            command=self.on_sound, takefocus=0,
            fg=TEXT, bg=BG, selectcolor="#3a2a70",
            activebackground=BG, activeforeground=TEXT,
            font=(self.font_family, 9), highlightthickness=0,
        )
        if not self.sounds.available:
            self.sound_chk.configure(state="disabled", fg=MUTED)
        self.sound_chk.pack(side="right")

        row2 = tk.Frame(self.footer, bg=BG)
        row2.pack(fill="x", pady=(4, 0))
        tk.Label(row2, text="速度", fg=MUTED, bg=BG, font=(self.font_family, 9)).pack(side="left")
        self.speed_var = tk.IntVar(value=self.speed_level)
        self.speed_scale = tk.Scale(
            row2, from_=1, to=10, orient="horizontal", showvalue=False,
            variable=self.speed_var, command=self.on_speed,
            length=180, bg=BG, fg=TEXT, troughcolor="#3a2a70",
            highlightthickness=0, activebackground=ACCENT,
            sliderrelief="flat", bd=0, width=12, takefocus=0,
        )
        self.speed_scale.pack(side="left", padx=6)
        self.speed_scale.bind("<ButtonRelease-1>", lambda e: self._save())
        self.speed_num = tk.Label(
            row2, text=str(self.speed_level), fg=TEXT, bg=BG,
            font=(self.font_family, 10, "bold"), width=2,
        )
        self.speed_num.pack(side="left")
        tk.Label(row2, text="慢", fg=MUTED, bg=BG, font=(self.font_family, 8)).pack(side="left", padx=(4, 0))
        tk.Label(row2, text="快", fg=MUTED, bg=BG, font=(self.font_family, 8)).pack(side="left", padx=(0, 8))

        self.btn_quit = self._button(row2, "退出", self.close)
        self.btn_quit.pack(side="right", padx=(6, 0))
        self.btn_help = self._button(row2, "帮助", self.toggle_help)
        self.btn_help.pack(side="right", padx=(6, 0))
        self.btn_pause = self._button(row2, "暂停", self.on_pause_button)
        self.btn_pause.pack(side="right", padx=(6, 0))
        self.btn_start = self._button(row2, "开始游戏", self.on_start_button, primary=True)
        self.btn_start.pack(side="right", padx=(12, 0))

        self.hint = tk.Label(
            self.footer,
            text="方向键 / WASD 转向（可预存两次）· 空格暂停 · R 重开 · H 帮助 · F11 全屏 · N 音效",
            fg=MUTED, bg=BG, font=(self.font_family, 8), anchor="w", justify="left",
        )
        self.hint.pack(fill="x", pady=(4, 0))

        # 滑条和按钮不抢走方向键
        for widget in (self.speed_scale, self.btn_start, self.btn_pause, self.btn_help, self.btn_quit, self.sound_chk):
            for seq in ("<Left>", "<Right>", "<Up>", "<Down>", "<space>", "<Return>"):
                widget.bind(seq, self._forward_key)

    def _forward_key(self, event):
        self.on_key(event)
        return "break"

    def _font(self, size, bold=False):
        size = max(8, int(size))
        return (self.font_family, size, "bold" if bold else "normal")

    # ----- settings -----

    def _snapshot(self):
        self.cfg.update({
            "best": self.best,
            "best_by_mode": self.best_by_mode,
            "history": self.history[:HISTORY_MAX],
            "display": self.display_mode,
            "speed": self.speed_level,
            "mode": self.mode,
            "sound": bool(self.sound_var.get()) if self.sounds.available else self.cfg.get("sound", True),
        })
        return self.cfg

    def _save(self):
        save_cfg(self._snapshot())

    def close(self):
        self._running = False
        try:
            self._save()
        except Exception:
            pass
        try:
            self.root.destroy()
        except Exception:
            pass

    def on_speed(self, _=None):
        self.speed_level = int(self.speed_var.get())
        self.speed_num.configure(text=str(self.speed_level))

    def on_sound(self):
        if not self.sounds.available:
            return
        self.sound = bool(self.sound_var.get())
        self.sounds.enabled = self.sound
        self._save()
        if self.sound:
            self.sounds.play("pause")

    def select_mode(self, mode):
        if mode not in MODES:
            return
        if self.state in ("playing", "paused", "dying"):
            self.pending_mode = None if mode == self.active_mode() else mode
        else:
            self.mode = mode
            self.pending_mode = None
            self._save()
        self._style_modes()
        self._sync_hud()

    def _style_modes(self):
        if self.state in ("playing", "paused", "dying"):
            chosen = self.pending_mode or (self.world.mode if self.world else self.mode)
        else:
            chosen = self.mode
        for key, btn in self.mode_buttons.items():
            on = key == chosen
            bg = ACCENT if on else "#2a1b55"
            fg = "white" if on else MUTED
            btn.configure(bg=bg, fg=fg, activebackground=ACCENT_SOFT if on else BTN_HOVER)
        if self.pending_mode and self.state in ("playing", "paused"):
            text = f"下局切换为{MODE_NAME[self.pending_mode]} · {MODE_BLURB[self.pending_mode]}"
        else:
            show = self.active_mode() if self.state in ("playing", "paused", "over", "dying") else self.mode
            text = MODE_BLURB[show]
        self.desc_lbl.configure(text=text)

    def active_mode(self):
        if self.world and self.state in ("playing", "paused", "dying", "over"):
            return self.world.mode
        return self.mode

    def _sync_buttons(self):
        if self.state == "menu":
            self.btn_start.configure(text="开始游戏", state="normal")
            self.btn_pause.configure(text="暂停", state="disabled")
        elif self.state == "playing":
            self.btn_start.configure(text="重新开始", state="normal")
            self.btn_pause.configure(text="暂停", state="normal")
        elif self.state == "paused":
            self.btn_start.configure(text="重新开始", state="normal")
            self.btn_pause.configure(text="继续", state="normal")
        elif self.state == "dying":
            self.btn_start.configure(text="重新开始", state="normal")
            self.btn_pause.configure(text="暂停", state="disabled")
        else:
            self.btn_start.configure(text="再来一局", state="normal")
            self.btn_pause.configure(text="暂停", state="disabled")

    def _sync_hud(self):
        score = 0
        length = "—"
        if self.world and self.state in ("playing", "paused", "dying", "over"):
            score = self.world.score
            length = str(len(self.world.snake))
        elif self.state == "over":
            score = self.result_score
            length = str(self.result_len)
        self.score_lbl.configure(text=f"分数 {score}")
        self.best_lbl.configure(text=f"最高 {self.best}")
        self.len_lbl.configure(text=f"长度 {length}")
        mode = self.active_mode()
        self.mode_lbl.configure(text=MODE_NAME[mode], fg={
            "classic": ACCENT, "zen": HEAD, "challenge": GOLD,
        }[mode])
        parts = []
        if self.world and self.state in ("playing", "paused", "dying"):
            if self.world.slow_left > 0:
                parts.append(f"慢动作 {self.world.slow_left:.1f}s")
            if self.world.mult > 1:
                parts.append(f"双倍 ×{self.world.mult_left}")
            if mode == "challenge" and self.world.eaten >= 4:
                parts.append("节奏加快")
        if self.pending_mode and self.state in ("playing", "paused"):
            parts.append(f"下局 {MODE_NAME[self.pending_mode]}")
        if self.state == "paused" and not self.help:
            parts.append("已暂停")
        self.buff_lbl.configure(text="   ".join(parts))

    def _flash_score(self):
        self._flash_gen += 1
        token = self._flash_gen
        self.score_lbl.configure(fg=GOLD)
        def restore():
            if token == self._flash_gen and self._running:
                try:
                    self.score_lbl.configure(fg=TEXT)
                except tk.TclError:
                    pass
        self.root.after(160, restore)

    # ----- dialogs -----

    def _suspend(self):
        self._suspended = self.state == "playing"
        if self._suspended:
            self.state = "paused"
            self._sync_buttons()

    def _resume_suspend(self):
        if self._suspended and self.state == "paused" and not self.help:
            self.state = "playing"
        self._suspended = False
        self._sync_buttons()
        try:
            self.root.focus_set()
        except tk.TclError:
            pass

    def _place_dialog(self, win, tw, th):
        self.root.update_idletasks()
        ww, wh, wx, wy = self._screens["work"]
        tw = min(tw, max(280, ww - 40))
        th = min(th, max(200, wh - 40))
        win.geometry(f"{int(tw)}x{int(th)}+{int(wx + (ww - tw) // 2)}+{int(wy + (wh - th) // 2)}")

    def open_about(self):
        self._suspend()
        try:
            messagebox.showinfo(
                APP_NAME,
                f"{APP_NAME}  {APP_VERSION}\n\n"
                "动漫风、无方格、连续蛇身。\n"
                "经典撞墙，禅意穿墙，挑战会越吃越快。\n"
                "浆果、星果、时砂和莲灯会改变这一局的节奏。\n\n"
                "方向键或 WASD 转向，空格暂停，R 重开，H 帮助。\n"
                f"设置保存在：\n{CONFIG_PATH}",
            )
        finally:
            self._resume_suspend()

    def open_display(self):
        self._suspend()
        win = tk.Toplevel(self.root)
        win.title("显示模式")
        win.configure(bg=BG)
        win.resizable(False, False)
        win.transient(self.root)
        win.grab_set()
        self._place_dialog(win, 360, 280)
        tk.Label(
            win, text="窗口仍然会出现在任务栏",
            fg=MUTED, bg=BG, font=self._font(9),
        ).pack(anchor="w", padx=22, pady=(16, 4))
        var = tk.StringVar(value=self.display_mode)
        notes = {
            "window": "窗口 — 按所选分辨率居中",
            "borderless": "无边框 — 铺满工作区，避开任务栏",
            "fullscreen": "全屏 — 覆盖整个屏幕，Esc 返回窗口",
        }
        for val in ("window", "borderless", "fullscreen"):
            tk.Radiobutton(
                win, text=notes[val], variable=var, value=val,
                fg=TEXT, bg=BG, selectcolor="#3a2a70",
                activebackground=BG, activeforeground=TEXT,
                font=self._font(11), anchor="w",
            ).pack(anchor="w", padx=22, pady=4)

        def finish(apply):
            try:
                win.grab_release()
            except tk.TclError:
                pass
            if apply:
                self.display_mode = var.get()
                self._suspended = False
                win.destroy()
                self.apply_display()
                self._sync_buttons()
            else:
                win.destroy()
                self._resume_suspend()

        win.protocol("WM_DELETE_WINDOW", lambda: finish(False))
        tk.Button(
            win, text="应用", command=lambda: finish(True),
            bg=ACCENT, fg="white", relief="flat", padx=16, pady=4,
            font=self._font(10, True),
        ).pack(pady=16)

    def open_res(self):
        self._suspend()
        sw, sh = self._screens["screen"]
        usable = usable_presets(sw, sh)
        win = tk.Toplevel(self.root)
        win.title("分辨率")
        win.configure(bg=BG)
        win.resizable(False, False)
        win.transient(self.root)
        win.grab_set()
        self._place_dialog(win, 440, 460)
        tk.Label(
            win, text=f"本机屏幕 {sw}×{sh}",
            fg=TEXT, bg=BG, font=self._font(12, True),
        ).pack(anchor="w", padx=18, pady=(14, 2))
        tk.Label(
            win, text="这是窗口外框的大小。顶栏和底栏会留在场地外面。",
            fg=MUTED, bg=BG, font=self._font(9), wraplength=390, justify="left",
        ).pack(anchor="w", padx=18, pady=(0, 8))
        var = tk.StringVar(value=self.cfg.get("preset"))
        if var.get() not in {n for n, _, _ in usable}:
            var.set(usable[-1][0])
        for n, _w, _h in usable:
            tk.Radiobutton(
                win, text=n, variable=var, value=n,
                fg=TEXT, bg=BG, selectcolor="#3a2a70",
                activebackground=BG, activeforeground=TEXT,
                font=self._font(10), anchor="w",
            ).pack(anchor="w", padx=22, pady=2)
        hidden = [n for n, w, h in RES_PRESETS if not (w <= sw and h <= sh)]
        if hidden:
            tk.Label(
                win, text="当前屏幕放不下：" + "、".join(hidden),
                fg=MUTED, bg=BG, wraplength=390, justify="left",
                font=self._font(8),
            ).pack(anchor="w", padx=18, pady=6)

        def finish(apply):
            try:
                win.grab_release()
            except tk.TclError:
                pass
            if apply:
                for n, w, h in usable:
                    if n == var.get():
                        self.cfg.update({"preset": n, "width": w, "height": h})
                        break
                self._suspended = False
                win.destroy()
                if self.display_mode != "window":
                    self.display_mode = "window"
                    self._apply_window_style()
                self.layout_field()
                self._apply_window_style()
                self.layout_field()
                self._save()
                if self.state in ("playing", "paused"):
                    self._resume_suspend()
                self._sync_buttons()
            else:
                win.destroy()
                self._resume_suspend()

        win.protocol("WM_DELETE_WINDOW", lambda: finish(False))
        tk.Button(
            win, text="应用", command=lambda: finish(True),
            bg=ACCENT, fg="white", relief="flat", padx=16, pady=4,
            font=self._font(10, True),
        ).pack(pady=12)

    def open_history(self):
        self._suspend()
        win = tk.Toplevel(self.root)
        win.title("历史最高分")
        win.configure(bg=BG)
        win.transient(self.root)
        win.grab_set()
        self._place_dialog(win, 460, 460)
        tk.Label(
            win, text=f"历史最高  {self.best}",
            fg=ACCENT, bg=BG, font=self._font(16, True),
        ).pack(anchor="w", padx=18, pady=(14, 2))
        bits = "    ".join(
            f"{MODE_NAME[k]} {self.best_by_mode.get(k, 0)}" for k in MODES
        )
        tk.Label(win, text=bits, fg=MUTED, bg=BG, font=self._font(10)).pack(anchor="w", padx=18)
        box = tk.Listbox(
            win, bg="#221445", fg=TEXT, font=self._font(11),
            highlightthickness=0, bd=0, activestyle="none",
            selectbackground="#4a2d78",
        )
        box.pack(fill="both", expand=True, padx=16, pady=10)
        if not self.history:
            box.insert("end", "  还没有对局")
        else:
            for i, item in enumerate(self.history, 1):
                mode = MODE_NAME.get(item.get("mode"), "—")
                length = item.get("length")
                extra = f"  长度 {length}" if length else ""
                box.insert(
                    "end",
                    f"  {i:>2}.   {item.get('score', 0):>4} 分    {mode}{extra}    {item.get('time', '')}",
                )

        def clear():
            if not messagebox.askyesno(APP_NAME, "清空最近对局和最高分？", parent=win):
                return
            self.history = []
            self.best = 0
            self.best_by_mode = {"classic": 0, "zen": 0, "challenge": 0}
            self._save()
            self._sync_hud()
            win.destroy()
            self._resume_suspend()

        def finish():
            try:
                win.grab_release()
            except tk.TclError:
                pass
            win.destroy()
            self._resume_suspend()

        bar = tk.Frame(win, bg=BG)
        bar.pack(pady=(0, 12))
        tk.Button(bar, text="清空记录", command=clear, relief="flat", padx=10).pack(side="left", padx=6)
        tk.Button(bar, text="关闭", command=finish, relief="flat", padx=10).pack(side="left", padx=6)
        win.protocol("WM_DELETE_WINDOW", finish)

    # ----- flow -----

    def show_menu(self):
        self.state = "menu"
        self.help = False
        self.pending_mode = None
        self.world = None
        self._style_modes()
        self._sync_buttons()
        self._sync_hud()

    def toggle_help(self):
        self.help = not self.help
        if self.help:
            self.sounds.play("pause")

    def on_start_button(self):
        self.help = False
        self.start_game()

    def on_pause_button(self):
        if self.state == "playing":
            self.state = "paused"
            self.sounds.play("pause")
        elif self.state == "paused":
            self.state = "playing"
        self._sync_buttons()
        self._sync_hud()

    def start_game(self):
        if self.pending_mode in MODES:
            self.mode = self.pending_mode
            self.pending_mode = None
        self.world = SnakeWorld(self.cols, self.rows, self.mode)
        self.state = "playing"
        self.help = False
        self._acc = 0.0
        self.progress = 0.0
        self._recorded = False
        self.victory = False
        self.new_record = False
        self.new_mode_record = False
        self.happy = 0.0
        self.shake = 0.0
        self.fx = FX()
        self._save()
        self._style_modes()
        self._sync_buttons()
        self._sync_hud()
        self.sounds.play("start")
        try:
            self.root.focus_set()
        except tk.TclError:
            pass

    def interval_ms(self):
        base = speed_to_ms(self.speed_level)
        mode = self.active_mode()
        if mode == "zen":
            base = int(base * 1.18)
        elif mode == "challenge" and self.world:
            base = int(base * (0.95 ** min(self.world.eaten, 22)))
        if self.world and self.world.slow_left > 0:
            base = int(base * 1.75)
        return max(32, base)

    def _remember_score(self):
        if self._recorded or not self.world:
            return
        self._recorded = True
        score = int(self.world.score)
        mode = self.world.mode
        self.result_score = score
        self.result_len = len(self.world.snake)
        self.result_mode = mode
        mode_best = int(self.best_by_mode.get(mode, 0))
        self.new_record = score > 0 and score > int(self.best)
        self.new_mode_record = score > 0 and score > mode_best
        if score <= 0:
            self._sync_hud()
            return
        if score > self.best:
            self.best = score
        if score > mode_best:
            self.best_by_mode[mode] = score
        self.history.insert(0, {
            "score": score,
            "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "mode": mode,
            "length": self.result_len,
        })
        self.history = self.history[:HISTORY_MAX]
        self._save()
        self._sync_hud()

    def _enter_over(self):
        self.state = "over"
        if self.new_record or self.victory:
            self.sounds.play("record")
            self._fx_record()
        self._style_modes()
        self._sync_buttons()
        self._sync_hud()

    def _on_events(self, events):
        for ev in events:
            if ev["type"] == "eat":
                self._fx_eat(ev)
                self._flash_score()
                self.happy = 0.28
                sound = {"berry": "eat", "star": "star", "slow": "slow", "mult": "mult"}[ev["kind"]]
                self.sounds.play(sound)
            elif ev["type"] == "die":
                self._remember_score()
                self.state = "dying"
                self._die_left = 0.58
                self.shake = 0.42
                self._fx_death()
                self.sounds.play("die")
                self._sync_buttons()
            elif ev["type"] == "win":
                self.victory = True
                self._remember_score()
                self._enter_over()

    def _cell_center(self, x, y):
        c = self.cell
        return (x + 0.5) * c, (y + 0.5) * c

    def _fx_eat(self, ev):
        x, y = self._cell_center(ev["x"], ev["y"])
        color = {"berry": BERRY, "star": GOLD, "slow": CYAN, "mult": VIOLET}[ev["kind"]]
        self.fx.burst(x, y, color, n=14 if ev["kind"] != "berry" else 10, speed=180)
        self.fx.burst(x, y, "#fff6fb", n=5, speed=90, life=0.28)
        self.fx.ring(x, y, color)
        if ev["kind"] == "berry":
            text, col = f"+{ev['amount']}", TEXT
        elif ev["kind"] == "star":
            text, col = f"+{ev['amount']}", GOLD
        elif ev["kind"] == "slow":
            text, col = "慢动作", CYAN
        else:
            text, col = "双倍", VIOLET
        self.fx.popup(x, y, text, col)

    def _fx_death(self):
        if not self.world:
            return
        cell = self.cell
        pts = [self._cell_center(x, y) for x, y in self.world.snake]
        step = 1 if len(pts) < 14 else 2
        for x, y in pts[::step]:
            self.fx.burst(x, y, BODY_A, n=4, speed=120, life=0.5)
        hx, hy = self.world.snake[0]
        dx, dy = self.world.death_face
        ix, iy = self._cell_center(hx + dx, hy + dy)
        self.fx.burst(ix, iy, BERRY, n=16, speed=220, life=0.55)
        self.fx.ring(ix, iy, "#ffffff")

    def _fx_record(self):
        w = self.cols * self.cell
        for i in range(24):
            x = random.uniform(24, max(25, w - 24))
            self.fx.particles.append({
                "x": x, "y": -8 - random.random() * 30,
                "vx": random.uniform(-20, 20),
                "vy": random.uniform(70, 160),
                "life": 0.9, "age": 0.0,
                "r": random.uniform(1.8, 3.2),
                "vr": 0.0, "color": GOLD, "kind": "dot",
            })

    # ----- keys -----

    def _toggle_fullscreen(self):
        if self.display_mode == "fullscreen":
            self.display_mode = "window"
        else:
            self.display_mode = "fullscreen"
        self.apply_display()

    def _on_escape(self):
        if self.help:
            self.help = False
            return
        if self.display_mode in ("fullscreen", "borderless"):
            self.display_mode = "window"
            self.apply_display()
            return
        if self.state != "menu":
            self.show_menu()

    def on_key(self, event):
        if not self._running:
            return
        focus = None
        try:
            focus = self.root.focus_get()
        except tk.TclError:
            return
        if focus is not None:
            try:
                if focus.winfo_toplevel() is not self.root:
                    return
            except tk.TclError:
                return
        low = (event.keysym or "").lower()
        if low in ("alt_l", "alt_r", "shift_l", "shift_r", "control_l", "control_r", "caps_lock"):
            return
        if low in ("h", "f1"):
            self.toggle_help()
            return
        if low == "n":
            if self.sounds.available:
                self.sound_var.set(not self.sound_var.get())
                self.on_sound()
            return
        if low == "f11":
            self._toggle_fullscreen()
            return
        if self.help and low in ("escape", "space", "p", "return", "kp_enter"):
            self.help = False
            return
        if low == "escape":
            self._on_escape()
            return
        if low in ("return", "kp_enter"):
            if self.state in ("menu", "over", "dying"):
                self.start_game()
            elif self.state == "paused":
                self.state = "playing"
                self._sync_buttons()
            return
        if low in ("space", "p"):
            if self.state == "menu":
                self.start_game()
            elif self.state == "playing":
                self.state = "paused"
                self.sounds.play("pause")
                self._sync_buttons()
            elif self.state == "paused":
                self.state = "playing"
                self._sync_buttons()
            elif self.state in ("over", "dying"):
                self.start_game()
            return
        if low == "r":
            self.start_game()
            return
        if low in DIR_KEYS and self.state == "playing" and not self.help and self.world and self.world.alive:
            dx, dy = DIR_KEYS[low]
            self.world.turn(dx, dy)

    # ----- loop -----

    def tick(self):
        try:
            if not self._running or not self.root.winfo_exists():
                return
        except tk.TclError:
            return
        now = time.perf_counter()
        dt = min(0.05, max(0.0, now - self._last))
        self._last = now
        self.clock += dt
        if self.happy > 0:
            self.happy = max(0.0, self.happy - dt)
        if self.shake > 0:
            self.shake = max(0.0, self.shake - dt)

        if self.state == "playing" and not self.help and self.world:
            self._acc += dt
            interval = self.interval_ms() / 1000.0
            steps = 0
            while self._acc >= interval and steps < 4 and self.state == "playing":
                self._acc -= interval
                events = self.world.step()
                self._on_events(events)
                steps += 1
                if self.state != "playing":
                    break
            if self.state != "playing":
                self._acc = 0.0
                self.progress = 0.0
            else:
                self.world.tick_time(dt)
                self.progress = max(0.0, min(0.999, self._acc / interval)) if interval else 0.0
        elif self.state == "dying":
            self._die_left -= dt
            self.progress = 0.0
            if self._die_left <= 0:
                self._enter_over()
        else:
            self.progress = 0.0

        self.fx.update(dt)
        self._sync_hud()
        self.draw()
        try:
            self.root.after(20, self.tick)
        except tk.TclError:
            pass

    # ----- drawing -----

    def _shake_offset(self):
        if self.shake <= 0:
            return 0.0, 0.0
        mag = (self.shake / 0.42) * 7.0
        return math.sin(self.clock * 54) * mag, math.cos(self.clock * 47) * mag * 0.65

    def _ensure_bg(self):
        key = (self.cols, self.rows, self.cell)
        if key == self._bg_key:
            return
        self.canvas.delete("all")
        w = self.cols * self.cell
        h = self.rows * self.cell
        steps = 20
        for i in range(steps):
            y0 = int(h * i / steps)
            y1 = int(h * (i + 1) / steps) + 1
            col = mix_hex(FIELD_TOP, FIELD_BOT, i / max(1, steps - 1))
            self.canvas.create_rectangle(0, y0, w, y1, fill=col, outline="", tags="bg")
        rng = random.Random(self.cols * 97 + self.rows * 13 + 7)
        for _ in range(5):
            cx = rng.randint(0, max(1, w))
            cy = rng.randint(0, max(1, h))
            r = rng.randint(self.cell, self.cell * 3)
            col = rng.choice(("#2a1460", "#3c2078", "#1b305c", "#4a2068"))
            self.canvas.create_oval(cx - r, cy - r, cx + r, cy + r, fill=col, outline="", tags="bg")
        self.canvas.create_rectangle(2, 2, w - 2, h - 2, outline=FRAME, width=2, tags="bg")
        self._twinkles = [
            (rng.uniform(10, max(11, w - 10)), rng.uniform(10, max(11, h - 10)), rng.uniform(0, 6.2))
            for _ in range(26)
        ]
        self._bg_key = key

    def _draw_twinkles(self):
        for x, y, ph in self._twinkles:
            a = 0.5 + 0.5 * math.sin(self.clock * 2.1 + ph)
            if a < 0.42:
                continue
            r = 1.0 + a * 1.5
            self.canvas.create_oval(x - r, y - r, x + r, y + r, fill="#f6eeff", outline="", tags="dyn")

    def draw(self):
        try:
            self._ensure_bg()
        except tk.TclError:
            return
        self.canvas.delete("dyn")
        ox, oy = self._shake_offset()
        self._draw_twinkles()
        if self.state == "menu" or self.world is None:
            self._draw_menu()
        else:
            self._draw_foods(ox, oy)
            self._draw_snake(ox, oy)
            self.fx.draw(self.canvas, ox, oy)
            self._draw_popups(ox, oy)
            if self.help:
                self._dim()
                self._draw_help_card()
            elif self.state == "paused":
                self._dim()
                self._draw_pause_card()
            elif self.state == "over":
                self._dim()
                self._draw_over_card()
        if self.state == "menu" and self.help:
            self._dim()
            self._draw_help_card()

    def _draw_popups(self, ox, oy):
        for p in self.fx.popups:
            self.canvas.create_text(
                p["x"] + ox, p["y"] + oy, text=p["text"], fill=p["color"],
                font=self._font(max(12, self.cell // 3), True), tags="dyn",
            )

    def _dim(self):
        w = self.cols * self.cell
        h = self.rows * self.cell
        self.canvas.create_rectangle(0, 0, w, h, fill="#0c0616", stipple="gray50", outline="", tags="dyn")

    def _card(self, cx, cy, cw, ch, accent):
        pts = _round_points(cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2, 18)
        self.canvas.create_polygon(pts, fill=PANEL, outline=accent, width=2, tags="dyn")

    def _draw_menu(self):
        w = self.cols * self.cell
        h = self.rows * self.cell
        bob = math.sin(self.clock * 1.6) * 4
        title_size = max(28, min(68, int(self.cell * 1.35)))
        self.canvas.create_text(
            w / 2 + 2, h * 0.30 + bob + 3, text="贪 吃 蛇",
            fill="#2a1248", font=self._font(title_size, True), tags="dyn",
        )
        self.canvas.create_text(
            w / 2, h * 0.30 + bob, text="贪 吃 蛇",
            fill=TEXT, font=self._font(title_size, True), tags="dyn",
        )
        self.canvas.create_text(
            w / 2, h * 0.30 + bob + title_size * 0.72,
            text="无方格  ·  连续蛇身  ·  三种节奏",
            fill=MUTED, font=self._font(max(11, self.cell // 3)), tags="dyn",
        )
        self.canvas.create_text(
            w / 2, h * 0.30 + bob + title_size * 1.15,
            text=f"历史最高  {self.best}    ·    {MODE_BLURB[self.mode]}",
            fill=ACCENT, font=self._font(max(11, self.cell // 3)), tags="dyn",
        )
        self.canvas.create_text(
            w / 2, h * 0.30 + bob + title_size * 1.55,
            text="按 Enter 开始",
            fill=TEXT, font=self._font(max(12, self.cell // 2.6), True), tags="dyn",
        )
        self._draw_mascot(w, h)

    def _draw_mascot(self, w, h):
        n = 18
        cell = max(16, min(self.cell, 34))
        pts = []
        # 头在右侧
        for i in range(n):
            t = i / (n - 1)
            x = w * 0.86 - t * w * 0.70
            y = h * 0.78 + math.sin(self.clock * 1.35 + i * 0.48) * h * 0.030
            pts.append((x, y))
        look_dy = math.cos(self.clock * 1.35) * 0.35
        norm = math.hypot(1.0, look_dy) or 1.0
        face = (1.0 / norm, look_dy / norm)
        self._paint_body(pts, cell)
        self._paint_head(pts[0][0], pts[0][1], face, face, cell, "normal", False, 1.0)
        bx = w * 0.42 + math.sin(self.clock * 1.2) * 10
        by = h * 0.62 + math.sin(self.clock * 1.8) * 8
        self._paint_orb_at(bx, by, "berry", cell, 1.0, False)

    def _snake_points(self, lead):
        world = self.world
        cell = self.cell
        dx, dy = world.direction
        grow = False
        if world.alive:
            motion = world.motion()
            grow = motion["will_grow"]
        else:
            dx, dy = world.death_face or world.direction
            lead = 1.0
            grow = world.death_grow
        hx, hy = world.snake[0]

        def px(x, y):
            return (x + 0.5) * cell, (y + 0.5) * cell

        pts = [px(hx + dx * lead, hy + dy * lead)]
        for x, y in world.snake:
            pts.append(px(x, y))
        if (not grow) and len(world.snake) >= 2 and lead > 0:
            tx, ty = world.snake[-1]
            px_, py_ = world.snake[-2]
            if abs(tx - px_) + abs(ty - py_) <= 1:
                pts[-1] = px(tx + (px_ - tx) * lead, ty + (py_ - ty) * lead)
        vx = hx + dx * lead
        vy = hy + dy * lead
        ghost = None
        if world.alive and world.mode == "zen" and lead > 0:
            cx = (vx + 0.5) * cell
            cy = (vy + 0.5) * cell
            field_w = self.cols * cell
            field_h = self.rows * cell
            if cx < 0 or cy < 0 or cx > field_w or cy > field_h:
                gvx = vx % self.cols
                gvy = vy % self.rows
                head = px(gvx, gvy)
                if dx < 0:
                    edge = (field_w, head[1])
                elif dx > 0:
                    edge = (0, head[1])
                elif dy < 0:
                    edge = (head[0], field_h)
                else:
                    edge = (head[0], 0)
                ghost = (head, edge)
        return _dedupe(pts), ghost, (dx, dy)

    def _draw_snake(self, ox, oy):
        lead = 0.0 if self.state != "playing" else self.progress
        if self.world and not self.world.alive:
            lead = 1.0
        pts, ghost, face = self._snake_points(lead)
        pts = [(x + ox, y + oy) for x, y in pts]
        self._paint_body(pts, self.cell)
        if ghost:
            (hx, hy), (ex, ey) = ghost
            self._paint_body([(ex + ox, ey + oy), (hx + ox, hy + oy)], self.cell)
            self._paint_head(hx + ox, hy + oy, face, self.world.glance(), self.cell, self._mood(), self._blinking(), self._pulse())
        if pts:
            glance = self.world.glance() if self.world and self.world.alive else face
            self._paint_head(pts[0][0], pts[0][1], face, glance, self.cell, self._mood(), self._blinking(), self._pulse())

    def _mood(self):
        if self.world and not self.world.alive:
            return "dead"
        return "normal"

    def _blinking(self):
        if self._mood() == "dead":
            return False
        phase = self.clock % 4.2
        return phase < 0.12

    def _pulse(self):
        if self.happy <= 0:
            return 1.0
        return 1.0 + 0.16 * (self.happy / 0.28)

    def _paint_body(self, pts, cell):
        if len(pts) < 2:
            return
        limit = cell * 1.75
        runs = []
        for run in _split_runs(pts, limit):
            if len(run) < 2:
                continue
            runs.append(round_path(run, cell * 0.55))
        base = max(10, int(cell * 0.72))
        # 先描边再填色。拐角事先收成圆弧，不用整段样条，避免身子甩出格子。
        for run in runs:
            flat = [v for p in run for v in p]
            self.canvas.create_line(
                *flat, fill=OUTLINE, width=base + 6,
                capstyle="round", joinstyle="round", tags="dyn",
            )
        seg_index = 0
        total = sum(len(r) - 1 for r in runs)
        for run in runs:
            for i in range(len(run) - 1):
                t = seg_index / max(1, total - 1)
                col = mix_hex(BODY_A, BODY_B, t)
                tail_from_end = total - seg_index
                width = base
                if tail_from_end <= 4:
                    width = max(base * 0.42, base * (0.42 + 0.58 * tail_from_end / 4))
                self.canvas.create_line(
                    run[i][0], run[i][1], run[i + 1][0], run[i + 1][1],
                    fill=col, width=width, capstyle="round", joinstyle="round", tags="dyn",
                )
                seg_index += 1
        # 高光：偏左上的一条细线，像光滑的身子
        for run in runs:
            if len(run) < 3:
                gloss = run
            else:
                gloss = run[:-2]
            if len(gloss) < 2:
                continue
            ox, oy = -base * 0.12, -base * 0.20
            flat = []
            for x, y in gloss:
                flat.extend((x + ox, y + oy))
            self.canvas.create_line(
                *flat, fill="#e9fff6", width=max(2, base // 5),
                capstyle="round", joinstyle="round", tags="dyn",
            )

    def _paint_head(self, x, y, face, glance, cell, mood, blink, pulse):
        dx, dy = face
        gx, gy = glance
        r = cell * 0.58 * pulse
        c = self.canvas
        c.create_oval(x - r, y - r, x + r, y + r, fill=HEAD, outline=OUTLINE, width=max(2, cell // 16), tags="dyn")
        # 脑后小芽，画在圆的外侧，才不会被脑袋盖住
        bx = x - dx * r * 1.18
        by = y - dy * r * 1.18
        sx = x - dx * r * 0.78
        sy = y - dy * r * 0.78
        c.create_line(sx, sy, bx, by, fill="#2f8f55", width=max(2, cell // 14), tags="dyn")
        c.create_oval(bx - cell * 0.16, by - cell * 0.10, bx + cell * 0.05, by + cell * 0.12, fill="#8dff9a", outline="", tags="dyn")
        c.create_oval(bx - cell * 0.02, by - cell * 0.18, bx + cell * 0.16, by + cell * 0.02, fill="#d8ffc4", outline="", tags="dyn")
        # 头顶高光
        c.create_oval(
            x - r * 0.55, y - r * 0.68, x + r * 0.02, y - r * 0.12,
            fill=HEAD_HI, outline="", tags="dyn",
        )
        px, py = -dy, dx  # 脸的左右
        eyes = [
            (dx * 0.16 + px * 0.28, dy * 0.16 + py * 0.28),
            (dx * 0.16 - px * 0.28, dy * 0.16 - py * 0.28),
        ]
        er = cell * 0.175
        for ox, oy in eyes:
            ex, ey = x + ox * cell * 0.85, y + oy * cell * 0.85
            if mood == "dead":
                s = er * 0.85
                c.create_line(ex - s, ey - s, ex + s, ey + s, fill=OUTLINE, width=max(2, cell // 16), tags="dyn")
                c.create_line(ex + s, ey - s, ex - s, ey + s, fill=OUTLINE, width=max(2, cell // 16), tags="dyn")
                continue
            eh = er * (0.18 if blink else 1.05)
            c.create_oval(ex - er, ey - eh, ex + er, ey + eh, fill="white", outline=OUTLINE, width=1, tags="dyn")
            if blink:
                continue
            # 眼珠看向即将转弯的方向
            sx = dx * 0.18 + gx * 0.42
            sy = dy * 0.18 + gy * 0.42
            pr = er * 0.52
            qx, qy = ex + sx * er * 0.7, ey + sy * er * 0.7
            c.create_oval(qx - pr, qy - pr, qx + pr, qy + pr, fill="#1b1430", outline="", tags="dyn")
            c.create_oval(qx - pr * 0.55, qy - pr * 0.7, qx - pr * 0.05, qy - pr * 0.15, fill="white", outline="", tags="dyn")
        # 腮红
        cheek_r = cell * 0.09 * (1.25 if self.happy > 0 else 1.0)
        for sign in (-1, 1):
            chx = x + px * sign * r * 0.72 + dx * r * 0.05
            chy = y + py * sign * r * 0.72 + dy * r * 0.05
            c.create_oval(chx - cheek_r, chy - cheek_r * 0.65, chx + cheek_r, chy + cheek_r * 0.65, fill="#ff8fb8", outline="", tags="dyn")
        # 嘴跟着脸的朝向，而不是永远朝下
        if mood != "dead":
            span = cell * (0.20 if self.happy > 0 else 0.15)
            mx = x + dx * r * 0.58
            my = y + dy * r * 0.58
            left = (mx - px * span, my - py * span)
            right = (mx + px * span, my + py * span)
            dip = (mx + dx * span * 0.55, my + dy * span * 0.55)
            c.create_line(
                *left, *dip, *right, smooth=True,
                fill=OUTLINE, width=max(2, cell // 14), capstyle="round", tags="dyn",
            )

    def _draw_foods(self, ox, oy):
        world = self.world
        if not world:
            return
        if world.berry:
            x, y = self._cell_center(*world.berry)
            self._paint_orb_at(x + ox, y + oy, "berry", self.cell, 1.0, False)
        if world.special:
            x, y, kind, ttl = world.special
            cx, cy = self._cell_center(x, y)
            blink = ttl < 2.2 and int(self.clock * 8) % 2 == 0
            self._paint_orb_at(cx + ox, cy + oy, kind, self.cell, ttl / 9.0, blink)

    def _paint_orb_at(self, x, y, kind, cell, life, blink_off):
        pulse = 1.0 + 0.07 * math.sin(self.clock * 4.0 + (hash(kind) % 5))
        r = cell * 0.30 * pulse
        c = self.canvas
        palette = {
            "berry": (BERRY, "#ffd0e2", "#ff4f86"),
            "star": (GOLD, "#fff3c4", "#e0a020"),
            "slow": (CYAN, "#e7fbff", "#3ec8e0"),
            "mult": (VIOLET, "#f3e8ff", "#9a78e0"),
        }
        main, hi, edge = palette[kind]
        # 外圈光
        c.create_oval(x - r * 2.15, y - r * 2.15, x + r * 2.15, y + r * 2.15, outline=main, width=1, tags="dyn")
        c.create_oval(x - r * 1.55, y - r * 1.55, x + r * 1.55, y + r * 1.55, outline=main, width=2, tags="dyn")
        if blink_off:
            return
        if kind == "star":
            pts = _star_points(x, y, r * 1.35, r * 0.58)
            c.create_polygon(pts, fill=main, outline=edge, width=1, tags="dyn")
            c.create_oval(x - r * 0.28, y - r * 0.55, x + r * 0.05, y - r * 0.15, fill=hi, outline="", tags="dyn")
            return
        c.create_oval(x - r, y - r, x + r, y + r, fill=main, outline=edge, width=1, tags="dyn")
        c.create_oval(x - r * 0.55, y - r * 0.62, x - r * 0.05, y - r * 0.15, fill=hi, outline="", tags="dyn")
        if kind == "berry":
            c.create_polygon(
                x, y - r * 1.05,
                x + r * 0.45, y - r * 1.55,
                x + r * 0.15, y - r * 0.7,
                fill="#7dffb0", outline="", tags="dyn",
            )
        elif kind == "slow":
            c.create_arc(
                x - r * 0.55, y - r * 0.55, x + r * 0.55, y + r * 0.55,
                start=40, extent=220, style="arc", outline="#14515c", width=max(2, cell // 16), tags="dyn",
            )
        elif kind == "mult":
            c.create_text(x, y + 1, text="×2", fill="#2a1848", font=self._font(max(8, cell // 3.4), True), tags="dyn")

    def _draw_pause_card(self):
        w = self.cols * self.cell
        h = self.rows * self.cell
        cw = min(w - 40, 420)
        ch = min(h - 40, 220)
        self._card(w / 2, h / 2, cw, ch, ACCENT)
        self.canvas.create_text(
            w / 2, h / 2 - ch * 0.22, text="暂停",
            fill=TEXT, font=self._font(max(22, self.cell * 0.7), True), tags="dyn",
        )
        self.canvas.create_text(
            w / 2, h / 2 + 8,
            text="空格继续    ·    R 重新开始    ·    H 帮助",
            fill=MUTED, font=self._font(max(11, self.cell // 3)), tags="dyn",
        )
        self.canvas.create_text(
            w / 2, h / 2 + ch * 0.26,
            text=MODE_BLURB[self.active_mode()],
            fill=ACCENT, font=self._font(max(10, self.cell // 3.4)), tags="dyn",
        )

    def _draw_over_card(self):
        w = self.cols * self.cell
        h = self.rows * self.cell
        cw = min(w - 36, 460)
        ch = min(h - 28, 340)
        accent = GOLD if (self.new_record or self.victory) else ACCENT
        self._card(w / 2, h / 2, cw, ch, accent)
        title = "清台" if self.victory else "游戏结束"
        top = h / 2 - ch / 2
        self.canvas.create_text(
            w / 2, top + 36, text=title,
            fill=accent, font=self._font(max(18, self.cell * 0.55), True), tags="dyn",
        )
        self.canvas.create_text(
            w / 2, top + ch * 0.40, text=str(self.result_score),
            fill=TEXT, font=self._font(max(28, self.cell * 0.95), True), tags="dyn",
        )
        if self.new_record:
            banner = "新纪录"
        elif self.new_mode_record:
            banner = f"{MODE_NAME[self.result_mode]}新纪录"
        else:
            banner = "本局得分"
        self.canvas.create_text(
            w / 2, top + ch * 0.40 + max(28, self.cell * 0.55),
            text=banner, fill=GOLD if self.new_record or self.new_mode_record else MUTED,
            font=self._font(max(12, self.cell // 2.8), True), tags="dyn",
        )
        mode_best = self.best_by_mode.get(self.result_mode, 0)
        self.canvas.create_text(
            w / 2, top + ch * 0.68,
            text=f"最高 {self.best}    ·    {MODE_NAME[self.result_mode]} {mode_best}    ·    长度 {self.result_len}",
            fill=MUTED, font=self._font(max(10, self.cell // 3.5)), tags="dyn",
        )
        self.canvas.create_text(
            w / 2, top + ch * 0.84,
            text="Enter / R 再来一局     Esc 返回标题",
            fill=TEXT, font=self._font(max(10, self.cell // 3.4)), tags="dyn",
        )

    def _draw_help_card(self):
        w = self.cols * self.cell
        h = self.rows * self.cell
        cw = min(w - 28, 560)
        ch = min(h - 24, 460)
        self._card(w / 2, h / 2, cw, ch, FRAME)
        left = w / 2 - cw / 2 + 28
        top = h / 2 - ch / 2 + 28
        size = 12 if ch >= 400 else 10
        gap = 22 if ch >= 400 else 18
        self.canvas.create_text(left, top, text="怎么玩", anchor="w", fill=ACCENT, font=self._font(size + 4, True), tags="dyn")
        keys = [
            ("方向键 / WASD", "转向，可提前存两次"),
            ("空格 / P", "暂停或继续"),
            ("R", "重新开始"),
            ("H / F1", "打开或关闭本页"),
            ("Esc", "关帮助 / 退出全屏 / 回标题"),
            ("F11", "全屏切换"),
            ("N", "音效开关"),
        ]
        modes = [
            ("经典", "撞墙结束，速度听滑条的"),
            ("禅意", "从对面穿出，节奏更慢"),
            ("挑战", "撞墙结束，吃得越多越快"),
        ]
        foods = [
            ("berry", "浆果", "+10"),
            ("star", "星果", "+30，多长一节"),
            ("slow", "时砂", "慢动作几秒"),
            ("mult", "莲灯", "接下来三次双倍"),
        ]
        y = top + 30
        key_x = left + min(168, cw * 0.34)
        bottom = h / 2 + ch / 2 - 16
        for key, action in keys:
            if y > bottom:
                break
            self.canvas.create_text(left, y, text=key, anchor="w", fill=GOLD, font=self._font(size, True), tags="dyn")
            self.canvas.create_text(key_x, y, text=action, anchor="w", fill=TEXT, font=self._font(size), tags="dyn")
            y += gap
        y += 6
        for name, blurb in modes:
            if y > bottom:
                break
            self.canvas.create_text(left, y, text=name, anchor="w", fill=ACCENT, font=self._font(size, True), tags="dyn")
            self.canvas.create_text(key_x, y, text=blurb, anchor="w", fill=TEXT, font=self._font(size), tags="dyn")
            y += gap
        y += 4
        for kind, name, blurb in foods:
            if y > bottom:
                break
            self._paint_orb_at(left + 10, y, kind, max(16, size + 8), 1.0, False)
            self.canvas.create_text(left + 28, y, text=name, anchor="w", fill=TEXT, font=self._font(size, True), tags="dyn")
            self.canvas.create_text(key_x, y, text=blurb, anchor="w", fill=MUTED, font=self._font(size), tags="dyn")
            y += gap + 2


def main():
    root = tk.Tk()
    SnakeApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
