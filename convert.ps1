# Ilha: conversoes que usam o proprio Windows ou o Office. Um processo por conversao; responde em JSON (uma linha por mensagem).
#   -Mode topng   -Src foto.heic -Dst saida.png          (HEIC, TIFF... -> PNG, pelo leitor de imagens do Windows)
#   -Mode pdf2png -Src doc.pdf   -Dst pasta -Kind prefixo (uma imagem por pagina, pelo leitor de PDF do Windows)
#   -Mode office  -Src arquivo   -Dst saida -Kind word|excel|ppt|pdf2docx   (Microsoft Office em segundo plano)
#   -Mode engines                                       (quais programas do Office estao instalados)
param([string]$Mode, [string]$Src = '', [string]$Dst = '', [string]$Kind = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Out-J($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

function Load-WinRT {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $m = [System.WindowsRuntimeSystemExtensions].GetMethods()
  $script:asOp = ($m | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $script:asAct = ($m | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
  [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  [void][Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime]
  [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  [void][Windows.Graphics.Imaging.BitmapEncoder, Windows.Graphics, ContentType = WindowsRuntime]
  [void][Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
}
function Await($op, [Type]$t) { $task = $script:asOp.MakeGenericMethod($t).Invoke($null, @($op)); if (-not $task.Wait(120000)) { throw 'Demorou demais' }; $task.Result }
function AwaitA($op) { $task = $script:asAct.Invoke($null, @($op)); if (-not $task.Wait(120000)) { throw 'Demorou demais' } }
function Open-Out([string]$file) {
  $folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync([IO.Path]::GetDirectoryName($file))) ([Windows.Storage.StorageFolder])
  $f = Await ($folder.CreateFileAsync([IO.Path]::GetFileName($file), [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
  Await ($f.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])
}
function Has-Prog([string]$p) { return [bool][Type]::GetTypeFromProgID($p) }

try {
  switch ($Mode) {
    'engines' {
      Out-J @{ ok = $true; word = (Has-Prog 'Word.Application'); excel = (Has-Prog 'Excel.Application'); ppt = (Has-Prog 'PowerPoint.Application') }
    }
    'topng' {
      Load-WinRT
      $f = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Src)) ([Windows.Storage.StorageFile])
      $in = Await ($f.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
      $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($in)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $sb = Await ($dec.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $out = Open-Out $Dst
      $enc = Await ([Windows.Graphics.Imaging.BitmapEncoder]::CreateAsync([Windows.Graphics.Imaging.BitmapEncoder]::PngEncoderId, $out)) ([Windows.Graphics.Imaging.BitmapEncoder])
      $enc.SetSoftwareBitmap($sb)
      AwaitA ($enc.FlushAsync())
      $out.Dispose(); $in.Dispose()
      Out-J @{ ok = $true }
    }
    'pdf2png' {
      Load-WinRT
      $f = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Src)) ([Windows.Storage.StorageFile])
      $doc = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($f)) ([Windows.Data.Pdf.PdfDocument])
      $n = [int]$doc.PageCount; $files = @()
      for ($i = 0; $i -lt $n; $i++) {
        $page = $doc.GetPage([uint32]$i)
        $opt = New-Object Windows.Data.Pdf.PdfPageRenderOptions
        $opt.DestinationWidth = [uint32][Math]::Min(4000, [Math]::Round($page.Size.Width * 2))   # 2x: nitido para ler
        $file = Join-Path $Dst ("{0} {1}.png" -f $Kind, ($i + 1))
        $out = Open-Out $file
        AwaitA ($page.RenderToStreamAsync($out, $opt))
        $out.Dispose(); $page.Dispose()
        $files += $file
        Out-J @{ page = $i + 1; total = $n }
      }
      Out-J @{ ok = $true; files = $files }
    }
    'office' {
      $app = $null
      try {
        if ($Kind -eq 'word' -or $Kind -eq 'pdf2docx') {
          $app = New-Object -ComObject Word.Application
          $app.Visible = $false; $app.DisplayAlerts = 0
          # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
          $doc = $app.Documents.Open($Src, $false, $true, $false)
          if ($Kind -eq 'word') { $doc.ExportAsFixedFormat($Dst, 17) } else { $doc.SaveAs2($Dst, 16) }   # 17 = PDF, 16 = docx
          $doc.Close(0)
        } elseif ($Kind -eq 'excel') {
          $app = New-Object -ComObject Excel.Application
          $app.Visible = $false; $app.DisplayAlerts = $false
          $wb = $app.Workbooks.Open($Src, 0, $true)
          $wb.ExportAsFixedFormat(0, $Dst)   # 0 = PDF
          $wb.Close($false)
        } elseif ($Kind -eq 'ppt') {
          $app = New-Object -ComObject PowerPoint.Application
          # Open(FileName, ReadOnly, Untitled, WithWindow)
          $p = $app.Presentations.Open($Src, -1, 0, 0)
          $p.SaveAs($Dst, 32)   # 32 = PDF
          $p.Close()
        } else { throw "tipo desconhecido: $Kind" }
      } finally {
        if ($app) { try { $app.Quit() } catch {}; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
      }
      Out-J @{ ok = $true }
    }
    default { throw "modo desconhecido: $Mode" }
  }
} catch {
  Out-J @{ ok = $false; error = "$($_.Exception.Message)" }
  exit 1
}
