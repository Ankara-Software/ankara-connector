# Ankara Yazılım Connector — Windows systray host.
# Starts ankara-connector-core.exe hidden; shows tray icon + About + logout menu.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:Version = '1.1.1'
$script:StatusPort = 4781
$script:InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:CoreExe = Join-Path $InstallDir 'ankara-connector-core.exe'
$script:IconPath = Join-Path $InstallDir 'ankara-yazilim.ico'
$script:CoreProc = $null

function Start-AgentCore {
  if ($script:CoreProc -and -not $script:CoreProc.HasExited) { return }
  if (-not (Test-Path $script:CoreExe)) {
    [System.Windows.Forms.MessageBox]::Show(
      "Çekirdek bulunamadı:`n$($script:CoreExe)",
      'Ankara Yazılım Connector',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    return
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $script:CoreExe
  $psi.Arguments = 'run'
  $psi.WorkingDirectory = $script:InstallDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $script:CoreProc = [System.Diagnostics.Process]::Start($psi)
}

function Stop-AgentCore {
  if ($script:CoreProc -and -not $script:CoreProc.HasExited) {
    $script:CoreProc.Kill()
    $script:CoreProc.WaitForExit(5000)
  }
  $script:CoreProc = $null
  Get-Process -Name 'ankara-connector-core' -ErrorAction SilentlyContinue | Stop-Process -Force
}

function Update-TrayTooltip {
  param([System.Windows.Forms.NotifyIcon]$Tray)
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$($script:StatusPort)/health" -TimeoutSec 2
    if ($r.paired) {
      $label = if ($r.label) { $r.label } else { $r.deviceId }
      $Tray.Text = "Ankara Yazılım Connector — Bağlı ($label)"
    } else {
      $Tray.Text = 'Ankara Yazılım Connector — Oturum bekleniyor'
    }
  } catch {
    $Tray.Text = 'Ankara Yazılım Connector — başlatılıyor…'
  }
}

function Show-About {
  $body = @"
Ankara Yazılım Connector $($script:Version)

Fiziksel donanımı Ankara Yazılım paneli ile köprüler.
Tüm ayarlar web panelden yapılır.

https://ankarayazilim.org/indir
"@
  [System.Windows.Forms.MessageBox]::Show(
    $body,
    'Ankara Yazılım Connector',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
}

function Invoke-Logout {
  Stop-AgentCore
  if (Test-Path $script:CoreExe) {
    $p = Start-Process -FilePath $script:CoreExe -ArgumentList 'logout' -WorkingDirectory $script:InstallDir -WindowStyle Hidden -PassThru
    $p.WaitForExit(15000)
  }
  Start-AgentCore
}

Start-AgentCore

$tray = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $script:IconPath) {
  $tray.Icon = New-Object System.Drawing.Icon($script:IconPath)
} else {
  $tray.Icon = [System.Drawing.SystemIcons]::Application
}
$tray.Visible = $true
Update-TrayTooltip -Tray $tray

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$null = $menu.Items.Add('Durumu Aç', $null, { Start-Process "http://127.0.0.1:$($script:StatusPort)/" })
$null = $menu.Items.Add('Hakkında…', $null, { Show-About })
$null = $menu.Items.Add('-')
$null = $menu.Items.Add('Oturumu Kapat', $null, { Invoke-Logout; Update-TrayTooltip -Tray $tray })
$null = $menu.Items.Add('-')
$null = $menu.Items.Add('Çıkış', $null, {
  $tray.Visible = $false
  Stop-AgentCore
  [System.Windows.Forms.Application]::Exit()
})
$tray.ContextMenuStrip = $menu

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 12000
$timer.Add_Tick({ Update-TrayTooltip -Tray $tray })
$timer.Start()

Register-EngineEvent PowerShell.Exiting -Action { Stop-AgentCore } | Out-Null
[System.Windows.Forms.Application]::Run()
