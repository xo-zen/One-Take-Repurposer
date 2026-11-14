import JSZip from 'jszip';
import type {
  HighlightCaptionItem,
  HighlightMoment,
  RenderedClipItem,
  SupportedLanguage,
  ThumbnailItem,
} from '../types/repurposer';
import { getLanguageLabel } from './captionLanguage';
import { formatTimestamp } from './formatTime';

export const MINUTES_SAVED_PER_CLIP = 30;

export function toSafeExportSlug(title: string, fallbackIndex: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const num = String(fallbackIndex + 1).padStart(2, '0');
  return slug ? `${num}-${slug}` : num;
}

export function getPreparedLanguages(
  captions: HighlightCaptionItem[]
): { codes: SupportedLanguage[]; labels: string[] } {
  const codes: SupportedLanguage[] = ['en'];
  const hasHindi = captions.some((item) => Boolean(item.translations?.hi));
  const hasBengali = captions.some((item) => Boolean(item.translations?.bn));

  if (hasHindi) codes.push('hi');
  if (hasBengali) codes.push('bn');

  return {
    codes,
    labels: codes.map((code) => getLanguageLabel(code)),
  };
}

export function formatEditingTimeSaved(totalMinutes: number): string {
  if (totalMinutes <= 0) return '0 min';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} ${hours === 1 ? 'hr' : 'hrs'} (${totalMinutes} min)`;
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'} ${mins} min (${totalMinutes} min)`;
}

export interface ExportTextParams {
  sourceFileName: string;
  selectedLanguage: SupportedLanguage;
  approvedCaptions: HighlightCaptionItem[];
  highlights: HighlightMoment[];
  clipsMadeCount: number;
  captionsEditedCount: number;
  languages: string[];
  estimatedMinutesSaved: number;
}

export function buildExportSummaryText({
  sourceFileName,
  selectedLanguage,
  approvedCaptions,
  highlights,
  clipsMadeCount,
  captionsEditedCount,
  languages,
  estimatedMinutesSaved,
}: ExportTextParams): string {
  const lines: string[] = [
    'ONE-TAKE REPURPOSER — EXPORT BUNDLE',
    '==================================',
    `Source video: ${sourceFileName || 'Untitled video'}`,
    `Exported at: ${new Date().toLocaleString()}`,
    `Active clip & thumbnail language: ${getLanguageLabel(selectedLanguage)}`,
    '',
    'SUMMARY',
    '-------',
    `Clips made: ${clipsMadeCount} of ${approvedCaptions.length} approved`,
    `Captions edited: ${captionsEditedCount}`,
    `Languages included: ${languages.join(', ')}`,
    `Estimated editing time saved: ${formatEditingTimeSaved(
      estimatedMinutesSaved
    )} (${MINUTES_SAVED_PER_CLIP} min per clip)`,
    '',
    'APPROVED HIGHLIGHTS, CAPTIONS & TRANSLATIONS',
    '============================================',
  ];

  approvedCaptions.forEach((item, index) => {
    const highlight = highlights.find((h) => h.id === item.highlightId);
    const rangeLabel = highlight
      ? `${formatTimestamp(highlight.start)} – ${formatTimestamp(highlight.end)}`
      : 'Timestamp unavailable';

    lines.push('');
    lines.push(`CLIP ${String(index + 1).padStart(2, '0')} (${rangeLabel})`);
    lines.push('----------------------------------------');
    lines.push('');
    lines.push('[English Original]');
    lines.push(`Title: ${item.title}`);
    lines.push(`Tone match: ${item.voiceToneMatchScore}/100`);
    lines.push('Caption:');
    lines.push(item.voiceCaption);
    lines.push(`Hashtags: ${item.hashtags.join(' ')}`);

    if (item.translations?.hi) {
      lines.push('');
      lines.push('[Hindi Translation (हिन्दी)]');
      lines.push(`Title: ${item.translations.hi.title}`);
      lines.push('Caption:');
      lines.push(item.translations.hi.caption);
      lines.push(`Hashtags: ${item.translations.hi.hashtags.join(' ')}`);
    }

    if (item.translations?.bn) {
      lines.push('');
      lines.push('[Bengali Translation (বাংলা)]');
      lines.push(`Title: ${item.translations.bn.title}`);
      lines.push('Caption:');
      lines.push(item.translations.bn.caption);
      lines.push(`Hashtags: ${item.translations.bn.hashtags.join(' ')}`);
    }
  });

  lines.push('');
  return lines.join('\n');
}

export interface CreateExportZipParams {
  sourceFileName: string;
  selectedLanguage: SupportedLanguage;
  approvedCaptions: HighlightCaptionItem[];
  allCaptions: HighlightCaptionItem[];
  highlights: HighlightMoment[];
  clips: Record<string, RenderedClipItem>;
  thumbnails: Record<string, ThumbnailItem>;
}

export interface CreateExportZipResult {
  zipBlob: Blob;
  zipFileName: string;
  includedClips: number;
  includedThumbnails: number;
}

export async function createExportZipBundle({
  sourceFileName,
  selectedLanguage,
  approvedCaptions,
  allCaptions,
  highlights,
  clips,
  thumbnails,
}: CreateExportZipParams): Promise<CreateExportZipResult> {
  const zip = new JSZip();
  const clipsFolder = zip.folder('clips');
  const thumbnailsFolder = zip.folder('thumbnails');

  let includedClips = 0;
  let includedThumbnails = 0;

  for (let i = 0; i < approvedCaptions.length; i++) {
    const item = approvedCaptions[i];
    const slug = toSafeExportSlug(item.title, i);
    const clip = clips[item.highlightId];
    const thumbnail = thumbnails[item.highlightId];

    if (clip?.status === 'ready' && clip.clipUrl && clipsFolder) {
      const response = await fetch(clip.clipUrl);
      if (!response.ok) {
        throw new Error(`Could not read rendered clip ${i + 1} for bundling.`);
      }
      const clipBlob = await response.blob();
      clipsFolder.file(`clip-${slug}.mp4`, clipBlob);
      includedClips += 1;
    }

    if (thumbnail?.status === 'ready' && thumbnail.thumbnailUrl && thumbnailsFolder) {
      const response = await fetch(thumbnail.thumbnailUrl);
      if (!response.ok) {
        throw new Error(`Could not read thumbnail ${i + 1} for bundling.`);
      }
      const thumbBlob = await response.blob();
      thumbnailsFolder.file(`thumbnail-${slug}.png`, thumbBlob);
      includedThumbnails += 1;
    }
  }

  const captionsEditedCount = allCaptions.filter(
    (item) =>
      item.voiceCaption !== item.originalVoiceCaption ||
      item.title !== item.originalTitle
  ).length;

  const { labels: languages } = getPreparedLanguages(approvedCaptions);
  const estimatedMinutesSaved = includedClips * MINUTES_SAVED_PER_CLIP;

  const textContent = buildExportSummaryText({
    sourceFileName,
    selectedLanguage,
    approvedCaptions,
    highlights,
    clipsMadeCount: includedClips,
    captionsEditedCount,
    languages,
    estimatedMinutesSaved,
  });

  // Include UTF-8 BOM so Hindi/Bengali characters and emojis open reliably in all text editors
  zip.file('captions-and-translations.txt', `\uFEFF${textContent}`);

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const baseName = (sourceFileName || 'one-take-export')
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return {
    zipBlob,
    zipFileName: `${baseName || 'one-take'}-repurposed-bundle.zip`,
    includedClips,
    includedThumbnails,
  };
}
