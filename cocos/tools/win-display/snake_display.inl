// SNAKE_DISPLAY_PATCH begin
namespace {
SDL_Window* gSnakeWindow = nullptr;
int gSnakeWindowedW = 0;
int gSnakeWindowedH = 0;
bool gSnakeApply = false;
bool gSnakeToggle = false;
bool gSnakeMark = false;
bool gSnakeFull = false;
int gSnakeApplyW = 0;
int gSnakeApplyH = 0;
int gSnakeApplyFull = 0;

std::string snakeExeDir() {
#if CC_PLATFORM == CC_PLATFORM_WINDOWS
    char path[MAX_PATH];
    DWORD n = GetModuleFileNameA(nullptr, path, MAX_PATH);
    if (n == 0 || n >= MAX_PATH) {
        return ".";
    }
    std::string dir(path, n);
    const auto slash = dir.find_last_of("\\/");
    if (slash == std::string::npos) {
        return ".";
    }
    dir.resize(slash);
    return dir;
#else
    return ".";
#endif
}

void snakeLogLine(const std::string& line) {
#if CC_PLATFORM == CC_PLATFORM_WINDOWS
    std::ofstream out(snakeExeDir() + "\\snake-boot.log", std::ios::app);
    if (out) {
        out << line << std::endl;
    }
#else
    (void)line;
#endif
}

#if CC_PLATFORM == CC_PLATFORM_WINDOWS
void snakeLogAddress(const char* label, uintptr_t addr) {
    HMODULE mod = nullptr;
    if (addr > 0x10000) {
        GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, reinterpret_cast<LPCSTR>(addr), &mod);
    }
    char modulePath[MAX_PATH] = "?";
    if (mod) {
        GetModuleFileNameA(mod, modulePath, MAX_PATH);
    }
    const auto base = reinterpret_cast<uintptr_t>(mod);
    char line[768];
    std::snprintf(line, sizeof(line), "%s %p %s+%llx", label, reinterpret_cast<void*>(addr), modulePath, static_cast<unsigned long long>(base ? addr - base : addr));
    snakeLogLine(line);
}

bool snakeReadable(const void* ptr, size_t bytes) {
    MEMORY_BASIC_INFORMATION info{};
    if (!VirtualQuery(ptr, &info, sizeof(info)) || info.State != MEM_COMMIT) {
        return false;
    }
    if (info.Protect & (PAGE_GUARD | PAGE_NOACCESS)) {
        return false;
    }
    const auto start = reinterpret_cast<uintptr_t>(info.BaseAddress);
    const auto addr = reinterpret_cast<uintptr_t>(ptr);
    return addr >= start && addr + bytes <= start + info.RegionSize;
}

LONG WINAPI snakeCrashFilter(EXCEPTION_POINTERS* info) {
    const DWORD code = (info && info->ExceptionRecord) ? info->ExceptionRecord->ExceptionCode : 0;
    char line[256];
    std::snprintf(line, sizeof(line), "crash code=%08lx", static_cast<unsigned long>(code));
    snakeLogLine(line);
#if defined(_M_X64)
    if (info && info->ContextRecord) {
        const CONTEXT* ctx = info->ContextRecord;
        std::snprintf(line, sizeof(line), "regs rip=%llx rsp=%llx rax=%llx rcx=%llx rdx=%llx r8=%llx r9=%llx",
                      static_cast<unsigned long long>(ctx->Rip), static_cast<unsigned long long>(ctx->Rsp),
                      static_cast<unsigned long long>(ctx->Rax), static_cast<unsigned long long>(ctx->Rcx),
                      static_cast<unsigned long long>(ctx->Rdx), static_cast<unsigned long long>(ctx->R8),
                      static_cast<unsigned long long>(ctx->R9));
        snakeLogLine(line);
        snakeLogAddress("rip", static_cast<uintptr_t>(ctx->Rip));
        for (int i = 0; i < 12; ++i) {
            const auto* slot = reinterpret_cast<const uintptr_t*>(ctx->Rsp) + i;
            if (!snakeReadable(slot, sizeof(uintptr_t))) {
                break;
            }
            char label[32];
            std::snprintf(label, sizeof(label), "stk%d", i);
            snakeLogAddress(label, *slot);
        }
    }
#else
    (void)info;
#endif
    return EXCEPTION_CONTINUE_SEARCH;
}

void snakeInstallCrashLog() {
    static bool installed = false;
    if (installed) {
        return;
    }
    installed = true;
    SetUnhandledExceptionFilter(snakeCrashFilter);
}
#else
void snakeInstallCrashLog() {}
#endif

bool snakeSmokeFlag() {
#if CC_PLATFORM == CC_PLATFORM_WINDOWS
    std::ifstream in(snakeExeDir() + "\\snake-smoke.txt");
    return static_cast<bool>(in);
#else
    return false;
#endif
}

int snakeDpiAwareness() {
#if CC_PLATFORM == CC_PLATFORM_WINDOWS
    HMODULE shcore = LoadLibraryW(L"shcore.dll");
    if (!shcore) {
        return -1;
    }
    using GetAwareness = HRESULT(WINAPI*)(HANDLE, int*);
    auto getAwareness = reinterpret_cast<GetAwareness>(GetProcAddress(shcore, "GetProcessDpiAwareness"));
    int awareness = -1;
    if (getAwareness) {
        getAwareness(nullptr, &awareness);
    }
    return awareness;
#else
    return -1;
#endif
}
}  // namespace

void snakeNoteWindow(SDL_Window* window) {
    if (window) {
        gSnakeWindow = window;
    }
}

SDL_Window* snakeResolveWindow(SDL_Window* window) {
    if (window) {
        return window;
    }
    if (gSnakeWindow) {
        return gSnakeWindow;
    }
    return SDL_GetKeyboardFocus();
}

struct SnakeMetrics {
    int width = 0;
    int height = 0;
    int screenW = 0;
    int screenH = 0;
    int workW = 0;
    int workH = 0;
    int dpi = 0;
    int fullscreen = 0;
    int smoke = 0;
    int awareness = -1;
};

#if CC_PLATFORM == CC_PLATFORM_WINDOWS
HWND snakeHwnd(SDL_Window* window);
#endif

SnakeMetrics snakeMeasure(SDL_Window* window) {
    SnakeMetrics metrics;
    metrics.smoke = snakeSmokeFlag() ? 1 : 0;
    metrics.awareness = snakeDpiAwareness();
    window = snakeResolveWindow(window);
    if (!window) {
        return metrics;
    }
    SDL_GetWindowSize(window, &metrics.width, &metrics.height);
#if CC_PLATFORM == CC_PLATFORM_WINDOWS
    HWND hwnd = snakeHwnd(window);
    if (hwnd) {
        RECT client{};
        if (GetClientRect(hwnd, &client)) {
            metrics.width = static_cast<int>(client.right - client.left);
            metrics.height = static_cast<int>(client.bottom - client.top);
        }
    }
#endif
    int index = SDL_GetWindowDisplayIndex(window);
    if (index < 0) {
        index = 0;
    }
    SDL_Rect bounds{};
    SDL_Rect usable{};
    if (SDL_GetDisplayBounds(index, &bounds) == 0) {
        metrics.screenW = bounds.w;
        metrics.screenH = bounds.h;
    }
    if (SDL_GetDisplayUsableBounds(index, &usable) == 0) {
        metrics.workW = usable.w;
        metrics.workH = usable.h;
    }
    float ddpi = 0;
    float hdpi = 0;
    float vdpi = 0;
    if (SDL_GetDisplayDPI(index, &ddpi, &hdpi, &vdpi) == 0 && hdpi > 0) {
        metrics.dpi = static_cast<int>(hdpi + 0.5f);
    }
    metrics.fullscreen = gSnakeFull ? 1 : 0;
    return metrics;
}

#if CC_PLATFORM == CC_PLATFORM_WINDOWS
HWND snakeHwnd(SDL_Window* window) {
    window = snakeResolveWindow(window);
    if (!window) {
        return nullptr;
    }
    SDL_SysWMinfo info;
    SDL_VERSION(&info.version);
    if (!SDL_GetWindowWMInfo(window, &info) || info.subsystem != SDL_SYSWM_WINDOWS) {
        return nullptr;
    }
    return info.info.win.window;
}
#endif

std::string snakeJson(const SnakeMetrics& metrics) {
    std::ostringstream out;
    out << "{\"ok\":1"
        << ",\"fullscreen\":" << metrics.fullscreen
        << ",\"width\":" << metrics.width
        << ",\"height\":" << metrics.height
        << ",\"screenW\":" << metrics.screenW
        << ",\"screenH\":" << metrics.screenH
        << ",\"workW\":" << metrics.workW
        << ",\"workH\":" << metrics.workH
        << ",\"dpi\":" << metrics.dpi
        << ",\"smoke\":" << metrics.smoke
        << "}";
    return out.str();
}

void snakeApplyWindow(SDL_Window* window, int width, int height, bool fullscreen) {
    snakeLogLine("apply-begin fullscreen=" + std::to_string(fullscreen ? 1 : 0) + " width=" + std::to_string(width) + " height=" + std::to_string(height));
    window = snakeResolveWindow(window);
#if CC_PLATFORM == CC_PLATFORM_WINDOWS
    HWND hwnd = snakeHwnd(window);
    if (!hwnd) {
        snakeLogLine("apply-failed no-hwnd");
        return;
    }
    if (!fullscreen) {
        RECT work{};
        int availW = width;
        int availH = height;
        int originX = 0;
        int originY = 0;
        if (SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0)) {
            availW = work.right - work.left;
            availH = work.bottom - work.top;
            originX = work.left;
            originY = work.top;
        }
        if (width < 640) {
            width = 640;
        }
        if (height < 360) {
            height = 360;
        }
        if (availW > 0 && width > availW) {
            width = availW;
        }
        if (availH > 0 && height > availH) {
            height = availH;
        }
        width &= ~1;
        height &= ~1;
        const LONG_PTR style = WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
        snakeLogLine("before-win32-window");
        SetWindowLongPtrW(hwnd, GWL_STYLE, style);
        RECT outer{0, 0, width, height};
        AdjustWindowRectEx(&outer, static_cast<DWORD>(style), FALSE, static_cast<DWORD>(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)));
        const int outerW = outer.right - outer.left;
        const int outerH = outer.bottom - outer.top;
        const int x = originX + std::max(0, (availW - outerW) / 2);
        const int y = originY + std::max(0, (availH - outerH) / 2);
        SetWindowPos(hwnd, HWND_NOTOPMOST, x, y, outerW, outerH, SWP_FRAMECHANGED | SWP_SHOWWINDOW);
        gSnakeWindowedW = width;
        gSnakeWindowedH = height;
        gSnakeFull = false;
    } else {
        if (!gSnakeFull && gSnakeWindowedW >= 640 && gSnakeWindowedH >= 360) {
            // Keep the last windowed client size for the next F11.
        } else if (!gSnakeFull) {
            RECT client{};
            if (GetClientRect(hwnd, &client)) {
                gSnakeWindowedW = std::max(640, static_cast<int>(client.right - client.left));
                gSnakeWindowedH = std::max(360, static_cast<int>(client.bottom - client.top));
            }
        }
        HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        MONITORINFO monitorInfo{};
        monitorInfo.cbSize = sizeof(monitorInfo);
        RECT bounds{0, 0, width, height};
        if (GetMonitorInfoW(monitor, &monitorInfo)) {
            bounds = monitorInfo.rcMonitor;
        }
        snakeLogLine("before-win32-fullscreen");
        SetWindowLongPtrW(hwnd, GWL_STYLE, WS_POPUP | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS);
        SetWindowPos(hwnd, HWND_TOP, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top, SWP_FRAMECHANGED | SWP_SHOWWINDOW);
        gSnakeFull = true;
    }
    SetForegroundWindow(hwnd);
    SetFocus(hwnd);
#else
    (void)width;
    (void)height;
    (void)fullscreen;
    snakeLogLine("apply-failed not-windows");
    return;
#endif
    const SnakeMetrics metrics = snakeMeasure(window);
    snakeLogLine("applied fullscreen=" + std::to_string(metrics.fullscreen) + " width=" + std::to_string(metrics.width) + " height=" + std::to_string(metrics.height));
}

void snakeToggleFullscreen(SDL_Window* window) {
    window = snakeResolveWindow(window);
    if (!window) {
        snakeLogLine("f11-failed no-window");
        return;
    }
    const bool fullscreen = gSnakeFull;
    int width = gSnakeWindowedW;
    int height = gSnakeWindowedH;
    if (width < 640 || height < 360) {
        SDL_GetWindowSize(window, &width, &height);
    }
    snakeApplyWindow(window, width, height, !fullscreen);
    const SnakeMetrics metrics = snakeMeasure(window);
    snakeLogLine("f11 fullscreen=" + std::to_string(metrics.fullscreen) + " width=" + std::to_string(metrics.width) + " height=" + std::to_string(metrics.height));
}

void snakePickDefaultWindow(int* width, int* height) {
    int availW = 1280;
    int availH = 720;
#if CC_PLATFORM == CC_PLATFORM_WINDOWS
    RECT work{};
    if (SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0)) {
        availW = work.right - work.left;
        availH = work.bottom - work.top;
    }
#endif
    if (availW < 2) {
        availW = 1280;
    }
    if (availH < 2) {
        availH = 720;
    }
    int pickW = availW & ~1;
    int pickH = (pickW * 9 / 16) & ~1;
    if (pickH > (availH & ~1)) {
        pickH = availH & ~1;
        pickW = (pickH * 16 / 9) & ~1;
        pickH = (pickW * 9 / 16) & ~1;
    }
    if (pickW < 640 || pickH < 360 || pickW > availW || pickH > availH) {
        pickW = std::max(2, std::min(availW, 960) & ~1);
        pickH = std::max(2, std::min(availH, 540) & ~1);
    }
    if (width) {
        *width = pickW;
    }
    if (height) {
        *height = pickH;
    }
}

void snakeFlushDisplay() {
    snakeInstallCrashLog();
    static bool announced = false;
    if (!announced) {
        announced = true;
        snakeLogLine("loop-enter");
        if (!gSnakeApply && !gSnakeToggle) {
            int pickW = 1280;
            int pickH = 720;
            snakePickDefaultWindow(&pickW, &pickH);
            gSnakeApply = true;
            gSnakeApplyW = pickW;
            gSnakeApplyH = pickH;
            // 启动即全屏：原生在第一帧就切全屏，避免先出现窗口再放大的跳变。
            // 想回到窗口模式可以在游戏内设置里切换，下次启动仍会默认全屏。
            gSnakeApplyFull = 1;
            snakeLogLine("queued default fullscreen " + std::to_string(pickW) + "x" + std::to_string(pickH));
        }
    }
    if (!gSnakeApply && !gSnakeToggle && !gSnakeMark) {
        return;
    }
    const bool apply = gSnakeApply;
    const bool toggle = gSnakeToggle;
    const bool mark = gSnakeMark;
    const int width = gSnakeApplyW;
    const int height = gSnakeApplyH;
    const int fullscreen = gSnakeApplyFull;
    gSnakeApply = false;
    gSnakeToggle = false;
    gSnakeMark = false;
    if (toggle) {
        snakeToggleFullscreen(nullptr);
    } else if (apply) {
        snakeApplyWindow(nullptr, width, height, fullscreen != 0);
    }
    if (mark) {
        const SnakeMetrics metrics = snakeMeasure(nullptr);
        snakeLogLine("mark fullscreen=" + std::to_string(metrics.fullscreen) + " width=" + std::to_string(metrics.width) + " height=" + std::to_string(metrics.height));
    }
}

void snakeLogBoot(SDL_Window* window) {
    snakeInstallCrashLog();
    const SnakeMetrics metrics = snakeMeasure(window);
    snakeLogLine("boot width=" + std::to_string(metrics.width) + " height=" + std::to_string(metrics.height) + " dpi=" + std::to_string(metrics.dpi) + " awareness=" + std::to_string(metrics.awareness) + " fullscreen=" + std::to_string(metrics.fullscreen) + " screen=" + std::to_string(metrics.screenW) + "x" + std::to_string(metrics.screenH) + " work=" + std::to_string(metrics.workW) + "x" + std::to_string(metrics.workH));
}

std::string snakeDisplayCommand(const char* op, int width, int height, int fullscreen) {
    const std::string which = op ? op : "state";
    snakeLogLine("js op=" + which + " width=" + std::to_string(width) + " height=" + std::to_string(height) + " fullscreen=" + std::to_string(fullscreen));
    if (which == "set") {
        gSnakeApply = true;
        gSnakeToggle = false;
        gSnakeApplyW = width;
        gSnakeApplyH = height;
        gSnakeApplyFull = fullscreen;
    } else if (which == "toggle") {
        gSnakeToggle = true;
        gSnakeApply = false;
    } else if (which == "mark") {
        gSnakeMark = true;
    }
    return snakeJson(snakeMeasure(nullptr));
}
// SNAKE_DISPLAY_PATCH end
