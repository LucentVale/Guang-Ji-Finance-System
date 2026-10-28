' Mematikan server Sistem Keuangan Guang Ji yang berjalan di belakang layar (port 3000).
' Perlu dijalankan setelah kode aplikasi diperbarui, supaya perubahan terpakai saat aplikasi dibuka lagi.
Option Explicit

Dim shell, exitCode
Set shell = CreateObject("WScript.Shell")

exitCode = shell.Run("powershell -NoProfile -WindowStyle Hidden -Command """ & _
  "$c = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; " & _
  "if (-not $c) { exit 2 }; " & _
  "$p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c[0].OwningProcess); " & _
  "if ($p.Name -ne 'node.exe') { exit 3 }; " & _
  "Stop-Process -Id $p.ProcessId -Force""", 0, True)

Select Case exitCode
  Case 0: MsgBox "Server Sistem Keuangan sudah dimatikan.", 64, "Sistem Keuangan Guang Ji"
  Case 2: MsgBox "Server memang sedang tidak berjalan.", 64, "Sistem Keuangan Guang Ji"
  Case 3: MsgBox "Port 3000 dipakai program lain, tidak dimatikan.", 48, "Sistem Keuangan Guang Ji"
  Case Else: MsgBox "Server gagal dimatikan (kode " & exitCode & ").", 16, "Sistem Keuangan Guang Ji"
End Select
