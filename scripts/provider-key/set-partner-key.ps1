# Stores the dedicated replacement Aween Rayeh partner key in Windows Credential
# Manager. Run it yourself in your own terminal: the key is typed at a hidden
# prompt, never passed as an argument, and never printed.
#
#   pwsh -NoProfile -File scripts/provider-key/set-partner-key.ps1
#   pwsh -NoProfile -File scripts/provider-key/set-partner-key.ps1 -Remove
param([switch]$Remove)
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "PartnerKey.psm1") -Force

if ($Remove) {
  Remove-PartnerKey
  Write-Output "The stored partner key was removed."
  return
}
$key = Read-Host -AsSecureString "Paste the dedicated replacement partner key (input is hidden)"
Save-PartnerKey -Key $key
$key.Dispose()
Write-Output "The partner key is stored for this Windows user (target Masari/AweenRayehPartnerKey). It was not displayed."
