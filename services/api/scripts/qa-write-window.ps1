Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = 'TJ Computer Write QA'
$form.Width = 560
$form.Height = 180
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.FormBorderStyle = 'FixedDialog'

$label = New-Object System.Windows.Forms.Label
$label.Text = 'Disposable TJ typing test. This window closes automatically.'
$label.Left = 16
$label.Top = 16
$label.Width = 500
$form.Controls.Add($label)

$inputBox = New-Object System.Windows.Forms.TextBox
$inputBox.Name = 'TJQAInput'
$inputBox.Left = 16
$inputBox.Top = 52
$inputBox.Width = 510
$form.Controls.Add($inputBox)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 120000
$timer.Add_Tick({ $timer.Stop(); $form.Close() })
$form.Add_Shown({ $inputBox.Focus(); $form.Activate(); $timer.Start() })
[void]$form.ShowDialog()
$timer.Dispose()
$form.Dispose()
