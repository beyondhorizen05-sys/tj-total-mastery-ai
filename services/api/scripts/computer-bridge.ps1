$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TJWinInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle, System.Text.StringBuilder text, int count);
  public const uint LEFTDOWN=0x0002, LEFTUP=0x0004, RIGHTDOWN=0x0008, RIGHTUP=0x0010, WHEEL=0x0800;
}
'@
[void][TJWinInput]::SetProcessDPIAware()

function ForegroundTitle {
  $buffer = New-Object System.Text.StringBuilder 512
  [void][TJWinInput]::GetWindowText([TJWinInput]::GetForegroundWindow(), $buffer, 512)
  return $buffer.ToString()
}

function ObserveElement($element, [int]$depth, [int]$maxDepth, $lines) {
  if ($lines.Count -ge 160 -or $depth -gt $maxDepth) { return }
  try {
    $current = $element.Current
    $name = [string]$current.Name
    $kind = [string]$current.ControlType.ProgrammaticName
    $bounds = $current.BoundingRectangle
    if ($name.Length -gt 120) { $name = $name.Substring(0, 120) }
    $visibleValue = ''
    if ($current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and -not $current.IsPassword) {
      $pattern = $null
      if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        $visibleValue = [string]$pattern.Current.Value
        if ($visibleValue.Length -gt 160) { $visibleValue = $visibleValue.Substring(0, 160) }
      }
    }
    if ($name -or $depth -eq 0) {
      [void]$lines.Add(('{0}{1}: {2}{7} [{3},{4},{5},{6}]' -f ('  ' * $depth), $kind, $name, [int]$bounds.X, [int]$bounds.Y, [int]$bounds.Width, [int]$bounds.Height, $(if ($visibleValue) { " value=$visibleValue" } else { '' })))
    }
    if ($depth -eq $maxDepth) { return }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($element)
    if ($null -eq $child) {
      $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
      $child = $walker.GetFirstChild($element)
    }
    while ($null -ne $child -and $lines.Count -lt 160) {
      ObserveElement $child ($depth + 1) $maxDepth $lines
      $child = $walker.GetNextSibling($child)
    }
  } catch { if (-not $script:observationError) { $script:observationError = $_.Exception.Message } }
}

try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $action = [string]$request.action
  $result = @{ ok = $true; action = $action; foreground = (ForegroundTitle) }
  switch ($action) {
    'status' {
      $result.desktop = [System.Windows.Forms.SystemInformation]::VirtualScreen.ToString()
      $result.speech_recognition = [bool](Get-Command -Name 'Add-Type' -ErrorAction SilentlyContinue)
    }
    'observe' {
      $lines = New-Object 'System.Collections.ArrayList'
      $root = [System.Windows.Automation.AutomationElement]::FromHandle([TJWinInput]::GetForegroundWindow())
      if ($null -eq $root) { $root = [System.Windows.Automation.AutomationElement]::RootElement }
      ObserveElement $root 0 6 $lines
      $result.elements = @($lines)
      if ($script:observationError) { $result.observation_error = $script:observationError }
      $result.cursor = [System.Windows.Forms.Cursor]::Position.ToString()
    }
    'click' {
      $x = [int]$request.x; $y = [int]$request.y
      $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
      if ($x -lt $screen.Left -or $x -ge $screen.Right -or $y -lt $screen.Top -or $y -ge $screen.Bottom) { throw 'Click coordinates are outside the desktop.' }
      [void][TJWinInput]::SetCursorPos($x, $y)
      Start-Sleep -Milliseconds 80
      if ($request.button -eq 'right') { [TJWinInput]::mouse_event([TJWinInput]::RIGHTDOWN,0,0,0,[UIntPtr]::Zero); [TJWinInput]::mouse_event([TJWinInput]::RIGHTUP,0,0,0,[UIntPtr]::Zero) }
      else { [TJWinInput]::mouse_event([TJWinInput]::LEFTDOWN,0,0,0,[UIntPtr]::Zero); [TJWinInput]::mouse_event([TJWinInput]::LEFTUP,0,0,0,[UIntPtr]::Zero) }
      $result.position = "$x,$y"
    }
    'type' {
      $value = [string]$request.text
      if ($value.Length -gt 4000) { throw 'Text exceeds 4000 characters.' }
      if ($null -ne $request.expected_handle -and [long]$request.expected_handle -ne ([TJWinInput]::GetForegroundWindow()).ToInt64()) { throw 'Focused window changed before typing.' }
      [System.Windows.Forms.SendKeys]::SendWait($value.Replace('{','{{}').Replace('}','{}}').Replace('+','{+}').Replace('^','{^}').Replace('%','{%}').Replace('~','{~}').Replace('(','{(}').Replace(')','{)}'))
      $result.characters = $value.Length
    }
    'key' {
      $allowed = @{ enter='{ENTER}'; tab='{TAB}'; escape='{ESC}'; backspace='{BACKSPACE}'; delete='{DELETE}'; up='{UP}'; down='{DOWN}'; left='{LEFT}'; right='{RIGHT}'; home='{HOME}'; end='{END}'; pageup='{PGUP}'; pagedown='{PGDN}'; space=' '; ctrl_c='^c'; ctrl_v='^v'; ctrl_a='^a'; ctrl_s='^s'; alt_tab='%{TAB}'; alt_left='%{LEFT}' }
      $key = [string]$request.key
      if (-not $allowed.ContainsKey($key)) { throw 'Unsupported key.' }
      [System.Windows.Forms.SendKeys]::SendWait($allowed[$key])
      $result.key = $key
    }
    'scroll' {
      $ticks = [int]$request.ticks
      if ($ticks -lt -10 -or $ticks -gt 10 -or $ticks -eq 0) { throw 'Scroll ticks must be between -10 and 10, excluding zero.' }
      [TJWinInput]::mouse_event([TJWinInput]::WHEEL,0,0,[uint32]($ticks * 120),[UIntPtr]::Zero)
      $result.ticks = $ticks
    }
    'screenshot' {
      $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try { $graphics.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $bitmap.Size) ; $bitmap.Save([string]$request.path, [System.Drawing.Imaging.ImageFormat]::Png) }
      finally { $graphics.Dispose(); $bitmap.Dispose() }
      $result.path = [string]$request.path
      $result.size = "$($screen.Width)x$($screen.Height)"
    }
    'launch' {
      $allowed = @{ notepad='notepad.exe'; calculator='calc.exe'; files='explorer.exe'; browser='msedge.exe'; settings='ms-settings:' }
      $app = [string]$request.application
      if (-not $allowed.ContainsKey($app)) { throw 'Unsupported application.' }
      Start-Process -FilePath $allowed[$app] -WindowStyle Normal
      $result.application = $app
    }
    default { throw 'Unsupported computer action.' }
  }
  $result.foreground = ForegroundTitle
  $result.foreground_handle = ([TJWinInput]::GetForegroundWindow()).ToInt64()
  [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 5 -Compress))
} catch {
  [Console]::Out.WriteLine((@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  exit 1
}
