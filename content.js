/**
 * OmniAudio Content Script
 * Relays client-side decoded audio and DOM media to background service worker.
 */

(function() {
  const seenUrls = new Set();

  // Inject main-world script
  function injectMainScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn('[OmniAudio] Could not inject main script:', e);
    }
  }

  // Receive 100% full uncorrupted client-side audio (Web Audio / PCM / Fetch)
  window.addEventListener('__OMNIAUDIO_CLIENT_AUDIO__', (e) => {
    if (!e.detail) return;
    try {
      chrome.runtime.sendMessage({
        type: 'CLIENT_AUDIO_CAPTURED',
        track: e.detail
      });
    } catch (err) {
      // Context invalidated or background waking up
    }
  });

  // Listen for download triggers directed to the in-page client store
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TRIGGER_IN_PAGE_DOWNLOAD') {
      window.dispatchEvent(new CustomEvent('__OMNIAUDIO_TRIGGER_DOWNLOAD__', {
        detail: {
          trackId: message.trackId,
          filename: message.filename
        }
      }));
      sendResponse({ success: true });
    }
  });

  // Listen for classic network audio discovery from injected
  window.addEventListener('__OMNIAUDIO_CAPTURED__', (e) => {
    if (e.detail && e.detail.url) {
      reportAudio(e.detail.url, e.detail.title, e.detail.mimeType, e.detail.source || 'injected');
    }
  });

  function sanitizeName(name) {
    if (!name) return 'Audio Track';
    return name.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 100);
  }

  function reportAudio(url, title, mimeType, source = 'dom') {
    if (!url || typeof url !== 'string') return;
    if (url.startsWith('chrome-extension://') || url.startsWith('chrome://')) return;
    if (seenUrls.has(url)) return;
    seenUrls.add(url);

    try {
      chrome.runtime.sendMessage({
        type: 'MEDIA_DETECTED',
        media: {
          url: url,
          title: sanitizeName(title || document.title || 'Audio Track'),
          mimeType: mimeType || 'audio/mpeg',
          pageUrl: window.location.href,
          source: source
        }
      });
    } catch (e) {}
  }

  // Scan media elements
  function scanMedia() {
    const mediaElements = document.querySelectorAll('audio, video');
    mediaElements.forEach(el => {
      const src = el.currentSrc || el.src;
      if (src && !src.startsWith('blob:chrome')) {
        const title = el.getAttribute('title') || el.getAttribute('aria-label') || document.title;
        reportAudio(src, title, el.tagName.toLowerCase() === 'audio' ? 'audio/mpeg' : 'video/mp4', 'dom_media');
      }
    });
  }

  // Init
  injectMainScript();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scanMedia();
    });
  } else {
    scanMedia();
  }
})();
