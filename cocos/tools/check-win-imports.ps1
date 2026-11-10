# Fail if Snake.exe or any shipped DLL imports a non-system DLL that is not in the package.
# Visual C++ runtime DLLs are never treated as Windows system files.
param(
    [Parameter(Mandatory = $true)][string]$Stage
)

$ErrorActionPreference = "Stop"
function Stop-Pack([string]$Message) { Write-Host $Message; exit 1 }
$snake = Join-Path $Stage "Snake.exe"
if (-not (Test-Path $snake)) { Stop-Pack "Stage is missing Snake.exe: $Stage" }
if (-not (Test-Path (Join-Path $Stage "vcruntime140_1.dll"))) {
    Stop-Pack "Release vcruntime140_1.dll is not in the package"
}
if (Test-Path (Join-Path $Stage "vcruntime140_1d.dll")) {
    Stop-Pack "Debug vcruntime140_1d.dll must not be shipped in place of the release runtime"
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$dumpbin = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find "VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe" |
    Select-Object -First 1
if (-not $dumpbin) { Stop-Pack "dumpbin.exe was not found" }

$system = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
Get-ChildItem "$env:SystemRoot\System32" -Filter "*.dll" -File | ForEach-Object { [void]$system.Add($_.Name) }
foreach ($extra in @("msvcrt.dll", "ucrtbase.dll", "ntdll.dll", "kernel32.dll", "kernelbase.dll")) {
    [void]$system.Add($extra)
}
# Private VC++ redistributable. A machine without it still has to start the game.
foreach ($name in @($system)) {
    if ($name -match '^(vcruntime|msvcp|concrt140|vccorlib140)') {
        [void]$system.Remove($name)
    }
}

function Get-PeImports([string]$Path) {
    $out = & $dumpbin /dependents $Path
    if ($LASTEXITCODE -ne 0) { Stop-Pack "dumpbin failed for $Path" }
    $deps = @()
    foreach ($line in $out) {
        if ($line -match '^\s+([A-Za-z0-9_.+-]+\.dll)\s*$') {
            $deps += $Matches[1]
        }
    }
    return $deps
}

$bins = Get-ChildItem $Stage -Recurse -File | Where-Object { $_.Extension -match '^\.(dll|exe)$' }
$present = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($bin in $bins) { [void]$present.Add($bin.Name) }

$missing = @()
foreach ($bin in $bins) {
    foreach ($dep in (Get-PeImports $bin.FullName)) {
        if ($dep -like "api-ms-*" -or $dep -like "ext-ms-*") { continue }
        if ($present.Contains($dep)) { continue }
        if ($system.Contains($dep)) { continue }
        $missing += "$($bin.Name) -> $dep"
    }
}

if ($missing.Count -gt 0) {
    $missing | ForEach-Object { Write-Host $_ }
    Stop-Pack "The Windows package is missing $($missing.Count) imported DLL(s)"
}
Write-Host "Import check passed for $($bins.Count) binaries"
