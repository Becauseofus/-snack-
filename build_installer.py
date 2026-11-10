# -*- coding: utf-8 -*-
"""用 PyInstaller 打出 Windows 游戏和安装包。

必须在 Windows 上运行（生成的是 .exe）。游戏本身没有第三方运行库。

    python build_installer.py
    python build_installer.py --dry-run

产物：
    dist/贪吃蛇.exe
    dist/贪吃蛇安装程序.exe
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
GAME_NAME = "贪吃蛇"
SETUP_NAME = "贪吃蛇安装程序"


def pyinstaller_base(work_name):
    return [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean",
        "--onefile", "--windowed",
        "--distpath", os.path.join(ROOT, "dist"),
        "--workpath", os.path.join(ROOT, "build", work_name),
        "--specpath", os.path.join(ROOT, "build", "spec"),
    ]


def commands():
    game_exe = os.path.join(ROOT, "dist", f"{GAME_NAME}.exe")
    # PyInstaller 在 Windows 上用分号分隔「源;目标」
    add_data = game_exe + ";."
    game = pyinstaller_base("game") + ["--name", GAME_NAME, os.path.join(ROOT, "snake_gui.py")]
    setup = pyinstaller_base("setup") + [
        "--name", SETUP_NAME,
        "--add-data", add_data,
        os.path.join(ROOT, "setup_snake.py"),
    ]
    return game, setup


def ensure_pyinstaller():
    try:
        import PyInstaller  # noqa: F401
    except Exception:
        print("没有 PyInstaller。先执行：")
        print(f"    {sys.executable} -m pip install -r requirements.txt")
        return False
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description="打包贪吃蛇 Windows 安装程序")
    parser.add_argument("--dry-run", action="store_true", help="只打印将要执行的命令")
    args = parser.parse_args(argv)
    game, setup = commands()
    print("游戏：")
    print(" ", subprocess.list2cmdline(game))
    print("安装包：")
    print(" ", subprocess.list2cmdline(setup))
    if args.dry_run:
        return 0
    if sys.platform != "win32":
        print("\n请在 Windows 上运行此脚本。这里只能检查命令，不能生成 .exe。")
        print("游戏可以直接运行：python snake_gui.py")
        return 2
    if not ensure_pyinstaller():
        return 1
    os.chdir(ROOT)
    if os.path.isdir(os.path.join(ROOT, "build")):
        shutil.rmtree(os.path.join(ROOT, "build"), ignore_errors=True)
    subprocess.check_call(game)
    game_exe = os.path.join(ROOT, "dist", f"{GAME_NAME}.exe")
    if not os.path.isfile(game_exe):
        print("没有生成", game_exe)
        return 1
    subprocess.check_call(setup)
    print("\n完成：")
    print(" ", os.path.join(ROOT, "dist", f"{GAME_NAME}.exe"))
    print(" ", os.path.join(ROOT, "dist", f"{SETUP_NAME}.exe"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
