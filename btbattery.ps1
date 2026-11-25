# Bateria dos aparelhos Bluetooth conectados (fones, mouse, controle).
# Roda separado do ajudante principal porque consultar os dispositivos leva alguns segundos.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$KEY = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'   # DEVPKEY_Bluetooth_Battery
$devs = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE|BTHHFENUM|BTHLEDEVICE)\\' -and $_.Status -eq 'OK' }
$out = @()
if ($devs) {
  $props = Get-PnpDeviceProperty -InstanceId @($devs.InstanceId) -KeyName $KEY
  foreach ($p in $props) {
    if ($null -eq $p.Data -or "$($p.Type)" -eq 'Empty') { continue }
    $d = $devs | Where-Object { $_.InstanceId -eq $p.InstanceId } | Select-Object -First 1
    $out += @{ name = "$($d.FriendlyName)"; battery = [int]$p.Data }
  }
}
# o mesmo aparelho aparece em mais de um nó: fica um por nome
$seen = @{}; $uniq = @()
foreach ($o in $out) { if (-not $seen.ContainsKey($o.name)) { $seen[$o.name] = 1; $uniq += $o } }
[Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @($uniq)))
