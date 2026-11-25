# Ajudante nativo da Ilha: detecta janela maximizada/tela cheia, lê a mídia tocando,
# mede a rede e o disco, e envia teclas de mídia. Fala com o app por JSON (uma linha por mensagem).
param([int]$SelfPid = 0)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$src = @'
using System;
using System.Text;
using System.Threading;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Net.NetworkInformation;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice { int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumeratorCom { }

public static class IslandNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT p, uint f);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  static readonly ConcurrentQueue<string> Q = new ConcurrentQueue<string>();
  public static void StartReader() {
    var t = new Thread(() => { string l; try { while ((l = Console.In.ReadLine()) != null) Q.Enqueue(l.Trim()); } catch {} Q.Enqueue("quit"); });
    t.IsBackground = true; t.Start();
  }
  public static string Next() { string s; return Q.TryDequeue(out s) ? s : null; }

  public static void Key(int vk) { keybd_event((byte)vk, 0, 0, UIntPtr.Zero); keybd_event((byte)vk, 0, 2, UIntPtr.Zero); }

  public static int MonX = 0, MonY = 0;

  // ---- volume do Windows (Core Audio) ----
  static IAudioEndpointVolume vol; static DateTime volAt = DateTime.MinValue;
  static IAudioEndpointVolume Vol() {
    if (vol == null || (DateTime.UtcNow - volAt).TotalSeconds > 4) {
      try {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
        IMMDevice dev; Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
        Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
        Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
        vol = (IAudioEndpointVolume)o; volAt = DateTime.UtcNow;
      } catch { vol = null; }
    }
    return vol;
  }
  // devolve "nível|mudo" (ex.: "0.42|0") ou "" sem saída de áudio
  public static string GetVol() {
    try { var v = Vol(); if (v == null) return ""; float l; bool m; v.GetMasterVolumeLevelScalar(out l); v.GetMute(out m); return Math.Round(l, 2).ToString(System.Globalization.CultureInfo.InvariantCulture) + "|" + (m ? "1" : "0"); }
    catch { vol = null; return ""; }
  }
  public static void SetVol(float l) { try { var v = Vol(); if (v == null) return; v.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, l)), Guid.Empty); if (l > 0) v.SetMute(false, Guid.Empty); } catch { vol = null; } }
  public static void ToggleMute() { try { var v = Vol(); if (v == null) return; bool m; v.GetMute(out m); v.SetMute(!m, Guid.Empty); } catch { vol = null; } }

  // "1" = a janela da frente cobre o monitor principal (maximizada ou tela cheia), "0" = não, "" = manter o estado anterior
  public static string Fg(uint selfPid) {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "";
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid == selfPid) return "";
    var sb = new StringBuilder(256); GetClassName(h, sb, 256); string cls = sb.ToString();
    if (cls == "Progman" || cls == "WorkerW") return "0";
    if (cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd" || cls == "Windows.UI.Core.CoreWindow" || cls == "XamlExplorerHostIslandWindow" || cls == "TopLevelWindowForOverflowXamlIsland" || cls == "NotifyIconOverflowWindow") return "";
    POINT o = new POINT(); o.X = MonX; o.Y = MonY;
    IntPtr prim = MonitorFromPoint(o, 2); // monitor onde a ilha está
    if (MonitorFromWindow(h, 2) != prim) return "0";
    if (IsIconic(h)) return "0";
    if (IsZoomed(h)) return "1";
    RECT r; if (!GetWindowRect(h, out r)) return "0";
    var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(prim, ref mi)) return "0";
    var m = mi.rcMonitor;
    return (r.L <= m.L && r.T <= m.T && r.R >= m.R && r.B >= m.B) ? "1" : "0";
  }

  public static long[] Net() {
    long rx = 0, tx = 0;
    try {
      foreach (var n in NetworkInterface.GetAllNetworkInterfaces()) {
        if (n.OperationalStatus != OperationalStatus.Up || n.NetworkInterfaceType == NetworkInterfaceType.Loopback || n.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
        var s = n.GetIPStatistics(); rx += s.BytesReceived; tx += s.BytesSent;
      }
    } catch {}
    return new long[] { rx, tx };
  }
}
'@
Add-Type -TypeDefinition $src
[IslandNative]::StartReader()

function Out-J($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

# ---- mídia (Windows Media Control / SMTC) ----
$mgr = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await($op, [Type]$t) { $task = $asTaskGeneric.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(3000); $task.Result }
  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  [void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
  [void][Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  # o PowerShell não converte o objeto COM sozinho: chama AsStreamForRead por reflexão
  $asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch { $mgr = $null }

$lastKey = ''; $lastArt = ''; $lastSig = ''
function Get-Media {
  if (-not $mgr) { return }
  $s = $mgr.GetCurrentSession()
  if (-not $s) { if ($script:lastSig -ne 'none') { $script:lastSig = 'none'; Out-J @{ t = 'media'; has = $false } }; return }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $status = [int]$s.GetPlaybackInfo().PlaybackStatus
  $tl = $s.GetTimelineProperties()
  $key = "$($p.Title)|$($p.Artist)"
  if ($key -ne $script:lastKey) {
    $script:lastKey = $key; $script:lastArt = ''
    try {
      if ($p.Thumbnail) {
        $st = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $ns = $script:asStream.Invoke($null, @($st))
        $ms = New-Object System.IO.MemoryStream; $ns.CopyTo($ms)
        if ($ms.Length -gt 0 -and $ms.Length -lt 3MB) { $script:lastArt = 'data:image/png;base64,' + [Convert]::ToBase64String($ms.ToArray()) }
        $ns.Dispose()
      }
    } catch {}
  }
  $pos = [math]::Round($tl.Position.TotalSeconds); $end = [math]::Round($tl.EndTime.TotalSeconds)
  $sig = "$key|$status|$pos|$end"
  if ($sig -eq $script:lastSig) { return }
  $script:lastSig = $sig
  Out-J @{ t = 'media'; has = $true; title = "$($p.Title)"; artist = "$($p.Artist)"; album = "$($p.AlbumTitle)"; app = "$($s.SourceAppUserModelId)"; playing = ($status -eq 4); pos = $pos; end = $end; art = $script:lastArt }
}

# ---- Wi-Fi e Bluetooth (Windows.Devices.Radios) ----
$radios = @(); $lastRadios = ''
function Load-Radios {
  if (-not $asTaskGeneric) { return }
  try {
    [void][Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
    [void](Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]))
    $script:radios = @(Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]))
  } catch { $script:radios = @() }
}
function Get-Radios([bool]$force) {
  $w = $script:radios | Where-Object { "$($_.Kind)" -eq 'WiFi' } | Select-Object -First 1
  $b = $script:radios | Where-Object { "$($_.Kind)" -eq 'Bluetooth' } | Select-Object -First 1
  $ssid = ''
  if ($w -and "$($w.State)" -eq 'On') { $m = (netsh wlan show interfaces) -match '^\s+SSID\s+:' | Select-Object -First 1; if ($m) { $ssid = ($m -split ':', 2)[1].Trim() } }
  $o = @{ t = 'radios'; wifi = @{ has = [bool]$w; on = ($w -and "$($w.State)" -eq 'On') }; bt = @{ has = [bool]$b; on = ($b -and "$($b.State)" -eq 'On') }; ssid = $ssid }
  $sig = "$($o.wifi.has)$($o.wifi.on)$($o.bt.has)$($o.bt.on)$ssid"
  if ($force -or $sig -ne $script:lastRadios) { $script:lastRadios = $sig; Out-J $o }
}
function Set-Radio([string]$kind, [bool]$on) {
  $k = if ($kind -eq 'bt') { 'Bluetooth' } else { 'WiFi' }
  $r = $script:radios | Where-Object { "$($_.Kind)" -eq $k } | Select-Object -First 1
  if (-not $r) { return }
  $st = if ($on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
  try { [void](Await ($r.SetStateAsync($st)) ([Windows.Devices.Radios.RadioAccessStatus])) } catch {}
}

function Get-Disk {
  $d = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -and ($_.Used + $_.Free) -gt 0 }
  Out-J @{ t = 'disk'; drives = @($d | ForEach-Object { @{ name = $_.Name; used = [int64]$_.Used; total = [int64]($_.Used + $_.Free) } }) }
}

$lastFg = $null; $lastVol = $null; $i = 0
$prevNet = [IslandNative]::Net(); $prevT = [DateTime]::UtcNow
Out-J @{ t = 'ready'; media = [bool]$mgr }
while ($true) {
  $refresh = $false
  while ($null -ne ($c = [IslandNative]::Next())) {
    $parts = $c -split ' '
    $inv = [System.Globalization.CultureInfo]::InvariantCulture
    switch ($parts[0]) {
      'play'  { [IslandNative]::Key(0xB3); $refresh = $true }
      'next'  { [IslandNative]::Key(0xB0); $refresh = $true }
      'prev'  { [IslandNative]::Key(0xB1); $refresh = $true }
      'mute'  { [IslandNative]::ToggleMute() }
      'vdown' { [IslandNative]::Key(0xAE) }
      'vup'   { [IslandNative]::Key(0xAF) }
      'setvol' { [IslandNative]::SetVol([single]::Parse($parts[1], $inv)) }
      'seek'  {
        try { $s = $mgr.GetCurrentSession(); if ($s) { [void](Await ($s.TryChangePlaybackPositionAsync([int64]([double]::Parse($parts[1], $inv) * 10000000))) ([bool])) } } catch {}
        $refresh = $true
      }
      'radio' { Set-Radio $parts[1] ($parts[2] -eq 'on'); Start-Sleep -Milliseconds 400; Get-Radios $true }
      'radios' { Get-Radios $true }
      'mon'   { [IslandNative]::MonX = [int]$parts[1]; [IslandNative]::MonY = [int]$parts[2]; $lastFg = $null }
      'disk'  { Get-Disk }
      'quit'  { exit }
    }
  }
  $v = [IslandNative]::GetVol()
  if ($v -ne '' -and $v -ne $lastVol) {
    $vp = $v -split '\|'
    Out-J @{ t = 'vol'; level = [double]::Parse($vp[0], [System.Globalization.CultureInfo]::InvariantCulture); muted = ($vp[1] -eq '1'); first = ($null -eq $lastVol) }
    $lastVol = $v
  }
  $fg = [IslandNative]::Fg([uint32]$SelfPid)
  if ($fg -ne '' -and $fg -ne $lastFg) { $lastFg = $fg; Out-J @{ t = 'fg'; covered = ($fg -eq '1') } }
  if ($i % 6 -eq 0) {
    $now = [DateTime]::UtcNow; $n = [IslandNative]::Net(); $dt = ($now - $prevT).TotalSeconds
    if ($dt -gt 0) { Out-J @{ t = 'net'; down = [math]::Max(0, ($n[0] - $prevNet[0]) / $dt); up = [math]::Max(0, ($n[1] - $prevNet[1]) / $dt) } }
    $prevNet = $n; $prevT = $now
  }
  if ($refresh) { Start-Sleep -Milliseconds 350; Get-Media }
  elseif ($i % 6 -eq 3) { Get-Media }
  if ($i % 180 -eq 0) { Get-Disk }
  if ($i % 1100 -eq 5) { Load-Radios }   # recarrega a lista de rádios a cada ~3 min (e logo no início)
  if ($i % 18 -eq 9) { Get-Radios $false }
  Start-Sleep -Milliseconds 160
  $i++
}
