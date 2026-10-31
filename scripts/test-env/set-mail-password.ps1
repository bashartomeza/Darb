# Stores the Google App Password for the demo's sender address in Windows Credential
# Manager. Run it yourself in your own terminal: the password is typed at a hidden
# prompt, never passed as an argument, and never printed.
#
#   pwsh -NoProfile -File scripts/test-env/set-mail-password.ps1
#   pwsh -NoProfile -File scripts/test-env/set-mail-password.ps1 -Remove
param([switch]$Remove)
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "MailPassword.psm1") -Force

if ($Remove) {
  Remove-MailPassword
  Write-Output "The stored Gmail App Password was removed."
  return
}
$password = Read-Host -AsSecureString "Paste the 16-letter Google App Password (input is hidden)"
Save-MailPassword -Password $password
$password.Dispose()
Write-Output "The App Password is stored for this Windows user (target Masari/DemoGmailAppPassword). It was not displayed. Restart the test environment (stop.ps1, start.ps1) to use it."
