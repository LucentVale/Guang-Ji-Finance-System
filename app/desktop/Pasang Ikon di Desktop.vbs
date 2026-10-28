' Memasang ikon "Sistem Keuangan Guang Ji" di Desktop dan Start Menu.
' Jalankan sekali di setiap komputer (klik dua kali file ini).
Option Explicit

Dim shell, fso, here, targets, folder, link
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)

targets = Array(shell.SpecialFolders("Desktop"), shell.SpecialFolders("Programs"))
For Each folder In targets
  Set link = shell.CreateShortcut(folder & "\Sistem Keuangan Guang Ji.lnk")
  link.TargetPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")
  link.Arguments = """" & here & "\Buka Sistem Keuangan.vbs"""
  link.WorkingDirectory = fso.GetParentFolderName(here)
  link.IconLocation = here & "\guang-ji.ico,0"
  link.Description = "Sistem Keuangan Guang Ji - laporan keuangan Fothang"
  link.Save
Next

If WScript.Arguments.Count = 0 Then
  MsgBox "Ikon ""Sistem Keuangan Guang Ji"" sudah dipasang di Desktop dan Start Menu.", 64, "Sistem Keuangan Guang Ji"
End If
