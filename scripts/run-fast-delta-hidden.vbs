Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""C:\netsuite-backup\scripts\run-fast-delta.ps1""", 0, True
