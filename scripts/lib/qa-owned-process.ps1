param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
# A job owns only this invocation's suspended child and its descendants. Assign
# before resuming so even fast launchers cannot escape before being registered.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class QaOwnedProcess {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long PerProcess, PerJob; public uint Flags; public UIntPtr Min, Max; public uint Active; public UIntPtr Affinity; public uint Priority, Scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits Basic; public Io Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public uint Size; public string Reserved, Desktop, Title; public uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags; public ushort Show,ReservedSize; public IntPtr ReservedBytes,Input,Output,Error; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process,Thread; public uint Pid,Tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool all, uint timeout);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  static string Quote(string value) {
    var text = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { text.Append('\\', slashes * 2 + 1); text.Append(c); }
      else { text.Append('\\', slashes); text.Append(c); }
      slashes = 0;
    }
    text.Append('\\', slashes * 2); text.Append('"'); return text.ToString();
  }
  public static int Run(string executable, string[] args, uint ownerPid) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null); ProcessInfo child = new ProcessInfo();
    IntPtr owner = OpenProcess(0x00100000, false, ownerPid); // SYNCHRONIZE, held across the wait (no PID reuse)
    if (job == IntPtr.Zero) throw new Win32Exception();
    try {
      if (owner == IntPtr.Zero || WaitForSingleObject(owner, 0) == 0) throw new Win32Exception();
      var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE
      if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) throw new Win32Exception();
      var startup = new Startup(); startup.Size = (uint)Marshal.SizeOf(startup); startup.Flags = 0x100;
      startup.Input = GetStdHandle(-10); startup.Output = GetStdHandle(-11); startup.Error = GetStdHandle(-12);
      foreach (IntPtr handle in new[] {startup.Input, startup.Output, startup.Error})
        if (handle != IntPtr.Zero && handle != new IntPtr(-1)) SetHandleInformation(handle, 1, 1);
      var command = new StringBuilder(Quote(executable)); foreach (string arg in args) command.Append(" ").Append(Quote(arg));
      if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000004, IntPtr.Zero, null, ref startup, out child)) throw new Win32Exception();
      if (!AssignProcessToJobObject(job, child.Process)) throw new Win32Exception();
      Console.Error.WriteLine("OWNED native_child_pid={0}", child.Pid);
      if (ResumeThread(child.Thread) == 0xffffffff) throw new Win32Exception();
      uint completed = WaitForMultipleObjects(2, new[] {child.Process, owner}, false, 0xffffffff);
      if (completed == 1) return 143;
      if (completed != 0) throw new Win32Exception();
      uint code;
      if (!GetExitCodeProcess(child.Process, out code)) throw new Win32Exception();
      return unchecked((int)code);
    } finally {
      // On startup failure the suspended process may not have joined the job.
      if (child.Process != IntPtr.Zero) { TerminateProcess(child.Process, 1); CloseHandle(child.Process); }
      if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
      CloseHandle(job);
      if (owner != IntPtr.Zero) CloseHandle(owner);
    }
  }
}
'@
try {
  $specification = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
  exit [QaOwnedProcess]::Run([string]$specification.executable, [string[]]$specification.args, [uint32]$specification.ownerPid)
} catch {
  [Console]::Error.WriteLine('qa_owned_process_start_failed')
  exit 1
}
