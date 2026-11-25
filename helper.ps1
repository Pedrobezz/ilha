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
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionManager2 { int f(); int g(); int GetSessionEnumerator(out IAudioSessionEnumerator e); }
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionEnumerator { int GetCount(out int n); int GetSession(int i, [MarshalAs(UnmanagedType.IUnknown)] out object s); }
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionControl2 {
  int GetState(out int state); int a1(); int a2(); int a3(); int a4(); int a5(); int a6(); int a7(); int a8();
  int b1(); int b2(); int GetProcessId(out uint pid);
}

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

  // ---- microfone: mudo do dispositivo de gravação padrão ----
  static IAudioEndpointVolume Capture() {
    try {
      var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
      IMMDevice dev; if (en.GetDefaultAudioEndpoint(1, 1, out dev) != 0) return null;
      Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
      if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return null;
      return (IAudioEndpointVolume)o;
    } catch { return null; }
  }
  public static int MicMuted() { try { var c = Capture(); if (c == null) return -1; bool m; c.GetMute(out m); return m ? 1 : 0; } catch { return -1; } }
  public static void ToggleMic() { try { var c = Capture(); if (c == null) return; bool m; c.GetMute(out m); c.SetMute(!m, Guid.Empty); } catch {} }

  // ---- microfone em uso: programas com sessão de áudio ATIVA no microfone padrão ----
  public static string MicApps(uint selfPid) {
    var apps = new System.Collections.Generic.List<string>();
    try {
      var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
      IMMDevice dev; if (en.GetDefaultAudioEndpoint(1, 1, out dev) != 0) return "";
      Guid iid = typeof(IAudioSessionManager2).GUID; object o;
      if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return "";
      IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se);
      int n; se.GetCount(out n);
      for (int i = 0; i < n; i++) {
        object so; se.GetSession(i, out so);
        var s2 = so as IAudioSessionControl2; if (s2 == null) continue;
        int st; s2.GetState(out st); if (st != 1) continue; // 1 = ativa (gravando agora)
        uint pid; s2.GetProcessId(out pid); if (pid == 0 || pid == selfPid) continue;
        try { var name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName + ".exe"; if (!apps.Contains(name)) apps.Add(name); } catch {}
      }
    } catch {}
    return string.Join(";", apps);
  }

  // ---- câmera em uso (o mesmo registro que o Windows usa para o ícone da barra) ----
  // devolve os apps usando agora, ex.: "Discord.exe;chrome.exe"
  public static string InUse(string cap) {
    var apps = new System.Collections.Generic.List<string>();
    try {
      using (var root = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\" + cap)) {
        if (root == null) return "";
        Action<Microsoft.Win32.RegistryKey, string> check = (k, name) => {
          object s = k.GetValue("LastUsedTimeStart"), e = k.GetValue("LastUsedTimeStop");
          if (s is long && (long)s > 0 && e is long && (long)e == 0) apps.Add(name);
        };
        foreach (var n in root.GetSubKeyNames()) {
          if (n == "NonPackaged") {
            using (var np = root.OpenSubKey(n)) foreach (var m in np.GetSubKeyNames()) using (var k = np.OpenSubKey(m)) if (k != null) check(k, m.Substring(m.LastIndexOf('#') + 1));
          } else using (var k = root.OpenSubKey(n)) if (k != null) check(k, n.Split('_')[0]);
        }
      }
    } catch {}
    return string.Join(";", apps);
  }

  // ---- brilho dos monitores externos (DDC/CI) ----
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct PHYSICAL_MONITOR { public IntPtr h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string desc; }
  delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT r, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
  [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr h, out uint n);
  [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr h, uint n, [Out] PHYSICAL_MONITOR[] arr);
  [DllImport("dxva2.dll")] static extern bool GetMonitorBrightness(IntPtr h, out uint min, out uint cur, out uint max);
  [DllImport("dxva2.dll")] static extern bool SetMonitorBrightness(IntPtr h, uint v);
  [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitors(uint n, PHYSICAL_MONITOR[] arr);
  static void EachMonitor(Action<IntPtr> fn) {
    var list = new System.Collections.Generic.List<IntPtr>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr hm, IntPtr hdc, ref RECT r, IntPtr d) => { list.Add(hm); return true; }, IntPtr.Zero);
    foreach (var hm in list) {
      uint n; if (!GetNumberOfPhysicalMonitorsFromHMONITOR(hm, out n) || n == 0) continue;
      var arr = new PHYSICAL_MONITOR[n];
      if (!GetPhysicalMonitorsFromHMONITOR(hm, n, arr)) continue;
      foreach (var pm in arr) fn(pm.h);
      DestroyPhysicalMonitors(n, arr);
    }
  }
  // brilho em % do primeiro monitor que aceita DDC/CI, ou -1
  public static int GetBright() {
    int res = -1;
    EachMonitor(h => { if (res >= 0) return; uint mn, cur, mx; if (GetMonitorBrightness(h, out mn, out cur, out mx) && mx > mn) res = (int)Math.Round(100.0 * (cur - mn) / (mx - mn)); });
    return res;
  }
  public static int SetBright(int pct) {
    int ok = 0;
    EachMonitor(h => { uint mn, cur, mx; if (GetMonitorBrightness(h, out mn, out cur, out mx) && mx > mn) { if (SetMonitorBrightness(h, (uint)(mn + (mx - mn) * pct / 100.0))) ok++; } });
    return ok;
  }

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

# ---- brilho: monitores externos por DDC/CI, notebook pelo WMI ----
function Get-Bright {
  $v = [IslandNative]::GetBright(); $kind = 'ddc'
  if ($v -lt 0) {
    $w = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($w) { $v = [int]$w.CurrentBrightness; $kind = 'wmi' } else { $kind = 'none' }
  }
  Out-J @{ t = 'bright'; value = $v; kind = $kind }
}
function Set-Bright([int]$p) {
  $p = [math]::Max(0, [math]::Min(100, $p))
  if ([IslandNative]::SetBright($p) -eq 0) {
    $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { [void](Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$p }) }
  }
}

# ---- microfone e câmera em uso ----
$lastAv = ''
function Get-Av {
  $mic = [IslandNative]::MicApps([uint32]$SelfPid); $cam = [IslandNative]::InUse('webcam'); $mm = [IslandNative]::MicMuted()
  $sig = "$mic|$cam|$mm"
  if ($sig -eq $script:lastAv) { return }
  $script:lastAv = $sig
  Out-J @{ t = 'av'; mic = @($mic -split ';' | Where-Object { $_ }); cam = @($cam -split ';' | Where-Object { $_ }); micMuted = ($mm -eq 1); hasMic = ($mm -ge 0) }
}

# ---- notificações do Windows (UserNotificationListener): só lê enquanto o ajuste estiver ligado ----
$notifOn = $false; $notifL = $null; $notifSeen = @{}; $notifIcons = @{}; $notifPrimed = $false; $notifAccess = ''
function Init-Notifs {
  if ($script:notifL -or -not $asTaskGeneric) { return }
  try {
    [void][Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.UI.Notifications.UserNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $l = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
    $a = "$(Await ($l.RequestAccessAsync()) ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus]))"
    if ($a -ne $script:notifAccess) { $script:notifAccess = $a; Out-J @{ t = 'notifAccess'; status = $a } }
    if ($a -eq 'Allowed') { $script:notifL = $l }
  } catch { if ($script:notifAccess -ne 'Error') { $script:notifAccess = 'Error'; Out-J @{ t = 'notifAccess'; status = 'Error' } } }
}
function Get-NotifIcon($n, [string]$key) {
  if ($script:notifIcons.ContainsKey($key)) { return $script:notifIcons[$key] }
  $data = ''
  try {
    $ref = $n.AppInfo.DisplayInfo.GetLogo((New-Object Windows.Foundation.Size 48, 48))
    $st = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $ns = $script:asStream.Invoke($null, @($st)); $ms = New-Object System.IO.MemoryStream; $ns.CopyTo($ms); $ns.Dispose()
    if ($ms.Length -gt 0 -and $ms.Length -lt 400KB) { $data = 'data:image/png;base64,' + [Convert]::ToBase64String($ms.ToArray()) }
  } catch {}
  $script:notifIcons[$key] = $data
  return $data
}
function Get-Notifs {
  if (-not $script:notifOn) { return }
  Init-Notifs
  if (-not $script:notifL) { return }
  try { $list = @(Await ($script:notifL.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]])) } catch { return }
  $live = @{}
  foreach ($n in $list) {
    if (-not $n) { continue }
    $id = [string]$n.Id; $live[$id] = 1
    if ($script:notifSeen.ContainsKey($id)) { continue }
    $script:notifSeen[$id] = 1
    if (-not $script:notifPrimed) { continue }   # as que já estavam na central quando ligou não aparecem
    try { if (([DateTimeOffset]::Now - $n.CreationTime).TotalSeconds -gt 90) { continue } } catch {}
    $app = ''; $aumid = ''
    try { $app = "$($n.AppInfo.DisplayInfo.DisplayName)"; $aumid = "$($n.AppInfo.AppUserModelId)" } catch {}
    $texts = @()
    try { $b = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric); if ($b) { $texts = @($b.GetTextElements() | ForEach-Object { "$($_.Text)" } | Where-Object { $_ }) } } catch {}
    if ($texts.Count -eq 0) { continue }
    $body = (@($texts | Select-Object -Skip 1) -join "`n")
    if ($body.Length -gt 400) { $body = $body.Substring(0, 400) }
    Out-J @{ t = 'notif'; id = $id; app = $app; aumid = $aumid; title = "$($texts[0])"; body = $body; icon = (Get-NotifIcon $n $aumid) }
  }
  foreach ($k in @($script:notifSeen.Keys)) { if (-not $live.ContainsKey($k)) { $script:notifSeen.Remove($k) } }
  $script:notifPrimed = $true
}

# ---- OCR: lê o texto de uma imagem com o leitor de texto do Windows (Windows.Media.Ocr), sem internet ----
$ocrEngine = $null
function Do-Ocr([string]$id, [string]$file) {
  $stream = $null
  try {
    if (-not $script:ocrEngine) {
      [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
      [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
      [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
      $script:ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
      if (-not $script:ocrEngine) { $l = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Select-Object -First 1; if ($l) { $script:ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($l) } }
    }
    if (-not $script:ocrEngine) { Out-J @{ t = 'ocr'; id = $id; ok = $false; error = 'noengine' }; return }
    $f = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file)) ([Windows.Storage.StorageFile])
    $stream = Await ($f.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $sb = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($script:ocrEngine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
    $text = (@($res.Lines | ForEach-Object { $_.Text }) -join "`n")
    Out-J @{ t = 'ocr'; id = $id; ok = $true; text = $text }
  } catch { Out-J @{ t = 'ocr'; id = $id; ok = $false; error = 'read' } }
  finally { if ($stream) { $stream.Dispose() } }
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
      'bright' { Get-Bright }
      'setbright' { Set-Bright ([int]$parts[1]) }
      'micmute' { [IslandNative]::ToggleMic(); $script:lastAv = ''; Get-Av }
      'mon'   { [IslandNative]::MonX = [int]$parts[1]; [IslandNative]::MonY = [int]$parts[2]; $lastFg = $null }
      'disk'  { Get-Disk }
      'ocr'   { if ($parts.Count -ge 3) { Do-Ocr $parts[1] ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[2]))) } }   # caminho em base64 (acentos)
      'notifs' { $script:notifOn = ($parts[1] -eq '1'); if (-not $script:notifOn) { $script:notifPrimed = $false; $script:notifSeen = @{} } }
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
  if ($i % 6 -eq 1) { Get-Av }
  if ($i % 8 -eq 2) { Get-Notifs }   # ~1,3 s
  Start-Sleep -Milliseconds 160
  $i++
}
