/**
 * OmniAudio Background Service Worker
 * Manages client-captured PCM audio buffers, network stream sniffing,
 * highest-quality ranking, and downloads.
 */

// Tab audio store: tabId -> Map<idOrUrl, TrackObject>
const tabAudios = new Map();
let activeRecording = null;

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return 'Stream';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(val >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(sec) {
  if (!sec || isNaN(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getFormatInfo(mimeType, url = '') {
  const mime = (mimeType || '').toLowerCase();
  const lowerUrl = (url || '').toLowerCase();

  if (mime.includes('flac') || lowerUrl.endsWith('.flac')) {
    return { ext: 'flac', label: 'FLAC (Lossless)', isLossless: true, baseScore: 1000 };
  }
  if (mime.includes('wav') || lowerUrl.endsWith('.wav')) {
    return { ext: 'wav', label: 'WAV (Lossless)', isLossless: true, baseScore: 980 };
  }
  if (mime.includes('opus') || lowerUrl.endsWith('.opus')) {
    return { ext: 'opus', label: 'OPUS', isLossless: false, baseScore: 880 };
  }
  if (mime.includes('webm') || lowerUrl.endsWith('.webm') || lowerUrl.endsWith('.weba')) {
    return { ext: 'webm', label: 'WEBM Audio', isLossless: false, baseScore: 850 };
  }
  if (mime.includes('aac') || lowerUrl.endsWith('.aac')) {
    return { ext: 'aac', label: 'AAC', isLossless: false, baseScore: 820 };
  }
  if (mime.includes('m4a') || mime.includes('mp4') || lowerUrl.endsWith('.m4a')) {
    return { ext: 'm4a', label: 'M4A', isLossless: false, baseScore: 800 };
  }
  if (mime.includes('ogg') || lowerUrl.endsWith('.ogg') || lowerUrl.endsWith('.oga')) {
    return { ext: 'ogg', label: 'OGG Vorbis', isLossless: false, baseScore: 750 };
  }
  if (mime.includes('mpeg') || mime.includes('mp3') || lowerUrl.endsWith('.mp3')) {
    return { ext: 'mp3', label: 'MP3', isLossless: false, baseScore: 720 };
  }

  return { ext: 'mp3', label: 'AUDIO', isLossless: false, baseScore: 500 };
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('range');
    u.searchParams.delete('bytes');
    u.searchParams.delete('_');
    return u.toString();
  } catch (e) {
    return url;
  }
}

function parseContentDispositionFilename(headerValue) {
  if (!headerValue) return null;
  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try { return decodeURIComponent(utf8Match[1].trim()); } catch (e) {}
  }
  const match = headerValue.match(/filename=["']?([^"';]+)["']?/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

function getUrlBasename(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      const last = parts[parts.length - 1];
      return decodeURIComponent(last).split('?')[0];
    }
  } catch (e) {}
  return null;
}

function sanitizeFilename(name, ext) {
  let clean = (name || 'Audio').replace(/[\\/:*?"<>|]/g, '_').trim();
  if (clean.length > 100) clean = clean.slice(0, 100).trim();
  const desiredExt = ext.startsWith('.') ? ext : `.${ext}`;
  if (!clean.toLowerCase().endsWith(desiredExt.toLowerCase())) {
    clean += desiredExt;
  }
  return clean;
}

function updateQualityRankings(tabId) {
  const map = tabAudios.get(tabId);
  if (!map || map.size === 0) return;

  let bestTrack = null;
  let maxScore = -1;

  for (const track of map.values()) {
    let score = track.baseScore || 500;
    // Client-captured PCM full samples get highest priority bonus
    if (track.isClientAudio) {
      score += 500;
    }
    if (track.size && track.size > 0) {
      score += Math.min(600, Math.floor(track.size / (1024 * 10)));
    }
    track.qualityScore = score;
    track.isHighestQuality = false;

    if (score > maxScore) {
      maxScore = score;
      bestTrack = track;
    }
  }

  if (bestTrack && map.size > 1) {
    bestTrack.isHighestQuality = true;
  }
}

function updateBadge(tabId) {
  if (!tabId || tabId < 0) return;
  const count = tabAudios.has(tabId) ? tabAudios.get(tabId).size : 0;
  const text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ text, tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#4f46e5', tabId }).catch(() => {});
}

// Add or update track from network sniffing
function addOrUpdateNetworkTrack(tabId, trackData) {
  if (!tabId || tabId < 0) return;
  if (!tabAudios.has(tabId)) {
    tabAudios.set(tabId, new Map());
  }

  const map = tabAudios.get(tabId);
  const normalized = normalizeUrl(trackData.url);
  const formatInfo = getFormatInfo(trackData.mimeType, trackData.url);

  let chosenName = trackData.filename;
  if (!chosenName) {
    const urlBasename = getUrlBasename(trackData.url);
    if (urlBasename && urlBasename.includes('.')) {
      chosenName = urlBasename;
    } else {
      chosenName = trackData.title || 'Audio Track';
    }
  }

  const cleanName = sanitizeFilename(chosenName, formatInfo.ext);

  if (map.has(normalized)) {
    const existing = map.get(normalized);
    if (trackData.size && (!existing.size || trackData.size > existing.size)) {
      existing.size = trackData.size;
      existing.sizeStr = formatBytes(trackData.size);
    }
  } else {
    const newTrack = {
      id: `net_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      url: trackData.url,
      dataUrl: trackData.url,
      normalizedUrl: normalized,
      title: chosenName,
      filename: cleanName,
      mimeType: trackData.mimeType || 'audio/mpeg',
      format: formatInfo.label,
      ext: formatInfo.ext,
      isLossless: formatInfo.isLossless,
      baseScore: formatInfo.baseScore,
      size: trackData.size || 0,
      sizeStr: formatBytes(trackData.size),
      timestamp: Date.now(),
      source: 'network',
      isClientAudio: false,
      isHighestQuality: false
    };
    map.set(normalized, newTrack);
  }

  updateQualityRankings(tabId);
  updateBadge(tabId);
}

// --- Network Sniffer ---
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;

    let contentType = '';
    let contentLength = 0;
    let contentDisposition = '';
    let contentRange = '';

    if (details.responseHeaders) {
      for (const h of details.responseHeaders) {
        const name = h.name.toLowerCase();
        if (name === 'content-type') contentType = (h.value || '').toLowerCase();
        if (name === 'content-length') contentLength = parseInt(h.value || '0', 10);
        if (name === 'content-disposition') contentDisposition = h.value || '';
        if (name === 'content-range') contentRange = h.value || '';
      }
    }

    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match && match[1]) contentLength = parseInt(match[1], 10);
    }

    const lowerUrl = details.url.toLowerCase();
    const isAudioMime = contentType.startsWith('audio/') ||
                        contentType.includes('ogg') ||
                        contentType.includes('opus') ||
                        (contentType.includes('webm') && !contentType.includes('video/webm'));

    const isAudioExt = /\.(mp3|wav|m4a|aac|flac|ogg|opus|weba)(\?.*)?$/i.test(lowerUrl);

    if (isAudioMime || isAudioExt) {
      const filename = parseContentDispositionFilename(contentDisposition);
      addOrUpdateNetworkTrack(details.tabId, {
        url: details.url,
        mimeType: contentType || 'audio/mpeg',
        size: contentLength,
        filename: filename,
        source: 'network'
      });
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Tab Cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
  tabAudios.delete(tabId);
  if (activeRecording && activeRecording.tabId === tabId) {
    stopRecording(tabId).catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabAudios.delete(tabId);
    updateBadge(tabId);
  }
});

// --- Offscreen Document for Live Capture ---
async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture and record live tab audio in highest quality'
    });
  }
}

async function closeOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (contexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

async function startRecording(tabId, format = 'wav', title = 'Tab Audio') {
  await ensureOffscreenDocument();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

  const response = await chrome.runtime.sendMessage({
    type: 'START_RECORDING',
    target: 'offscreen',
    streamId: streamId,
    format: format,
    title: title,
    tabId: tabId
  });

  if (response && response.success) {
    activeRecording = { tabId, format, title, startTime: Date.now() };
    return { success: true };
  } else {
    throw new Error(response ? response.error : 'Failed to start tab audio capture');
  }
}

async function stopRecording(tabId) {
  const response = await chrome.runtime.sendMessage({
    type: 'STOP_RECORDING',
    target: 'offscreen'
  });
  activeRecording = null;
  setTimeout(() => { closeOffscreenDocument().catch(() => {}); }, 1500);
  return response;
}

// --- Messages Router ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId || (sender.tab ? sender.tab.id : null);

  switch (message.type) {
    // 1. Client-Side PCM / Web Audio / Decoded Full Sample Captured!
    case 'CLIENT_AUDIO_CAPTURED': {
      if (sender.tab && sender.tab.id) {
        const currentTabId = sender.tab.id;
        if (!tabAudios.has(currentTabId)) {
          tabAudios.set(currentTabId, new Map());
        }
        const map = tabAudios.get(currentTabId);
        const t = message.track;

        const trackObj = {
          id: t.id,
          url: t.dataUrl || '',
          dataUrl: t.dataUrl || '',
          title: t.title || 'Audio Sample',
          filename: t.filename || 'Audio_Sample.wav',
          mimeType: 'audio/wav',
          format: t.format || 'WAV (Full Sample)',
          ext: 'wav',
          isLossless: true,
          baseScore: 1200,
          qualityScore: 1600, // Top priority
          size: t.size || 0,
          sizeStr: formatBytes(t.size),
          duration: t.duration || 0,
          durationStr: formatDuration(t.duration),
          timestamp: Date.now(),
          source: 'client_audio_buffer',
          isClientAudio: true,
          isHighestQuality: true
        };

        map.set(t.id, trackObj);
        updateQualityRankings(currentTabId);
        updateBadge(currentTabId);
      }
      sendResponse({ success: true });
      break;
    }

    case 'MEDIA_DETECTED': {
      if (tabId) {
        addOrUpdateNetworkTrack(tabId, message.media);
      }
      sendResponse({ success: true });
      break;
    }

    case 'GET_TAB_AUDIO': {
      const map = tabAudios.get(message.tabId);
      const list = map ? Array.from(map.values()) : [];
      // Client audio full samples always prioritized first
      list.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));
      sendResponse({
        tracks: list,
        activeRecording: activeRecording
      });
      break;
    }

    case 'CLEAR_TAB_AUDIO': {
      if (message.tabId) {
        tabAudios.delete(message.tabId);
        updateBadge(message.tabId);
      }
      sendResponse({ success: true });
      break;
    }

    case 'DOWNLOAD_TRACK': {
      const { url, filename, trackId, isClientAudio } = message;

      // For Client-Captured Data URLs: Direct uncorrupted client download
      if (url && url.startsWith('data:')) {
        chrome.downloads.download({
          url: url,
          filename: filename || 'Audio_Sample.wav',
          saveAs: false
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            // Trigger in-page anchor download fallback
            if (message.tabId) {
              chrome.tabs.sendMessage(message.tabId, {
                type: 'TRIGGER_IN_PAGE_DOWNLOAD',
                trackId: trackId,
                filename: filename
              });
            }
            sendResponse({ success: true, fallback: true });
          } else {
            sendResponse({ success: true, downloadId });
          }
        });
        return true;
      }

      // If client audio requested but no dataUrl or large, trigger in-page download
      if (isClientAudio && message.tabId) {
        chrome.tabs.sendMessage(message.tabId, {
          type: 'TRIGGER_IN_PAGE_DOWNLOAD',
          trackId: trackId,
          filename: filename
        });
        sendResponse({ success: true, inPage: true });
        return true;
      }

      // Remote network URL download
      chrome.downloads.download({
        url: url,
        filename: filename || 'Audio.mp3',
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
      });
      return true;
    }

    case 'DOWNLOAD_ALL': {
      const map = tabAudios.get(message.tabId);
      if (map && map.size > 0) {
        let count = 0;
        for (const track of map.values()) {
          setTimeout(() => {
            if (track.dataUrl && track.dataUrl.startsWith('data:')) {
              chrome.downloads.download({
                url: track.dataUrl,
                filename: track.filename,
                saveAs: false
              });
            } else if (track.isClientAudio) {
              chrome.tabs.sendMessage(message.tabId, {
                type: 'TRIGGER_IN_PAGE_DOWNLOAD',
                trackId: track.id,
                filename: track.filename
              });
            } else {
              chrome.downloads.download({
                url: track.url,
                filename: track.filename,
                saveAs: false
              });
            }
          }, count * 400);
          count++;
        }
        sendResponse({ success: true, count });
      } else {
        sendResponse({ success: false, error: 'No tracks to download' });
      }
      break;
    }

    case 'START_RECORDING': {
      startRecording(message.tabId, message.format, message.title)
        .then(res => sendResponse(res))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    case 'STOP_RECORDING': {
      stopRecording(message.tabId)
        .then(res => sendResponse(res))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    case 'RECORDING_COMPLETE': {
      chrome.downloads.download({
        url: message.dataUrl,
        filename: message.filename,
        saveAs: false
      });
      sendResponse({ success: true });
      break;
    }

    default:
      break;
  }
});
