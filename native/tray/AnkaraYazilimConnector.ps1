# Ankara Yazılım Connector — Windows systray host (PowerShell fallback).
# Starts ankara-connector-core.exe hidden; shows tray icon + About + logout menu.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:Version = '1.1.8'
$script:StatusPort = 4781
$script:InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:CoreExe = Join-Path $InstallDir 'ankara-connector-core.exe'
$script:IconPath = Join-Path $InstallDir 'ankara-yazilim.ico'
$script:CoreProc = $null

function Invoke-Health {
  foreach ($scheme in @('https', 'http')) {
    try {
      if ($scheme -eq 'https') {
        return Invoke-RestMethod -Uri "$scheme://127.0.0.1:$($script:StatusPort)/health" -TimeoutSec 3 -SkipCertificateCheck
      }
      return Invoke-RestMethod -Uri "$scheme://127.0.0.1:$($script:StatusPort)/health" -TimeoutSec 3
    } catch {}
  }
  return $null
}

function Get-StatusBaseUrl {
  try {
    $r = Invoke-Health
    if ($r -and $r.tls) { return "https://127.0.0.1:$($script:StatusPort)/" }
    if ($r) { return "http://127.0.0.1:$($script:StatusPort)/" }
  } catch {}
  return "https://127.0.0.1:$($script:StatusPort)/"
}

function Invoke-StatusPost {
  param([string]$Path)
  $base = (Get-StatusBaseUrl).TrimEnd('/')
  $uri = "$base/$Path"
  try {
    if ($uri.StartsWith('https')) {
      return Invoke-RestMethod -Method POST -Uri $uri -ContentType 'application/json' -Body '{}' -SkipCertificateCheck
    }
    return Invoke-RestMethod -Method POST -Uri $uri -ContentType 'application/json' -Body '{}'
  } catch {
    return $null
  }
}

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
    $r = Invoke-Health
    if ($r -and $r.paired) {
      $label = if ($r.tenantName) { $r.tenantName } elseif ($r.label) { $r.label } else { $r.deviceId }
      $Tray.Text = "Ankara Yazılım Connector — Bağlı ($label)"
    } elseif ($r -and $r.sessionPaused) {
      $Tray.Text = 'Ankara Yazılım Connector — Oturum kapalı'
    } else {
      $Tray.Text = 'Ankara Yazılım Connector — Oturum bekleniyor'
    }
  } catch {
    $Tray.Text = 'Ankara Yazılım Connector — başlatılıyor…'
  }
}

function Update-MenuState {
  param(
    [System.Windows.Forms.ToolStripMenuItem]$LoginItem,
    [System.Windows.Forms.ToolStripMenuItem]$LogoutItem,
    [System.Windows.Forms.ToolStripMenuItem]$TrustItem,
    [System.Windows.Forms.ToolStripMenuItem]$UpdateItem
  )
  $r = Invoke-Health
  if (-not $r) {
    $UpdateItem.Visible = $false
    return
  }
  if ($r.paired) {
    $LoginItem.Visible = $false
    $LogoutItem.Visible = $true
  } else {
    $LoginItem.Visible = $true
    $LogoutItem.Visible = $false
  }
  if ($r.tls -and -not $r.certTrusted) {
    $TrustItem.Visible = $true
  } else {
    $TrustItem.Visible = $false
  }
  if ($r.pendingUpdate -and $r.pendingUpdate.version) {
    $UpdateItem.Text = "Güncellemeyi uygula… (v$($r.pendingUpdate.version))"
    $UpdateItem.Visible = $true
  } else {
    $UpdateItem.Visible = $false
  }
}

function Show-About {
  $base = (Get-StatusBaseUrl).TrimEnd('/')
  Start-Process "$base/about?tray=$($script:Version)&tbuild=ps1"
}

function Invoke-TrustCert {
  $r = Invoke-StatusPost -Path 'trust-cert'
  if ($r -and $r.ok) {
    [System.Windows.Forms.MessageBox]::Show(
      'Sertifika Windows kullanıcı deposuna eklendi.',
      'Yerel sertifika',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
  } else {
    [System.Windows.Forms.MessageBox]::Show(
      'Sertifika güven deposuna eklenemedi.',
      'Yerel sertifika',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
  }
}

function Invoke-Logout {
  Invoke-StatusPost -Path 'session/logout' | Out-Null
  Stop-AgentCore
  Start-Sleep -Milliseconds 300
  Start-AgentCore
}

function Invoke-Login {
  $r = Invoke-StatusPost -Path 'session/login'
  if ($r -and $r.ok) {
    [System.Windows.Forms.MessageBox]::Show(
      'Tarayıcıda oturum açma sayfası açıldı.',
      'Oturum aç',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
  } else {
    [System.Windows.Forms.MessageBox]::Show(
      'Oturum açılamadı. Durum sayfasını kontrol edin.',
      'Oturum aç',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
  }
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
$mOpen = $menu.Items.Add('Durumu Aç', $null, { Start-Process (Get-StatusBaseUrl) })
$mTrust = $menu.Items.Add('Yerel sertifikayı güven…', $null, { Invoke-TrustCert })
$mLogin = $menu.Items.Add('Oturum aç…', $null, { Invoke-Login })
$mUpdate = $menu.Items.Add('Güncellemeyi uygula…', $null, { Invoke-StatusPost -Path 'update/apply' | Out-Null })
$mUpdate.Visible = $false
$mAbout = $menu.Items.Add('Hakkında…', $null, { Show-About })
$null = $menu.Items.Add('-')
$mLogout = $menu.Items.Add('Oturumu Kapat', $null, { Invoke-Logout; Update-TrayTooltip -Tray $tray })
$mLogout.Visible = $false
$null = $menu.Items.Add('-')
$null = $menu.Items.Add('Çıkış', $null, {
  $tray.Visible = $false
  Stop-AgentCore
  [System.Windows.Forms.Application]::Exit()
})
$tray.ContextMenuStrip = $menu

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 12000
$timer.Add_Tick({
  Update-TrayTooltip -Tray $tray
  Update-MenuState -LoginItem $mLogin -LogoutItem $mLogout -TrustItem $mTrust -UpdateItem $mUpdate
})
$timer.Start()
Update-MenuState -LoginItem $mLogin -LogoutItem $mLogout -TrustItem $mTrust -UpdateItem $mUpdate

Register-EngineEvent PowerShell.Exiting -Action { Stop-AgentCore } | Out-Null
[System.Windows.Forms.Application]::Run()
