param([switch]$Female, [string]$VoiceName)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $text = [Console]::In.ReadToEnd()
  if ($text) {
    $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
      if ($VoiceName) {
        $speaker.SelectVoice($VoiceName)
      } elseif ($Female) {
        $speaker.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female)
        $speaker.Rate = -1
      }
      $speaker.Speak($text.Substring(0, [Math]::Min(450, $text.Length)))
    }
    finally { $speaker.Dispose() }
  }
} catch { exit 1 }
