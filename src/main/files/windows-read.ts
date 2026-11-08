import { win32 } from 'node:path'
import { execFile } from '../exec-host'
import { resolveWindowsShell } from '../windows-executable'
import { createSpawnLimiter } from '../spawn-limiter'

const readers = createSpawnLimiter(2)

/** Fixed native implementation; paths are data in the child environment, never script source. */
export const WINDOWS_CONTAINED_READER = String.raw`
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class MdeContainedReader {
  [StructLayout(LayoutKind.Sequential)]
  struct Info {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle file, out Info info);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern uint GetFileType(SafeFileHandle file);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder path, uint length, uint flags);

  public sealed class Result { public long Size; public byte[] Bytes; }
  static Exception Changed() { return new IOException("File changed or could not be opened safely. Try again."); }
  static string Normal(string path) {
    if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) path = @"\\" + path.Substring(8);
    else if (path.StartsWith(@"\\?\", StringComparison.Ordinal)) path = path.Substring(4);
    if (!Path.IsPathRooted(path) || path.StartsWith(@"\\.\", StringComparison.Ordinal)) throw Changed();
    return Path.GetFullPath(path).TrimEnd('\\');
  }
  static string FinalName(SafeFileHandle handle) {
    var text = new StringBuilder(32768);
    uint size = GetFinalPathNameByHandleW(handle, text, (uint)text.Capacity, 0);
    if (size == 0 || size >= text.Capacity) throw Changed();
    return Normal(text.ToString());
  }
  static SafeFileHandle Open(string path, bool directory) {
    // Ancestors share read only: no write handle may add/change a reparse point,
    // and no delete handle may rename/replace them. File contents may be edited,
    // but the opened file itself must not be replaced during the bounded read.
    // Include directory LIST access (GENERIC_READ), not attributes alone:
    // metadata-only handles do not participate in Windows share-access checks.
    var handle = CreateFileW(path, 0x80000000u, directory ? 1u : 3u, IntPtr.Zero,
      3, 0x00200000u | (directory ? 0x02000000u : 0u), IntPtr.Zero);
    Info info;
    if (handle.IsInvalid || GetFileType(handle) != 1 || !GetFileInformationByHandle(handle, out info) ||
        (info.Attributes & 0x400) != 0 || ((info.Attributes & 0x10) != 0) != directory) {
      handle.Dispose(); throw Changed();
    }
    return handle;
  }
  public static Result Read(string root, string path, int limit) {
    if (limit < 0 || limit > 20 * 1024 * 1024) throw Changed();
    root = Normal(root); path = Normal(path);
    if (!path.StartsWith(root + @"\", StringComparison.OrdinalIgnoreCase)) throw Changed();
    string volume = Path.GetPathRoot(path);
    var parts = path.Substring(volume.Length).Split('\\');
    foreach (var part in parts) {
      if (part.Length == 0 || part.IndexOfAny(new char[] {':', '<', '>', '"', '|', '?', '*'}) >= 0 ||
          part.EndsWith(".") || part.EndsWith(" ")) throw Changed();
    }
    var handles = new List<SafeFileHandle>();
    try {
      string prefix = volume;
      var current = Open(prefix, true); handles.Add(current);
      SafeFileHandle rootHandle = Normal(prefix).Equals(root, StringComparison.OrdinalIgnoreCase) ? current : null;
      for (int i = 0; i < parts.Length - 1; i++) {
        prefix = Path.Combine(prefix, parts[i]);
        current = Open(prefix, true); handles.Add(current);
        if (prefix.Equals(root, StringComparison.OrdinalIgnoreCase)) rootHandle = current;
      }
      if (rootHandle == null) throw Changed();
      using (var file = Open(path, false)) {
        // Identity is obtained from handles, not a second pathname lookup.
        if (!FinalName(file).StartsWith(FinalName(rootHandle) + @"\", StringComparison.OrdinalIgnoreCase)) throw Changed();
        using (var stream = new FileStream(file, FileAccess.Read)) {
          long size = stream.Length;
          if (size > limit) return new Result { Size = size, Bytes = null };
          var bytes = new byte[(int)size + 1];
          int length = 0, read;
          while (length < bytes.Length && (read = stream.Read(bytes, length, bytes.Length - length)) > 0) length += read;
          if (length != size || stream.Length != size) throw Changed();
          Array.Resize(ref bytes, length);
          return new Result { Size = size, Bytes = bytes };
        }
      }
    } finally { for (int i = handles.Count - 1; i >= 0; i--) handles[i].Dispose(); }
  }
}
`

const script = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "Add-Type -TypeDefinition @'",
  WINDOWS_CONTAINED_READER,
  "'@",
  '$request = $env:MDE_CONTAINED_READ | ConvertFrom-Json',
  'try {',
  '  $result = [MdeContainedReader]::Read($request.root, $request.path, [int]$request.limit)',
  '  $data = if ($null -eq $result.Bytes) { $null } else { [Convert]::ToBase64String($result.Bytes) }',
  '  @{ size = $result.Size; data = $data } | ConvertTo-Json -Compress',
  '} catch { exit 1 }',
].join('\n')

/** No fallback to path-based reads if native handle verification is unavailable. */
export function readWindowsContainedFile(root: string, path: string, limit: number): Promise<{ size: number; bytes: Buffer | null }> {
  const file = resolveWindowsShell('powershell.exe')
  return readers.run('interactive', () => new Promise((resolve, reject) => {
    execFile(file, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      cwd: win32.dirname(file),
      env: { ...process.env, MDE_CONTAINED_READ: JSON.stringify({ root, path, limit }) },
      encoding: 'utf8', timeout: 15_000, maxBuffer: Math.ceil(limit * 4 / 3) + 64 * 1024, windowsHide: true,
    }, (error, stdout) => {
      try {
        if (error) throw error
        const result = JSON.parse(stdout) as { size: number; data: string | null }
        if (!Number.isSafeInteger(result.size) || result.size < 0 ||
          (result.size > limit ? result.data !== null : typeof result.data !== 'string')) throw new Error()
        const bytes = result.data === null ? null : Buffer.from(result.data, 'base64')
        if (bytes && (bytes.length !== result.size || bytes.length > limit)) throw new Error()
        resolve({ size: result.size, bytes })
      } catch { reject(new Error('File changed or could not be opened safely. Try again.')) }
    })
  }))
}
