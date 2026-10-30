/**
 * Lossless WAV (RIFF/PCM) Encoder
 * Encodes Float32Array audio channels into a standard 16-bit uncompressed WAV Blob.
 */

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Encodes audio channel buffers into a WAV Blob
 * @param {Float32Array} samplesL Left channel samples (-1.0 to 1.0)
 * @param {Float32Array|null} samplesR Right channel samples (or null for mono)
 * @param {number} sampleRate Sample rate in Hz (e.g., 44100 or 48000)
 * @returns {Blob} WAV Blob
 */
function encodeWAV(samplesL, samplesR, sampleRate = 48000) {
  const numChannels = samplesR ? 2 : 1;
  const numSamples = samplesL.length;
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // 1. RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // ChunkSize
  writeString(view, 8, 'WAVE');

  // 2. "fmt " sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);             // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);              // AudioFormat (1 = PCM uncompressed)
  view.setUint16(22, numChannels, true);    // NumChannels
  view.setUint32(24, sampleRate, true);     // SampleRate
  view.setUint32(28, byteRate, true);       // ByteRate
  view.setUint16(32, blockAlign, true);     // BlockAlign
  view.setUint16(34, 16, true);             // BitsPerSample (16 bits)

  // 3. "data" sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);       // Subchunk2Size

  // 4. Interleave and quantize 32-bit float to 16-bit signed integer
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    // Left channel
    let sL = Math.max(-1, Math.min(1, samplesL[i]));
    view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true);
    offset += 2;

    // Right channel (if stereo)
    if (numChannels === 2) {
      let sR = Math.max(-1, Math.min(1, samplesR[i]));
      view.setInt16(offset, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { encodeWAV };
}
