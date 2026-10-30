/**
 * OmniAudio Offscreen Capture Worker
 * Handles live tab audio capture with simultaneous speaker passthrough,
 * real-time VU meter level computation, and studio-grade lossless WAV or 320kbps Opus encoding.
 */

let currentStream = null;
let audioContext = null;
let mediaRecorder = null;
let scriptProcessor = null;
let recordedChunks = [];
let leftChannelBuffers = [];
let rightChannelBuffers = [];
let recordingFormat = 'wav';
let recordingTitle = 'Tab Audio';
let recordingStartTime = 0;
let isRecording = false;
let levelInterval = null;
let currentTabId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.type === 'START_RECORDING') {
    startCapture(message)
      .then(res => sendResponse({ success: true, ...res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  } else if (message.type === 'STOP_RECORDING') {
    stopCapture()
      .then(res => sendResponse({ success: true, ...res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  } else if (message.type === 'GET_RECORDING_STATUS') {
    sendResponse({
      isRecording: isRecording,
      format: recordingFormat,
      title: recordingTitle,
      duration: isRecording ? Math.floor((Date.now() - recordingStartTime) / 1000) : 0
    });
  }
});

async function startCapture({ streamId, format = 'wav', title = 'Tab Audio', tabId }) {
  if (isRecording) {
    throw new Error('Already recording tab audio');
  }

  recordingFormat = format;
  recordingTitle = title || 'Tab Audio';
  currentTabId = tabId;
  recordedChunks = [];
  leftChannelBuffers = [];
  rightChannelBuffers = [];

  // Capture the raw audio stream from the tab
  currentStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  // Use native sample rate without forced resampling for zero distortion
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  audioContext = new AudioCtx();
  const source = audioContext.createMediaStreamSource(currentStream);

  // Passthrough to speakers so the user still hears the audio
  source.connect(audioContext.destination);

  // Setup Analyser for live visualizer
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  levelInterval = setInterval(() => {
    if (!isRecording) return;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const avg = sum / dataArray.length;
    const normalizedLevel = Math.min(100, Math.round((avg / 255) * 100));

    chrome.runtime.sendMessage({
      type: 'LIVE_AUDIO_LEVEL',
      level: normalizedLevel,
      elapsed: Math.floor((Date.now() - recordingStartTime) / 1000)
    }).catch(() => {});
  }, 100);

  if (format === 'wav') {
    // Lossless PCM stereo recording
    const bufferSize = 4096;
    scriptProcessor = audioContext.createScriptProcessor(bufferSize, 2, 2);
    scriptProcessor.onaudioprocess = (e) => {
      if (!isRecording) return;
      const left = e.inputBuffer.getChannelData(0);
      const right = e.inputBuffer.getChannelData(1);
      leftChannelBuffers.push(new Float32Array(left));
      rightChannelBuffers.push(new Float32Array(right));
    };

    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);
  } else {
    // High-Bitrate Opus WebM (320 kbps)
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(currentStream, {
      mimeType: mimeType,
      audioBitsPerSecond: 320000
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.start(250);
  }

  isRecording = true;
  recordingStartTime = Date.now();

  return { format, title };
}

async function stopCapture() {
  if (!isRecording) {
    throw new Error('No active recording in progress');
  }

  isRecording = false;
  if (levelInterval) {
    clearInterval(levelInterval);
    levelInterval = null;
  }

  const durationSec = Math.max(1, Math.floor((Date.now() - recordingStartTime) / 1000));
  let outputBlob = null;
  let extension = 'wav';

  if (recordingFormat === 'wav') {
    if (scriptProcessor) {
      scriptProcessor.disconnect();
      scriptProcessor.onaudioprocess = null;
      scriptProcessor = null;
    }

    const totalSamples = leftChannelBuffers.reduce((acc, b) => acc + b.length, 0);
    const mergedLeft = new Float32Array(totalSamples);
    const mergedRight = new Float32Array(totalSamples);

    let offset = 0;
    for (let i = 0; i < leftChannelBuffers.length; i++) {
      mergedLeft.set(leftChannelBuffers[i], offset);
      mergedRight.set(rightChannelBuffers[i], offset);
      offset += leftChannelBuffers[i].length;
    }

    outputBlob = encodeWAV(mergedLeft, mergedRight, audioContext.sampleRate || 44100);
    extension = 'wav';
  } else {
    extension = 'webm';
    await new Promise((resolve) => {
      mediaRecorder.onstop = resolve;
      mediaRecorder.stop();
    });
    outputBlob = new Blob(recordedChunks, { type: 'audio/webm' });
  }

  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    await audioContext.close();
    audioContext = null;
  }

  const reader = new FileReader();
  const dataUrl = await new Promise((resolve, reject) => {
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(outputBlob);
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const cleanTitle = (recordingTitle || 'Recorded_Audio').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80);
  const filename = `${cleanTitle} - ${timestamp}.${extension}`;

  chrome.runtime.sendMessage({
    type: 'RECORDING_COMPLETE',
    dataUrl: dataUrl,
    filename: filename,
    format: extension.toUpperCase(),
    size: outputBlob.size,
    duration: durationSec,
    tabId: currentTabId
  });

  return {
    filename,
    format: extension.toUpperCase(),
    size: outputBlob.size,
    duration: durationSec
  };
}
