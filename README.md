# 🎵 OmniAudio - Ultimate Audio Downloader & Studio Recorder

**OmniAudio** is a Chrome Extension (Manifest V3) designed to detect, capture, and download **any client-side audio** playing in your browser in the **highest possible quality**.

Whether audio comes from direct file URLs, dynamic HTML5 audio players, `<audio>`/`<video>` elements, Web Audio API, Blob URLs, or complex streaming pipelines, OmniAudio captures it with 0% generational loss.

---

## 🌟 Key Capabilities

### 1. Dual Capture Architecture
* **Mode 1 — Network & DOM Stream Sniffer**:
  * Automatically intercepts audio response headers (`audio/mpeg`, `audio/mp4`, `audio/ogg`, `audio/webm`, `audio/wav`, `audio/flac`, `audio/aac`, etc.) and audio extensions (`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus`, etc.).
  * Discovers dynamically injected HTML5 `<audio>` and `<video>` tags, Blobs (`URL.createObjectURL`), and media sessions.
  * Direct bit-for-bit download without re-encoding (original remote source quality).
* **Mode 2 — Studio Live Tab Capture (For any audio received on the client)**:
  * For Web Audio synthesizers, procedural audio, encrypted client playback, or chunked streams where direct URLs are hidden or fragmented.
  * Captures directly from Chrome's internal audio mixer using Manifest V3 Offscreen API.
  * **Lossless WAV (PCM 48,000 Hz / 16-bit Stereo)**: True uncompressed studio-master fidelity.
  * **High-Bitrate Opus (320 kbps WebM)**: Audiophile-grade compressed audio with small file size.
  * **Simultaneous Speaker Passthrough**: Audio continues playing smoothly through your speakers with no muting or latency.

### 2. "Highest Quality" Automatic Detection
* Analyzes all streams detected on the page.
* Ranks audio streams by codec fidelity (FLAC/WAV > Opus > AAC/M4A > MP3 > OGG) and file size/bitrate.
* Badges the best stream with **⭐ Highest Quality**.
* Header includes a 1-click **"Best Quality"** quick-download button.

### 3. Integrated Audio Preview Player
* Mini audio player built directly into the popup.
* Tap **Preview** to listen to any track before downloading.
* Interactive time scrubber, play/pause controls, and time display.

### 4. Smart Filtering & Batch Tools
* **Search filter**: Instantly search detected tracks by name or extension.
* **Format filter chips**: Filter by `All`, `MP3`, `WAV`, `FLAC`, `M4A`, `WEBM`.
* **Sound effect filter (`>100KB`)**: Automatically hides tiny UI button clicks and notification chimes (can be unchecked anytime).
* **Batch Download All**: 1-click download of all detected tracks.
* **Copy Link**: 1-click copy direct audio URL to clipboard.

---

## 🚀 How to Install in Chrome

1. Open Google Chrome (or any Chromium browser: Brave, Microsoft Edge, Opera, Vivaldi).
2. In the URL bar, go to:
   ```
   chrome://extensions
   ```
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select this folder:
   ```
   e:\Sudhanshu\Projects\Audio-downloader
   ```
6. The extension **OmniAudio** will now appear in your extensions list and toolbar! Pin it to your toolbar for quick access.

---

## 🎧 How to Use

### Downloading Detected Audio Streams:
1. Navigate to any webpage with audio (music sites, podcasts, video platforms, radio, etc.).
2. Play the audio on the webpage.
3. Click the **OmniAudio** icon in your browser toolbar.
4. The popup displays all detected audio files:
   - The best file is highlighted with a gold **⭐ Highest Quality** badge.
   - Click **Preview** to listen right in the popup.
   - Click **Download** to save it to your Chrome Downloads folder with a clean, sanitized filename.
   - Click **Best Quality** in the header to immediately download the master track.

### Using the Live Tab Recorder:
1. In the OmniAudio popup, switch to the **Live Recorder** tab.
2. Select your preferred capture quality:
   - **Lossless WAV (PCM)**: 48 kHz / 16-bit uncompressed studio sound.
   - **High-Bitrate Opus (320k)**: 320 kbps Opus WebM.
3. Click **Start Recording Tab Audio**.
4. Play the audio on the tab — watch the real-time animated VU bars dance to the music!
5. Click **Stop & Save Audio** when done. The recording is instantly exported and saved to your Downloads folder.

---

## 📁 File Structure

```
Audio-downloader/
├── manifest.json        # Chrome Extension Manifest V3 configuration
├── background.js       # Background service worker (network sniffer, badge, download manager)
├── content.js          # In-page DOM inspector & MutationObserver
├── injected.js         # Main-world script interceptor (Blob & MediaSession)
├── offscreen.html      # Offscreen document host for tab audio capture
├── offscreen.js        # Tab audio capture engine, speaker passthrough & VU meter
├── wav-encoder.js      # Pure JS lossless 16-bit PCM WAV encoder
├── popup.html          # Extension popup interface
├── popup.css           # Modern dark-theme glassmorphism styling
├── popup.js            # Popup controller & UI interactions
├── generate-icons.js   # Script that generated the extension icons
└── icons/              # Extension icons (16px, 32px, 48px, 128px)
```
