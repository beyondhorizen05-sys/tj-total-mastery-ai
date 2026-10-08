$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $voices = @($speaker.GetInstalledVoices() | ForEach-Object {
      [pscustomobject]@{
        name = $_.VoiceInfo.Name
        gender = $_.VoiceInfo.Gender.ToString()
        culture = $_.VoiceInfo.Culture.Name
      }
    })
    ConvertTo-Json -InputObject $voices -Compress -Depth 3
  } finally { $speaker.Dispose() }
} catch { exit 1 }
