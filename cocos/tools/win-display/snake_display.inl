// SNAKE_DISPLAY_PATCH begin
namespace {
SDL_Window* gSnakeWindow = nullptr;
int gSnakeWindowedW = 0;
int gSnakeWindowedH = 0;

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
        out << line << "\n";
    }
#else
    (void)line;
#endif
}

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

SnakeMetrics snakeMeasure(SDL_Window* window) {
    SnakeMetrics metrics;
    metrics.smoke = snakeSmokeFlag() ? 1 : 0;
    metrics.awareness = snakeDpiAwareness();
    window = snakeResolveWindow(window);
    if (!window) {
        return metrics;
    }
    SDL_GetWindowSize(window, &metrics.width, &metrics.height);
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
    const Uint32 flags = SDL_GetWindowFlags(window);
    metrics.fullscreen = (flags & (SDL_WINDOW_FULLSCREEN | SDL_WINDOW_FULLSCREEN_DESKTOP)) ? 1 : 0;
    return metrics;
}

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

void snakeFocus(SDL_Window* window) {
    if (!window) {
        return;
    }
    SDL_RaiseWindow(window);
#if SDL_VERSION_ATLEAST(2, 0, 18)
    SDL_SetWindowInputFocus(window);
#endif
}

void snakeApplyWindow(SDL_Window* window, int width, int height, bool fullscreen) {
    window = snakeResolveWindow(window);
    if (!window) {
        snakeLogLine("apply-failed no-window");
        return;
    }
    int index = SDL_GetWindowDisplayIndex(window);
    if (index < 0) {
        index = 0;
    }
    SDL_Rect usable{};
    if (SDL_GetDisplayUsableBounds(index, &usable) != 0 || usable.w <= 0 || usable.h <= 0) {
        SDL_GetDisplayBounds(index, &usable);
    }
    if (!fullscreen) {
        if (width < 640) {
            width = 640;
        }
        if (height < 360) {
            height = 360;
        }
        if (usable.w > 0 && width > usable.w) {
            width = usable.w;
        }
        if (usable.h > 0 && height > usable.h) {
            height = usable.h;
        }
        width &= ~1;
        height &= ~1;
        if (SDL_GetWindowFlags(window) & (SDL_WINDOW_FULLSCREEN | SDL_WINDOW_FULLSCREEN_DESKTOP)) {
            SDL_SetWindowFullscreen(window, 0);
        }
        SDL_SetWindowBordered(window, SDL_TRUE);
        SDL_SetWindowResizable(window, SDL_TRUE);
        SDL_SetWindowSize(window, width, height);
        if (usable.w >= width && usable.h >= height) {
            const int x = usable.x + std::max(0, (usable.w - width) / 2);
            const int y = usable.y + std::max(0, (usable.h - height) / 2);
            SDL_SetWindowPosition(window, x, y);
        }
        gSnakeWindowedW = width;
        gSnakeWindowedH = height;
    } else {
        if (!(SDL_GetWindowFlags(window) & (SDL_WINDOW_FULLSCREEN | SDL_WINDOW_FULLSCREEN_DESKTOP))) {
            int currentW = 0;
            int currentH = 0;
            SDL_GetWindowSize(window, &currentW, &currentH);
            if (currentW >= 640 && currentH >= 360) {
                gSnakeWindowedW = currentW;
                gSnakeWindowedH = currentH;
            }
        }
        SDL_SetWindowFullscreen(window, SDL_WINDOW_FULLSCREEN_DESKTOP);
    }
    snakeFocus(window);
    const SnakeMetrics metrics = snakeMeasure(window);
    snakeLogLine("applied fullscreen=" + std::to_string(metrics.fullscreen) + " width=" + std::to_string(metrics.width) + " height=" + std::to_string(metrics.height));
}

void snakeToggleFullscreen(SDL_Window* window) {
    window = snakeResolveWindow(window);
    if (!window) {
        snakeLogLine("f11-failed no-window");
        return;
    }
    const bool fullscreen = (SDL_GetWindowFlags(window) & (SDL_WINDOW_FULLSCREEN | SDL_WINDOW_FULLSCREEN_DESKTOP)) != 0;
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
    const int candidates[][2] = {{2560, 1440}, {1920, 1080}, {1600, 900}, {1280, 720}, {960, 540}};
    int pickW = 960;
    int pickH = 540;
    bool found = false;
    for (const auto& candidate : candidates) {
        if (candidate[0] <= availW && candidate[1] <= availH) {
            pickW = candidate[0];
            pickH = candidate[1];
            found = true;
            break;
        }
    }
    if (!found) {
        pickW = std::max(640, std::min(availW, 960));
        pickH = std::max(360, std::min(availH, 540));
    }
    if (width) {
        *width = pickW;
    }
    if (height) {
        *height = pickH;
    }
}

void snakeLogBoot(SDL_Window* window) {
    const SnakeMetrics metrics = snakeMeasure(window);
    snakeLogLine("boot width=" + std::to_string(metrics.width) + " height=" + std::to_string(metrics.height) + " dpi=" + std::to_string(metrics.dpi) + " awareness=" + std::to_string(metrics.awareness) + " fullscreen=" + std::to_string(metrics.fullscreen) + " screen=" + std::to_string(metrics.screenW) + "x" + std::to_string(metrics.screenH) + " work=" + std::to_string(metrics.workW) + "x" + std::to_string(metrics.workH));
}

std::string snakeDisplayCommand(const char* op, int width, int height, int fullscreen) {
    const std::string which = op ? op : "state";
    SDL_Window* window = snakeResolveWindow(nullptr);
    if (which == "set") {
        snakeApplyWindow(window, width, height, fullscreen != 0);
    } else if (which == "toggle") {
        snakeToggleFullscreen(window);
    } else if (which == "mark") {
        const SnakeMetrics metrics = snakeMeasure(window);
        snakeLogLine("mark fullscreen=" + std::to_string(metrics.fullscreen) + " width=" + std::to_string(metrics.width) + " height=" + std::to_string(metrics.height));
    }
    return snakeJson(snakeMeasure(nullptr));
}
// SNAKE_DISPLAY_PATCH end
