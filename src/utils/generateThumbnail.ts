import type { ThumbnailStyleId } from '../types/repurposer';

const THUMB_WIDTH = 720;
const THUMB_HEIGHT = 1280;

export interface ThumbnailStyleOption {
  id: ThumbnailStyleId;
  label: string;
}

export const THUMBNAIL_STYLE_OPTIONS: ThumbnailStyleOption[] = [
  { id: 'editorial-bottom', label: 'Bottom Gradient' },
  { id: 'bold-center', label: 'Center Spotlight' },
  { id: 'top-headline', label: 'Top Banner' },
];

function drawCoverFrame(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
) {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / targetRatio;
    sy = (sourceHeight - sh) / 2;
  }

  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
}

function scoreFrameVisualQuality(ctx: CanvasRenderingContext2D): number {
  const sampleW = 80;
  const sampleH = 142;
  const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
  const pixelCount = sampleW * sampleH;

  let sumLum = 0;
  let sumLumSq = 0;

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sumLum += lum;
    sumLumSq += lum * lum;
  }

  const mean = sumLum / pixelCount;
  const variance = Math.max(0, sumLumSq / pixelCount - mean * mean);
  const stdDev = Math.sqrt(variance);

  // Penalize nearly black or blown-out frames; reward good contrast/detail
  let brightnessScore = 1;
  if (mean < 24) {
    brightnessScore = mean / 24;
  } else if (mean > 235) {
    brightnessScore = Math.max(0.1, (255 - mean) / 20);
  }

  return stdDev * brightnessScore;
}

function seekVideoElement(video: HTMLVideoElement, targetTime: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
      reject(new Error('Timed out while seeking video frame.'));
    }, 6000);

    const handleSeeked = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
      resolve();
    };

    const handleError = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
      reject(new Error('Failed to decode video frame.'));
    };

    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);
    video.currentTime = targetTime;
  });
}

export async function captureBestFrameFromVideo(
  videoUrl: string,
  start: number,
  end: number
): Promise<{ frameDataUrl: string; capturedAtSeconds: number }> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error('Timed out loading video for thumbnail capture.'));
      }, 8000);

      video.onloadeddata = () => {
        window.clearTimeout(timeoutId);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeoutId);
        reject(new Error('Could not load video frame in the browser.'));
      };
      video.src = videoUrl;
    });

    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    const maxTime =
      Number.isFinite(video.duration) && video.duration > 0
        ? Math.max(0, video.duration - 0.1)
        : end;

    const clampedStart = Math.max(0, Math.min(start, maxTime));
    const clampedEnd = Math.max(clampedStart, Math.min(end, maxTime));
    const span = Math.max(0, clampedEnd - clampedStart);
    const midpoint = Number((clampedStart + span * 0.5).toFixed(2));

    // Sample midpoint first (baseline), plus two candidate offsets inside the highlight
    const candidates =
      span >= 2
        ? [
            midpoint,
            Number((clampedStart + span * 0.25).toFixed(2)),
            Number((clampedStart + span * 0.72).toFixed(2)),
          ]
        : [midpoint];

    const scoreCanvas = document.createElement('canvas');
    scoreCanvas.width = 80;
    scoreCanvas.height = 142;
    const scoreCtx = scoreCanvas.getContext('2d');

    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = THUMB_WIDTH;
    fullCanvas.height = THUMB_HEIGHT;
    const fullCtx = fullCanvas.getContext('2d');

    if (!fullCtx) {
      throw new Error('Browser canvas is unavailable for thumbnail generation.');
    }

    let bestTime = midpoint;
    let bestScore = -1;
    let bestDataUrl: string | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const candidateTime = candidates[i];
      try {
        await seekVideoElement(video, candidateTime);

        fullCtx.clearRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        drawCoverFrame(
          fullCtx,
          video,
          sourceWidth,
          sourceHeight,
          THUMB_WIDTH,
          THUMB_HEIGHT
        );

        let score = 1;
        if (scoreCtx) {
          scoreCtx.clearRect(0, 0, 80, 142);
          drawCoverFrame(scoreCtx, video, sourceWidth, sourceHeight, 80, 142);
          score = scoreFrameVisualQuality(scoreCtx);
          // Slight preference for midpoint when scores are close ("use midpoint if unsure")
          if (i === 0) {
            score *= 1.1;
          }
        }

        if (score > bestScore || !bestDataUrl) {
          bestScore = score;
          bestTime = candidateTime;
          bestDataUrl = fullCanvas.toDataURL('image/jpeg', 0.92);
        }
      } catch {
        // If a secondary seek fails, keep the midpoint or earlier valid capture
        if (i === 0) {
          throw new Error('Could not seek to the highlight midpoint to capture a frame.');
        }
      }
    }

    if (!bestDataUrl) {
      throw new Error('Could not capture a frame from the video.');
    }

    return {
      frameDataUrl: bestDataUrl,
      capturedAtSeconds: bestTime,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

function wrapTitleLines(
  ctx: CanvasRenderingContext2D,
  title: string,
  maxWidth: number
): string[] {
  const cleanTitle = title.replace(/\s+/g, ' ').trim();
  if (!cleanTitle) return ['Untitled Clip'];

  const words = cleanTitle.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) {
    lines.push(current);
  }

  return lines.slice(0, 4);
}

export async function renderThumbnailWithStyle(
  frameDataUrl: string,
  title: string,
  style: ThumbnailStyleId
): Promise<string> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load captured video frame.'));
    image.src = frameDataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser 2D canvas context is unavailable.');
  }

  ctx.drawImage(img, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);

  const paddingX = 52;
  const maxTextWidth = THUMB_WIDTH - paddingX * 2;
  const titleFontFamily =
    '"Plus Jakarta Sans", "DM Sans", "Noto Sans Devanagari", "Noto Sans Bengali", -apple-system, BlinkMacSystemFont, sans-serif';

  if (style === 'editorial-bottom') {
    const gradient = ctx.createLinearGradient(0, THUMB_HEIGHT * 0.38, 0, THUMB_HEIGHT);
    gradient.addColorStop(0, 'rgba(15, 23, 42, 0)');
    gradient.addColorStop(0.45, 'rgba(15, 23, 42, 0.58)');
    gradient.addColorStop(1, 'rgba(15, 23, 42, 0.94)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

    const fontSize = 54;
    const lineHeight = 68;
    ctx.font = `700 ${fontSize}px ${titleFontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const lines = wrapTitleLines(ctx, title, maxTextWidth);
    const bottomMargin = 110;
    const startY = THUMB_HEIGHT - bottomMargin - (lines.length - 1) * lineHeight;

    // Subtle crisp accent bar above the title
    ctx.fillStyle = '#60A5FA';
    ctx.fillRect(paddingX, startY - fontSize - 22, 64, 5);

    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;

    lines.forEach((line, idx) => {
      ctx.fillText(line, paddingX, startY + idx * lineHeight);
    });
  } else if (style === 'bold-center') {
    const gradient = ctx.createLinearGradient(0, 0, 0, THUMB_HEIGHT);
    gradient.addColorStop(0, 'rgba(15, 23, 42, 0.42)');
    gradient.addColorStop(0.5, 'rgba(15, 23, 42, 0.78)');
    gradient.addColorStop(1, 'rgba(15, 23, 42, 0.58)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

    const fontSize = 58;
    const lineHeight = 72;
    ctx.font = `700 ${fontSize}px ${titleFontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lines = wrapTitleLines(ctx, title, maxTextWidth);
    const totalHeight = lines.length * lineHeight;
    const firstLineY = THUMB_HEIGHT / 2 - totalHeight / 2 + lineHeight / 2;

    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 3;

    lines.forEach((line, idx) => {
      ctx.fillText(line, THUMB_WIDTH / 2, firstLineY + idx * lineHeight);
    });
  } else {
    // top-headline
    const gradient = ctx.createLinearGradient(0, 0, 0, THUMB_HEIGHT * 0.62);
    gradient.addColorStop(0, 'rgba(15, 23, 42, 0.94)');
    gradient.addColorStop(0.58, 'rgba(15, 23, 42, 0.55)');
    gradient.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

    const fontSize = 52;
    const lineHeight = 66;
    ctx.font = `700 ${fontSize}px ${titleFontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const lines = wrapTitleLines(ctx, title, maxTextWidth);
    const startY = 104;

    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;

    lines.forEach((line, idx) => {
      ctx.fillText(line, paddingX, startY + idx * lineHeight);
    });
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not export thumbnail PNG.'))),
      'image/png'
    );
  });

  return URL.createObjectURL(blob);
}
