# Draws the Liquid Todo app icon and tray icon as PNG files.
param(
  [string]$OutDir = (Join-Path $PSScriptRoot '..\resources')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-LiquidIcon([int]$size, [string]$target) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $pad = $size * 0.06
  $body = New-RoundedPath $pad $pad ($size - (2 * $pad)) ($size - (2 * $pad)) ($size * 0.24)

  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(0, 0),
    [System.Drawing.PointF]::new($size, $size),
    [System.Drawing.Color]::FromArgb(255, 108, 196, 255),
    [System.Drawing.Color]::FromArgb(255, 10, 106, 240)
  )
  $graphics.FillPath($gradient, $body)

  $graphics.SetClip($body)
  $highlight = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(0, 0),
    [System.Drawing.PointF]::new($size * 0.35, $size),
    [System.Drawing.Color]::FromArgb(165, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(0, 255, 255, 255)
  )
  $graphics.FillRectangle($highlight, 0, 0, $size, $size)
  $sheen = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(0, $size * 0.55),
    [System.Drawing.PointF]::new($size, $size),
    [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(70, 255, 255, 255)
  )
  $graphics.FillRectangle($sheen, 0, 0, $size, $size)
  $graphics.ResetClip()

  $rim = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(130, 255, 255, 255), [single]($size * 0.012))
  $graphics.DrawPath($rim, $body)

  $check = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(250, 255, 255, 255), [single]($size * 0.085))
  $check.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $check.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $check.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLines($check, @(
      [System.Drawing.PointF]::new($size * 0.30, $size * 0.53),
      [System.Drawing.PointF]::new($size * 0.44, $size * 0.67),
      [System.Drawing.PointF]::new($size * 0.72, $size * 0.35)
    ))

  $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

New-LiquidIcon 512 (Join-Path $OutDir 'icon.png')
New-LiquidIcon 64 (Join-Path $OutDir 'tray.png')
New-LiquidIcon 32 (Join-Path $OutDir 'tray-small.png')

Write-Output "icons written to $OutDir"
