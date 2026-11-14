import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const CLIP_WIDTH = 720;
const CLIP_HEIGHT = 1280;

let sharedFfmpeg: FFmpeg | null = null;
let sharedLoadPromise: Promise<FFmpeg> | null = null;

async function getLoadedFfmpeg(): Promise<FFmpeg> {
  if (sharedFfmpeg?.loaded) {
    return sharedFfmpeg;
  }

  if (sharedLoadPromise) {
    return sharedLoadPromise;
  }

  sharedLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    try {
      const coreURL = await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript');
      const wasmURL = await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm');

      await ffmpeg.load({
        coreURL,
        wasmURL,
      });

      sharedFfmpeg = ffmpeg;
      return ffmpeg;
    } catch (err) {
      sharedFfmpeg = null;
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not initialize the browser video processor (${detail}). Please try again.`
      );
    } finally {
      sharedLoadPromise = null;
    }
  })();

  return sharedLoadPromise;
}

interface SubtitleChunk {
  startOffset: number;
  endOffset: number;
  text: string;
}

function buildSubtitleChunks(captionText: string, clipDuration: number): SubtitleChunk[] {
  const normalized = captionText.replace(/\s+/g, ' ').trim();
  if (!normalized || clipDuration <= 0) {
    return [];
  }

  // Split into natural phrase/word chunks (~52 chars each, up to 8 cards) so subtitles stay legible in 9:16
  const words = normalized.split(' ');
  const rawChunks: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > 52 && current) {
      rawChunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    rawChunks.push(current);
  }

  // Merge trailing tiny chunk or cap total chunks to 8 for snappy FFmpeg filter execution
  let chunks = rawChunks;
  if (chunks.length > 8) {
    const perGroup = Math.ceil(chunks.length / 8);
    const merged: string[] = [];
    for (let i = 0; i < chunks.length; i += perGroup) {
      merged.push(chunks.slice(i, i + perGroup).join(' '));
    }
    chunks = merged;
  }

  const totalChars = chunks.reduce((sum, text) => sum + text.length, 0) || 1;
  let cursor = 0;

  return chunks.map((text, index) => {
    const proportion = text.length / totalChars;
    const span = clipDuration * proportion;
    const startOffset = cursor;
    const endOffset =
      index === chunks.length - 1
        ? clipDuration
        : Math.min(clipDuration, startOffset + span);
    cursor = endOffset;

    return {
      startOffset,
      endOffset: Math.max(startOffset + 0.2, endOffset),
      text,
    };
  });
}

function wrapCanvasLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, 4);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

async function renderSubtitleOverlayPng(text: string): Promise<Uint8Array> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const canvas = document.createElement('canvas');
  canvas.width = CLIP_WIDTH;
  canvas.height = CLIP_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser 2D canvas context is unavailable.');
  }

  ctx.clearRect(0, 0, CLIP_WIDTH, CLIP_HEIGHT);

  const fontSize = 34;
  const lineHeight = 48;
  ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", "DM Sans", "Noto Sans Devanagari", "Noto Sans Bengali", -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxTextWidth = CLIP_WIDTH - 104;
  const lines = wrapCanvasLines(ctx, text, maxTextWidth);
  if (lines.length === 0) {
    const emptyBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed.'))),
        'image/png'
      );
    });
    return new Uint8Array(await emptyBlob.arrayBuffer());
  }

  const maxLineWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const boxPaddingX = 28;
  const boxPaddingY = 18;
  const boxWidth = Math.min(CLIP_WIDTH - 56, maxLineWidth + boxPaddingX * 2);
  const boxHeight = lines.length * lineHeight + boxPaddingY * 2;
  const boxX = (CLIP_WIDTH - boxWidth) / 2;
  const centerY = Math.round(CLIP_HEIGHT * 0.77);
  const boxY = Math.round(centerY - boxHeight / 2);

  // Dark translucent pill backdrop for WCAG contrast over any video frame
  ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
  drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 16);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Crisp white subtitle text
  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;

  lines.forEach((line, index) => {
    const lineY = boxY + boxPaddingY + lineHeight * (index + 0.5);
    ctx.fillText(line, CLIP_WIDTH / 2, lineY);
  });

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not generate subtitle image.'))),
      'image/png'
    );
  });

  return new Uint8Array(await blob.arrayBuffer());
}

export interface RenderVerticalClipOptions {
  file: File;
  start: number;
  end: number;
  captionText: string;
  onPhaseChange?: (phase: 'loading-core' | 'rendering') => void;
  onProgress?: (percent: number) => void;
}

export interface RenderVerticalClipResult {
  blob: Blob;
  clipUrl: string;
  sizeBytes: number;
}

export async function renderVerticalClipWithSubtitles({
  file,
  start,
  end,
  captionText,
  onPhaseChange,
  onProgress,
}: RenderVerticalClipOptions): Promise<RenderVerticalClipResult> {
  const clipDuration = Math.max(0.5, end - start);

  onPhaseChange?.('loading-core');
  onProgress?.(2);
  const ffmpeg = await getLoadedFfmpeg();

  onPhaseChange?.('rendering');
  onProgress?.(5);

  const extMatch = file.name.match(/\.[a-zA-Z0-9]+$/);
  const inputExt = extMatch ? extMatch[0].toLowerCase() : '.mp4';
  const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const inputFileName = `input_${uniqueId}${inputExt}`;
  const outputFileName = `output_${uniqueId}.mp4`;
  const tempFilesToDelete: string[] = [inputFileName, outputFileName];

  const logBuffer: string[] = [];
  const handleLog = ({ message }: { message: string }) => {
    if (message) {
      logBuffer.push(message);
      if (logBuffer.length > 15) {
        logBuffer.shift();
      }
    }
  };

  const handleProgress = ({ progress, time }: { progress: number; time: number }) => {
    let ratio = Number.isFinite(progress) ? progress : 0;
    if ((ratio <= 0 || ratio > 1) && Number.isFinite(time) && time > 0) {
      ratio = time / 1_000_000 / clipDuration;
    }
    const clamped = Math.min(98, Math.max(5, Math.round(ratio * 95 + 5)));
    onProgress?.(clamped);
  };

  ffmpeg.on('log', handleLog);
  ffmpeg.on('progress', handleProgress);

  try {
    const inputData = await fetchFile(file);
    await ffmpeg.writeFile(inputFileName, inputData);

    const subtitleChunks = buildSubtitleChunks(captionText, clipDuration);
    const subtitleInputs: string[] = [];

    for (let i = 0; i < subtitleChunks.length; i++) {
      const pngName = `sub_${uniqueId}_${i}.png`;
      const pngBytes = await renderSubtitleOverlayPng(subtitleChunks[i].text);
      await ffmpeg.writeFile(pngName, pngBytes);
      tempFilesToDelete.push(pngName);
      subtitleInputs.push('-i', pngName);
    }

    const baseFilter = `[0:v]scale=${CLIP_WIDTH}:${CLIP_HEIGHT}:force_original_aspect_ratio=increase,crop=${CLIP_WIDTH}:${CLIP_HEIGHT},setsar=1,setpts=PTS-STARTPTS[v0]`;

    let filterComplex = '';
    if (subtitleChunks.length === 0) {
      filterComplex = `[0:v]scale=${CLIP_WIDTH}:${CLIP_HEIGHT}:force_original_aspect_ratio=increase,crop=${CLIP_WIDTH}:${CLIP_HEIGHT},setsar=1,setpts=PTS-STARTPTS[vout]`;
    } else {
      const overlaySteps = subtitleChunks.map((chunk, index) => {
        const inLabel = `v${index}`;
        const outLabel = index === subtitleChunks.length - 1 ? 'vout' : `v${index + 1}`;
        const tStart = chunk.startOffset.toFixed(2);
        const tEnd = chunk.endOffset.toFixed(2);
        return `[${inLabel}][${index + 1}:v]overlay=0:0:enable='between(t,${tStart},${tEnd})'[${outLabel}]`;
      });
      filterComplex = `${baseFilter};${overlaySteps.join(';')}`;
    }

    const args = [
      '-ss',
      Math.max(0, start).toFixed(2),
      '-t',
      clipDuration.toFixed(2),
      '-i',
      inputFileName,
      ...subtitleInputs,
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '26',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      '-shortest',
      outputFileName,
    ];

    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      const lastLogs = logBuffer.slice(-3).join(' | ');
      throw new Error(
        lastLogs
          ? `FFmpeg failed to render this clip (${lastLogs}).`
          : 'FFmpeg could not encode this video segment.'
      );
    }

    const outputData = await ffmpeg.readFile(outputFileName);
    if (!(outputData instanceof Uint8Array) || outputData.byteLength === 0) {
      throw new Error('Rendered video file was empty.');
    }

    const copyBytes = new Uint8Array(outputData.byteLength);
    copyBytes.set(outputData);
    const blob = new Blob([copyBytes.buffer], { type: 'video/mp4' });
    const clipUrl = URL.createObjectURL(blob);

    onProgress?.(100);

    return {
      blob,
      clipUrl,
      sizeBytes: blob.size,
    };
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'An unexpected error occurred while rendering the vertical clip.';
    throw new Error(message);
  } finally {
    ffmpeg.off('log', handleLog);
    ffmpeg.off('progress', handleProgress);

    for (const fileName of tempFilesToDelete) {
      try {
        await ffmpeg.deleteFile(fileName);
      } catch {
        // Ignore cleanup failures for files that weren't created
      }
    }
  }
}
