# Hızlı Windows tray kurulumu (geliştirme / v1.1.0 → v1.1.1 geçişi)
# Mevcut ankara-connector exe'nizi systray + About + Oturumu Kapat menüsü ile çalıştırır.
#
# Kullanım (PowerShell):
#   cd ankara-connector
#   .\scripts\install-windows-tray-local.ps1 -CoreExe "C:\Downloads\ankara-connector-1.1.0-windows-x64.exe"

param(
  [Parameter(Mandatory = $false)]
  [string]$CoreExe,
  [Parameter(Mandatory = $false)]
  [string]$InstallDir = "$env:LOCALAPPDATA\Ankara Yazilim\Connector"
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not $CoreExe) {
  $candidate = Join-Path $Root 'dist\ankara-connector-core.exe'
  if (Test-Path $candidate) { $CoreExe = $candidate }
}
if (-not $CoreExe -or -not (Test-Path $CoreExe)) {
  throw 'CoreExe bulunamadi. -CoreExe ile mevcut connector indirmenizi verin.'
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Force $CoreExe (Join-Path $InstallDir 'ankara-connector-core.exe')
Copy-Item -Force (Join-Path $Root 'windows\assets\ankara-yazilim.ico') (Join-Path $InstallDir 'ankara-yazilim.ico')
Copy-Item -Force (Join-Path $Root 'windows\tray\AnkaraYazilimConnector.ps1') (Join-Path $InstallDir 'AnkaraYazilimConnector.ps1')

$cmd = Join-Path $InstallDir 'AnkaraYazilimConnector.cmd'
Set-Content -Path $cmd -Value '@echo off' -Encoding ASCII
Add-Content -Path $cmd -Value 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0AnkaraYazilimConnector.ps1"' -Encoding ASCII

$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Ankara Yazilim Connector.lnk'
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($lnk)
$sc.TargetPath = $cmd
$sc.WorkingDirectory = $InstallDir
$sc.IconLocation = (Join-Path $InstallDir 'ankara-yazilim.ico')
$sc.Description = 'Ankara Yazilim Connector'
$sc.Save()

Write-Host "Kuruldu: $InstallDir"
Write-Host "Baslatiliyor (systray)…"
Start-Process -FilePath $cmd -WorkingDirectory $InstallDir
Write-Host "Saatin yanindaki gizli simgeler (^) icinde Ankara Yazilim logosunu arayin."
Write-Host "Sag tik: Durumu Ac | Hakkinda | Oturumu Kapat | Cikis"
