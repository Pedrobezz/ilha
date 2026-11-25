# Bateria de periféricos sem fio que o Windows não mostra (receptores USB próprios):
#  - Logitech LIGHTSPEED (ex.: G Pro X Superlight 2): protocolo HID++ 2.0, recursos 0x1004 / 0x1000 / 0x1001
#  - HyperX Cloud III Wireless (03F0:05B7): pergunta de status no canal do fabricante
# Só LÊ o estado da bateria; não muda nenhuma configuração dos aparelhos.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$src = @'
using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class Hid {
  [StructLayout(LayoutKind.Sequential)] struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid g; public int flags; public IntPtr r; }
  [StructLayout(LayoutKind.Sequential)] public struct HIDD_ATTRIBUTES { public int Size; public ushort VendorID, ProductID, Version; }
  [StructLayout(LayoutKind.Sequential)] public struct HIDP_CAPS {
    public ushort Usage, UsagePage, InputReportByteLength, OutputReportByteLength, FeatureReportByteLength;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
    public ushort a, b, c, d, e, f, g, h, i, j;
  }
  [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
  [DllImport("hid.dll")] static extern bool HidD_GetAttributes(SafeFileHandle h, ref HIDD_ATTRIBUTES a);
  [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr p);
  [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr p);
  [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr p, ref HIDP_CAPS c);
  [DllImport("setupapi.dll")] static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr e, IntPtr w, int f);
  [DllImport("setupapi.dll")] static extern bool SetupDiEnumDeviceInterfaces(IntPtr s, IntPtr d, ref Guid g, int i, ref SP_DEVICE_INTERFACE_DATA di);
  [DllImport("setupapi.dll", CharSet = CharSet.Auto)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr s, ref SP_DEVICE_INTERFACE_DATA di, IntPtr det, int size, out int req, IntPtr dd);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr s);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
  static extern SafeFileHandle CreateFile(string n, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr t);

  public class Dev { public string Path; public ushort Vid, Pid, UsagePage, Usage, InLen, OutLen; }

  public static List<Dev> List(ushort vid) {
    var res = new List<Dev>(); Guid g; HidD_GetHidGuid(out g);
    IntPtr set = SetupDiGetClassDevs(ref g, IntPtr.Zero, IntPtr.Zero, 0x12);
    var di = new SP_DEVICE_INTERFACE_DATA(); di.cbSize = Marshal.SizeOf(di);
    for (int i = 0; SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref di); i++) {
      int req; SetupDiGetDeviceInterfaceDetail(set, ref di, IntPtr.Zero, 0, out req, IntPtr.Zero);
      IntPtr det = Marshal.AllocHGlobal(req);
      Marshal.WriteInt32(det, IntPtr.Size == 8 ? 8 : 6);
      if (SetupDiGetDeviceInterfaceDetail(set, ref di, det, req, out req, IntPtr.Zero)) {
        string path = Marshal.PtrToStringAuto(new IntPtr(det.ToInt64() + 4));
        using (var h = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
          if (!h.IsInvalid) {
            var a = new HIDD_ATTRIBUTES(); a.Size = Marshal.SizeOf(a);
            if (HidD_GetAttributes(h, ref a) && a.VendorID == vid) {
              IntPtr pp; var caps = new HIDP_CAPS();
              if (HidD_GetPreparsedData(h, out pp)) { HidP_GetCaps(pp, ref caps); HidD_FreePreparsedData(pp); }
              res.Add(new Dev { Path = path, Vid = a.VendorID, Pid = a.ProductID, UsagePage = caps.UsagePage, Usage = caps.Usage, InLen = caps.InputReportByteLength, OutLen = caps.OutputReportByteLength });
            }
          }
        }
      }
      Marshal.FreeHGlobal(det);
    }
    SetupDiDestroyDeviceInfoList(set);
    return res;
  }

  [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(SafeFileHandle h, IntPtr buf, uint n, out uint got, IntPtr ov);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(SafeFileHandle h, IntPtr buf, uint n, out uint done, IntPtr ov);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetOverlappedResult(SafeFileHandle h, IntPtr ov, out uint n, bool wait);
  [DllImport("kernel32.dll")] static extern bool CancelIo(SafeFileHandle h);
  [DllImport("kernel32.dll")] static extern IntPtr CreateEvent(IntPtr a, bool manual, bool init, string name);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  public static SafeFileHandle Open(string path) {
    var h = CreateFile(path, 0xC0000000, 3, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero); // leitura+escrita, compartilhado, assíncrono
    return h.IsInvalid ? null : h;
  }
  // E/S assíncrona com tempo limite (cancela se o aparelho não responder)
  static byte[] Io(SafeFileHandle h, byte[] data, int len, int ms, bool write) {
    IntPtr buf = Marshal.AllocHGlobal(len), ovp = Marshal.AllocHGlobal(64), ev = CreateEvent(IntPtr.Zero, true, false, null);
    try {
      for (int i = 0; i < 64; i += 4) Marshal.WriteInt32(ovp, i, 0);
      Marshal.WriteIntPtr(ovp, IntPtr.Size == 8 ? 24 : 16, ev); // OVERLAPPED.hEvent
      if (write) Marshal.Copy(data, 0, buf, len);
      uint n; bool ok = write ? WriteFile(h, buf, (uint)len, out n, ovp) : ReadFile(h, buf, (uint)len, out n, ovp);
      if (!ok) {
        if (Marshal.GetLastWin32Error() != 997) return null; // não ficou pendente: erro
        if (WaitForSingleObject(ev, (uint)ms) != 0) { CancelIo(h); GetOverlappedResult(h, ovp, out n, true); return null; }
        if (!GetOverlappedResult(h, ovp, out n, false)) return null;
      }
      var r = new byte[n]; Marshal.Copy(buf, r, 0, (int)n); return r;
    } finally { CloseHandle(ev); Marshal.FreeHGlobal(buf); Marshal.FreeHGlobal(ovp); }
  }
  public static byte[] Read(SafeFileHandle h, int inLen, int ms) { return Io(h, null, inLen, ms, false); }
  public static bool Write(SafeFileHandle h, byte[] data, int outLen) { var b = new byte[outLen]; Array.Copy(data, b, Math.Min(data.Length, outLen)); return Io(h, b, outLen, 1000, true) != null; }
  // lê relatórios até 'match' aceitar um, ou acabar o tempo
  public static byte[] ReadUntil(SafeFileHandle h, int inLen, int ms, Func<byte[], bool> match) {
    var end = DateTime.UtcNow.AddMilliseconds(ms);
    while (DateTime.UtcNow < end) {
      int left = (int)(end - DateTime.UtcNow).TotalMilliseconds; if (left < 1) left = 1;
      var b = Io(h, null, inLen, left, false);
      if (b == null) return null;
      if (b.Length > 0 && match(b)) return b;
    }
    return null;
  }
  public static string Hex(byte[] b, int n) { if (b == null) return "(nada)"; var sb = new StringBuilder(); for (int i = 0; i < Math.Min(n, b.Length); i++) sb.Append(b[i].ToString("X2")).Append(' '); return sb.ToString(); }
}
'@
Add-Type -TypeDefinition $src

function Out-J($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)) }
function Read-Match($h, [int]$len, [int]$ms, [scriptblock]$cond) {
  $end = [DateTime]::UtcNow.AddMilliseconds($ms)
  while ([DateTime]::UtcNow -lt $end) {
    $left = [int]([math]::Max(1, ($end - [DateTime]::UtcNow).TotalMilliseconds))
    $b = [Hid]::Read($h, $len, $left)
    if ($null -eq $b) { return $null }
    if ($b.Length -gt 0 -and (& $cond $b)) { return ,$b }
  }
  return $null
}

# ---------------- Logitech HID++ 2.0 (receptor LIGHTSPEED / Bolt) ----------------
function Send-Hpp($h, [int]$dev, [int]$idx, [int]$fn, [byte[]]$args2) {
  $pkt = [byte[]](@(0x11, $dev, $idx, (($fn -shl 4) -bor 0x0B)) + @($args2))
  [void][Hid]::Write($h, $pkt, 20)
  return (Read-Match $h 20 700 { param($b) $b[1] -eq $dev -and ($b[2] -eq $idx -or $b[2] -eq 0xFF -or $b[2] -eq 0x8F) })
}
function Get-FeatureIndex($h, [int]$dev, [int]$feat) {
  $r = Send-Hpp $h $dev 0 0 ([byte[]](($feat -shr 8), ($feat -band 0xFF)))
  if ($r -and $r[2] -eq 0 -and $r[4] -ne 0) { return [int]$r[4] }
  if (-not $r -or $r[2] -ne 0) { return -1 }   # sem resposta: não há aparelho nesse lugar do receptor
  return 0                                      # aparelho existe, mas sem esse recurso
}
function Get-HppName($h, [int]$dev) {
  $idx = Get-FeatureIndex $h $dev 0x0005; if ($idx -le 0) { return '' }
  $r = Send-Hpp $h $dev $idx 0 ([byte[]]@()); if (-not $r) { return '' }
  $len = [int]$r[4]; $name = ''
  for ($off = 0; $off -lt $len -and $off -lt 64; $off += 16) {
    $r = Send-Hpp $h $dev $idx 1 ([byte[]]@($off)); if (-not $r) { break }
    $name += [System.Text.Encoding]::ASCII.GetString($r, 4, [math]::Min(16, $len - $off))
  }
  return $name.Trim([char]0).Trim()
}
function Get-Logitech {
  $out = @()
  foreach ($long in ([Hid]::List(0x046D) | Where-Object { $_.UsagePage -eq 0xFF00 -and $_.OutLen -eq 20 })) {
    $h = [Hid]::Open($long.Path); if (-not $h) { continue }
    try {
      foreach ($dev in 1..6) {
        $feat = 0; $idx = 0
        foreach ($f in @(0x1004, 0x1000, 0x1001)) { $idx = Get-FeatureIndex $h $dev $f; if ($idx -ne 0) { $feat = $f; break } }
        if ($idx -le 0) { continue }
        $r = Send-Hpp $h $dev $idx ($(if ($feat -eq 0x1004) { 1 } else { 0 })) ([byte[]]@())
        if (-not $r -or $r[2] -ne $idx) { continue }
        if ($feat -eq 0x1004) { $pct = [int]$r[4]; $charging = ($r[6] -eq 1 -or $r[6] -eq 2) }
        elseif ($feat -eq 0x1000) { $pct = [int]$r[4]; $charging = ($r[6] -ge 1 -and $r[6] -le 3) }
        else { $mv = ($r[4] * 256 + $r[5]); $pct = [int][math]::Max(0, [math]::Min(100, ($mv - 3500) / 7)); $charging = (($r[6] -band 0x80) -ne 0) }
        $name = Get-HppName $h $dev; if (-not $name) { $name = 'Mouse Logitech' }
        $out += @{ name = $name; battery = $pct; charging = $charging; kind = 'mouse' }
      }
    } finally { $h.Dispose() }
  }
  return $out
}

# ---------------- HyperX Cloud III Wireless (03F0:05B7) ----------------
# Resposta ao comando 66 89: o 5º byte é a bateria em % (conferido com o app NGENUITY).
function Get-HyperX {
  $ven = [Hid]::List(0x03F0) | Where-Object { $_.Pid -eq 0x05B7 -and $_.UsagePage -eq 0xFF13 } | Select-Object -First 1
  if (-not $ven) { return $null }
  $h = [Hid]::Open($ven.Path); if (-not $h) { return $null }
  try {
    # 66 82: 1 = fone ligado e conectado ao receptor
    [void][Hid]::Write($h, [byte[]](0x66, 0x82), $ven.OutLen)
    $c = Read-Match $h $ven.InLen 600 { param($b) $b[0] -eq 0x66 -and $b[1] -eq 0x82 }
    if ($c -and $c[2] -eq 0) { return $null }
    [void][Hid]::Write($h, [byte[]](0x66, 0x89), $ven.OutLen)
    $r = Read-Match $h $ven.InLen 800 { param($b) $b[0] -eq 0x66 -and $b[1] -eq 0x89 }
    if (-not $r -or $r[4] -gt 100) { return $null }
    # 66 8A: 1 = no cabo, carregando (conferido tirando e colocando o cabo)
    [void][Hid]::Write($h, [byte[]](0x66, 0x8A), $ven.OutLen)
    $c = Read-Match $h $ven.InLen 600 { param($b) $b[0] -eq 0x66 -and $b[1] -eq 0x8A }
    return @{ name = 'HyperX Cloud III'; battery = [int]$r[4]; charging = [bool]($c -and $c[2] -eq 1); kind = 'headset' }
  } finally { $h.Dispose() }
}

$out = @()
foreach ($d in @(Get-Logitech)) { if ($d) { $out += $d } }
$hx = Get-HyperX; if ($hx) { $out += $hx }
[Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @($out)))
