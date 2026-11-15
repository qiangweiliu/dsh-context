# Restart the DSH Desktop app so a freshly installed plugin build is loaded.
#
# Why this is needed: the plugin is a Node module loaded at process start. HMR covers
# small client edits, but replacing the installed package (version bump) needs a process
# restart. That is the host's mechanism, not ours.
#
# How it is launched: via restart-desktop-hidden.vbs, which starts this script with
# window style 0 so no console window appears. dsh's own stdout/stderr are redirected to
# files under .restart-desktop.d/ so diagnostics survive without a console.
#
# ASCII only: Windows PowerShell 5.1 misparses UTF-8 without BOM.

param(
  [switch]$DryRun
)

$root = 'C:\Users\40410\Desktop\context'
$log = Join-Path $root '.restart-desktop.log'
$diagDir = Join-Path $root '.restart-desktop.d'
$exe = 'E:\tool\dsh\DeepSeek Harness.exe'
$taskName = 'DshDesktopRestart'

function Write-Log($message) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $message" | Out-File -FilePath $log -Append -Encoding utf8
}

function Get-DshProcesses {
  @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
}

Write-Log ("fired (dryRun=" + [bool]$DryRun + ")")

$before = Get-DshProcesses
$earliest = ($before | Sort-Object StartTime | Select-Object -First 1).StartTime
Write-Log ("procs before: " + $before.Count + "; earliest start " + $earliest)

if ($DryRun) {
  Write-Log 'dry run: would close main windows, wait 3s, kill survivors, wait 5s'
  Write-Log ("dry run: would launch " + $exe + " with stdout/stderr redirected to " + $diagDir)
  Write-Log 'dry run: would delete the scheduled task and finish'
  exit 0
}

# Close gracefully first so in-flight writes can settle, then force-kill survivors.
foreach ($process in $before) {
  try { [void]$process.CloseMainWindow() } catch {}
}
Start-Sleep -Seconds 3
Get-DshProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5
Write-Log ("procs after kill: " + (Get-DshProcesses).Count)

# Keep dsh's boot output (web URL+token, update check, warnings) even without a console.
if (-not (Test-Path $diagDir)) { New-Item -ItemType Directory -Force -Path $diagDir | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdout = Join-Path $diagDir ("dsh-$stamp.out.log")
$stderr = Join-Path $diagDir ("dsh-$stamp.err.log")

try {
  Start-Process -FilePath $exe -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  Write-Log ("launched " + $exe)
  Write-Log ("stdout -> " + $stdout)
  Write-Log ("stderr -> " + $stderr)
} catch {
  Write-Log ("launch failed: " + $_.Exception.Message)
  # Fall back to a plain launch: a missing web URL in the log is better than no app.
  Start-Process -FilePath $exe
  Write-Log 'fallback launch without redirect'
}

for ($i = 1; $i -le 24; $i++) {
  Start-Sleep -Seconds 5
  $now = Get-DshProcesses
  if ($now.Count -gt 0) {
    Write-Log ("check " + $i + ": procs " + $now.Count + "; earliest start " + ($now | Sort-Object StartTime | Select-Object -First 1).StartTime)
    break
  }
}
Write-Log ("procs at end: " + (Get-DshProcesses).Count)

# Extract the web URL so the caller can reopen the panel without guessing the port.
if (Test-Path $stdout) {
  $url = (Select-String -Path $stdout -Pattern 'dsh web:\s*(http\S+)' -AllMatches |
    Select-Object -Last 1).Matches.Groups[1].Value
  if ($url) { Write-Log ("web url: " + $url) } else { Write-Log 'web url: (not found in stdout)' }
}

schtasks /Delete /TN $taskName /F 2>&1 | Out-Null
Write-Log 'restart done; scheduled task removed'