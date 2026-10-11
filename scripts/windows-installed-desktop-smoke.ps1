# Real packaged-app smoke on an ephemeral Windows CI runner.
# Runs the NSIS installer silently, launches the installed Tauri executable,
# and checks its own supervised Node API using its private session token.
# Never prints the session token or user data.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $env:OS -ne 'Windows_NT') { throw 'Windows required' }

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$bundleDir = Join-Path $root 'apps/desktop/src-tauri/target/release/bundle/nsis'
$installer = Get-ChildItem -LiteralPath $bundleDir -Filter '*setup.exe' -File |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw 'No built NSIS installer was found' }

$installDir = Join-Path $env:TEMP ('tj-installed-smoke-' + [guid]::NewGuid().ToString('N'))
$appProcess = $null
try {
  Write-Host 'Installing NSIS package into isolated temporary directory'
  $setup = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
  if ($setup.ExitCode -ne 0) { throw "Silent installer failed (exit code $($setup.ExitCode))" }
  if (-not (Test-Path -LiteralPath $installDir)) { throw 'Installer did not create the requested install directory' }

  $resourceApi = Join-Path $installDir 'resources/api/launcher.cjs'
  $resourceNode = Join-Path $installDir 'resources/node.exe'
  if (-not (Test-Path -LiteralPath $resourceApi) -or -not (Test-Path -LiteralPath $resourceNode)) {
    throw 'Installed application does not include bundled Node and API resources'
  }

  $exe = Get-ChildItem -LiteralPath $installDir -Filter '*.exe' -File |
    Where-Object { $_.Name -notin @('node.exe','Uninstall.exe','uninstall.exe') } |
    Select-Object -First 1
  if (-not $exe) { throw 'Installed Tauri desktop executable was not found' }

  Write-Host 'Starting the installed Tauri desktop to verify Rust supervisor + API'
  $appProcess = Start-Process -FilePath $exe.FullName -PassThru
  $tokenPath = Join-Path $env:LOCALAPPDATA ("com.tj.totalmasteryai/desktop-session-$($appProcess.Id).token")
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  $verified = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    $appProcess.Refresh()
    if ($appProcess.HasExited) { throw "Installed desktop exited during startup (exit code $($appProcess.ExitCode))" }
    if (Test-Path -LiteralPath $tokenPath) {
      $token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
      if ($token -match '^[a-f0-9]{64}$') {
        $children = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
          Where-Object { $_.ParentProcessId -eq $appProcess.Id -and $_.CommandLine -like '*launcher.cjs*' })
        foreach ($child in $children) {
          $listeners = @(Get-NetTCPConnection -OwningProcess $child.ProcessId -State Listen -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalAddress -eq '127.0.0.1' })
          foreach ($listener in $listeners) {
            try {
              $answer = Invoke-WebRequest -Uri "http://127.0.0.1:$($listener.LocalPort)/api/v1/system/status" `
                -Headers @{ 'X-TJ-Desktop-Token' = $token } -TimeoutSec 2
              if ($answer.StatusCode -eq 200) { $verified = $true; break }
            } catch { } # Expected while the listener is initializing.
          }
          if ($verified) { break }
        }
      }
    }
    if ($verified) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $verified) {
    $log = Join-Path $env:LOCALAPPDATA 'com.tj.totalmasteryai/desktop-backend-startup.log'
    throw "Installed Tauri desktop failed to boot its authenticated API. Inspect local startup log: $log"
  }
  Write-Host 'PASS: NSIS installed Tauri desktop launched bundled authenticated loopback API'
} finally {
  if ($appProcess -and -not $appProcess.HasExited) {
    Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
