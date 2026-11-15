# Desktop restart used by a scheduled task (ASCII only: Windows PowerShell 5.1 misparses UTF-8 without BOM).
$log = 'C:\Users\40410\Desktop\context\.restart-desktop.log'
function Write-Log($message) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $message" | Out-File -FilePath $log -Append -Encoding utf8 }

Write-Log 'scheduled task fired: restarting Desktop'
$before = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
Write-Log ("procs before: " + $before.Count + "; earliest start " + ($before | Sort-Object StartTime | Select-Object -First 1).StartTime)
foreach ($process in $before) { try { [void]$process.CloseMainWindow() } catch {} }
Start-Sleep -Seconds 3
Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5
Write-Log ("procs after kill: " + @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count)

Start-Process 'E:\tool\dsh\DeepSeek Harness.exe'
Write-Log 'launched DeepSeek Harness.exe'
for ($i = 1; $i -le 24; $i++) {
  Start-Sleep -Seconds 5
  $now = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
  if ($now.Count -gt 0) {
    Write-Log ("check " + $i + ": procs " + $now.Count + "; earliest start " + ($now | Sort-Object StartTime | Select-Object -First 1).StartTime)
    break
  }
}
Write-Log ("procs at end: " + @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count)
schtasks /Delete /TN 'DshDesktopRestart' /F 2>&1 | Out-Null
Write-Log 'restart done; scheduled task removed'
