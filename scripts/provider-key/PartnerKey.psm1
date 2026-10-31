# Windows Credential Manager access for the Aween Rayeh partner key.
# The key is read and written through the Win32 credential API, never through
# a command line, so it does not appear in process arguments or shell history.

Set-StrictMode -Version Latest

$script:Target = "Masari/AweenRayehPartnerKey"

if (-not ("Masari.CredentialStore" -as [type])) {
  Add-Type -Namespace Masari -Name CredentialStore -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CREDENTIAL {
  public uint Flags; public uint Type; public string TargetName; public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
  public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
}
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredDelete(string target, uint type, uint flags);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr buffer);
'@
}

function Save-PartnerKey {
  param([Parameter(Mandatory)][System.Security.SecureString]$Key)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Key)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ($plain.Length -lt 20) { throw "The key looks too short to be a real partner key." }
    $bytes = [Text.Encoding]::Unicode.GetBytes($plain)
    $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
      $credential = New-Object Masari.CredentialStore+CREDENTIAL
      $credential.Type = 1          # CRED_TYPE_GENERIC
      $credential.TargetName = $script:Target
      $credential.CredentialBlobSize = $bytes.Length
      $credential.CredentialBlob = $blob
      $credential.Persist = 2       # CRED_PERSIST_LOCAL_MACHINE
      $credential.UserName = "masari-partner-key"
      if (-not [Masari.CredentialStore]::CredWrite([ref]$credential, 0)) {
        throw "Windows refused to store the credential (error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
      }
    } finally {
      [Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
      [Array]::Clear($bytes, 0, $bytes.Length)
    }
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Test-PartnerKey {
  $pointer = [IntPtr]::Zero
  if ([Masari.CredentialStore]::CredRead($script:Target, 1, 0, [ref]$pointer)) {
    [Masari.CredentialStore]::CredFree($pointer)
    return $true
  }
  return $false
}

# Returns the key as a string. Callers must put it only in a child process
# environment and never print or log it.
function Get-PartnerKey {
  $pointer = [IntPtr]::Zero
  if (-not [Masari.CredentialStore]::CredRead($script:Target, 1, 0, [ref]$pointer)) {
    throw "No partner key is stored. Run scripts/provider-key/set-partner-key.ps1 first."
  }
  try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][Masari.CredentialStore+CREDENTIAL])
    return [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, [int]($credential.CredentialBlobSize / 2))
  } finally {
    [Masari.CredentialStore]::CredFree($pointer)
  }
}

function Remove-PartnerKey {
  [void][Masari.CredentialStore]::CredDelete($script:Target, 1, 0)
}

Export-ModuleMember -Function Save-PartnerKey, Test-PartnerKey, Get-PartnerKey, Remove-PartnerKey
