[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$tempFile = Join-Path ([System.IO.Path]::GetTempPath()) "SessionManagerPluginSetup.exe"
Write-Host "Downloading to $tempFile..."
(New-Object Net.WebClient).DownloadFile("https://s3.amazonaws.com/session-manager-downloads/plugin/latest/windows/SessionManagerPluginSetup.exe", $tempFile)
Write-Host "Downloaded. Installing..."
Start-Process -FilePath $tempFile -ArgumentList "/quiet" -Wait
Write-Host "Done. Checking install..."
Test-Path "C:\Program Files\Amazon\SessionManagerPlugin\bin\session-manager-plugin.exe"
