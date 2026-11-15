param([Parameter(Mandatory=$true)][string]$Stage)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$out = Join-Path $root 'build\installer'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$payload = Join-Path $out 'payload.zip'
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $payload -Force
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$exe = Join-Path $out 'Snake-Dufaxing-Setup-win64.exe'
& $compiler /nologo /target:winexe /platform:x64 "/out:$exe" "/resource:$payload,payload.zip" /reference:System.Windows.Forms.dll /reference:System.IO.Compression.dll /reference:Microsoft.CSharp.dll (Join-Path $PSScriptRoot 'LocalInstaller.cs')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
Get-Item $exe | Select-Object FullName,Length
