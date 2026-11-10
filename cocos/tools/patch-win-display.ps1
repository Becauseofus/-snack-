# Patch the Cocos 3.8.6 Windows engine that this job compiles.
# Native screen.requestFullScreen() is a no-op in 3.8.6, and the default window is 800x600.
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$snippet = Get-Content -Raw -Path (Join-Path $PSScriptRoot "win-display\snake_display.inl")
if ($snippet -notmatch "SNAKE_DISPLAY_PATCH begin") { throw "Display snippet is missing" }

$search = @(
    "C:\cocos-creator-3.8.6",
    (Join-Path $root "cocos\build")
) | Where-Object { Test-Path $_ }

function Get-EngineFiles([string]$Name) {
    $hits = @()
    foreach ($dir in $search) {
        $hits += Get-ChildItem -Path $dir -Recurse -Filter $Name -File -ErrorAction SilentlyContinue
    }
    return $hits | Sort-Object FullName -Unique
}

function Read-Norm([string]$Path) {
    return ([IO.File]::ReadAllText($Path) -replace "`r`n", "`n" -replace "`r", "`n")
}

function Write-Norm([string]$Path, [string]$Text) {
    $text = $Text -replace "`r`n", "`n" -replace "`r", "`n"
    [IO.File]::WriteAllText($Path, $text)
}

function Assert-Replaced([string]$Path, [string]$Before, [string]$After, [string]$Label) {
    $text = Read-Norm $Path
    $before = $Before -replace "`r`n", "`n" -replace "`r", "`n"
    $after = $After -replace "`r`n", "`n" -replace "`r", "`n"
    if ($text.Contains($after.Trim())) {
        Write-Host "already patched $Label $Path"
        return
    }
    if (-not $text.Contains($before)) {
        throw "Could not find $Label in $Path"
    }
    Write-Norm $Path ($text.Replace($before, $after))
    Write-Host "patched $Label $Path"
}

$includes = @"
#include <algorithm>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#if CC_PLATFORM == CC_PLATFORM_WINDOWS
#include <windows.h>
#endif
// SNAKE_DISPLAY_PATCH includes

"@

$sdlFiles = @(Get-EngineFiles "SDLHelper.cpp")
if (-not $sdlFiles) { throw "SDLHelper.cpp was not found under the Cocos engine" }
foreach ($file in $sdlFiles) {
    $text = Read-Norm $file.FullName
    if ($text -notmatch "SNAKE_DISPLAY_PATCH includes") {
        $anchor = '#include "platform/interfaces/modules/ISystemWindowManager.h"'
        if (-not $text.Contains($anchor)) { throw "SDLHelper include anchor missing in $($file.FullName)" }
        $text = $text.Replace($anchor, $anchor + "`n" + $includes.TrimEnd())
    }
    if ($text -notmatch "SNAKE_DISPLAY_PATCH begin") {
        $anchor = "namespace cc {"
        $index = $text.IndexOf($anchor)
        if ($index -lt 0) { throw "SDLHelper namespace anchor missing in $($file.FullName)" }
        $text = $text.Insert($index + $anchor.Length, "`n" + $snippet.TrimEnd() + "`n")
    }
    if (-not $text.Contains("snakeNoteWindow(handle)")) {
        $created = $text.IndexOf("SDL_CreateWindow")
        $ret = if ($created -ge 0) { $text.IndexOf("return handle;", $created) } else { -1 }
        if ($ret -lt 0) {
            $sample = if ($created -ge 0) { $text.Substring($created, [Math]::Min(700, $text.Length - $created)) } else { "SDL_CreateWindow not found" }
            throw "SDL window create anchor missing in $($file.FullName)`n$sample"
        }
        $text = $text.Insert($ret, "snakeNoteWindow(handle); // SNAKE_DISPLAY_PATCH`n    snakeLogBoot(handle);`n    ")
    }
    if (-not $text.Contains("snakeToggleFullscreen(SDL_GetWindowFromID")) {
        $keyAt = $text.IndexOf("case SDL_KEYDOWN:")
        if ($keyAt -lt 0) { throw "SDL keydown anchor missing in $($file.FullName)" }
        $lineEnd = $text.IndexOf("`n", $keyAt)
        $nextEnd = $text.IndexOf("`n", $lineEnd + 1)
        if ($nextEnd -lt 0) { throw "SDL keydown block is truncated in $($file.FullName)" }
        $hook = "            if (event.keysym.sym == SDLK_F11 && !event.repeat) {`n                snakeToggleFullscreen(SDL_GetWindowFromID(event.windowID)); // SNAKE_DISPLAY_PATCH`n            }`n"
        $text = $text.Insert($nextEnd + 1, $hook)
    }
    Write-Norm $file.FullName $text
    Write-Host "patched SDLHelper $($file.FullName)"
}

$baseFiles = @(Get-EngineFiles "BaseGame.cpp")
if (-not $baseFiles) { throw "BaseGame.cpp was not found" }
foreach ($file in $baseFiles) {
    Assert-Replaced $file.FullName `
        "int BaseGame::init() {" `
        "void snakePickDefaultWindow(int* width, int* height); // SNAKE_DISPLAY_PATCH`nint BaseGame::init() {" `
        "BaseGame declaration"
    Assert-Replaced $file.FullName `
        "_windowInfo.width = _windowInfo.width == -1 ? 800 : _windowInfo.width;`n    _windowInfo.height = _windowInfo.height == -1 ? 600 : _windowInfo.height;" `
        @"
if (_windowInfo.width == -1 || _windowInfo.height == -1) {
        int pickW = 1280;
        int pickH = 720;
        snakePickDefaultWindow(&pickW, &pickH); // SNAKE_DISPLAY_PATCH
        if (_windowInfo.width == -1) {
            _windowInfo.width = pickW;
        }
        if (_windowInfo.height == -1) {
            _windowInfo.height = pickH;
        }
    }
"@ `
        "BaseGame size"
}

$platformFiles = @(Get-EngineFiles "WindowsPlatform.cpp")
if (-not $platformFiles) { throw "WindowsPlatform.cpp was not found" }
$dpi = @'
int32_t WindowsPlatform::init() {
    // SNAKE_DISPLAY_PATCH dpi
    {
        using SetProcessDpiAwarenessContextFn = BOOL(WINAPI*)(HANDLE);
        auto setContext = reinterpret_cast<SetProcessDpiAwarenessContextFn>(GetProcAddress(GetModuleHandleW(L"user32.dll"), "SetProcessDpiAwarenessContext"));
        if (!setContext || !setContext(reinterpret_cast<HANDLE>(static_cast<LONG_PTR>(-4)))) {
            SetProcessDPIAware();
        }
    }
'@
foreach ($file in $platformFiles) {
    Assert-Replaced $file.FullName "int32_t WindowsPlatform::init() {" $dpi.TrimEnd() "WindowsPlatform dpi"
}

$bindFiles = @(Get-EngineFiles "jsb_global.cpp")
if (-not $bindFiles) { throw "jsb_global.cpp was not found" }
$binding = @'

namespace cc {
std::string snakeDisplayCommand(const char* op, int width, int height, int fullscreen);
}

static bool JSB_snakeDisplay(se::State& s) {  // SNAKE_DISPLAY_PATCH
    const auto& args = s.args();
    ccstd::string op = "state";
    if (args.size() > 0) {
        op = args[0].toString();
    }
    const int width = args.size() > 1 ? args[1].toInt32() : 0;
    const int height = args.size() > 2 ? args[2].toInt32() : 0;
    const int fullscreen = args.size() > 3 ? args[3].toInt32() : 0;
    s.rval().setString(cc::snakeDisplayCommand(op.c_str(), width, height, fullscreen));
    return true;
}
SE_BIND_FUNC(JSB_snakeDisplay)

'@
foreach ($file in $bindFiles) {
    $text = Read-Norm $file.FullName
    if (-not $text.Contains("JSB_snakeDisplay")) {
        $anchor = "bool jsb_register_global_variables(se::Object *global)"
        if (-not $text.Contains($anchor)) { throw "jsb register anchor missing in $($file.FullName)" }
        $text = $text.Replace($anchor, $binding.TrimEnd() + "`n" + $anchor)
    }
    if (-not $text.Contains('defineFunction("snakeDisplay"')) {
        $anchor = "se::ScriptEngine::getInstance()->clearException();"
        $index = $text.LastIndexOf($anchor)
        if ($index -lt 0) { throw "jsb clearException anchor missing in $($file.FullName)" }
        $text = $text.Insert($index, "__jsbObj->defineFunction(`"snakeDisplay`", _SE(JSB_snakeDisplay)); // SNAKE_DISPLAY_PATCH`n    ")
    }
    Write-Norm $file.FullName $text
    Write-Host "patched jsb $($file.FullName)"
}

$managerFiles = @(Get-EngineFiles "SystemWindowManager.cpp")
if (-not $managerFiles) { throw "SystemWindowManager.cpp was not found" }
foreach ($file in $managerFiles) {
    $text = Read-Norm $file.FullName
    if (-not $text.Contains("snakeFlushDisplay();")) {
        $anchor = "void SystemWindowManager::processEvent() {"
        if (-not $text.Contains($anchor)) { throw "processEvent anchor missing in $($file.FullName)" }
        $text = $text.Replace($anchor, "void snakeFlushDisplay(); // SNAKE_DISPLAY_PATCH`n" + $anchor + "`n    snakeFlushDisplay(); // SNAKE_DISPLAY_PATCH")
    }
    if ($text.Contains("CC_ASSERT(window);") -and -not $text.Contains("SNAKE_DISPLAY_PATCH null-window")) {
        $text = $text.Replace("CC_ASSERT(window);", "if (!window) { continue; } // SNAKE_DISPLAY_PATCH null-window")
    }
    Write-Norm $file.FullName $text
    Write-Host "patched SystemWindowManager $($file.FullName)"
}

exit 0
