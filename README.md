# 贪吃蛇

一款使用 Cocos Creator 制作的中文贪吃蛇游戏，提供 Windows 安装包、免安装版和网页构建。当前发布版本为 **1.0.8**。

## 下载与安装

在 [GitHub Releases](https://github.com/Becauseofus/-snack-/releases/latest) 下载：

| 文件 | 用途 |
| --- | --- |
| `Snake-cocos-Setup-win64.exe` | Windows 64 位安装包，可选择安装位置，并创建快捷方式 |
| `Snake-cocos-win64.zip` | 免安装版，解压后运行 `Snake.exe` |

安装时请关闭正在运行的游戏。部分安全软件可能提示安装程序正在写入 DLL；先核对安装包来源和目标路径，再决定是否允许。不要通过重命名 DLL 来绕过提示。

## 玩法

使用方向键或 WASD 控制蛇转向。标题界面按普通按键开始游戏；F1–F12 和 Win 键不会启动游戏。游戏内有经典、禅意和挑战三种模式，对局中切换模式会在下一局生效。

| 按键 | 操作 |
| --- | --- |
| 方向键 / WASD | 转向，可预存两次 |
| 空格 / P | 暂停或继续 |
| R | 重新开始 |
| H / F1 | 打开玩法说明 |
| N | 开关音效 |
| F11 | 切换窗口与全屏 |
| Esc | 关闭设置，或返回标题 |

浆果得 10 分；星果得 30 分并额外增长；时砂暂时减速；莲灯让接下来三次得分翻倍。禅意模式可穿过边界，挑战模式会随着吃到的果实加速。

## 皮肤与设置

标题界面和游戏中都可以点击“皮肤”，选择经典青蛇、金鳞祥龙、霓光机械蛇或草莓糖果蛇。皮肤面板右侧有预览；机械蛇的头部屏幕会闪烁。选择会自动保存，标题蛇也会同步变化。

“设置”中可以调整显示方式、音效并查看玩法和记录。最高分、历史记录及皮肤选择保存在本机。Windows 版音效使用随游戏提供的 WAV 文件。

## 源码与构建

当前发布使用 [Cocos Creator 工程](cocos/)（3.8.6）。打开 `cocos/assets/game.scene` 可预览；Windows 和网页的构建步骤见 [Cocos 工程说明](cocos/README.md)。推送 `cocos-v*` 标签会触发 GitHub Actions 构建并发布 Windows 安装包。

仓库根目录的 `snake_gui.py` 是早期 Python 版，使用 `python snake_gui.py` 运行；它与当前 Cocos 发布版的界面和功能不同。

运行 Cocos 逻辑测试：

```bash
node --import ./test-loader.mjs --test cocos/tests/*.test.ts
```

[贡献者说明](CONTRIBUTORS.md)
