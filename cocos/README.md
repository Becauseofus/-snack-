# 贪吃蛇 · Cocos Creator 3.8

Python 版的玩法移植。工程用 Cocos Creator **3.8.6** 建的，3.8 的更新版本打开时如果提示升级工程，按编辑器的迁移走即可。

场景是 `assets/game.scene`。`Canvas` 上已经挂了 `GameApp`，打开工程选这个场景就能预览，不用再拖脚本。

## 在自己的电脑上打开

1. 安装 [Cocos Creator 3.8.x](https://www.cocos.com/creator-download)（Dashboard 或下面的 zip 都行）。
2. 用 Dashboard 打开本目录 `cocos/`。Dashboard 默认要登录 Cocos 账号。不想登录的话，在 Dashboard 右上角的启动参数里加上 `--nologin`，这是 3.8 仍认的参数。
3. 打开 `assets/game.scene`，点预览。

界面文字全是中文。存档走 `sys.localStorage`，键名 `SnakeGame.settings`，内容和原来的最高分、分模式纪录、最近十局、速度、模式、音效开关一样。

## 和 Python 版一样的规则

- **经典**：撞墙结束，速度只听滑条。
- **禅意**：穿出对面，基础节奏再慢一截。撞到自己仍然结束。
- **挑战**：撞墙结束，吃得越多越快，特殊果更常见。
- 对局中换模式，下一局才生效。
- 浆果 +10。星果 +30，并且下一格再长一节。时砂慢动作约 4.5 秒。莲灯让接下来三次得分翻倍。
- 转向最多预存两次，当前这一格走完才换方向。不吃东西时，即将空出来的尾巴那一格可以走进去。
- 空格 / P 暂停，R 重开，H / F1 帮助，Esc 先关帮助或记录，再退出全屏，否则回标题。N 开关音效。F11 切浏览器全屏。
- 结算卡片有本局分数、历史最高、本模式最高、长度。超过历史最高显示「新纪录」，只超过本模式显示「经典新纪录」这类字，卡片描边变成金色。
- 网页里音效用 Web Audio 合成，没有外部音乐文件。桌面版会优先播 `assets/resources/audio` 里的短 wav。没有音频接口时，开关写成「音效（系统不支持）」。

蛇是一条连续的身子：尖吻、两侧琥珀色竖瞳，没有圆白眼、腮红和笑脸。背上有鳞，肚子是浅色，尾巴收到一个点，隔一会儿吐一下分叉的信子。

手机上可以用滑动，或者右下角的方向键。

## 命令行构建

编辑器只有 Windows / macOS。下面这条是 3.8 官方的命令行形式，再加了 `--nologin`：

```bat
CocosCreator.exe --nologin --project <cocos 目录的绝对路径> --build "platform=web-mobile;debug=false;startScene=7c3e9a10-4b28-4f6d-8a15-2e9d0c6b4f31;outputName=web-mobile;name=Snake"
```

构建成功时进程退出码是 **36**，不是 0。产物在 `cocos/build/web-mobile/`。

Windows 包要分两步：上面的命令把 `platform` 换成 `windows`，生成 Visual Studio 工程；再用 VS 2022 的「使用 C++ 的桌面开发」编译 `cocos/build/windows` 里的 `.sln`。编辑器 zip 里带了 native 引擎的 CMake 工程，编译本身不需要再登录。

3.8.6 安装包（不需要账号）:

`https://download.cocos.com/CocosCreator/v3.8.6/CocosCreator-v3.8.6-win-032501.zip`

解压后根目录就是 `CocosCreator.exe`。

## 登录这件事，查过编辑器包里的启动代码

`CocosCreator.exe` 里，只要参数里有 `--build`，启动会走 `manager(skipLogin = true)`，然后构建完 `process.exit`。这条路径不打开 Dashboard，也不弹登录窗。`--nologin` 只影响「打开工程来编辑」那条路径，构建本身已经跳过登录。

会要登录、或者要本机操作的是这些：

- 用 Dashboard 打开工程做编辑、预览。不登录就进不去 Dashboard，除非启动参数写 `--nologin`。
- 命令行进程仍然要有桌面会话。官方文档写了命令行构建需要 GUI 环境。GitHub 的 `windows-latest` 有桌面会话，所以工作流 `.github/workflows/cocos.yml` 会在那上面试。服务会话（Session 0）里 Electron 起不来，那种机器做不到无人构建。
- 第一次在本机「生成」Windows 包时，如果本机没有 VS 2022 的 C++ 工作负载，编译会停在这一步。这一步不在编辑器登录里，但必须有本机的编译器。

## 已经在 GitHub Actions 上跑过

`web-mobile` 在 `windows-latest` 上构建成功，退出码 36，没有弹出登录。产物是该次运行的 artifact `web-mobile`。

GitHub Pages 要仓库管理员先打开一次：Settings → Pages → Source 选 GitHub Actions。没打开时部署接口返回 404，不会有网页地址。这是仓库设置，不是 Cocos 账号。

Windows 工程那一步，编辑器自带的 CMake 报了 `could not find any instance of Visual Studio`，没认出 runner 上的 Visual Studio 2022。工作流会在生成工程前换成 runner 自带的较新 CMake，并在 `cocos/tools/build-windows.json` 里指定 `vsVersion` 为 `2022`。编译仍然依赖本机的 MSVC。
