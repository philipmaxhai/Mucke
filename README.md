# Mucke – House DAW im Browser

Eine schlanke Audio-Workstation als Web-App (React + Tailwind), gebaut für House & Elektro:
Tab-Audio mitschneiden, im BPM-Grid schneiden und loopen, mit DJ-Effekten bearbeiten und als WAV exportieren.

## Starten

Online (ohne Installation): https://philipmaxhai.github.io/Mucke/ – wird bei jedem Push per GitHub Actions neu gebaut.

Lokal:

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # statischer Build in dist/
```

## Features

- **Tab-/System-Audio aufnehmen** über `getDisplayMedia` – verlustfrei (PCM per AudioWorklet, kein Opus/MP3 dazwischen).
  Alternativ Mikrofon/Line-In oder Audiodateien importieren (Button oder Drag & Drop in die Timeline).
- **Timeline mit BPM-Grid**: Takte, Beats, 4-Takt-Phrasen hervorgehoben, Snapping von 1 Takt bis 1/16 (Shift = frei).
- **Schneiden & Loopen**: Clips verschieben (auch zwischen Spuren), Kanten trimmen, Doppelklick schneidet,
  Alt-Ziehen kopiert, Strg+D dupliziert direkt dahinter. Loop-Bereich im Lineal ziehen – Wiedergabe ist gapless.
- **DJ-Effekte pro Spur**: Highpass, Lowpass, 3-Band-EQ mit Kill (−30 dB), tempo-synchrones Delay (1/16 bis 1/2) mit Feedback,
  Volume, Pan, Mute/Solo. Master mit Volume und Limiter.
- **Varispeed**: Original-BPM eines Samples eintragen → Clip läuft im Projekttempo (wie am Plattenspieler, Tonhöhe ändert sich mit).
- **Tap-Tempo**, Metronom, Undo/Redo.
- **Export**: ganzer Track oder exakt der Loop-Bereich als 16-Bit-WAV (44,1 kHz), gerendert durch dieselbe FX-Kette.

## FL-Studio-Workflow

- **PAT / SONG** oben in der Leiste: PAT spielt nur das aktuelle Pattern in Schleife, SONG spielt die Playlist (die Timeline).
- **Channel Rack (F6)**: Step-Sequencer mit eingebauten Drums (Kick, Clap, Snare, Hats, Perc), Synths (Bass, Lead, Pluck, Pad, House-Orgel)
  und Sampler (Audiodatei oder ein Clip aus der Timeline). Pro Kanal Volume, Pan, Tonhöhe, Mute/Solo und Ziel-Insert im Mixer.
  Patterns mit 1–8 Takten, Swing, Klonen. „In Playlist“ legt das Pattern an die Playhead-Position.
- **Piano Roll (F7)**: Noten pro Kanal und Pattern setzen, verschieben, Länge ziehen, Rechtsklick löscht.
- **Mixer (F9)**: Insert-Kanäle mit Fader, Pan, Pegelanzeige, Mute/Solo und Effekt-Slots (Filter, EQ, Delay), plus Master mit Limiter.
- **Clip & FX (F8)**: die bisherige Effekt- und Clip-Ansicht.

## Windows-App: Spotify & andere Programme einzeln aufnehmen

Im Browser geht nur Tab-Audio. Die Windows-App (`desktop/`, Electron) nimmt den Ton einzelner Programme auf, z. B. nur Spotify,
und jedes Programm landet auf einer eigenen Spur. Alternativ „Ganzer Desktop (ohne Mucke)“. Apps lassen sich im Dialog außerdem
im Windows-Lautstärkemixer stummschalten.

- Technik: WASAPI-Prozess-Loopback (dieselbe Windows-Schnittstelle wie „Anwendungsaudioaufnahme“ in OBS), ab Windows 10 Version 2004.
  Aufgenommen wird nur, was die App ohnehin an die Lautsprecher schickt; es wird kein Kopierschutz umgangen.
- **Download**: GitHub → Actions → „Windows desktop app“ → letzter Lauf → Artifact „Mucke-Windows“ (portable `.exe` und `.zip`).
  Die App ist nicht signiert, Windows SmartScreen fragt deshalb beim ersten Start nach („Weitere Informationen“ → „Trotzdem ausführen“).
- Selbst bauen (Windows, Node 22, Visual Studio Build Tools):
  ```bash
  npm ci && npm run build
  cd desktop/native && cl /O2 /EHsc /std:c++17 /MT mucke-loopback.cpp ole32.lib mmdevapi.lib uuid.lib psapi.lib /Fe:mucke-loopback.exe
  cd .. && npm install && npm run dist      # Ergebnis in desktop/dist/
  ```
- Rechtliches: Spotify verbietet Mitschnitte in den Nutzungsbedingungen. Nur für den rein privaten Gebrauch.

## Tab-Audio aufnehmen – Browser-Hinweise

- Funktioniert in **Chrome, Edge, Brave, Opera** (Chromium). Firefox und Safari liefern bei Bildschirmfreigabe kein Audio.
- Im Freigabe-Dialog den **Tab** wählen, in dem die Musik läuft, und **„Tab-Audio teilen“** anhaken.
- Ganzer Bildschirm mit **Systemaudio** geht unter Windows und ChromeOS. Unter macOS je nach Chrome-/macOS-Version
  meist nur Tab-Audio – für Systemsound dort ein Loopback-Tool (z. B. BlackHole) als Mikrofon nutzen.
- Die Aufnahme endet mit „Stopp“ oder wenn du in der Browserleiste „Freigabe beenden“ klickst.
- **Spotify, Apple Music, Netflix & Co. sind kopiergeschützt (DRM):** Chrome gibt deren Ton beim Teilen nur als Stille weiter. Mucke erkennt stumme Aufnahmen und sagt Bescheid. YouTube, SoundCloud, Bandcamp-Previews oder eigene Dateien funktionieren.
- Nimm nur Material auf, an dem du die Rechte hast bzw. das du privat nutzen darfst.

## Tastatur

| Taste | Aktion |
| --- | --- |
| Leertaste | Play / Pause |
| S | Clip am Playhead schneiden |
| Strg+D | Clip dahinter duplizieren |
| Entf / Backspace | Clip löschen |
| L | Loop an/aus |
| P | Loop auf ausgewählten Clip setzen |
| M | Metronom |
| Pos1 / Enter | Zum Anfang / zum Loop-Start |
| + / − , Strg+Mausrad | Zoom |
| Strg+Z / Strg+Shift+Z | Undo / Redo |

## Aufbau

- `src/audio/engine.js` – AudioContext, Transport, sample-genaues Scheduling, gapless Loops, Metronom
- `src/audio/fx.js` – FX-Kette pro Spur und Master (identisch für Live und Export)
- `src/audio/recorder.js` – Tab-/Mic-Aufnahme per AudioWorklet
- `src/audio/export.js`, `wav.js` – Offline-Rendering und WAV-Encoder
- `src/components/Timeline.jsx` – Canvas-Timeline mit Grid, Waveforms, Drag/Trim/Split
- `src/state/project.js` – Projektzustand, Undo-Historie, Grid-Helfer
