const TARGET_SAMPLE_RATE = 16000;

export interface ExtractedMediaPayload {
  blob: Blob;
  mimeType: string;
  mode: 'audio-wav' | 'video-fallback';
  durationSeconds: number;
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const bufferLength = 44 + samples.length * 2;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM format chunk size
  view.setUint16(20, 1, true); // PCM = 1
  view.setUint16(22, 1, true); // Mono = 1 channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate = sampleRate * numChannels * bytesPerSample
  view.setUint16(32, 2, true); // Block align = numChannels * bytesPerSample
  view.setUint16(34, 16, true); // Bits per sample = 16

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export async function readVideoDurationSeconds(file: File): Promise<number> {
  const tempUrl = URL.createObjectURL(file);

  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';

      const cleanup = () => {
        video.removeAttribute('src');
        video.load();
      };

      video.onloadedmetadata = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          const duration = video.duration;
          cleanup();
          resolve(duration);
          return;
        }

        // Some WebM containers report Infinity until seeking near the end
        if (video.duration === Infinity) {
          const handleSeeked = () => {
            video.removeEventListener('seeked', handleSeeked);
            const resolvedDuration =
              Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
            cleanup();
            resolve(resolvedDuration);
          };
          video.addEventListener('seeked', handleSeeked);
          video.currentTime = 1e7;
          return;
        }

        cleanup();
        resolve(0);
      };

      video.onerror = () => {
        cleanup();
        reject(new Error('Could not read video metadata. Please try an MP4 or WebM video.'));
      };

      video.src = tempUrl;
    });
  } finally {
    URL.revokeObjectURL(tempUrl);
  }
}

/**
 * Extracts and downsamples the audio track of a video into a compact 16 kHz mono WAV
 * in the browser. Falls back cleanly to the original video blob if browser audio
 * decoding fails for an uncommon container/codec.
 */
export async function extractAudioOrFallback(
  file: File,
  knownDurationSeconds: number
): Promise<ExtractedMediaPayload> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioCtx) {
    return {
      blob: file,
      mimeType: file.type || 'video/mp4',
      mode: 'video-fallback',
      durationSeconds: knownDurationSeconds,
    };
  }

  let audioContext: AudioContext | null = null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    audioContext = new AudioCtx();
    const decoded = await audioContext.decodeAudioData(arrayBuffer);
    const durationSeconds = decoded.duration || knownDurationSeconds;

    if (durationSeconds > 300) {
      throw new Error('DURATION_EXCEEDED');
    }

    const frameCount = Math.max(1, Math.ceil(durationSeconds * TARGET_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);

    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);

    const rendered = await offline.startRendering();
    const wavBlob = encodeWavPcm16(rendered.getChannelData(0), TARGET_SAMPLE_RATE);

    return {
      blob: wavBlob,
      mimeType: 'audio/wav',
      mode: 'audio-wav',
      durationSeconds,
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'DURATION_EXCEEDED') {
      throw err;
    }
    return {
      blob: file,
      mimeType: file.type || 'video/mp4',
      mode: 'video-fallback',
      durationSeconds: knownDurationSeconds,
    };
  } finally {
    if (audioContext && audioContext.state !== 'closed') {
      try {
        await audioContext.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}
