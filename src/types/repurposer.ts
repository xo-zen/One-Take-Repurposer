export type WorkflowStepId = 'upload' | 'highlights' | 'captions' | 'clips' | 'export';

export type SupportedLanguage = 'en' | 'hi' | 'bn';

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export type TranscriptionStatus =
  | 'idle'
  | 'extracting'
  | 'transcribing'
  | 'success'
  | 'error';

export interface HighlightMoment {
  id: string;
  start: number;
  end: number;
  reason: string;
  hook_score: number;
}

export type HighlightsStatus = 'idle' | 'loading' | 'success' | 'error';

export type CaptionReviewStatus = 'pending' | 'approved' | 'rejected';

export interface TranslatedCaptionContent {
  title: string;
  caption: string;
  hashtags: string[];
}

export interface HighlightCaptionItem {
  highlightId: string;
  title: string;
  originalTitle: string;
  voiceCaption: string;
  originalVoiceCaption: string;
  hashtags: string[];
  voiceToneMatchScore: number;
  voiceToneMatchExplanation: string;
  genericCaption: string;
  genericToneMatchScore: number;
  genericToneMatchExplanation: string;
  reviewStatus: CaptionReviewStatus;
  translations: Partial<Record<'hi' | 'bn', TranslatedCaptionContent>>;
}

export type CaptionsStatus = 'idle' | 'loading' | 'success' | 'error';
export type TranslationStatus = 'idle' | 'loading' | 'success' | 'error';

export type ClipRenderStatus = 'idle' | 'loading-core' | 'rendering' | 'ready' | 'error';

export interface RenderedClipItem {
  highlightId: string;
  status: ClipRenderStatus;
  progress: number;
  clipUrl: string | null;
  clipSizeBytes: number | null;
  error: string | null;
}

export type ThumbnailStyleId = 'editorial-bottom' | 'bold-center' | 'top-headline';

export type ThumbnailStatus = 'idle' | 'generating' | 'ready' | 'error';

export interface ThumbnailItem {
  highlightId: string;
  status: ThumbnailStatus;
  selectedStyle: ThumbnailStyleId;
  capturedAtSeconds: number | null;
  frameDataUrl: string | null;
  renderedTitle: string;
  thumbnailUrl: string | null;
  error: string | null;
}

export interface UploadedVideoState {
  file: File | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  videoUrl: string | null;
  durationSeconds: number | null;
  extractionMode: 'audio-wav' | 'video-fallback' | null;
  transcript: TranscriptSegment[];
  transcriptionStatus: TranscriptionStatus;
  transcriptionError: string | null;
  highlights: HighlightMoment[];
  highlightsStatus: HighlightsStatus;
  highlightsError: string | null;
  voiceSamples: string;
  captions: HighlightCaptionItem[];
  captionsStatus: CaptionsStatus;
  captionsError: string | null;
  selectedLanguage: SupportedLanguage;
  translationStatus: TranslationStatus;
  translationError: string | null;
  clips: Record<string, RenderedClipItem>;
  thumbnails: Record<string, ThumbnailItem>;
}
