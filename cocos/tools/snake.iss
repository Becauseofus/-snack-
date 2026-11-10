#define MyAppName "贪吃蛇"
#define MyAppVersion "1.0.1"
#define MyAppExe "Snake.exe"
#ifndef Stage
#define Stage "release-assets\stage"
#endif

[Setup]
AppId={{C0C05A4E-3E88-4D91-9E6A-3C8B1D4F2A71}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Becauseofus
DefaultDirName={localappdata}\Programs\贪吃蛇
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=no
OutputDir=release-assets
OutputBaseFilename=Snake-cocos-Setup-win64
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\{#MyAppExe}
WizardStyle=modern
SetupLogging=yes

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; WorkingDir: "{app}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; WorkingDir: "{app}"

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent unchecked
