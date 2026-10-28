' Membuka Sistem Keuangan Guang Ji seperti aplikasi desktop:
'   1. menjalankan server di belakang layar (tanpa jendela hitam); bila sudah berjalan, server kedua otomatis berhenti
'   2. menunggu server siap
'   3. membuka aplikasi di jendela Microsoft Edge mode aplikasi (tanpa tab & alamat), atau browser bawaan bila Edge tidak ada
' Catatan server ditulis ke data\server.log.
Option Explicit

Const APP_URL = "http://localhost:3000"
Const TITLE = "Sistem Keuangan Guang Ji"

Dim shell, fso, appDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = appDir

If Not fso.FolderExists(appDir & "\data") Then fso.CreateFolder appDir & "\data"

' Pertama kali dijalankan: pasang komponen (exceljs).
If Not fso.FolderExists(appDir & "\node_modules") Then
  shell.Run "cmd /c npm install", 1, True
End If

shell.Run "cmd /c node server.js >> data\server.log 2>&1", 0, False

If Not WaitForServer(30) Then
  MsgBox "Aplikasi tidak bisa dijalankan." & vbCrLf & vbCrLf & _
         "Pastikan Node.js sudah terpasang, lalu lihat catatan di:" & vbCrLf & appDir & "\data\server.log", 16, TITLE
  WScript.Quit 1
End If

OpenAppWindow

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
