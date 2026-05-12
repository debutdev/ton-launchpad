Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "web\public\mockups"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir "ton-launchpad-dashboard-mockup.png"

function C($hex) {
  $value = $hex.TrimStart("#")
  return [System.Drawing.Color]::FromArgb(
    [Convert]::ToInt32($value.Substring(0, 2), 16),
    [Convert]::ToInt32($value.Substring(2, 2), 16),
    [Convert]::ToInt32($value.Substring(4, 2), 16)
  )
}

function CA($alpha, $hex) {
  $base = C $hex
  return [System.Drawing.Color]::FromArgb($alpha, $base.R, $base.G, $base.B)
}

function Font($name, $size, $style = [System.Drawing.FontStyle]::Regular) {
  return [System.Drawing.Font]::new($name, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}

function RoundPath($x, $y, $w, $h, $r) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function FillRound($g, $x, $y, $w, $h, $r, $color) {
  $path = RoundPath $x $y $w $h $r
  $brush = [System.Drawing.SolidBrush]::new($color)
  $g.FillPath($brush, $path)
  $brush.Dispose()
  $path.Dispose()
}

function StrokeRound($g, $x, $y, $w, $h, $r, $color, $width = 1) {
  $path = RoundPath $x $y $w $h $r
  $pen = [System.Drawing.Pen]::new($color, $width)
  $g.DrawPath($pen, $path)
  $pen.Dispose()
  $path.Dispose()
}

function Text($g, $copy, $font, $color, $x, $y, $w = 1000, $h = 1000, $align = "Near") {
  $brush = [System.Drawing.SolidBrush]::new($color)
  $format = [System.Drawing.StringFormat]::new()
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
  $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
  if ($align -eq "Center") { $format.Alignment = [System.Drawing.StringAlignment]::Center }
  if ($align -eq "Far") { $format.Alignment = [System.Drawing.StringAlignment]::Far }
  $rect = [System.Drawing.RectangleF]::new($x, $y, $w, $h)
  $g.DrawString($copy, $font, $brush, $rect, $format)
  $format.Dispose()
  $brush.Dispose()
}

function Circle($g, $x, $y, $d, $color) {
  $brush = [System.Drawing.SolidBrush]::new($color)
  $g.FillEllipse($brush, $x, $y, $d, $d)
  $brush.Dispose()
}

function TokenThumb($g, $x, $y, $size, $bg1, $bg2, $label) {
  $path = RoundPath $x $y $size $size 18
  $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.Rectangle]::new($x, $y, $size, $size),
    (C $bg1),
    (C $bg2),
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
  )
  $g.FillPath($brush, $path)
  $brush.Dispose()
  $pen = [System.Drawing.Pen]::new((CA 120 "#ffffff"), 2)
  $g.DrawPath($pen, $path)
  $pen.Dispose()
  $path.Dispose()

  Circle $g ($x + 16) ($y + 16) ($size - 32) (CA 48 "#ffffff")
  Circle $g ($x + 32) ($y + 32) ($size - 64) (CA 80 "#ffffff")
  Text $g $label (Font "Bahnschrift SemiCondensed" 38 ([System.Drawing.FontStyle]::Bold)) (C "#ffffff") ($x + 10) ($y + ($size / 2) - 23) ($size - 20) 50 "Center"
}

function MiniChart($g, $x, $y, $w, $h) {
  $gridPen = [System.Drawing.Pen]::new((CA 38 "#0098ea"), 1)
  for ($i = 1; $i -lt 5; $i++) {
    $yy = $y + ($h / 5) * $i
    $g.DrawLine($gridPen, $x, $yy, $x + $w, $yy)
  }
  $gridPen.Dispose()

  $random = [System.Random]::new(16)
  $cx = $x + 8
  $last = $y + $h - 32
  for ($i = 0; $i -lt 54; $i++) {
    $open = $last + $random.Next(-16, 18)
    $close = $open + $random.Next(-24, 26)
    $high = [Math]::Min($open, $close) - $random.Next(4, 18)
    $low = [Math]::Max($open, $close) + $random.Next(4, 18)
    $open = [Math]::Max($y + 18, [Math]::Min($y + $h - 18, $open))
    $close = [Math]::Max($y + 18, [Math]::Min($y + $h - 18, $close))
    $high = [Math]::Max($y + 8, [Math]::Min($y + $h - 8, $high))
    $low = [Math]::Max($y + 8, [Math]::Min($y + $h - 8, $low))
    $color = if ($close -le $open) { C "#0098ea" } else { C "#ff4d67" }
    $pen = [System.Drawing.Pen]::new($color, 2)
    $g.DrawLine($pen, $cx + 4, $high, $cx + 4, $low)
    $pen.Dispose()
    $brush = [System.Drawing.SolidBrush]::new($color)
    $bodyY = [Math]::Min($open, $close)
    $bodyH = [Math]::Max(5, [Math]::Abs($close - $open))
    $g.FillRectangle($brush, $cx, $bodyY, 8, $bodyH)
    $brush.Dispose()
    if ($i % 9 -eq 0 -and $i -gt 8) {
      Circle $g ($cx - 4) ($bodyY - 20) 28 (CA 220 "#0098ea")
      Text $g "DB" (Font "Segoe UI" 9 ([System.Drawing.FontStyle]::Bold)) (C "#ffffff") ($cx - 2) ($bodyY - 14) 24 18 "Center"
    }
    $cx += 13
    $last = $close
  }
}

$W = 1920
$H = 1080
$bmp = [System.Drawing.Bitmap]::new($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.Rectangle]::new(0, 0, $W, $H),
  (C "#f2f9ff"),
  (C "#d9efff"),
  [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
)
$g.FillRectangle($bg, 0, 0, $W, $H)
$bg.Dispose()

Circle $g 1440 -240 560 (CA 46 "#0098ea")
Circle $g 1260 760 540 (CA 34 "#0098ea")
Circle $g 360 260 420 (CA 42 "#83c3ff")

$sidebarW = 216
FillRound $g 18 18 ($sidebarW - 18) 1044 26 (CA 245 "#ffffff")
StrokeRound $g 18 18 ($sidebarW - 18) 1044 26 (CA 150 "#b8ddff") 1

Circle $g 42 42 32 (C "#0098ea")
Text $g "T" (Font "Bahnschrift SemiCondensed" 22 ([System.Drawing.FontStyle]::Bold)) (C "#ffffff") 42 43 32 28 "Center"
Text $g "TONPad" (Font "Segoe UI" 24 ([System.Drawing.FontStyle]::Bold)) (C "#071827") 84 42 120 34
Text $g "launch on ton" (Font "Segoe UI" 11) (C "#5c7b92") 85 74 100 18

$nav = @("Home", "Explore", "Live", "Callouts", "Chat", "Terminal", "Support")
$ny = 128
foreach ($item in $nav) {
  if ($item -eq "Home") {
    FillRound $g 34 ($ny - 10) 150 44 14 (C "#d9efff")
    StrokeRound $g 34 ($ny - 10) 150 44 14 (CA 100 "#0098ea") 1
  }
  $navDot = if ($item -eq "Home") { C "#0098ea" } else { CA 100 "#0b2a3f" }
  $navText = if ($item -eq "Home") { C "#071827" } else { C "#49687c" }
  Circle $g 48 ($ny + 2) 16 $navDot
  Text $g $item (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) $navText 76 ($ny - 2) 110 26
  $ny += 58
}
FillRound $g 34 952 150 54 18 (C "#0098ea")
Text $g "Create coin" (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) (C "#ffffff") 34 968 150 24 "Center"

$mainX = 242
$contentW = 1648
FillRound $g $mainX 18 $contentW 70 24 (CA 235 "#ffffff")
StrokeRound $g $mainX 18 $contentW 70 24 (CA 120 "#b8ddff") 1
FillRound $g 272 34 520 38 14 (C "#eef8ff")
StrokeRound $g 272 34 520 38 14 (CA 120 "#8fcfff") 1
Text $g "Search TON launches, tickers, creators..." (Font "Segoe UI" 15) (C "#6d8aa0") 322 42 380 24
Text $g "TON chain launchpad dashboard" (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) (C "#24455d") 900 42 300 24 "Center"
FillRound $g 1460 30 52 46 16 (C "#e8f5ff")
Text $g "Alert" (Font "Segoe UI" 12 ([System.Drawing.FontStyle]::Bold)) (C "#0098ea") 1460 45 52 18 "Center"
FillRound $g 1524 30 136 46 16 (C "#071827")
Text $g "Voice chat" (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) (C "#ffffff") 1524 42 136 24 "Center"
FillRound $g 1674 30 94 46 16 (C "#071827")
Text $g "+ Create" (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) (C "#ffffff") 1674 42 94 24 "Center"
FillRound $g 1784 30 86 46 16 (C "#0098ea")
Text $g "Connect" (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) (C "#ffffff") 1784 42 86 24 "Center"

Text $g "Featured TON launches" (Font "Segoe UI" 22 ([System.Drawing.FontStyle]::Bold)) (C "#071827") 272 122 360 30
Text $g "View all" (Font "Segoe UI" 14 ([System.Drawing.FontStyle]::Bold)) (C "#0098ea") 1790 128 80 24 "Far"

$coins = @(
  @("AQUA", "AquaCat", '$5.35M', "+18.4%", "#0098ea", "#00d4ff"),
  @("NANO", "NanoJet", '$2.59M', "+7.9%", "#2f80ed", "#83c3ff"),
  @("BOLT", "BoltWish", '$379K', "+4.2%", "#4da2ff", "#5c4ade"),
  @("WAVE", "TonWave", '$336K', "-2.3%", "#00aaff", "#67e8f9"),
  @("PEARL", "PearlAI", '$283K', "+11.0%", "#89cfff", "#0098ea"),
  @("MINT", "MintDrop", '$202K', "+0.6%", "#55db9c", "#0098ea")
)
$cx = 272
$rank = 1
foreach ($coin in $coins) {
  FillRound $g $cx 156 244 66 18 (CA 248 "#ffffff")
  StrokeRound $g $cx 156 244 66 18 (CA 150 "#b8ddff") 1
  Text $g "$rank" (Font "Segoe UI" 12 ([System.Drawing.FontStyle]::Bold)) (C "#5f7b92") ($cx + 16) 181 20 18 "Center"
  TokenThumb $g ($cx + 46) 168 42 $coin[4] $coin[5] $coin[0].Substring(0,1)
  Text $g $coin[0] (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) (C "#071827") ($cx + 98) 169 80 22
  Text $g $coin[1] (Font "Segoe UI" 12) (C "#6d8aa0") ($cx + 98) 190 82 18
  Text $g $coin[2] (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) (C "#071827") ($cx + 164) 169 70 22 "Far"
  $deltaColor = if ($coin[3].StartsWith("-")) { C "#ff4d67" } else { C "#0098ea" }
  Text $g $coin[3] (Font "Segoe UI" 11 ([System.Drawing.FontStyle]::Bold)) $deltaColor ($cx + 164) 191 70 18 "Far"
  $cx += 256
  $rank += 1
}

Text $g "Trending now" (Font "Segoe UI" 25 ([System.Drawing.FontStyle]::Bold)) (C "#071827") 272 256 300 34
$trend = @(
  @("AquaCat", '$1.27M', "TON community cat with absurd speed", "#0098ea", "#9ee7ff", "AC"),
  @("Jettonix", '$3.83M', "First bonded meme launch on TONPad", "#071827", "#0098ea", "JX"),
  @("Blue Whale", '$338K', "A whale tracker that became a token", "#064e73", "#55db9c", "BW"),
  @("Open Mint", '$761K', "Creator coin with live voice trading", "#83c3ff", "#5c4ade", "OM")
)
$tx = 272
foreach ($t in $trend) {
  TokenThumb $g $tx 302 250 $t[3] $t[4] $t[5]
  $overlay = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.Rectangle]::new($tx, 430, 250, 122),
    (CA 0 "#071827"),
    (CA 190 "#071827"),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
  )
  $g.FillRectangle($overlay, $tx, 430, 250, 122)
  $overlay.Dispose()
  Text $g $t[1] (Font "Segoe UI" 22 ([System.Drawing.FontStyle]::Bold)) (C "#ffffff") ($tx + 14) 462 100 28
  Text $g $t[0] (Font "Segoe UI" 16 ([System.Drawing.FontStyle]::Bold)) (C "#ffffff") ($tx + 14) 492 210 24
  Text $g $t[2] (Font "Segoe UI" 13) (C "#5d7484") ($tx + 2) 562 250 24 "Center"
  $tx += 274
}

Text $g "Explore coins" (Font "Segoe UI" 25 ([System.Drawing.FontStyle]::Bold)) (C "#071827") 272 626 300 34
$filters = @("Movers", "New", "Live", "Market cap", "Agents", "Oldest", "Last trade")
$fx = 272
foreach ($f in $filters) {
  $fw = if ($f -eq "Market cap") { 112 } elseif ($f -eq "Last trade") { 108 } else { 84 }
  $filterBg = if ($f -eq "New") { C "#0098ea" } else { C "#ffffff" }
  $filterText = if ($f -eq "New") { C "#ffffff" } else { C "#46667c" }
  FillRound $g $fx 674 $fw 42 14 $filterBg
  StrokeRound $g $fx 674 $fw 42 14 (CA 130 "#b8ddff") 1
  Text $g $f (Font "Segoe UI" 14 ([System.Drawing.FontStyle]::Bold)) $filterText $fx 686 $fw 20 "Center"
  $fx += $fw + 10
}

$grid = @(
  @("AQUA CAT", "AQUA", '$12.4K MC', "+16s", "#0098ea", "#84d8ff"),
  @("TON DRILL", "DRIL", '$2.72K MC', "+22s", "#071827", "#83c3ff"),
  @("BAM BAM", "BAM", '$979 MC', "+23s", "#2f80ed", "#5c4ade"),
  @("DUCKY TON", "DUCK", '$4.45K MC', "+26s", "#ffd731", "#0098ea")
)
$gx = 272
foreach ($item in $grid) {
  FillRound $g $gx 748 232 272 18 (CA 248 "#ffffff")
  StrokeRound $g $gx 748 232 272 18 (CA 150 "#b8ddff") 1
  TokenThumb $g ($gx + 14) 762 204 $item[4] $item[5] $item[1].Substring(0,2)
  FillRound $g ($gx + 142) 774 76 28 11 (CA 230 "#071827")
  Text $g "Mayhem" (Font "Segoe UI" 11 ([System.Drawing.FontStyle]::Bold)) (C "#ffffff") ($gx + 142) 781 76 16 "Center"
  Text $g $item[0] (Font "Segoe UI" 17 ([System.Drawing.FontStyle]::Bold)) (C "#071827") ($gx + 14) 982 204 24
  Text $g $item[1] (Font "Segoe UI" 14) (C "#6d8aa0") ($gx + 14) 1006 62 20
  Text $g $item[2] (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) (C "#071827") ($gx + 78) 1007 94 20
  Text $g $item[3] (Font "Segoe UI" 13 ([System.Drawing.FontStyle]::Bold)) (C "#0098ea") ($gx + 176) 1008 44 18 "Far"
  $gx += 252
}

$rightX = 1452
FillRound $g $rightX 256 418 344 20 (CA 248 "#ffffff")
StrokeRound $g $rightX 256 418 344 20 (CA 150 "#b8ddff") 1
Text $g "Market pulse" (Font "Segoe UI" 21 ([System.Drawing.FontStyle]::Bold)) (C "#071827") ($rightX + 24) 278 180 28
Text $g "TON volume 24h" (Font "Segoe UI" 13) (C "#6d8aa0") ($rightX + 24) 318 130 18
Text $g '$7.48M' (Font "Segoe UI" 34 ([System.Drawing.FontStyle]::Bold)) (C "#071827") ($rightX + 24) 336 160 48
Text $g "+18.6%" (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) (C "#0098ea") ($rightX + 184) 352 80 24
MiniChart $g ($rightX + 24) 408 366 150

FillRound $g $rightX 624 418 186 20 (CA 248 "#ffffff")
StrokeRound $g $rightX 624 418 186 20 (CA 150 "#b8ddff") 1
Text $g "Launch composer" (Font "Segoe UI" 20 ([System.Drawing.FontStyle]::Bold)) (C "#071827") ($rightX + 24) 646 200 28
Text $g "Start with image, ticker, supply, and curve." (Font "Segoe UI" 13) (C "#6d8aa0") ($rightX + 24) 676 310 20
FillRound $g ($rightX + 24) 716 170 44 15 (C "#0098ea")
Text $g "Create token" (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) (C "#ffffff") ($rightX + 24) 728 170 22 "Center"
FillRound $g ($rightX + 206) 716 162 44 15 (C "#e8f5ff")
Text $g "Import draft" (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) (C "#0098ea") ($rightX + 206) 728 162 22 "Center"

FillRound $g $rightX 834 418 186 20 (CA 248 "#ffffff")
StrokeRound $g $rightX 834 418 186 20 (CA 150 "#b8ddff") 1
Text $g "Top callouts" (Font "Segoe UI" 20 ([System.Drawing.FontStyle]::Bold)) (C "#071827") ($rightX + 24) 856 170 28
$calls = @(
  @("tonclinics", 'called AQUA at $4.03M', "+10%"),
  @("bluealpha", 'called NANO at $1.27M', "4.2x"),
  @("solraindays", 'called WAVE at $2.17M', "0.0%")
)
$cy = 902
foreach ($call in $calls) {
  Circle $g ($rightX + 24) $cy 36 (C "#d9efff")
  Text $g $call[0].Substring(0,2).ToUpper() (Font "Segoe UI" 10 ([System.Drawing.FontStyle]::Bold)) (C "#0098ea") ($rightX + 24) ($cy + 10) 36 14 "Center"
  Text $g $call[0] (Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Bold)) (C "#071827") ($rightX + 72) ($cy - 2) 140 22
  Text $g $call[1] (Font "Segoe UI" 12) (C "#6d8aa0") ($rightX + 72) ($cy + 19) 180 18
  FillRound $g ($rightX + 318) ($cy + 4) 58 26 12 (C "#e8f5ff")
  Text $g $call[2] (Font "Segoe UI" 12 ([System.Drawing.FontStyle]::Bold)) (C "#0098ea") ($rightX + 318) ($cy + 9) 58 16 "Center"
  $cy += 50
}

$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output $outPath
