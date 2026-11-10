# Install the built game, launch it, and collect a window log plus screenshots.
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$log = Join-Path $OutDir "install.log"
$args = @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/DIR=$InstallDir", "/LOG=$log")
Write-Host "Installing $Setup -> $InstallDir"
$installer = Start-Process -FilePath $Setup -ArgumentList $args -PassThru -Wait
if ($installer.ExitCode -ne 0) { throw "Installer exit code $($installer.ExitCode)" }
$exe = Join-Path $InstallDir "Snake.exe"
if (-not (Test-Path $exe)) { throw "Installed Snake.exe is missing" }
if (-not (Test-Path (Join-Path $InstallDir "vcruntime140_1.dll"))) { throw "Installed folder is missing vcruntime140_1.dll" }
if (Test-Path (Join-Path $InstallDir "vcruntime140_1d.dll")) { throw "Installed folder still contains vcruntime140_1d.dll" }

& "$PSScriptRoot\check-win-imports.ps1" -Stage $InstallDir
if ($LASTEXITCODE -ne 0) { throw "Installed package failed the import check" }

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
public class SnakeShellLink {}
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
public interface ISnakeShellLinkW {
    [PreserveSig] int GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, uint fFlags);
}
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
public interface ISnakePersistFile {
    void GetClassID(out Guid pClassID);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, bool fRemember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
}
public static class SnakeLnk {
    public static string Read(string path) {
        var link = (ISnakeShellLinkW)new SnakeShellLink();
        ((ISnakePersistFile)link).Load(path, 0);
        var sb = new StringBuilder(2048);
        link.GetPath(sb, sb.Capacity, IntPtr.Zero, 0);
        if (sb.Length == 0) link.GetPath(sb, sb.Capacity, IntPtr.Zero, 4);
        return sb.ToString();
    }
}
"@

function Test-ByteSpan([byte[]]$Hay, [byte[]]$Needle) {
    if ($Needle.Length -eq 0 -or $Hay.Length -lt $Needle.Length) { return $false }
    for ($i = 0; $i -le $Hay.Length - $Needle.Length; $i++) {
        $ok = $true
        for ($j = 0; $j -lt $Needle.Length; $j++) {
            if ($Hay[$i + $j] -ne $Needle[$j]) { $ok = $false; break }
        }
        if ($ok) { return $true }
    }
    return $false
}

$wanted = [System.IO.Path]::GetFullPath($exe)
$wantedUtf16 = [System.Text.Encoding]::Unicode.GetBytes($wanted)
$wantedAscii = [System.Text.Encoding]::ASCII.GetBytes($wanted)
$shortcutRoots = @(
    [Environment]::GetFolderPath("Desktop"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs")
)
$shortcutOk = $false
foreach ($root in $shortcutRoots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem $root -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
        $target = ""
        try { $target = [SnakeLnk]::Read($_.FullName) } catch { Write-Host "shortcut read failed $($_.FullName): $($_.Exception.Message)" }
        $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
        $embedded = (Test-ByteSpan $bytes $wantedUtf16) -or (Test-ByteSpan $bytes $wantedAscii)
        Write-Host "shortcut $($_.FullName) -> $target embedded=$embedded"
        if (-not $embedded -and $_.BaseName -like "*贪吃蛇*") {
            $chars = foreach ($b in $bytes) { if ($b -ge 32 -and $b -le 126) { [char]$b } else { "`n" } }
            $pieces = ((-join $chars) -split "`n" | Where-Object { $_.Length -ge 4 } | Select-Object -First 24) -join " | "
            Write-Host "ascii strings: $pieces"
        }
        $same = $false
        if ($target) {
            try { $same = [System.IO.Path]::GetFullPath($target) -ieq $wanted } catch { $same = $target -ieq $wanted }
        }
        if ($same -or $embedded) { $script:shortcutOk = $true }
    }
}
if (-not $shortcutOk) { throw "Desktop or Start Menu shortcut does not point at the installed Snake.exe" }

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SnakeSmoke {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
"@

function Wait-BootLine([string]$Path, [string]$Pattern, [int]$Seconds, [System.Diagnostics.Process]$Process) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            $have = if (Test-Path $Path) { Get-Content $Path } else { @("<no log>") }
            Write-Host "Snake.exe exited $($Process.ExitCode) while waiting for $Pattern"
            $have | ForEach-Object { Write-Host $_ }
            throw "Snake.exe exited $($Process.ExitCode) while waiting for $Pattern"
        }
        if (Test-Path $Path) {
            $text = Get-Content -Raw $Path
            if ($text -match $Pattern) { return $text }
        }
        Start-Sleep -Milliseconds 400
    }
    $have = if (Test-Path $Path) { Get-Content $Path } else { @("<no log>") }
    Write-Host "Timed out waiting for $Pattern"
    $have | ForEach-Object { Write-Host $_ }
    throw "Timed out waiting for $Pattern"
}

function Save-WindowShot([IntPtr]$Hwnd, [string]$Path) {
    $rect = New-Object SnakeSmoke+RECT
    if (-not [SnakeSmoke]::GetWindowRect($Hwnd, [ref]$rect)) { throw "GetWindowRect failed" }
    $w = $rect.Right - $rect.Left
    $h = $rect.Bottom - $rect.Top
    if ($w -lt 80 -or $h -lt 80) { throw "Window rect is $w x $h" }
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bmp.Dispose()
    Write-Host "saved $Path ${w}x${h} $((Get-Item $Path).Length)"
}

function Send-F11([IntPtr]$Hwnd) {
    $ignored = 0
    $targetThread = [SnakeSmoke]::GetWindowThreadProcessId($Hwnd, [ref]$ignored)
    $currentThread = [SnakeSmoke]::GetCurrentThreadId()
    [SnakeSmoke]::AttachThreadInput($currentThread, $targetThread, $true) | Out-Null
    [SnakeSmoke]::ShowWindow($Hwnd, 9) | Out-Null
    [SnakeSmoke]::BringWindowToTop($Hwnd) | Out-Null
    [SnakeSmoke]::SetForegroundWindow($Hwnd) | Out-Null
    Start-Sleep -Milliseconds 300
    [SnakeSmoke]::keybd_event(0x7A, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
    [SnakeSmoke]::keybd_event(0x7A, 0, 2, [UIntPtr]::Zero)
    [SnakeSmoke]::AttachThreadInput($currentThread, $targetThread, $false) | Out-Null
}

$boot = Join-Path $InstallDir "snake-boot.log"
if (Test-Path $boot) { Remove-Item $boot -Force }
Set-Content -Path (Join-Path $InstallDir "snake-smoke.txt") -Value "1" -Encoding ascii
$process = $null
try {
    $env:ALSOFT_DRIVERS = "null"
    $process = Start-Process -FilePath $exe -WorkingDirectory $InstallDir -PassThru
    $deadline = (Get-Date).AddSeconds(50)
    while ((Get-Date) -lt $deadline -and $process.MainWindowHandle -eq [IntPtr]::Zero) {
        if ($process.HasExited) { throw "Snake.exe exited before showing a window: $($process.ExitCode)" }
        Start-Sleep -Milliseconds 300
        $process.Refresh()
    }
    if ($process.MainWindowHandle -eq [IntPtr]::Zero) { throw "Snake.exe did not open a window" }
    $null = Wait-BootLine $boot "boot width=(\d+) height=(\d+)" 20 $process
    $text = Get-Content -Raw $boot
    if ($text -notmatch "awareness=([0-9-]+)") { throw "Boot log has no DPI awareness line`n$text" }
    $awareness = [int]$Matches[1]
    if ($awareness -lt 1) { throw "Process is not DPI-aware (awareness=$awareness)`n$text" }
    $text = Wait-BootLine $boot "loop-enter" 20 $process
    $text = Wait-BootLine $boot "applied fullscreen=0 width=(\d+) height=(\d+)" 20 $process
    if ($text -match "applied fullscreen=0 width=800 height=600") { throw "Window stayed at the 800x600 startup size`n$text" }
    $text = Wait-BootLine $boot "mark fullscreen=0 width=(\d+) height=(\d+)" 25 $process
    Start-Sleep -Milliseconds 700
    $process.Refresh()
    Save-WindowShot $process.MainWindowHandle (Join-Path $OutDir "display-window.png")
    $text = Wait-BootLine $boot "mark fullscreen=1 width=(\d+) height=(\d+)" 20 $process
    Start-Sleep -Milliseconds 600
    $process.Refresh()
    Save-WindowShot $process.MainWindowHandle (Join-Path $OutDir "display-fullscreen.png")
    Send-F11 $process.MainWindowHandle
    $text = Wait-BootLine $boot "f11 fullscreen=0 width=(\d+) height=(\d+)" 15 $process
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    Save-WindowShot $process.MainWindowHandle (Join-Path $OutDir "f11-window.png")
    Copy-Item $boot (Join-Path $OutDir "snake-boot.log") -Force
    Write-Host "SMOKE OK"
    Get-Content (Join-Path $OutDir "snake-boot.log")
    exit 0
} finally {
    if (Test-Path $boot) { Copy-Item $boot (Join-Path $OutDir "snake-boot.log") -Force -ErrorAction SilentlyContinue }
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
}
