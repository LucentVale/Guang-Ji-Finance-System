' Membuka Sistem Keuangan Guang Ji seperti aplikasi desktop:
'   1. menjalankan server di belakang layar (tanpa jendela hitam); bila sudah berjalan, server kedua otomatis berhenti
'   2. menunggu server siap
'   3. membuka aplikasi di jendela Microsoft Edge mode aplikasi (tanpa tab & alamat), atau browser bawaan bila Edge tidak ada
'
' Dua cara pakai, dikenali otomatis:
'   - VERSI TERPASANG (lewat installer): ada ..\runtime\node.exe di sebelah folder app.
'       Node bawaan installer yang dipakai; data di %LOCALAPPDATA%\Guang Ji\Sistem Keuangan (lewat GUANGJI_DATA_DIR).
'   - KOMPUTER PENGEMBANG: Node.js terpasang di Windows; data di app\data; komponen dipasang bila belum ada.
' Catatan server ditulis ke server.log di folder data.
Option Explicit

Const APP_URL = "http://localhost:3000"
Const TITLE = "Sistem Keuangan Guang Ji"

Dim shell, fso, appDir, runtimeNode, installed, dataDir, nodeCmd, logFile
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = appDir

runtimeNode = fso.GetParentFolderName(appDir) & "\runtime\node.exe"
installed = fso.FileExists(runtimeNode)

If installed Then
  dataDir = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Guang Ji\Sistem Keuangan"
  EnsureFolder dataDir
  ' Diwariskan ke proses server yang dijalankan di bawah (dibaca src/configLoader.js).
  shell.Environment("Process")("GUANGJI_DATA_DIR") = dataDir
  nodeCmd = """" & runtimeNode & """"
Else
  dataDir = appDir & "\data"
  EnsureFolder dataDir
  ' Pertama kali dijalankan: pasang komponen yang dibutuhkan aplikasi saja (exceljs).
  ' --omit=dev: alat pengembang (ESLint) tidak ikut diunduh.
  If Not fso.FolderExists(appDir & "\node_modules") Then
    shell.Run "cmd /c npm install --omit=dev", 1, True
  End If
  nodeCmd = "node"
End If

logFile = dataDir & "\server.log"
' cmd /c "<perintah>": tanda kutip luar dibuang cmd, sehingga path yang berisi spasi tetap utuh.
shell.Run "cmd /c """ & nodeCmd & " server.js >> """ & logFile & """ 2>&1""", 0, False

If Not WaitForServer(30) Then
  If installed Then
    MsgBox "Aplikasi tidak bisa dijalankan." & vbCrLf & vbCrLf & _
           "Lihat catatan di:" & vbCrLf & logFile, 16, TITLE
  Else
    MsgBox "Aplikasi tidak bisa dijalankan." & vbCrLf & vbCrLf & _
           "Pastikan Node.js sudah terpasang, lalu lihat catatan di:" & vbCrLf & logFile, 16, TITLE
  End If
  WScript.Quit 1
End If

OpenAppWindow

' Buat folder beserta folder induknya bila belum ada (FileSystemObject.CreateFolder tidak bertingkat).
Sub EnsureFolder(path)
  If fso.FolderExists(path) Then Exit Sub
  EnsureFolder fso.GetParentFolderName(path)
  fso.CreateFolder path
End Sub

' Tunggu sampai server menjawab (maksimal tries x 0,5 detik).
' Memakai /api/auth/status karena hanya endpoint itu yang terbuka tanpa login.
Function WaitForServer(tries)
  Dim i, http
  WaitForServer = False
  For i = 1 To tries
    On Error Resume Next
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.open "GET", APP_URL & "/api/auth/status", False
    http.send
    If Err.Number = 0 Then
      If http.status = 200 Then WaitForServer = True
    End If
    Err.Clear
    On Error GoTo 0
    If WaitForServer Then Exit Function
    WScript.Sleep 500
  Next
End Function

Sub OpenAppWindow()
  Dim edge
  edge = ""
  On Error Resume Next
  edge = shell.RegRead("HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe\")
  On Error GoTo 0
  If edge <> "" And fso.FileExists(edge) Then
    shell.Run """" & edge & """ --app=" & APP_URL, 1, False
  Else
    shell.Run APP_URL, 1, False
  End If
End Sub
