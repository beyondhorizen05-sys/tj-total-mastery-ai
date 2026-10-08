$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if ($installed.Count -eq 0) { throw 'No Windows speech recognition language is installed.' }
  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($installed[0])
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $recognizer.SetInputToDefaultAudioDevice()
  [Console]::Out.WriteLine((@{ ready = $true; culture = $installed[0].Culture.Name } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  while ($true) {
    $heard = $recognizer.Recognize([TimeSpan]::FromSeconds(4))
    if ($null -ne $heard -and $heard.Text) {
      [Console]::Out.WriteLine((@{ text = $heard.Text; confidence = $heard.Confidence } | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
    }
  }
} catch {
  [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
  exit 1
} finally {
  if ($null -ne $recognizer) { $recognizer.Dispose() }
}
