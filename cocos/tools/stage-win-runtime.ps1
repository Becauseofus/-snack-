# Copy the release VC++ runtime next to Snake.exe and drop debug CRT copies.
# Cocos's own msvcr folder ships vcruntime140_1d.dll and omits vcruntime140_1.dll.
param(
    [Parameter(Mandatory = $true)][string]$Stage
)

$ErrorActionPreference = "Stop"
function Stop-Pack([string]$Message) { Write-Host $Message; exit 1 }
if (-not (Test-Path (Join-Path $Stage "Snake.exe"))) {
    Stop-Pack "Stage is missing Snake.exe: $Stage"
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath |
    Select-Object -First 1
if (-not $vs) { Stop-Pack "Visual Studio with the C++ toolset was not found" }

$crt = Get-ChildItem -Path (Join-Path $vs "VC") -Recurse -Filter "vcruntime140_1.dll" -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -eq "vcruntime140_1.dll" -and
        $_.FullName -match '\\x64\\' -and
        $_.FullName -notmatch '\\debug\\|\\onecore\\'
    } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if (-not $crt) { Stop-Pack "Release vcruntime140_1.dll was not found under $vs" }
Write-Host "CRT directory $($crt.DirectoryName)"

$names = @(
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "msvcp140.dll",
    "msvcp140_1.dll",
    "msvcp140_2.dll",
    "msvcp140_atomic_wait.dll",
    "concrt140.dll",
    "vccorlib140.dll"
)
foreach ($name in $names) {
    $src = Join-Path $crt.DirectoryName $name
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $Stage $name) -Force
        Write-Host "Bundled $name"
    }
}
if (-not (Test-Path (Join-Path $Stage "vcruntime140_1.dll"))) {
    Stop-Pack "Failed to stage vcruntime140_1.dll"
}

Get-ChildItem $Stage -File | Where-Object {
    $_.Name -match '^(vcruntime|msvcp|ucrtbase|concrt|vccorlib).*d\.dll$'
} | ForEach-Object {
    Write-Host "Removing debug runtime $($_.Name)"
    Remove-Item $_.FullName -Force
}

$webpRoots = @(
    "cocos\build",
    "C:\cocos-creator-3.8.6\resources\resources\3d\engine\native\external\win64"
)
$webp = $webpRoots | ForEach-Object {
    if (Test-Path $_) {
        Get-ChildItem $_ -Recurse -Filter "webp.dll" -ErrorAction SilentlyContinue
    }
} | Where-Object { $_.FullName -notmatch '\\debug\\' } | Select-Object -First 1
if ($webp) {
    Copy-Item $webp.FullName (Join-Path $Stage "webp.dll") -Force
    Write-Host "Bundled webp.dll from $($webp.FullName)"
} elseif (Test-Path (Join-Path $Stage "libwebpmux.dll")) {
    Write-Host "Removing libwebpmux.dll. It imports webp.dll, which this engine does not ship, and Snake.exe does not import it."
    Remove-Item (Join-Path $Stage "libwebpmux.dll") -Force
}

# Turn off the Cocos splash screen. Otherwise the game shows a windowed logo
# for two seconds and only then switches to fullscreen.
# Only the two splash numbers are touched, everything else stays as built.
$settingsPath = Join-Path $Stage "Resources\src\settings.json"
if (Test-Path $settingsPath) {
    $text = [System.IO.File]::ReadAllText($settingsPath)
    $patched = $text -replace '("splashScreen"\s*:\s*\{[^{}]*?"displayRatio"\s*:\s*)[0-9.]+', '${1}0'
    $patched = $patched -replace '("splashScreen"\s*:\s*\{[^{}]*?"totalTime"\s*:\s*)[0-9.]+', '${1}0'
    if ($patched -ne $text) {
        [System.IO.File]::WriteAllText($settingsPath, $patched, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "Disabled the Cocos splash screen"
    }
}

# Keep PCM files accessible to the Windows default-device audio backend.
$audioDest = Join-Path $Stage "Resources\audio"
New-Item -ItemType Directory -Force -Path $audioDest | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot "..\assets\resources\audio\*.wav") -Destination $audioDest -Force
