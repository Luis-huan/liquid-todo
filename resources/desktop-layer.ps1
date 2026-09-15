# Pins the widget to the Windows desktop so it behaves like a wallpaper widget: visible when the
# desktop is shown, covered by every normal window, absent from Alt+Tab, never raised on its own.
#
# The window is NOT reparented. Reparenting (SetParent) makes Chromium stop presenting the
# window on Windows 11 24H2+, so the desktop window is assigned as the widget's OWNER instead,
# which keeps the widget a normal top-level window that renders fine.
#
# Two ways to run it:
#   -Serve                long lived host: one JSON request per line on stdin, one JSON reply per
#                         line on stdout. The app uses this so re-checking the desktop ownership
#                         costs a pipe write instead of a fresh PowerShell start.
#   -Hwnd <n> -Mode <m>   single attach, for manual use.
[CmdletBinding()]
param(
  [string]$Hwnd = '',
  [ValidateSet('workerw', 'bottom')][string]$Mode = 'workerw',
  [switch]$Serve
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Namespace LiquidTodo -Name Native -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr hWndParent, IntPtr hWndChildAfter, string lpszClass, string lpszWindow);
[DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
[DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder name, int max);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lparam);
[DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)] public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);
[DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)] public static extern int GetWindowLong32(IntPtr hWnd, int nIndex);
[DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] public static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
[DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)] public static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);
public delegate bool EnumProc(IntPtr hWnd, IntPtr lparam);
'@

$GWL_EXSTYLE = -20
$GWLP_HWNDPARENT = -8
$WS_EX_TOOLWINDOW = 0x00000080
$WS_EX_TOPMOST = 0x00000008
$SWP_NOSIZE = 0x0001
$SWP_NOMOVE = 0x0002
$SWP_NOACTIVATE = 0x0010
$SWP_FRAMECHANGED = 0x0020
$SWP_NOOWNERZORDER = 0x0200
$HWND_TOP = [IntPtr]::Zero
$HWND_NOTOPMOST = [IntPtr](-2)

function Get-Class([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return '' }
  $sb = [System.Text.StringBuilder]::new(256)
  [void][LiquidTodo.Native]::GetClassName($handle, $sb, 256)
  return $sb.ToString()
}

function Get-Progman {
  $script:progman = [IntPtr]::Zero
  $callback = [LiquidTodo.Native+EnumProc] {
    param([IntPtr]$handle, [IntPtr]$lparam)
    if ((Get-Class $handle) -eq 'Progman') {
      $script:progman = $handle
      return $false
    }
    return $true
  }
  [void][LiquidTodo.Native]::EnumWindows($callback, [IntPtr]::Zero)
  return $script:progman
}

function Get-ExStyle([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return [long]0 }
  if ([IntPtr]::Size -eq 8) {
    return [LiquidTodo.Native]::GetWindowLongPtr64($handle, $GWL_EXSTYLE).ToInt64()
  }
  return [long][LiquidTodo.Native]::GetWindowLong32($handle, $GWL_EXSTYLE)
}

function Set-ToolWindowStyle([IntPtr]$handle, [bool]$enabled) {
  $style = Get-ExStyle $handle
  if ($enabled) { $style = $style -bor $WS_EX_TOOLWINDOW } else { $style = $style -band (-bnot $WS_EX_TOOLWINDOW) }
  if ([IntPtr]::Size -eq 8) {
    [void][LiquidTodo.Native]::SetWindowLongPtr64($handle, $GWL_EXSTYLE, [IntPtr]$style)
  } else {
    [void][LiquidTodo.Native]::SetWindowLong32($handle, $GWL_EXSTYLE, [int]$style)
  }
}

function Get-Owner([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
  if ([IntPtr]::Size -eq 8) { return [LiquidTodo.Native]::GetWindowLongPtr64($handle, $GWLP_HWNDPARENT) }
  return [IntPtr]([LiquidTodo.Native]::GetWindowLong32($handle, $GWLP_HWNDPARENT))
}

function Set-Owner([IntPtr]$handle, [IntPtr]$owner) {
  if ([IntPtr]::Size -eq 8) {
    [void][LiquidTodo.Native]::SetWindowLongPtr64($handle, $GWLP_HWNDPARENT, $owner)
  } else {
    [void][LiquidTodo.Native]::SetWindowLong32($handle, $GWLP_HWNDPARENT, [int]$owner)
  }
}

function Find-DesktopHost {
  $progman = Get-Progman
  if ($progman -eq [IntPtr]::Zero) { return $null }

  # Ask the shell to spin up the wallpaper WorkerW (a no-op on newer builds).
  $ignored = [IntPtr]::Zero
  [void][LiquidTodo.Native]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$ignored)

  # Windows 11 24H2+: the wallpaper worker lives inside Progman.
  $workerUnderProgman = [LiquidTodo.Native]::FindWindowEx($progman, [IntPtr]::Zero, 'WorkerW', $null)
  if ($workerUnderProgman -ne [IntPtr]::Zero) {
    return @{ target = $workerUnderProgman; name = 'WorkerW(progman)' }
  }

  # Older layout: a top level WorkerW hosts the icon view and the wallpaper worker follows it.
  $worker = [IntPtr]::Zero
  while ($true) {
    $worker = [LiquidTodo.Native]::FindWindowEx([IntPtr]::Zero, $worker, 'WorkerW', $null)
    if ($worker -eq [IntPtr]::Zero) { break }
    $defView = [LiquidTodo.Native]::FindWindowEx($worker, [IntPtr]::Zero, 'SHELLDLL_DefView', $null)
    if ($defView -ne [IntPtr]::Zero) {
      $sibling = [LiquidTodo.Native]::FindWindowEx([IntPtr]::Zero, $worker, 'WorkerW', $null)
      if ($sibling -ne [IntPtr]::Zero) { return @{ target = $sibling; name = 'WorkerW(sibling)' } }
    }
  }

  return @{ target = $progman; name = 'Progman' }
}

function Test-DesktopOwner([IntPtr]$handle) {
  $owner = Get-Owner $handle
  if ($owner -eq [IntPtr]::Zero) { return $false }
  $class = Get-Class $owner
  return ($class -eq 'WorkerW' -or $class -eq 'Progman' -or $class -eq 'Worker')
}

function Invoke-Attach([IntPtr]$handle, [string]$mode) {
  if ($handle -eq [IntPtr]::Zero) {
    return @{ ok = $false; mode = $mode; parent = 'none'; pinned = $false; error = 'window handle unavailable' }
  }

  if ($mode -eq 'bottom') {
    # A plain floating window: no owner and not topmost, so a click raises it like any other app
    # and Show Desktop hides it.
    Set-Owner $handle ([IntPtr]::Zero)
    Set-ToolWindowStyle $handle $true
    [void][LiquidTodo.Native]::SetWindowPos($handle, $HWND_NOTOPMOST, 0, 0, 0, 0,
      ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOACTIVATE -bor $SWP_NOOWNERZORDER))
    return @{ ok = $true; mode = 'bottom'; parent = 'desktop-independent'; pinned = $false; error = '' }
  }

  # A sticky topmost flag would survive the re-own below, and the desktop layer must never be
  # topmost. It is cleared while the window still has no owner, so this cannot lift the widget
  # above normal windows.
  if (((Get-ExStyle $handle) -band $WS_EX_TOPMOST) -ne 0) {
    Set-Owner $handle ([IntPtr]::Zero)
    [void][LiquidTodo.Native]::SetWindowPos($handle, $HWND_NOTOPMOST, 0, 0, 0, 0,
      ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOACTIVATE -bor $SWP_NOOWNERZORDER))
  }

  $hostInfo = Find-DesktopHost
  if ($null -eq $hostInfo -or $hostInfo.target -eq [IntPtr]::Zero) {
    return @{ ok = $false; mode = 'workerw'; parent = 'none'; pinned = $false; error = 'desktop window not found' }
  }

  Set-ToolWindowStyle $handle $true
  Set-Owner $handle $hostInfo.target
  if (-not (Test-DesktopOwner $handle)) {
    return @{ ok = $false; mode = 'workerw'; parent = $hostInfo.name; pinned = $false; error = 'desktop ownership was rejected' }
  }

  # Live wallpapers draw in their own desktop windows, so the widget is lifted above them. The
  # lift only happens once the desktop really owns the window: HWND_TOP is then scoped to the
  # owner's group and stays under every normal window. Without the check above this call would
  # put the widget in front of the user's work, which is exactly what it must never do.
  [void][LiquidTodo.Native]::SetWindowPos($handle, $HWND_TOP, 0, 0, 0, 0,
    ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED))

  @{ ok = $true; mode = 'workerw'; parent = $hostInfo.name; pinned = $true; error = '' }
}

function Invoke-Status([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) {
    return @{ ok = $false; pinned = $false; ownerClass = ''; topmost = $false; toolWindow = $false; error = 'window handle unavailable' }
  }
  $owner = Get-Owner $handle
  $exStyle = Get-ExStyle $handle
  return @{
    ok = $true
    pinned = (Test-DesktopOwner $handle)
    ownerClass = (Get-Class $owner)
    topmost = (($exStyle -band $WS_EX_TOPMOST) -ne 0)
    toolWindow = (($exStyle -band $WS_EX_TOOLWINDOW) -ne 0)
    error = ''
  }
}

function Invoke-Detach([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return @{ ok = $false; error = 'window handle unavailable' } }
  Set-Owner $handle ([IntPtr]::Zero)
  return @{ ok = $true; error = '' }
}

function ConvertTo-Handle([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return [IntPtr]::Zero }
  try { return [IntPtr][long]$value } catch { return [IntPtr]::Zero }
}

if ($Serve) {
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if (-not $line) { continue }

    $request = $null
    $reply = $null
    $stop = $false
    try {
      $request = $line | ConvertFrom-Json
      $target = ConvertTo-Handle ([string]$request.hwnd)
      switch ([string]$request.cmd) {
        'attach' { $reply = Invoke-Attach $target ([string]$request.mode) }
        'status' { $reply = Invoke-Status $target }
        'detach' { $reply = Invoke-Detach $target }
        'ping'   { $reply = @{ ok = $true; error = '' } }
        'exit'   { $reply = @{ ok = $true; error = '' }; $stop = $true }
        default  { $reply = @{ ok = $false; error = "unknown command: $($request.cmd)" } }
      }
    } catch {
      $reply = @{ ok = $false; error = $_.Exception.Message }
    }

    if ($null -ne $request -and $null -ne $request.id) { $reply['id'] = $request.id }
    [Console]::Out.WriteLine(($reply | ConvertTo-Json -Compress -Depth 5))
    [Console]::Out.Flush()
    if ($stop) { break }
  }
  exit 0
}

$single = ConvertTo-Handle $Hwnd
(Invoke-Attach $single $Mode) | ConvertTo-Json -Compress -Depth 5
