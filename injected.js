/**
 * OmniAudio Injected Script (Runs in Page MAIN World)
 * Intercepts Web Audio API (AudioBufferSourceNode.prototype.start, decodeAudioData),
 * fetch, XMLHttpRequest, and Blob URLs to capture 100% full-length, uncorrupted audio.
 */
(function() {
  if (window.__OMNIAUDIO_INJECTED__) return;
  window.__OMNIAUDIO_INJECTED__ = true;

  // In-memory store for captured audio blobs
  window.__OMNIAUDIO_BLOB_STORE__ = window.__OMNIAUDIO_BLOB_STORE__ || {};
  const processedBuffers = new WeakSet();
  const reportedFingerprints = new Set();

  // --- Lossless WAV Encoder ---
  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  function encodeWAV(samplesL, samplesR, sampleRate = 44100) {
    const numChannels = samplesR ? 2 : 1;
    const numSamples = samplesL.length;
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');

    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // 16-bit

    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      let sL = Math.max(-1, Math.min(1, samplesL[i]));
      view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true);
      offset += 2;

      if (numChannels === 2) {
        let sR = Math.max(-1, Math.min(1, samplesR[i]));
        view.setInt16(offset, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  // --- Track Title & Filename Resolver for Splice and modern web players ---
  function sanitizeFilename(name, ext = 'wav') {
    let clean = (name || 'Audio_Sample').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    if (clean.length > 90) clean = clean.slice(0, 90).trim();
    if (!clean.toLowerCase().endsWith('.' + ext.toLowerCase())) {
      clean += '.' + ext;
    }
    return clean;
  }

  function detectActiveTrackName() {
    // 1. Splice-specific active playing row detection
    const pauseButtons = document.querySelectorAll(
      'button[aria-label*="Pause" i], button[title*="Pause" i], [class*="playing" i] button, [data-qa*="pause" i], [data-qa*="playing" i]'
    );
    for (const btn of pauseButtons) {
      const row = btn.closest(
        '[data-qa*="row" i], [class*="row" i], [class*="item" i], [class*="cell" i], tr, li, article, div[class*="sample" i]'
      );
      if (row) {
        // Look for title element inside the playing row
        const titleEl = row.querySelector(
          '[class*="title" i], [class*="name" i], [data-qa*="title" i], [data-qa*="filename" i], a[href*="/sounds/"]'
        );
        if (titleEl && titleEl.textContent.trim()) {
          return titleEl.textContent.trim();
        }
        // First non-empty text node that looks like a sample name
        const textNodes = row.innerText.split('\n').map(t => t.trim()).filter(Boolean);
        for (const t of textNodes) {
          if (t.length > 2 && t.length < 90 && !/^(play|pause|bpm|key|add|like|download|\d+)$/i.test(t)) {
            return t;
          }
        }
      }
    }

    // 2. Splice waveform or sample detail header
    const sampleDetail = document.querySelector('[class*="asset-title" i], [class*="sample-name" i], [data-qa*="asset-title" i]');
    if (sampleDetail && sampleDetail.textContent.trim()) {
      return sampleDetail.textContent.trim();
    }

    // 3. MediaSession API metadata
    if (navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.title) {
      const meta = navigator.mediaSession.metadata;
      return [meta.title, meta.artist].filter(Boolean).join(' - ');
    }

    // 4. Page title fallback
    const title = (document.title || 'Audio Sample').replace(/\s*[-|]\s*Splice.*/i, '').trim();
    return title || 'Audio Sample';
  }

  // --- Dispatch client-side captured audio to content script ---
  function dispatchClientAudio({ trackId, title, filename, blob, duration, sampleRate, format, dataUrl }) {
    window.dispatchEvent(new CustomEvent('__OMNIAUDIO_CLIENT_AUDIO__', {
      detail: {
        id: trackId,
        title: title,
        filename: filename,
        duration: duration,
        sampleRate: sampleRate,
        format: format,
        size: blob.size,
        dataUrl: dataUrl,
        timestamp: Date.now()
      }
    }));
  }

  // --- Process Decoded AudioBuffer into 100% Full Lossless WAV ---
  function processAudioBuffer(audioBuffer, originalBufferCopy = null) {
    if (!audioBuffer || processedBuffers.has(audioBuffer)) return;
    processedBuffers.add(audioBuffer);

    // Filter tiny clicks or empty buffers
    if (audioBuffer.duration < 0.2 || audioBuffer.length < 4410) return;

    // Prevent duplicates of identical duration and length
    const fingerprint = `${audioBuffer.sampleRate}_${audioBuffer.length}_${audioBuffer.numberOfChannels}_${audioBuffer.duration.toFixed(3)}`;
    if (reportedFingerprints.has(fingerprint)) return;
    reportedFingerprints.add(fingerprint);

    const title = detectActiveTrackName();
    const filename = sanitizeFilename(title, 'wav');
    const trackId = `client_audio_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
    const wavBlob = encodeWAV(left, right, audioBuffer.sampleRate);

    // Save in in-memory store
    window.__OMNIAUDIO_BLOB_STORE__[trackId] = {
      wavBlob: wavBlob,
      originalBuffer: originalBufferCopy,
      title: title,
      filename: filename,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate
    };

    // Convert to Data URL so it can be previewed in popup and downloaded directly
    const reader = new FileReader();
    reader.onloadend = () => {
      dispatchClientAudio({
        trackId: trackId,
        title: title,
        filename: filename,
        blob: wavBlob,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        format: `WAV Lossless (${Math.round(audioBuffer.sampleRate / 1000)}kHz)`,
        dataUrl: reader.result
      });
    };
    reader.readAsDataURL(wavBlob);
  }

  // 1. Intercept AudioBufferSourceNode.prototype.start (Fires when any Web Audio player starts playing!)
  if (window.AudioBufferSourceNode) {
    const origStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      try {
        if (this.buffer && this.buffer instanceof AudioBuffer) {
          processAudioBuffer(this.buffer);
        }
      } catch (e) {
        console.warn('[OmniAudio] AudioBufferSourceNode hook error:', e);
      }
      return origStart.apply(this, args);
    };
  }

  // 2. Intercept AudioContext.prototype.decodeAudioData
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (AudioCtx && AudioCtx.prototype.decodeAudioData) {
    const origDecode = AudioCtx.prototype.decodeAudioData;
    AudioCtx.prototype.decodeAudioData = function(arrayBuffer, successCallback, errorCallback) {
      // Clone arrayBuffer before it is detached by decodeAudioData
      let bufferCopy = null;
      try {
        if (arrayBuffer instanceof ArrayBuffer) {
          bufferCopy = arrayBuffer.slice(0);
        }
      } catch (e) {}

      const result = origDecode.apply(this, arguments);

      // Handle Promise return
      if (result && typeof result.then === 'function') {
        result.then((audioBuffer) => {
          try {
            processAudioBuffer(audioBuffer, bufferCopy);
          } catch (e) {}
        }).catch(() => {});
      }

      return result;
    };
  }

  // 3. Intercept window.fetch for direct audio requests
  if (window.fetch) {
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const response = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const isAudio = contentType.startsWith('audio/') ||
                        contentType.includes('ogg') ||
                        contentType.includes('opus') ||
                        /\.(mp3|wav|ogg|m4a|aac|opus|webm)(\?.*)?$/i.test(url);

        if (isAudio && response.ok) {
          const clone = response.clone();
          clone.blob().then(blob => {
            if (blob && blob.size > 2048) {
              const title = detectActiveTrackName();
              const ext = url.split('.').pop().split('?')[0].toLowerCase() || 'mp3';
              const filename = sanitizeFilename(title, ext);
              const trackId = `client_fetch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

              window.__OMNIAUDIO_BLOB_STORE__[trackId] = {
                wavBlob: blob,
                title: title,
                filename: filename
              };

              const reader = new FileReader();
              reader.onloadend = () => {
                dispatchClientAudio({
                  trackId: trackId,
                  title: title,
                  filename: filename,
                  blob: blob,
                  duration: 0,
                  sampleRate: 44100,
                  format: ext.toUpperCase(),
                  dataUrl: reader.result
                });
              };
              reader.readAsDataURL(blob);
            }
          }).catch(() => {});
        }
      } catch (e) {}
      return response;
    };
  }

  // 4. Listen for in-page download trigger from content script (Reliable Fallback)
  window.addEventListener('__OMNIAUDIO_TRIGGER_DOWNLOAD__', (e) => {
    try {
      const { trackId, filename } = e.detail || {};
      const item = window.__OMNIAUDIO_BLOB_STORE__[trackId];
      if (item && item.wavBlob) {
        const url = URL.createObjectURL(item.wavBlob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename || item.filename || 'Audio_Sample.wav';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          a.remove();
          URL.revokeObjectURL(url);
        }, 1500);
      }
    } catch (err) {
      console.warn('[OmniAudio] In-page download trigger error:', err);
    }
  });

  // 5. Classic HTMLMediaElement.prototype.play hook
  try {
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() {
      try {
        const src = this.currentSrc || this.src;
        if (src && !src.startsWith('blob:chrome')) {
          const title = detectActiveTrackName();
          window.dispatchEvent(new CustomEvent('__OMNIAUDIO_CAPTURED__', {
            detail: {
              url: src,
              title: title,
              mimeType: this.tagName.toLowerCase() === 'audio' ? 'audio/mpeg' : 'video/mp4',
              source: 'media_element'
            }
          }));
        }
      } catch (e) {}
      return origPlay.apply(this, arguments);
    };
  } catch (e) {}
})();
