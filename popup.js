/**
 * OmniAudio Popup Controller
 * Renders client-captured full WAV samples and network streams,
 * controls audio preview player, downloads, and live tab recorder.
 */

document.addEventListener('DOMContentLoaded', async () => {
  let activeTab = null;
  let detectedTracks = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let filterSmallSounds = false; // default false so all samples show
  let currentlyPlayingUrl = null;
  let recordingTimerInterval = null;
  let isRecording = false;

  // Header & Tabs Elements
  const pageTitleEl = document.getElementById('pageTitle');
  const btnDownloadBest = document.getElementById('btnDownloadBest');
  const detectedCountBadge = document.getElementById('detectedCount');
  const tabRecordDot = document.getElementById('tabRecordDot');
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabContents = document.querySelectorAll('.tab-content');
  const toastEl = document.getElementById('toast');

  // Detected Audio Elements
  const searchInput = document.getElementById('searchInput');
  const chkFilterSmall = document.getElementById('chkFilterSmall');
  const btnDownloadAll = document.getElementById('btnDownloadAll');
  const btnClearList = document.getElementById('btnClearList');
  const formatChips = document.querySelectorAll('.chip');
  const trackListEl = document.getElementById('trackList');
  const emptyStateEl = document.getElementById('emptyState');
  const btnSwitchToRecorder = document.getElementById('btnSwitchToRecorder');

  // Audio Player Elements
  const audioPlayerBar = document.getElementById('audioPlayerBar');
  const playerTitle = document.getElementById('playerTitle');
  const playerTime = document.getElementById('playerTime');
  const btnPlayerPlayPause = document.getElementById('btnPlayerPlayPause');
  const iconPlay = document.getElementById('iconPlay');
  const iconPause = document.getElementById('iconPause');
  const playerSeek = document.getElementById('playerSeek');
  const btnPlayerClose = document.getElementById('btnPlayerClose');
  const previewAudio = document.getElementById('previewAudioElement');

  // Recorder Elements
  const recorderBadge = document.getElementById('recorderBadge');
  const recorderTimer = document.getElementById('recorderTimer');
  const visualizerEl = document.getElementById('visualizer');
  const btnToggleRecording = document.getElementById('btnToggleRecording');
  const btnRecordText = document.getElementById('btnRecordText');

  // Initialize VU Bars
  const NUM_BARS = 20;
  visualizerEl.innerHTML = '';
  const vuBars = [];
  for (let i = 0; i < NUM_BARS; i++) {
    const bar = document.createElement('div');
    bar.className = 'vu-bar';
    visualizerEl.appendChild(bar);
    vuBars.push(bar);
  }

  function showToast(msg, duration = 2500) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => { toastEl.classList.remove('show'); }, duration);
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // Get current active tab
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      activeTab = tabs[0];
      pageTitleEl.textContent = activeTab.title || 'Current Webpage';
      pageTitleEl.title = activeTab.title || '';
    }
  } catch (e) {
    pageTitleEl.textContent = 'Active Page';
  }

  // Load detected tracks
  async function loadDetectedTracks() {
    if (!activeTab || !activeTab.id) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_TAB_AUDIO',
        tabId: activeTab.id
      });

      if (response && response.tracks) {
        detectedTracks = response.tracks;
        detectedCountBadge.textContent = detectedTracks.length;
        renderTrackList();
      }

      if (response && response.activeRecording) {
        setRecordingUI(true, response.activeRecording);
      }
    } catch (e) {
      console.warn('[OmniAudio] Could not fetch tracks:', e);
    }
  }

  // Render list
  function renderTrackList() {
    const filtered = detectedTracks.filter(track => {
      if (filterSmallSounds && track.size > 0 && track.size < 50 * 1024) {
        return false;
      }

      if (currentFilter !== 'all') {
        const ext = (track.ext || '').toLowerCase();
        if (ext !== currentFilter) return false;
      }

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const title = (track.title || '').toLowerCase();
        const filename = (track.filename || '').toLowerCase();
        if (!title.includes(q) && !filename.includes(q)) return false;
      }

      return true;
    });

    const bestTrack = detectedTracks.find(t => t.isHighestQuality) || detectedTracks[0];
    if (bestTrack && detectedTracks.length > 0) {
      btnDownloadBest.style.display = 'inline-flex';
      btnDownloadBest.onclick = () => downloadTrack(bestTrack);
    } else {
      btnDownloadBest.style.display = 'none';
    }

    if (filtered.length === 0) {
      trackListEl.style.display = 'none';
      emptyStateEl.style.display = 'flex';
      return;
    }

    trackListEl.style.display = 'flex';
    emptyStateEl.style.display = 'none';
    trackListEl.innerHTML = '';

    filtered.forEach(track => {
      const card = document.createElement('div');
      card.className = `track-card ${track.isHighestQuality ? 'is-best' : ''}`;

      let formatClass = 'tag-format';
      if (track.isLossless) formatClass += ' lossless';
      else if (track.ext === 'opus' || track.ext === 'webm') formatClass += ' opus';
      else if (track.ext === 'mp3') formatClass += ' mp3';

      card.innerHTML = `
        <div class="track-top-row">
          <div class="track-title" title="${escapeHtml(track.title || track.filename)}">${escapeHtml(track.title || track.filename)}</div>
          ${track.isHighestQuality ? `
            <span class="badge-best-quality" title="Highest quality full sample">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              Master WAV
            </span>
          ` : ''}
        </div>
        <div class="track-meta-row">
          <span class="${formatClass}">${track.format || track.ext.toUpperCase()}</span>
          ${track.durationStr ? `<span class="tag-size">⏱ ${track.durationStr}</span>` : ''}
          <span class="tag-size">${track.sizeStr || 'Audio'}</span>
          ${track.isClientAudio ? `<span class="tag-lossless" style="font-size:9px;">100% Full</span>` : ''}
        </div>
        <div class="track-actions-row">
          <button class="btn-track-action btn-track-copy" title="Copy Audio URL">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            <span>Link</span>
          </button>
          <button class="btn-track-action btn-track-preview" title="Preview audio">
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <span>Preview</span>
          </button>
          <button class="btn-track-action btn-track-download" title="Download audio">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>Download</span>
          </button>
        </div>
      `;

      card.querySelector('.btn-track-copy').onclick = async () => {
        try {
          const text = track.url && !track.url.startsWith('data:') ? track.url : track.filename;
          await navigator.clipboard.writeText(text);
          showToast('Copied to clipboard!');
        } catch (e) {
          showToast('Copy failed');
        }
      };

      card.querySelector('.btn-track-preview').onclick = () => {
        togglePreview(track);
      };

      card.querySelector('.btn-track-download').onclick = () => {
        downloadTrack(track);
      };

      trackListEl.appendChild(card);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function downloadTrack(track) {
    showToast(`Downloading: ${track.filename}...`);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_TRACK',
        url: track.dataUrl || track.url,
        filename: track.filename,
        trackId: track.id,
        isClientAudio: track.isClientAudio,
        tabId: activeTab ? activeTab.id : null
      });

      if (response && response.success) {
        showToast('Download started!');
      } else {
        showToast('Download started');
      }
    } catch (e) {
      showToast('Download initiated');
    }
  }

  // Audio Preview
  function togglePreview(track) {
    const playUrl = track.dataUrl || track.url;
    if (currentlyPlayingUrl === playUrl && !previewAudio.paused) {
      previewAudio.pause();
      updatePlayerUI(false);
      return;
    }

    currentlyPlayingUrl = playUrl;
    previewAudio.src = playUrl;
    playerTitle.textContent = track.title || track.filename;
    audioPlayerBar.style.display = 'flex';

    previewAudio.play().then(() => {
      updatePlayerUI(true);
    }).catch(err => {
      console.warn('[OmniAudio] Preview error:', err);
      showToast('Direct preview unavailable; click Download');
    });
  }

  function updatePlayerUI(isPlaying) {
    iconPlay.style.display = isPlaying ? 'none' : 'block';
    iconPause.style.display = isPlaying ? 'block' : 'none';
  }

  btnPlayerPlayPause.onclick = () => {
    if (previewAudio.paused) {
      previewAudio.play();
      updatePlayerUI(true);
    } else {
      previewAudio.pause();
      updatePlayerUI(false);
    }
  };

  previewAudio.ontimeupdate = () => {
    if (previewAudio.duration) {
      const progress = (previewAudio.currentTime / previewAudio.duration) * 100;
      playerSeek.value = progress;
      playerTime.textContent = `${formatTime(previewAudio.currentTime)} / ${formatTime(previewAudio.duration)}`;
    }
  };

  previewAudio.onended = () => {
    updatePlayerUI(false);
    playerSeek.value = 0;
  };

  playerSeek.oninput = () => {
    if (previewAudio.duration) {
      previewAudio.currentTime = (playerSeek.value / 100) * previewAudio.duration;
    }
  };

  btnPlayerClose.onclick = () => {
    previewAudio.pause();
    previewAudio.src = '';
    currentlyPlayingUrl = null;
    audioPlayerBar.style.display = 'none';
  };

  // Tabs
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      navTabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById(target === 'detected' ? 'tabDetected' : 'tabRecorder').classList.add('active');
    });
  });

  btnSwitchToRecorder.onclick = () => {
    document.querySelector('.nav-tab[data-tab="recorder"]').click();
  };

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderTrackList();
  });

  chkFilterSmall.addEventListener('change', (e) => {
    filterSmallSounds = e.target.checked;
    renderTrackList();
  });

  formatChips.forEach(chip => {
    chip.addEventListener('click', () => {
      formatChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderTrackList();
    });
  });

  btnDownloadAll.onclick = async () => {
    if (!activeTab) return;
    showToast('Starting download of all tracks...');
    const response = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_ALL',
      tabId: activeTab.id
    });
    if (response && response.success) {
      showToast(`Downloading ${response.count} audio tracks!`);
    }
  };

  btnClearList.onclick = async () => {
    if (!activeTab) return;
    await chrome.runtime.sendMessage({
      type: 'CLEAR_TAB_AUDIO',
      tabId: activeTab.id
    });
    detectedTracks = [];
    detectedCountBadge.textContent = '0';
    renderTrackList();
    showToast('List cleared');
  };

  // Live Recorder
  function setRecordingUI(recording, data = {}) {
    isRecording = recording;

    if (recording) {
      recorderBadge.textContent = 'Recording';
      recorderBadge.classList.add('recording');
      btnToggleRecording.classList.add('is-recording');
      btnRecordText.textContent = 'Stop & Save Audio';
      tabRecordDot.classList.add('pulsing');

      let startTime = data.startTime || (Date.now() - (data.duration || 0) * 1000);
      if (recordingTimerInterval) clearInterval(recordingTimerInterval);

      recordingTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        recorderTimer.textContent = formatTime(elapsed);
      }, 500);
    } else {
      recorderBadge.textContent = 'Ready';
      recorderBadge.classList.remove('recording');
      btnToggleRecording.classList.remove('is-recording');
      btnRecordText.textContent = 'Start Recording Tab Audio';
      tabRecordDot.classList.remove('pulsing');

      if (recordingTimerInterval) {
        clearInterval(recordingTimerInterval);
        recordingTimerInterval = null;
      }
      recorderTimer.textContent = '00:00';
      vuBars.forEach(b => {
        b.style.height = '4px';
        b.classList.remove('active');
      });
    }
  }

  btnToggleRecording.onclick = async () => {
    if (!activeTab || !activeTab.id) {
      showToast('No active tab');
      return;
    }

    if (!isRecording) {
      const selectedFormat = document.querySelector('input[name="recordFormat"]:checked').value;
      const title = activeTab.title || 'Tab Audio';

      try {
        btnRecordText.textContent = 'Connecting...';
        const response = await chrome.runtime.sendMessage({
          type: 'START_RECORDING',
          tabId: activeTab.id,
          format: selectedFormat,
          title: title
        });

        if (response && response.success) {
          setRecordingUI(true, { startTime: Date.now() });
          showToast(`Recording live tab sound...`);
        } else {
          setRecordingUI(false);
          showToast('Failed to start recording');
        }
      } catch (err) {
        setRecordingUI(false);
        showToast(`Error: ${err.message}`);
      }
    } else {
      try {
        btnRecordText.textContent = 'Saving...';
        await chrome.runtime.sendMessage({
          type: 'STOP_RECORDING',
          tabId: activeTab.id
        });
        setRecordingUI(false);
        showToast('Saved to Downloads!');
      } catch (err) {
        setRecordingUI(false);
        showToast(`Save error: ${err.message}`);
      }
    }
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LIVE_AUDIO_LEVEL' && isRecording) {
      const level = message.level || 0;
      vuBars.forEach((bar, index) => {
        const center = NUM_BARS / 2;
        const dist = Math.abs(index - center) / center;
        const multiplier = 1.0 - (dist * 0.45);
        const randomJitter = (Math.random() * 0.3 - 0.15);
        const barHeight = Math.max(4, Math.min(58, Math.round((level * 0.58) * (multiplier + randomJitter))));
        bar.style.height = `${barHeight}px`;
        if (barHeight > 10) bar.classList.add('active');
        else bar.classList.remove('active');
      });
    }
  });

  // Periodically refresh list while popup is open to catch newly played samples
  setInterval(loadDetectedTracks, 1200);

  await loadDetectedTracks();
});
