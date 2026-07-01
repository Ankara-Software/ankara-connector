# ankara-connector — Windows service registration (roadmap §3, §5).
# Requires elevation. Uses `sc.exe` to create a Windows Service that runs the
# agent in the background at boot, independent of any user session.
#
# Usage (run as Administrator):
#   pwsh -File scripts\install-daemon-windows.ps1 -Action install
#   pwsh -File scripts\install-daemon-windows.ps1 -Action uninstall

param(
  [ValidateSet('install', 'uninstall')] [string]$Action = 'install',
  [string]$BinPath = (Join-Path $env:LOCALAPPDATA 'AnkaraYazilim\ankara-connector.exe'),
  [switch]$Silent
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'AnkaraConnector'

if ($Action -eq 'install') {
  if (-not (Test-Path $BinPath)) { throw "Connector bulunamadı: $BinPath" }
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Halter zaten kurulu — yeniden başlatılıyor."
    Restart-Service -Name $ServiceName -Force
    return
  }
  & sc.exe create $ServiceName binPath= "`"$BinPath`" run" start= auto DisplayName= "Ankara Yazılım Connector"
  & sc.exe description $ServiceName "Fiziksel donanımı panellerle köprüleyen Connector arka plan hizmeti."
  & sc.exe start $ServiceName
  Write-Host "Connector Windows hizmeti olarak kuruldu."
}
else {
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    & sc.exe stop $ServiceName
    & sc.exe delete $ServiceName
    Write-Host "Connector Windows hizmeti kaldırıldı."
  }
}
