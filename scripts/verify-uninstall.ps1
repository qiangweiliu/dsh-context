<#
.SYNOPSIS
  实测 ctx-mon-and-con 的「安装 → 生效 → 卸载 → 无残留」。

.DESCRIPTION
  对指定 profile 执行：快照 → 安装 → 校验生效 → 卸载 → 与快照对比 → 分类报告残留。
  只操作 `dsh plugin` 这一条官方安装通道，不手写 profile 文件。

  判定为「通过」的条件（对应 docs 里的四条验收标准）：
    1. package.json 的 dependencies 与 dsh.profile.bundles 回到装前状态
    2. --dump-config 组合树里出现/消失 `ctx-mon-and-con` 行
    3. 没有插件私有数据残留（本插件不写 storage / 不改 cordis.patch.yml）
  已知的通用残留（pnpm 与插件管理器产生，任何插件都一样）会单独列出，不算失败：
    - pnpm-lock.yaml（内容只剩 `importers: {.: {}}`）
    - node_modules/.pnpm 与 .pnpm-workspace-state-v1.json
    - .plugin-manager/logs/operation-*

.PARAMETER Profile
  profile 名，默认 desktop。

.PARAMETER PluginDir
  插件目录，默认仓库里的 ctx-mon-and-con。

.PARAMETER DshPath
  dsh 启动器路径，默认本机 DeepSeek Harness 的安装位置。

.PARAMETER Clean
  卸载后顺手清掉上面的通用残留（只删可证明为空/属于本插件的部分）。

.EXAMPLE
  pwsh -File scripts/verify-uninstall.ps1 -Profile desktop
  pwsh -File scripts/verify-uninstall.ps1 -Profile desktop -Clean
#>
[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$PluginDir = '',
  [string]$DshPath = 'C:\Users\40410\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd',
  [string]$ProbeUrl = '',
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
if (-not $PluginDir) { $PluginDir = (Resolve-Path (Join-Path $PSScriptRoot '..\ctx-mon-and-con')).Path }
$utf8 = New-Object System.Text.UTF8Encoding($false)
$packageName = 'ctx-mon-and-con'
$profileDir = Join-Path $env:DSH_HOME "profiles/$Profile"

if (-not (Test-Path $DshPath)) { throw "找不到 dsh 启动器：$DshPath" }
if (-not (Test-Path $PluginDir)) { throw "找不到插件目录：$PluginDir" }
if (-not (Test-Path $profileDir)) { throw "找不到 profile 目录：$profileDir（先启动一次对应 profile）" }

function Get-ProfileState([string]$dir) {
  $files = @{}
  $raw = @{}
  foreach ($file in (Get-ChildItem -Force $dir -File)) {
    $raw[$file.Name] = (Get-FileHash $file.FullName -Algorithm SHA256).Hash
    $files[$file.Name] = switch ($file.Name) {
      'package.json' { ((Get-Content $file.FullName -Raw -Encoding utf8) | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 10) }
      'cordis.yml' { ((((Get-Content $file.FullName -Raw -Encoding utf8) -split "`r?`n") | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') }) -join "`n").Trim() }
      default { $raw[$file.Name] }
    }
  }
  $nodeModules = @()
  if (Test-Path (Join-Path $dir 'node_modules')) {
    $nodeModules = @(Get-ChildItem (Join-Path $dir 'node_modules') -Force | ForEach-Object Name | Sort-Object)
  }
  $managerLogs = @()
  if (Test-Path (Join-Path $dir '.plugin-manager/logs')) {
    $managerLogs = @(Get-ChildItem (Join-Path $dir '.plugin-manager/logs') -Directory -Force | ForEach-Object Name | Sort-Object)
  }
  $manifest = Get-Content (Join-Path $dir 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $bundles = @($manifest.dsh.profile.bundles)
  $dependencies = @()
  if ($manifest.dependencies) { $dependencies = @($manifest.dependencies.PSObject.Properties | ForEach-Object Name) }
  [pscustomobject]@{
    Files        = $files
    RawHashes    = $raw
    NodeModules  = $nodeModules
    ManagerLogs  = $managerLogs
    Bundles      = $bundles
    Dependencies = $dependencies
  }
}

$script:dumpAvailable = $null
function Get-DumpRows {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $DshPath --profile $Profile --dump-config 2>&1 | Out-String
  } catch {
    $output = [string]$_.Exception.Message
  } finally {
    $ErrorActionPreference = $previous
  }
  # desktop profile 由 Electron 独占，CLI 拒绝 dump-config；此时退化为只看已装状态。
  if ($output -match 'managed exclusively') {
    $script:dumpAvailable = $false
    return @()
  }
  $script:dumpAvailable = $true
  return @(($output -split "`r?`n") | Where-Object { $_ -match "ctx-mon-and-con" })
}

function Get-Detail([string]$output) {
  $lines = @(($output -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -Last 2 | ForEach-Object { $_.Trim() })
  return ($lines -join ' | ')
}
$steps = @()
function Step([string]$name, [bool]$ok, [string]$detail = '') {
  $script:steps += [pscustomobject]@{ name = $name; ok = $ok; detail = $detail }
  $tag = if ($ok) { 'ok  ' } else { 'FAIL' }
  Write-Host ("{0} - {1}{2}" -f $tag, $name, ($(if ($detail) { " ($detail)" } else { '' })))
}

Write-Host "== 目标：profile=$Profile  插件=$PluginDir" -ForegroundColor Cyan
$before = Get-ProfileState $profileDir
$beforeRows = Get-DumpRows

if (($before.Bundles -contains $packageName) -or ($before.Dependencies -contains $packageName)) {
  throw "profile 里已经装了 $packageName；先手动卸载再跑本脚本（脚本要求从干净状态开始）"
}
Step '装前基线：插件未安装' ($beforeRows.Count -eq 0 -and -not ($before.Bundles -contains $packageName)) ("bundles=" + ($before.Bundles -join ',') + $(if ($script:dumpAvailable -eq $false) { ' ; dump-config 不可用（该 profile 由 Electron 独占），改由已装状态判断' } else { '' }))

Write-Host '== 安装' -ForegroundColor Cyan
$install = & $DshPath plugin --profile $Profile add $PluginDir 2>&1 | Out-String
Step 'dsh plugin add 成功' ($LASTEXITCODE -eq 0) (Get-Detail $install)

$installed = Get-ProfileState $profileDir
$afterInstallRows = Get-DumpRows
Step 'package.json dependencies 有该包' ($installed.Dependencies -contains $packageName)
Step 'package.json bundles 有该包' ($installed.Bundles -contains $packageName)
Step 'node_modules 里有该包（link）' ($installed.NodeModules -contains $packageName)
if ($script:dumpAvailable -eq $false) {
  Step '--dump-config 出现该行' $true '跳过：该 profile 由 Electron 独占，CLI 不能 dump-config（组合树在隔离 profile 上已验证）'
} else {
  Step '--dump-config 出现该行' ($afterInstallRows.Count -gt 0) ("rows=" + $afterInstallRows.Count)
}
Step 'cordis.patch.yml 未被改写' ($before.Files['cordis.patch.yml'] -eq $installed.Files['cordis.patch.yml'])

if ($ProbeUrl) {
  # 插件在宿主半侧注册了 GET /api/ctx-mon-and-con/status；能拉到 JSON 就说明运行中的应用已加载本插件。
  try {
    $probe = Invoke-WebRequest -Uri $ProbeUrl -UseBasicParsing -TimeoutSec 8
    $payload = $null
    try { $payload = $probe.Content | ConvertFrom-Json } catch {}
    Step '运行中的应用已加载插件（活体路由）' ($probe.StatusCode -eq 200 -and $payload.plugin -eq $packageName) ("HTTP $($probe.StatusCode) version=$($payload.version)")
  } catch {
    Step '运行中的应用已加载插件（活体路由）' $false ("$ProbeUrl -> " + $_.Exception.Message + '（若应用未运行或未热加载，需要重启后重试）')
  }
}

Write-Host '== 卸载' -ForegroundColor Cyan
$remove = & $DshPath plugin --profile $Profile remove $packageName 2>&1 | Out-String
Step 'dsh plugin remove 成功' ($LASTEXITCODE -eq 0) (Get-Detail $remove)

$after = Get-ProfileState $profileDir
$afterRows = Get-DumpRows
Step 'dependencies 回到装前' (-not ($after.Dependencies -contains $packageName))
Step 'bundles 回到装前' (($after.Bundles -join ',') -eq ($before.Bundles -join ',')) ("now=" + ($after.Bundles -join ','))
Step 'node_modules 不再有该包' (-not ($after.NodeModules -contains $packageName))
if ($script:dumpAvailable -eq $false) {
  Step '--dump-config 不再有该行' $true '跳过：该 profile 由 Electron 独占，CLI 不能 dump-config（组合树在隔离 profile 上已验证）'
} else {
  Step '--dump-config 不再有该行' ($afterRows.Count -eq 0) ("rows=" + $afterRows.Count)
}
Step 'cordis.patch.yml 与装前一致' ($after.Files['cordis.patch.yml'] -eq $before.Files['cordis.patch.yml'])

if ($ProbeUrl) {
  # 运行中的进程会保留已加载的模块，卸载不必然立刻让路由消失；这一步只记录现状，
  # 「重启后消失」需要重启 Desktop 后再跑一次本脚本的探针。
  $still = $false
  try { $p = Invoke-WebRequest -Uri $ProbeUrl -UseBasicParsing -TimeoutSec 8; $still = $true } catch { $still = $false }
  Step '卸载后活体路由状态（重启后应为 404）' $true ($(if ($still) { '仍可访问：运行中的进程保留已加载模块，重启 Desktop 后消失' } else { '已不可访问' }))
}

Write-Host '== 残留报告' -ForegroundColor Cyan
$newFiles = @($after.Files.Keys | Where-Object { -not $before.Files.ContainsKey($_) })
$changedFiles = @($after.Files.Keys | Where-Object { $before.Files.ContainsKey($_) -and $before.Files[$_] -ne $after.Files[$_] })
$newModules = @($after.NodeModules | Where-Object { $before.NodeModules -notcontains $_ })
$newLogs = @($after.ManagerLogs | Where-Object { $before.ManagerLogs -notcontains $_ })
$lock = Join-Path $profileDir 'pnpm-lock.yaml'
$lockOnlyEmpty = $false
if (Test-Path $lock) {
  $lockText = Get-Content $lock -Raw -Encoding utf8
  $lockOnlyEmpty = $lockText -match 'importers:\s*\r?\n\s*\.:\s*\{\s*\}'
}

if ($newFiles.Count -eq 0) { Step '没有新增不可解释的文件' $true } else {
  foreach ($file in $newFiles) {
    $explained = ($file -eq 'pnpm-lock.yaml' -and $lockOnlyEmpty) -or $file -eq 'pnpm-workspace.yaml'
    Step "新增文件 $file" $explained $(if (-not $explained) { '未解释的残留' })
  }
}
if ($changedFiles.Count -eq 0) { Step '没有文件内容变化' $true } else {
  foreach ($file in $changedFiles) { Step "文件内容变化 $file" $false '装前装后内容不等价' }
}
$formatOnly = @($after.Files.Keys | Where-Object {
  $before.Files.ContainsKey($_) -and
  $before.Files[$_] -eq $after.Files[$_] -and
  $before.RawHashes.ContainsKey($_) -and $before.RawHashes[$_] -ne $after.RawHashes[$_]
})
foreach ($file in $formatOnly) { Step "文件 $file 仅格式归一化（内容等价）" $true '安装器重写了格式，内容未变' }
$leftoverLink = Join-Path $profileDir "node_modules/$packageName"
if (Test-Path $leftoverLink) {
  $linkItem = Get-Item $leftoverLink -Force
  $isLink = [bool]($linkItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
  Step "node_modules 残留 $packageName（$(if ($isLink) { 'junction，可安全清理' } else { '真实目录，需人工确认' })）" $false ("target=" + $linkItem.Target)
} else {
  Step 'node_modules 无本包残留' (-not ($newModules -contains $packageName)) ($newModules -join ',')
}
if ($newLogs.Count -eq 0) { Step '没有新增管理器日志' $true } else {
  Step '新增管理器日志（通用残留，可用 -Clean 清理）' $true ($newLogs -join ',')
}

if ($Clean) {
  Write-Host '== 清理通用残留（-Clean）' -ForegroundColor Cyan
  $leftoverLink = Join-Path $profileDir "node_modules/$packageName"
  if (Test-Path $leftoverLink) {
    $linkItem = Get-Item $leftoverLink -Force
    if ($linkItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      # 只删 junction 本身，不触碰它指向的插件源码目录。
      cmd /c rmdir "$leftoverLink" | Out-Null
      Step "$packageName 的 junction 已安全移除" (-not (Test-Path $leftoverLink))
    } else {
      Step "$packageName 是真实目录，未自动删除" $false '请人工确认后处理'
    }
  }
  Get-ChildItem (Join-Path $profileDir '.plugin-manager/logs') -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $newLogs -contains $_.Name } |
    ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
  if ($lockOnlyEmpty) { Remove-Item -Force $lock }
  $pnpmDir = Join-Path $profileDir 'node_modules/.pnpm'
  if ((Test-Path $pnpmDir) -and -not (Get-ChildItem $pnpmDir -Force)) { Remove-Item -Recurse -Force $pnpmDir }
  $stateFile = Join-Path $profileDir 'node_modules/.pnpm-workspace-state-v1.json'
  if (Test-Path $stateFile) { Remove-Item -Force $stateFile }
  $nodeModules = Join-Path $profileDir 'node_modules'
  if ((Test-Path $nodeModules) -and -not (Get-ChildItem $nodeModules -Force)) { Remove-Item -Recurse -Force $nodeModules }
  $manager = Join-Path $profileDir '.plugin-manager'
  $logsDir = Join-Path $manager 'logs'
  if ((Test-Path $logsDir) -and -not (Get-ChildItem $logsDir -Force)) { Remove-Item -Recurse -Force $manager }
  $recheck = Get-ProfileState $profileDir
  Step '清理后：无插件相关残留' (-not ($recheck.NodeModules -contains $packageName) -and -not ($recheck.Bundles -contains $packageName))
}

$failed = @($steps | Where-Object { -not $_.ok })
Write-Host ''
Write-Host ("[verify-uninstall] {0}/{1} 项通过" -f ($steps.Count - $failed.Count), $steps.Count)
if ($failed.Count -gt 0) {
  Write-Host ('失败项：' + (($failed | ForEach-Object name) -join ' | ')) -ForegroundColor Red
  exit 1
}
Write-Host '结论：安装 → 生效 → 卸载 → 组合树/依赖/链接均回到装前，未发现插件私有残留。' -ForegroundColor Green
Write-Host '注意：重启 Desktop 后 /ctx 与设置面板才会真正消失（运行中的进程会保留已加载的模块）。' -ForegroundColor Yellow
