# -*- coding: utf-8 -*-
"""拍一组界面截图，方便核对布局和画面。只在有显示器时使用。"""
import os
import subprocess
import sys
import time

os.environ.setdefault("XDG_CONFIG_HOME", "/tmp/snake-preview-config")
os.makedirs(os.environ["XDG_CONFIG_HOME"], exist_ok=True)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import snake_gui as sg  # noqa: E402


OUT = os.path.join(ROOT, "docs", "screenshots")
os.makedirs(OUT, exist_ok=True)


def grab(root, name):
    root.update_idletasks()
    root.update()
    try:
        root.lift()
        root.attributes("-topmost", True)
    except Exception:
        pass
    # 等窗口管理器把几何尺寸真正画出来，否则会截到上一帧
    time.sleep(0.35)
    root.update()
    x, y = root.winfo_rootx(), root.winfo_rooty()
    w, h = root.winfo_width(), root.winfo_height()
    path = os.path.join(OUT, name)
    cmd = [
        "import", "-window", "root",
        "-crop", f"{w}x{h}+{x}+{y}",
        "-quiet", path,
    ]
    subprocess.check_call(cmd)
    print(name, w, h, path)


def report(app):
    root = app.root
    root.update_idletasks()
    win_r = root.winfo_rootx() + root.winfo_width()
    win_b = root.winfo_rooty() + root.winfo_height()
    for widget in (
        app.btn_start, app.btn_pause, app.btn_help, app.btn_quit,
        app.sound_chk, app.hud, app.footer, app.canvas, app.hint,
    ):
        x2 = widget.winfo_rootx() + widget.winfo_width()
        y2 = widget.winfo_rooty() + widget.winfo_height()
        flag = "OK" if x2 <= win_r + 1 and y2 <= win_b + 1 else "CLIP"
        print(f"  {flag} {widget} {widget.winfo_width()}x{widget.winfo_height()} -> {x2 - win_r},{y2 - win_b}")


def curve(cols, rows):
    cy = max(3, rows // 2 - 1)
    x = min(cols - 3, max(10, cols // 2 + 3))
    y = max(2, cy - 2)
    pts = [(x - i, y) for i in range(8)]
    pts += [(x - 7, y + i) for i in range(1, 4)]
    pts += [(x - 7 + i, y + 3) for i in range(1, 6)]
    return [p for p in pts if 0 <= p[0] < cols and 0 <= p[1] < rows]


def main():
    os.makedirs(os.path.dirname(sg.CONFIG_PATH), exist_ok=True)
    if os.path.isfile(sg.CONFIG_PATH):
        os.remove(sg.CONFIG_PATH)
    root = sg.tk.Tk()
    app = sg.SnakeApp(root)
    app._running = False
    app.best = 120
    app.best_by_mode = {"classic": 80, "zen": 40, "challenge": 120}
    app.cfg.update({"preset": "1280×720 (720p)", "width": 1280, "height": 720})
    app.display_mode = "window"
    app.apply_display()
    root.update()
    app.clock = 1.1
    app._sync_hud()
    app.draw()
    report(app)
    grab(root, "01-menu.png")

    app.start_game()
    world = app.world
    world.allow_special = False
    pts = curve(app.cols, app.rows)
    world.snake = pts
    world.direction = (1, 0)
    world.queue = [(0, -1)]
    hx, hy = pts[0]
    world.berry = (min(app.cols - 1, hx + 3), hy)
    world.special = (max(1, hx - 2), min(app.rows - 1, hy + 5), "star", 7.5)
    world.score = 80
    world.eaten = 8
    world.slow_left = 3.2
    world.mult = 2
    world.mult_left = 2
    app.progress = 0.4
    app.state = "playing"
    bx, by = app._cell_center(*world.berry)
    app.fx.burst(bx, by, sg.BERRY, n=12, speed=160)
    app.fx.ring(bx, by, sg.BERRY)
    app.fx.popup(bx, by, "+10", sg.TEXT)
    app.fx.update(0.12)
    app._sync_hud()
    app._sync_buttons()
    app.draw()
    grab(root, "02-playing.png")

    app.state = "paused"
    app._sync_buttons()
    app._sync_hud()
    app.draw()
    grab(root, "03-paused.png")

    app.help = True
    app.draw()
    grab(root, "04-help.png")
    app.help = False

    world.score = 180
    app.result_score = 180
    app.result_len = len(world.snake)
    app.result_mode = "classic"
    app.best = 180
    app.best_by_mode["classic"] = 180
    app.new_record = True
    app.new_mode_record = True
    app.victory = False
    app.state = "over"
    app._sync_hud()
    app._sync_buttons()
    app.draw()
    grab(root, "05-gameover.png")

    app.close()


if __name__ == "__main__":
    main()
