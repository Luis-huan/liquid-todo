# Pins the widget to the Windows desktop so it behaves like a wallpaper widget:
# visible when the desktop is shown, covered by normal windows, absent from Alt+Tab.
#
# The window is NOT reparented. Reparenting (SetParent) makes Chromium stop presenting the
# window on Windows 11 24H2+, so instead the desktop window is assigned as the widget's
# OWNER, which keeps the widget a normal top-level window that renders fine.
param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [ValidateSet('workerw', 'bottom')][string]$Mode = 'workerw'
)

$ErrorActionPreference = 'Stop'

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
$SWP_NOSIZE = 0x0001
$SWP_NOMOVE = 0x0002
$SWP_NOACTIVATE = 0x0010
$SWP_FRAMECHANGED = 0x0020
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

function Set-ToolWindowStyle([IntPtr]$handle, [bool]$enabled) {
  if ([IntPtr]::Size -eq 8) {
    $style = [LiquidTodo.Native]::GetWindowLongPtr64($handle, $GWL_EXSTYLE).ToInt64()
    if ($enabled) { $style = $style -bor $WS_EX_TOOLWINDOW } else { $style = $style -band (-bnot $WS_EX_TOOLWINDOW) }
    [void][LiquidTodo.Native]::SetWindowLongPtr64($handle, $GWL_EXSTYLE, [IntPtr]$style)
  } else {
    $style = [LiquidTodo.Native]::GetWindowLong32($handle, $GWL_EXSTYLE)
    if ($enabled) { $style = $style -bor $WS_EX_TOOLWINDOW } else { $style = $style -band (-bnot $WS_EX_TOOLWINDOW) }
    [void][LiquidTodo.Native]::SetWindowLong32($handle, $GWL_EXSTYLE, [int]$style)
  }
}

function Get-Owner([IntPtr]$handle) {
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

  # Older layout: a top-level WorkerW hosts the icon view and the wallpaper worker follows it.
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

$target = [IntPtr]$Hwnd

try {
  if ($Mode -eq 'workerw') {
    $hostInfo = Find-DesktopHost
    if ($null -eq $hostInfo -or $hostInfo.target -eq [IntPtr]::Zero) {
      @{ ok = $false; mode = 'workerw'; parent = 'none'; error = 'desktop window not found' } | ConvertTo-Json -Compress
      exit 0
    }

    Set-ToolWindowStyle $target $true
    Set-Owner $target $hostInfo.target
    if ((Get-Owner $target) -ne $hostInfo.target) {
      @{ ok = $false; mode = 'workerw'; parent = $hostInfo.name; error = 'desktop ownership was rejected' } | ConvertTo-Json -Compress
      exit 0
    }

    # Live wallpapers draw in their own desktop windows, so the widget has to be lifted above
    # them; it stays below every normal window because it is never topmost.
    [void][LiquidTodo.Native]::SetWindowPos($target, $HWND_TOP, 0, 0, 0, 0,
      ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED))

    @{ ok = $true; mode = 'workerw'; parent = $hostInfo.name; error = '' } | ConvertTo-Json -Compress
    exit 0
  }

  Set-Owner $target ([IntPtr]::Zero)
  Set-ToolWindowStyle $target $true
  [void][LiquidTodo.Native]::SetWindowPos($target, $HWND_NOTOPMOST, 0, 0, 0, 0,
    ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED))

  @{ ok = $true; mode = 'bottom'; parent = 'desktop-independent'; error = '' } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; mode = $Mode; parent = 'unknown'; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
