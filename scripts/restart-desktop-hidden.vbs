' Launch restart-desktop.ps1 with no console window.
'
' Why: a scheduled task whose action is powershell.exe creates a visible console
' window in the user session. WScript.Shell.Run with window style 0 starts the
' process with STARTF_USESHOWWINDOW/SW_HIDE, so PowerShell (and therefore the
' console) stays invisible. That is more reliable than -WindowStyle Hidden when
' the process is started by the Task Scheduler.
'
' Usage: wscript.exe //B //Nologo scripts\restart-desktop-hidden.vbs [args]
' The optional args are forwarded to the PowerShell script (e.g. -DryRun).

Option Explicit

Dim shell, fso, here, script, args, index, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
script = here & "\restart-desktop.ps1"

args = ""
For index = 0 To WScript.Arguments.Count - 1
  args = args & " " & WScript.Arguments(index)
Next

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & script & """" & args
shell.Run command, 0, False