; Installer Windows untuk Sistem Keuangan Guang Ji (Inno Setup 6).
; JANGAN dikompilasi langsung: jalankan `npm run build:installer` (scripts/build-installer.js), yang menyiapkan folder
; staging lalu memanggil ISCC dengan /DAppVersion, /DStagingDir, dan /DOutputDir.
;
; Susunan hasil pemasangan (per pengguna, tanpa hak Administrator):
;   {app}\runtime\node.exe                       Node.js bawaan (komputer tujuan tidak perlu memasang Node)
;   {app}\app\...                                program (server.js, src, public, node_modules produksi, desktop\*.vbs)
;   %LOCALAPPDATA%\Guang Ji\Sistem Keuangan\     DATA: keuangan.db, config.local.json, server.log
; Folder data TIDAK disentuh saat update maupun uninstall. Lokasinya harus sama dengan di desktop\Buka Sistem Keuangan.vbs.

#ifndef AppVersion
  #error AppVersion belum diisi. Jalankan lewat: npm run build:installer
#endif
#ifndef StagingDir
  #error StagingDir belum diisi. Jalankan lewat: npm run build:installer
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

#define AppName "Sistem Keuangan Guang Ji"
#define ShortcutName "Sistem Keuangan"
#define DataDir "{localappdata}\Guang Ji\Sistem Keuangan"
#define Launcher "{app}\app\desktop\Buka Sistem Keuangan.vbs"
#define StopServer "{app}\app\desktop\Matikan Server.vbs"
#define Icon "{app}\app\desktop\guang-ji.ico"

[Setup]
; AppId tetap sama di setiap versi, supaya versi baru dipasang MENIMPA versi lama (bukan aplikasi kedua).
AppId={{D4E503B5-99D7-4AA0-A5AA-53B3E2945971}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Yayasan Guang Ji
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=SistemKeuanganGuangJi-Setup-{#AppVersion}
SetupIconFile={#StagingDir}\app\desktop\guang-ji.ico
UninstallDisplayIcon={#Icon}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Server yang sedang berjalan memakai runtime\node.exe; Restart Manager diminta menutupnya sebelum file diganti.
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "id"; MessagesFile: "compiler:Default.isl"

; Teks wizard yang paling terlihat, dalam Bahasa Indonesia (Inno Setup belum punya terjemahan resmi Indonesia).
[Messages]
SetupAppTitle=Pemasangan
SetupWindowTitle=Pemasangan - %1
WelcomeLabel1=Selamat datang di pemasangan [name]
WelcomeLabel2=Program ini akan memasang [name/ver] di komputer Anda.%n%nTutup aplikasi lain sebelum melanjutkan.
ButtonNext=&Lanjut >
ButtonBack=< &Kembali
ButtonInstall=&Pasang
ButtonCancel=Batal
ButtonFinish=&Selesai
ButtonYes=&Ya
ButtonNo=&Tidak
ExitSetupTitle=Batalkan Pemasangan
ExitSetupMessage=Pemasangan belum selesai. Bila dibatalkan, program tidak akan terpasang.%n%nBatalkan pemasangan?
WizardReady=Siap Memasang
ReadyLabel1=Pemasangan [name] siap dimulai.
ReadyLabel2a=Klik Pasang untuk mulai memasang.
WizardInstalling=Sedang Memasang
InstallingLabel=Mohon tunggu, [name] sedang dipasang di komputer Anda.
FinishedHeadingLabel=Pemasangan [name] selesai
FinishedLabelNoIcons=[name] sudah terpasang.
FinishedLabel=[name] sudah terpasang. Buka lewat ikon "Sistem Keuangan" di Desktop.
WizardPreparing=Menyiapkan Pemasangan
StatusExtractFiles=Menyalin file...
StatusCreateIcons=Membuat ikon...
StatusRunProgram=Menyelesaikan pemasangan...
ConfirmUninstall=Hapus %1 dari komputer ini?%n%nData keuangan TIDAK ikut dihapus (tersimpan di folder data pengguna).
UninstalledAll=%1 sudah dihapus dari komputer ini.%n%nData keuangan tetap tersimpan di folder AppData\Local\Guang Ji\Sistem Keuangan milik pengguna ini.
UninstallStatusLabel=Mohon tunggu, %1 sedang dihapus.

[CustomMessages]
id.OpenNow=Buka Sistem Keuangan sekarang
id.StopServerLink=Matikan Server
id.DataFolderLink=Folder Data (database & cadangan)

[InstallDelete]
; Update: hapus program versi lama seluruhnya supaya tidak ada file usang. Data ada di folder lain, jadi aman.
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"

[Dirs]
Name: "{#DataDir}"; Flags: uninsneveruninstall

[Files]
Source: "{#StagingDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StagingDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
; Data awal & pengaturan: HANYA bila komputer ini belum punya data, dan tidak pernah dihapus saat uninstall.
Source: "{#StagingDir}\seed\keuangan.db"; DestDir: "{#DataDir}"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "{#StagingDir}\seed\config.local.json"; DestDir: "{#DataDir}"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{autodesktop}\{#ShortcutName}"; Filename: "{sys}\wscript.exe"; Parameters: """{#Launcher}"""; WorkingDir: "{app}\app"; IconFilename: "{#Icon}"; Comment: "{#AppName}"
Name: "{group}\{#ShortcutName}"; Filename: "{sys}\wscript.exe"; Parameters: """{#Launcher}"""; WorkingDir: "{app}\app"; IconFilename: "{#Icon}"; Comment: "{#AppName}"
Name: "{group}\{cm:StopServerLink}"; Filename: "{sys}\wscript.exe"; Parameters: """{#StopServer}"""; WorkingDir: "{app}\app"
Name: "{group}\{cm:DataFolderLink}"; Filename: "{#DataDir}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{#Launcher}"""; WorkingDir: "{app}\app"; Description: "{cm:OpenNow}"; Flags: postinstall nowait skipifsilent

[Code]
// Hentikan server Sistem Keuangan yang berjalan dari folder pemasangan ini (node.exe bawaan),
// supaya file program bisa diganti (update) atau dihapus (uninstall). Server lain tidak disentuh.
procedure StopBundledServer();
var
  ResultCode: Integer;
  Runtime: String;
begin
  Runtime := ExpandConstant('{app}\runtime\node.exe');
  if not FileExists(Runtime) then Exit;
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Filter ''Name=''''node.exe'''''' | ' +
    'Where-Object { $_.ExecutablePath -eq ''' + Runtime + ''' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopBundledServer();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopBundledServer();
  Result := True;
end;
