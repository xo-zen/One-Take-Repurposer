import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  Check,
  Upload,
  Sparkles,
  Captions,
  Scissors,
  Download,
  type LucideIcon,
} from 'lucide-react';
import { CaptionsStage } from './components/CaptionsStage';
import { ClipsStage } from './components/ClipsStage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExportStage } from './components/ExportStage';
import { HighlightsStage } from './components/HighlightsStage';
import { UploadStage } from './components/UploadStage';
import type {
  CaptionReviewStatus,
  HighlightCaptionItem,
  HighlightMoment,
  RenderedClipItem,
  SupportedLanguage,
  ThumbnailItem,
  ThumbnailStyleId,
  TranscriptSegment,
  TranslatedCaptionContent,
  UploadedVideoState,
  WorkflowStepId,
} from './types/repurposer';
import { getEffectiveCaptionContent } from './utils/captionLanguage';
import { createExportZipBundle } from './utils/exportBundle';
import {
  extractAudioOrFallback,
  readVideoDurationSeconds,
} from './utils/extractAudio';
import {
  captureBestFrameFromVideo,
  renderThumbnailWithStyle,
} from './utils/generateThumbnail';
import { renderVerticalClipWithSubtitles } from './utils/renderClip';
import {
  clearCachedClips,
  clearCachedWorkspace,
  deleteCachedClipBlob,
  loadCachedWorkspace,
  loadTranscriptCacheForFile,
  saveCachedClipBlob,
  saveCachedWorkspace,
  saveTranscriptCache,
} from './utils/workspaceCache';

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_DURATION_SECONDS = 300; // 5 minutes

interface WorkflowStep {
  id: WorkflowStepId;
  number: string;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: 'upload',
    number: '01',
    label: 'Upload',
    title: 'Upload Source Video',
    description:
      'Bring in your single long-form recording and define your creator voice before any repurposing begins.',
    icon: Upload,
  },
  {
    id: 'highlights',
    number: '02',
    label: 'Highlights',
    title: 'Review Key Highlights',
    description:
      'Inspect candidate moments surfaced from your recording and choose which segments move forward.',
    icon: Sparkles,
  },
  {
    id: 'captions',
    number: '03',
    label: 'Captions',
    title: 'Edit Captions & Translations',
    description:
      'Refine transcripts, captions, and localized text in your own voice before styling clips.',
    icon: Captions,
  },
  {
    id: 'clips',
    number: '04',
    label: 'Clips',
    title: 'Shape Shorts & Thumbnails',
    description:
      'Frame vertical shorts and thumbnail concepts while keeping final creative control.',
    icon: Scissors,
  },
  {
    id: 'export',
    number: '05',
    label: 'Export',
    title: 'Approve & Export',
    description:
      'Review every piece side by side. Nothing leaves your workspace without your explicit approval.',
    icon: Download,
  },
];

const INITIAL_VIDEO_STATE: UploadedVideoState = {
  file: null,
  fileName: '',
  fileSize: 0,
  mimeType: '',
  videoUrl: null,
  durationSeconds: null,
  extractionMode: null,
  transcript: [],
  transcriptionStatus: 'idle',
  transcriptionError: null,
  highlights: [],
  highlightsStatus: 'idle',
  highlightsError: null,
  voiceSamples: '',
  captions: [],
  captionsStatus: 'idle',
  captionsError: null,
  selectedLanguage: 'en',
  translationStatus: 'idle',
  translationError: null,
  clips: {},
  thumbnails: {},
};

function revokeAllClipUrls(clips: Record<string, RenderedClipItem>) {
  Object.values(clips).forEach((clip) => {
    if (clip.clipUrl) {
      URL.revokeObjectURL(clip.clipUrl);
    }
  });
}

function revokeAllThumbnailUrls(thumbnails: Record<string, ThumbnailItem>) {
  Object.values(thumbnails).forEach((thumb) => {
    if (thumb.thumbnailUrl) {
      URL.revokeObjectURL(thumb.thumbnailUrl);
    }
  });
}

function RepurposerShell() {
  const [activeStepId, setActiveStepId] = useState<WorkflowStepId>('upload');
  const [videoState, setVideoState] = useState<UploadedVideoState>(INITIAL_VIDEO_STATE);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isBatchRendering, setIsBatchRendering] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatusText, setExportStatusText] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastExportSummary, setLastExportSummary] = useState<{
    fileName: string;
    sizeBytes: number;
  } | null>(null);

  const [isCacheHydrated, setIsCacheHydrated] = useState(false);

  const activeRequestRef = useRef<AbortController | null>(null);
  const highlightsRequestRef = useRef<AbortController | null>(null);
  const captionsRequestRef = useRef<AbortController | null>(null);
  const translationsRequestRef = useRef<AbortController | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const clipsRef = useRef<Record<string, RenderedClipItem>>({});
  const thumbnailsRef = useRef<Record<string, ThumbnailItem>>({});
  const skipHydrationRef = useRef(false);

  useEffect(() => {
    videoUrlRef.current = videoState.videoUrl;
  }, [videoState.videoUrl]);

  useEffect(() => {
    clipsRef.current = videoState.clips;
  }, [videoState.clips]);

  useEffect(() => {
    thumbnailsRef.current = videoState.thumbnails;
  }, [videoState.thumbnails]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const restored = await loadCachedWorkspace();
      if (cancelled) {
        if (restored?.videoState.videoUrl) {
          URL.revokeObjectURL(restored.videoState.videoUrl);
        }
        if (restored?.videoState.clips) {
          revokeAllClipUrls(restored.videoState.clips);
        }
        return;
      }

      if (restored && !skipHydrationRef.current) {
        setActiveStepId(restored.activeStepId);
        setVideoState(restored.videoState);
      } else if (restored) {
        if (restored.videoState.videoUrl) {
          URL.revokeObjectURL(restored.videoState.videoUrl);
        }
        revokeAllClipUrls(restored.videoState.clips);
      }
      setIsCacheHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isCacheHydrated) return;
    if (!videoState.file && videoState.transcript.length === 0) return;

    const timer = window.setTimeout(() => {
      void saveCachedWorkspace(activeStepId, videoState);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isCacheHydrated, activeStepId, videoState]);

  useEffect(() => {
    return () => {
      activeRequestRef.current?.abort();
      highlightsRequestRef.current?.abort();
      captionsRequestRef.current?.abort();
      translationsRequestRef.current?.abort();
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
      }
      revokeAllClipUrls(clipsRef.current);
      revokeAllThumbnailUrls(thumbnailsRef.current);
    };
  }, []);

  const runTranscription = async (file: File, knownDurationSeconds: number) => {
    skipHydrationRef.current = true;
    void clearCachedClips();
    activeRequestRef.current?.abort();
    highlightsRequestRef.current?.abort();
    captionsRequestRef.current?.abort();
    translationsRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;

    revokeAllClipUrls(clipsRef.current);
    revokeAllThumbnailUrls(thumbnailsRef.current);

    setVideoState((prev) => ({
      ...prev,
      transcriptionStatus: 'extracting',
      transcriptionError: null,
      transcript: [],
      highlights: [],
      highlightsStatus: 'idle',
      highlightsError: null,
      captions: [],
      captionsStatus: 'idle',
      captionsError: null,
      selectedLanguage: 'en',
      translationStatus: 'idle',
      translationError: null,
      clips: {},
      thumbnails: {},
    }));

    try {
      const payload = await extractAudioOrFallback(file, knownDurationSeconds);
      if (controller.signal.aborted) return;

      setVideoState((prev) => ({
        ...prev,
        durationSeconds: payload.durationSeconds || prev.durationSeconds,
        extractionMode: payload.mode,
        transcriptionStatus: 'transcribing',
      }));

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': payload.mimeType,
          'X-Mime-Type': payload.mimeType,
          'X-Duration-Seconds': String(payload.durationSeconds || knownDurationSeconds || 0),
        },
        body: payload.blob,
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({}))) as {
        segments?: TranscriptSegment[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          data.error || 'Gemini could not transcribe this video. Please try again.'
        );
      }

      if (controller.signal.aborted) return;

      const segments = Array.isArray(data.segments) ? data.segments : [];
      const resolvedDuration = payload.durationSeconds || knownDurationSeconds || null;

      setVideoState((prev) => ({
        ...prev,
        transcript: segments,
        transcriptionStatus: 'success',
        transcriptionError: null,
      }));

      void saveTranscriptCache(file, {
        durationSeconds: resolvedDuration,
        extractionMode: payload.mode,
        transcript: segments,
      });
    } catch (err) {
      if (controller.signal.aborted) return;

      const rawMessage = err instanceof Error ? err.message : '';
      const friendlyMessage =
        rawMessage === 'DURATION_EXCEEDED'
          ? 'This video is longer than 5 minutes. Please choose a video that is 5 minutes or shorter.'
          : rawMessage || 'Could not transcribe the video. Please try again.';

      setVideoState((prev) => ({
        ...prev,
        transcriptionStatus: 'error',
        transcriptionError: friendlyMessage,
      }));
    }
  };

  const handleSelectVideo = async (file: File) => {
    skipHydrationRef.current = true;
    setValidationError(null);

    if (!file.type.startsWith('video/')) {
      setValidationError(
        'Please select a video file (such as MP4, WebM, or MOV).'
      );
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setValidationError(
        `This video is ${sizeMb} MB. Please choose a file that is 20 MB or smaller.`
      );
      return;
    }

    let durationSeconds = 0;
    try {
      durationSeconds = await readVideoDurationSeconds(file);
    } catch (err) {
      setValidationError(
        err instanceof Error
          ? err.message
          : 'Could not read this video file. Please try another format.'
      );
      return;
    }

    if (durationSeconds > MAX_DURATION_SECONDS) {
      const mins = Math.floor(durationSeconds / 60);
      const secs = Math.floor(durationSeconds % 60);
      setValidationError(
        `This video is ${mins}:${String(secs).padStart(
          2,
          '0'
        )} long. Videos must be 5 minutes (5:00) or shorter.`
      );
      return;
    }

    if (videoState.videoUrl) {
      URL.revokeObjectURL(videoState.videoUrl);
    }

    const nextVideoUrl = URL.createObjectURL(file);
    const cachedTranscript = await loadTranscriptCacheForFile(file);

    revokeAllClipUrls(clipsRef.current);
    revokeAllThumbnailUrls(thumbnailsRef.current);
    void clearCachedClips();
    setExportError(null);
    setLastExportSummary(null);

    if (cachedTranscript && cachedTranscript.transcript.length > 0) {
      setVideoState({
        file,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'video/mp4',
        videoUrl: nextVideoUrl,
        durationSeconds:
          cachedTranscript.durationSeconds ??
          (durationSeconds > 0 ? durationSeconds : null),
        extractionMode: cachedTranscript.extractionMode,
        transcript: cachedTranscript.transcript,
        transcriptionStatus: 'success',
        transcriptionError: null,
        highlights: [],
        highlightsStatus: 'idle',
        highlightsError: null,
        voiceSamples: videoState.voiceSamples,
        captions: [],
        captionsStatus: 'idle',
        captionsError: null,
        selectedLanguage: 'en',
        translationStatus: 'idle',
        translationError: null,
        clips: {},
        thumbnails: {},
      });
      return;
    }

    setVideoState({
      file,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'video/mp4',
      videoUrl: nextVideoUrl,
      durationSeconds: durationSeconds > 0 ? durationSeconds : null,
      extractionMode: null,
      transcript: [],
      transcriptionStatus: 'extracting',
      transcriptionError: null,
      highlights: [],
      highlightsStatus: 'idle',
      highlightsError: null,
      voiceSamples: videoState.voiceSamples,
      captions: [],
      captionsStatus: 'idle',
      captionsError: null,
      selectedLanguage: 'en',
      translationStatus: 'idle',
      translationError: null,
      clips: {},
      thumbnails: {},
    });

    void runTranscription(file, durationSeconds);
  };

  const handleRetryTranscription = () => {
    if (!videoState.file) return;
    void runTranscription(videoState.file, videoState.durationSeconds ?? 0);
  };

  const handleClearVideo = () => {
    skipHydrationRef.current = true;
    activeRequestRef.current?.abort();
    highlightsRequestRef.current?.abort();
    captionsRequestRef.current?.abort();
    translationsRequestRef.current?.abort();
    if (videoState.videoUrl) {
      URL.revokeObjectURL(videoState.videoUrl);
    }
    revokeAllClipUrls(clipsRef.current);
    revokeAllThumbnailUrls(thumbnailsRef.current);
    setValidationError(null);
    setExportError(null);
    setLastExportSummary(null);
    setVideoState(INITIAL_VIDEO_STATE);
    void clearCachedWorkspace();
  };

  const runFindHighlights = async (
    transcriptToAnalyze = videoState.transcript,
    durationSeconds = videoState.durationSeconds
  ) => {
    if (transcriptToAnalyze.length === 0) return;

    highlightsRequestRef.current?.abort();
    captionsRequestRef.current?.abort();
    translationsRequestRef.current?.abort();
    const controller = new AbortController();
    highlightsRequestRef.current = controller;

    revokeAllClipUrls(clipsRef.current);
    revokeAllThumbnailUrls(thumbnailsRef.current);
    void clearCachedClips();

    setVideoState((prev) => ({
      ...prev,
      highlightsStatus: 'loading',
      highlightsError: null,
      captions: [],
      captionsStatus: 'idle',
      captionsError: null,
      selectedLanguage: 'en',
      translationStatus: 'idle',
      translationError: null,
      clips: {},
      thumbnails: {},
    }));

    try {
      const response = await fetch('/api/highlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: transcriptToAnalyze,
          durationSeconds,
        }),
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({}))) as {
        highlights?: HighlightMoment[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          data.error || 'Gemini could not extract highlights. Please try again.'
        );
      }

      if (controller.signal.aborted) return;

      setVideoState((prev) => ({
        ...prev,
        highlights: Array.isArray(data.highlights) ? data.highlights : [],
        highlightsStatus: 'success',
        highlightsError: null,
      }));
    } catch (err) {
      if (controller.signal.aborted) return;

      const friendlyMessage =
        err instanceof Error && err.message
          ? err.message
          : 'Could not find highlights. Please try again.';

      setVideoState((prev) => ({
        ...prev,
        highlightsStatus: 'error',
        highlightsError: friendlyMessage,
      }));
    }
  };

  const handleDeleteHighlight = (id: string) => {
    const existingClip = clipsRef.current[id];
    if (existingClip?.clipUrl) {
      URL.revokeObjectURL(existingClip.clipUrl);
    }
    const existingThumb = thumbnailsRef.current[id];
    if (existingThumb?.thumbnailUrl) {
      URL.revokeObjectURL(existingThumb.thumbnailUrl);
    }
    void deleteCachedClipBlob(id);

    setVideoState((prev) => {
      const nextClips = { ...prev.clips };
      delete nextClips[id];
      const nextThumbnails = { ...prev.thumbnails };
      delete nextThumbnails[id];
      return {
        ...prev,
        highlights: prev.highlights.filter((item) => item.id !== id),
        captions: prev.captions.filter((item) => item.highlightId !== id),
        clips: nextClips,
        thumbnails: nextThumbnails,
      };
    });
  };

  const handleVoiceSamplesChange = (value: string) => {
    setVideoState((prev) => ({
      ...prev,
      voiceSamples: value,
    }));
  };

  const runGenerateCaptions = async () => {
    if (!videoState.voiceSamples.trim() || videoState.highlights.length === 0) {
      return;
    }

    captionsRequestRef.current?.abort();
    translationsRequestRef.current?.abort();
    const controller = new AbortController();
    captionsRequestRef.current = controller;

    revokeAllClipUrls(clipsRef.current);
    revokeAllThumbnailUrls(thumbnailsRef.current);
    void clearCachedClips();

    setVideoState((prev) => ({
      ...prev,
      captionsStatus: 'loading',
      captionsError: null,
      selectedLanguage: 'en',
      translationStatus: 'idle',
      translationError: null,
      clips: {},
      thumbnails: {},
    }));

    const payloadHighlights = videoState.highlights.map((hl) => {
      const overlapping = videoState.transcript.filter(
        (seg) => seg.end > hl.start && seg.start < hl.end
      );
      const transcriptText =
        overlapping.length > 0
          ? overlapping.map((seg) => seg.text).join(' ')
          : '';
      return {
        id: hl.id,
        start: hl.start,
        end: hl.end,
        reason: hl.reason,
        transcriptText,
      };
    });

    try {
      const response = await fetch('/api/captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          highlights: payloadHighlights,
          voiceSamples: videoState.voiceSamples,
        }),
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({}))) as {
        captions?: HighlightCaptionItem[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          data.error || 'Gemini could not generate captions. Please try again.'
        );
      }

      if (controller.signal.aborted) return;

      const rawCaptions = Array.isArray(data.captions) ? data.captions : [];
      const hydratedCaptions: HighlightCaptionItem[] = rawCaptions.map((item) => ({
        ...item,
        originalTitle: item.title,
        originalVoiceCaption: item.voiceCaption,
        reviewStatus: 'pending',
        translations: {},
      }));

      setVideoState((prev) => ({
        ...prev,
        captions: hydratedCaptions,
        captionsStatus: 'success',
        captionsError: null,
      }));
    } catch (err) {
      if (controller.signal.aborted) return;

      const friendlyMessage =
        err instanceof Error && err.message
          ? err.message
          : 'Could not generate captions. Please try again.';

      setVideoState((prev) => ({
        ...prev,
        captionsStatus: 'error',
        captionsError: friendlyMessage,
      }));
    }
  };

  const handleUpdateCaptionText = (
    highlightId: string,
    updates: { title?: string; voiceCaption?: string }
  ) => {
    setVideoState((prev) => ({
      ...prev,
      captions: prev.captions.map((item) =>
        item.highlightId === highlightId
          ? {
              ...item,
              ...(updates.title !== undefined ? { title: updates.title } : {}),
              ...(updates.voiceCaption !== undefined
                ? { voiceCaption: updates.voiceCaption }
                : {}),
              translations: {},
            }
          : item
      ),
    }));
  };

  const handleUpdateTranslatedText = (
    highlightId: string,
    language: 'hi' | 'bn',
    updates: { title?: string; caption?: string }
  ) => {
    setVideoState((prev) => ({
      ...prev,
      captions: prev.captions.map((item) => {
        if (item.highlightId !== highlightId) return item;
        const existingTranslation = item.translations?.[language];
        if (!existingTranslation) return item;
        return {
          ...item,
          translations: {
            ...item.translations,
            [language]: {
              ...existingTranslation,
              ...(updates.title !== undefined ? { title: updates.title } : {}),
              ...(updates.caption !== undefined ? { caption: updates.caption } : {}),
            },
          },
        };
      }),
    }));
  };

  const runTranslateCaptions = async (
    targetLanguage: 'hi' | 'bn',
    forceAll = false
  ) => {
    if (videoState.captions.length === 0) return;

    const itemsToTranslate = forceAll
      ? videoState.captions
      : videoState.captions.filter((item) => !item.translations?.[targetLanguage]);

    if (itemsToTranslate.length === 0) {
      setVideoState((prev) => ({
        ...prev,
        translationStatus: 'success',
        translationError: null,
      }));
      return;
    }

    translationsRequestRef.current?.abort();
    const controller = new AbortController();
    translationsRequestRef.current = controller;

    setVideoState((prev) => ({
      ...prev,
      translationStatus: 'loading',
      translationError: null,
    }));

    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetLanguage,
          voiceSamples: videoState.voiceSamples,
          items: itemsToTranslate.map((item) => ({
            highlightId: item.highlightId,
            title: item.title,
            caption: item.voiceCaption,
            hashtags: item.hashtags,
          })),
        }),
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({}))) as {
        translations?: Array<TranslatedCaptionContent & { highlightId: string }>;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          data.error || 'Gemini could not translate these captions. Please try again.'
        );
      }

      if (controller.signal.aborted) return;

      const returned = Array.isArray(data.translations) ? data.translations : [];
      const translationMap = new Map<string, TranslatedCaptionContent>();
      returned.forEach((entry) => {
        if (entry?.highlightId) {
          translationMap.set(entry.highlightId, {
            title: entry.title,
            caption: entry.caption,
            hashtags: Array.isArray(entry.hashtags) ? entry.hashtags : [],
          });
        }
      });

      setVideoState((prev) => ({
        ...prev,
        translationStatus: 'success',
        translationError: null,
        captions: prev.captions.map((item) => {
          const translated = translationMap.get(item.highlightId);
          if (!translated) return item;
          return {
            ...item,
            translations: {
              ...item.translations,
              [targetLanguage]: translated,
            },
          };
        }),
      }));
    } catch (err) {
      if (controller.signal.aborted) return;

      const friendlyMessage =
        err instanceof Error && err.message
          ? err.message
          : 'Could not translate captions. Please try again.';

      setVideoState((prev) => ({
        ...prev,
        translationStatus: 'error',
        translationError: friendlyMessage,
      }));
    }
  };

  const handleSelectLanguage = (language: SupportedLanguage) => {
    setExportError(null);
    setLastExportSummary(null);
    if (language === 'en') {
      translationsRequestRef.current?.abort();
      setVideoState((prev) => ({
        ...prev,
        selectedLanguage: 'en',
        translationStatus: 'idle',
        translationError: null,
      }));
      return;
    }

    const allTranslated = videoState.captions.every((item) =>
      Boolean(item.translations?.[language])
    );

    setVideoState((prev) => ({
      ...prev,
      selectedLanguage: language,
      translationStatus: allTranslated ? 'success' : 'loading',
      translationError: null,
    }));

    if (!allTranslated) {
      void runTranslateCaptions(language, false);
    }
  };

  const handleRetryTranslation = () => {
    if (videoState.selectedLanguage === 'en') return;
    void runTranslateCaptions(videoState.selectedLanguage, true);
  };

  const handleSetCaptionReview = (
    highlightId: string,
    status: CaptionReviewStatus
  ) => {
    setExportError(null);
    setLastExportSummary(null);
    setVideoState((prev) => ({
      ...prev,
      captions: prev.captions.map((item) =>
        item.highlightId === highlightId ? { ...item, reviewStatus: status } : item
      ),
    }));
  };

  const renderSingleClip = async (
    captionItem: HighlightCaptionItem,
    highlight: HighlightMoment
  ): Promise<RenderedClipItem> => {
    const sourceFile = videoState.file;
    if (!sourceFile) {
      const errorClip: RenderedClipItem = {
        highlightId: captionItem.highlightId,
        status: 'error',
        progress: 0,
        clipUrl: null,
        clipSizeBytes: null,
        error:
          'The source video file is no longer loaded. Please re-upload it in the Upload tab.',
      };
      setVideoState((prev) => ({
        ...prev,
        clips: {
          ...prev.clips,
          [captionItem.highlightId]: errorClip,
        },
      }));
      return errorClip;
    }

    const previousClip = clipsRef.current[captionItem.highlightId];
    if (previousClip?.clipUrl) {
      URL.revokeObjectURL(previousClip.clipUrl);
    }

    setVideoState((prev) => ({
      ...prev,
      clips: {
        ...prev.clips,
        [captionItem.highlightId]: {
          highlightId: captionItem.highlightId,
          status: 'loading-core',
          progress: 2,
          clipUrl: null,
          clipSizeBytes: null,
          error: null,
        },
      },
    }));

    const effective = getEffectiveCaptionContent(
      captionItem,
      videoState.selectedLanguage
    );

    try {
      const result = await renderVerticalClipWithSubtitles({
        file: sourceFile,
        start: highlight.start,
        end: highlight.end,
        captionText: effective.caption,
        onPhaseChange: (phase) => {
          setVideoState((prev) => ({
            ...prev,
            clips: {
              ...prev.clips,
              [captionItem.highlightId]: {
                ...(prev.clips[captionItem.highlightId] ?? {
                  highlightId: captionItem.highlightId,
                  progress: 2,
                  clipUrl: null,
                  clipSizeBytes: null,
                  error: null,
                }),
                status: phase,
              },
            },
          }));
        },
        onProgress: (percent) => {
          setVideoState((prev) => ({
            ...prev,
            clips: {
              ...prev.clips,
              [captionItem.highlightId]: {
                ...(prev.clips[captionItem.highlightId] ?? {
                  highlightId: captionItem.highlightId,
                  status: 'rendering',
                  clipUrl: null,
                  clipSizeBytes: null,
                  error: null,
                }),
                progress: percent,
              },
            },
          }));
        },
      });

      const readyClip: RenderedClipItem = {
        highlightId: captionItem.highlightId,
        status: 'ready',
        progress: 100,
        clipUrl: result.clipUrl,
        clipSizeBytes: result.sizeBytes,
        error: null,
      };

      setVideoState((prev) => ({
        ...prev,
        clips: {
          ...prev.clips,
          [captionItem.highlightId]: readyClip,
        },
      }));
      void saveCachedClipBlob(
        captionItem.highlightId,
        result.clipUrl,
        result.sizeBytes
      );
      return readyClip;
    } catch (err) {
      const errorMessage =
        err instanceof Error && err.message
          ? err.message
          : 'Could not render this clip in the browser. Please try again.';

      const errorClip: RenderedClipItem = {
        highlightId: captionItem.highlightId,
        status: 'error',
        progress: 0,
        clipUrl: null,
        clipSizeBytes: null,
        error: errorMessage,
      };

      setVideoState((prev) => ({
        ...prev,
        clips: {
          ...prev.clips,
          [captionItem.highlightId]: errorClip,
        },
      }));
      return errorClip;
    }
  };

  const handleRenderAllClips = async (onlyMissing = false) => {
    const approvedCaptions = videoState.captions.filter(
      (item) => item.reviewStatus === 'approved'
    );
    if (approvedCaptions.length === 0 || isBatchRendering) return;

    setExportError(null);
    setIsBatchRendering(true);
    try {
      for (const captionItem of approvedCaptions) {
        if (onlyMissing && clipsRef.current[captionItem.highlightId]?.status === 'ready') {
          continue;
        }
        const highlight = videoState.highlights.find(
          (h) => h.id === captionItem.highlightId
        );
        if (highlight) {
          await renderSingleClip(captionItem, highlight);
        }
      }
    } finally {
      setIsBatchRendering(false);
    }
  };

  const generateThumbnailForHighlight = async (
    captionItem: HighlightCaptionItem,
    highlight: HighlightMoment,
    styleOverride?: ThumbnailStyleId,
    forceRecapture = false
  ): Promise<ThumbnailItem> => {
    const existing = thumbnailsRef.current[captionItem.highlightId];
    const targetStyle: ThumbnailStyleId =
      styleOverride ?? existing?.selectedStyle ?? 'editorial-bottom';
    const effective = getEffectiveCaptionContent(
      captionItem,
      videoState.selectedLanguage
    );

    const currentVideoUrl = videoUrlRef.current;
    if (!currentVideoUrl) {
      const errorThumb: ThumbnailItem = {
        highlightId: captionItem.highlightId,
        status: 'error',
        selectedStyle: targetStyle,
        capturedAtSeconds: existing?.capturedAtSeconds ?? null,
        frameDataUrl: existing?.frameDataUrl ?? null,
        renderedTitle: effective.title,
        thumbnailUrl: null,
        error:
          'The source video is no longer loaded. Please re-upload it in the Upload tab.',
      };
      setVideoState((prev) => ({
        ...prev,
        thumbnails: {
          ...prev.thumbnails,
          [captionItem.highlightId]: errorThumb,
        },
      }));
      return errorThumb;
    }

    // Fast path: if frame was already captured and we aren't re-capturing, just re-composite the selected style
    if (!forceRecapture && existing?.frameDataUrl) {
      try {
        const nextUrl = await renderThumbnailWithStyle(
          existing.frameDataUrl,
          effective.title,
          targetStyle
        );
        if (existing.thumbnailUrl) {
          URL.revokeObjectURL(existing.thumbnailUrl);
        }
        const readyThumb: ThumbnailItem = {
          ...existing,
          status: 'ready',
          selectedStyle: targetStyle,
          renderedTitle: effective.title,
          thumbnailUrl: nextUrl,
          error: null,
        };
        setVideoState((prev) => ({
          ...prev,
          thumbnails: {
            ...prev.thumbnails,
            [captionItem.highlightId]: readyThumb,
          },
        }));
        return readyThumb;
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Could not update thumbnail style.';
        const errorThumb: ThumbnailItem = {
          ...existing,
          status: 'error',
          selectedStyle: targetStyle,
          error: message,
        };
        setVideoState((prev) => ({
          ...prev,
          thumbnails: {
            ...prev.thumbnails,
            [captionItem.highlightId]: errorThumb,
          },
        }));
        return errorThumb;
      }
    }

    if (existing?.thumbnailUrl) {
      URL.revokeObjectURL(existing.thumbnailUrl);
    }

    setVideoState((prev) => ({
      ...prev,
      thumbnails: {
        ...prev.thumbnails,
        [captionItem.highlightId]: {
          highlightId: captionItem.highlightId,
          status: 'generating',
          selectedStyle: targetStyle,
          capturedAtSeconds: null,
          frameDataUrl: null,
          renderedTitle: effective.title,
          thumbnailUrl: null,
          error: null,
        },
      },
    }));

    try {
      const captured = await captureBestFrameFromVideo(
        currentVideoUrl,
        highlight.start,
        highlight.end
      );
      const nextUrl = await renderThumbnailWithStyle(
        captured.frameDataUrl,
        effective.title,
        targetStyle
      );

      const readyThumb: ThumbnailItem = {
        highlightId: captionItem.highlightId,
        status: 'ready',
        selectedStyle: targetStyle,
        capturedAtSeconds: captured.capturedAtSeconds,
        frameDataUrl: captured.frameDataUrl,
        renderedTitle: effective.title,
        thumbnailUrl: nextUrl,
        error: null,
      };

      setVideoState((prev) => ({
        ...prev,
        thumbnails: {
          ...prev.thumbnails,
          [captionItem.highlightId]: readyThumb,
        },
      }));
      return readyThumb;
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Could not capture a thumbnail frame from this video.';

      const errorThumb: ThumbnailItem = {
        highlightId: captionItem.highlightId,
        status: 'error',
        selectedStyle: targetStyle,
        capturedAtSeconds: null,
        frameDataUrl: null,
        renderedTitle: effective.title,
        thumbnailUrl: null,
        error: message,
      };

      setVideoState((prev) => ({
        ...prev,
        thumbnails: {
          ...prev.thumbnails,
          [captionItem.highlightId]: errorThumb,
        },
      }));
      return errorThumb;
    }
  };

  const handleDownloadExportZip = async () => {
    const approvedCaptions = videoState.captions.filter(
      (item) => item.reviewStatus === 'approved'
    );
    if (approvedCaptions.length === 0 || isExporting) return;

    setExportError(null);
    setLastExportSummary(null);
    setIsExporting(true);

    try {
      const workingClips: Record<string, RenderedClipItem> = { ...videoState.clips };
      const workingThumbnails: Record<string, ThumbnailItem> = {
        ...videoState.thumbnails,
      };

      for (let i = 0; i < approvedCaptions.length; i++) {
        const captionItem = approvedCaptions[i];
        const highlight = videoState.highlights.find(
          (h) => h.id === captionItem.highlightId
        );
        if (!highlight) continue;

        const existingThumb = workingThumbnails[captionItem.highlightId];
        const effective = getEffectiveCaptionContent(
          captionItem,
          videoState.selectedLanguage
        );
        if (
          !existingThumb ||
          existingThumb.status !== 'ready' ||
          !existingThumb.thumbnailUrl ||
          existingThumb.renderedTitle !== effective.title
        ) {
          setExportStatusText(
            `Preparing thumbnail ${i + 1} of ${approvedCaptions.length}...`
          );
          const thumbResult = await generateThumbnailForHighlight(captionItem, highlight);
          workingThumbnails[captionItem.highlightId] = thumbResult;
        }

        const existingClip = workingClips[captionItem.highlightId];
        if (!existingClip || existingClip.status !== 'ready' || !existingClip.clipUrl) {
          setExportStatusText(
            `Rendering 9:16 clip ${i + 1} of ${approvedCaptions.length}...`
          );
          const clipResult = await renderSingleClip(captionItem, highlight);
          workingClips[captionItem.highlightId] = clipResult;
          if (clipResult.status !== 'ready') {
            throw new Error(
              clipResult.error ||
                `Could not render Clip 0${i + 1}. Fix or retry rendering in the Clips tab.`
            );
          }
        }
      }

      setExportStatusText('Bundling clips, thumbnails, and captions into ZIP...');
      const bundle = await createExportZipBundle({
        sourceFileName: videoState.fileName,
        selectedLanguage: videoState.selectedLanguage,
        approvedCaptions,
        allCaptions: videoState.captions,
        highlights: videoState.highlights,
        clips: workingClips,
        thumbnails: workingThumbnails,
      });

      const downloadUrl = URL.createObjectURL(bundle.zipBlob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = bundle.zipFileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

      setLastExportSummary({
        fileName: bundle.zipFileName,
        sizeBytes: bundle.zipBlob.size,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Could not build the export ZIP bundle. Please try again.';
      setExportError(message);
    } finally {
      setIsExporting(false);
      setExportStatusText(null);
    }
  };

  useEffect(() => {
    if (
      activeStepId === 'highlights' &&
      videoState.transcriptionStatus === 'success' &&
      videoState.transcript.length > 0 &&
      videoState.highlightsStatus === 'idle'
    ) {
      void runFindHighlights(videoState.transcript, videoState.durationSeconds);
    }
  }, [
    activeStepId,
    videoState.transcriptionStatus,
    videoState.transcript,
    videoState.highlightsStatus,
    videoState.durationSeconds,
  ]);

  useEffect(() => {
    if (
      (activeStepId !== 'clips' && activeStepId !== 'export') ||
      !videoState.videoUrl
    ) {
      return;
    }

    const approvedCaptions = videoState.captions.filter(
      (item) => item.reviewStatus === 'approved'
    );
    if (approvedCaptions.length === 0) return;

    const toGenerate = approvedCaptions.filter((item) => {
      const existing = videoState.thumbnails[item.highlightId];
      if (!existing || existing.status === 'idle') return true;
      const effective = getEffectiveCaptionContent(item, videoState.selectedLanguage);
      // Re-composite automatically if the creator edited the title or switched language
      if (existing.status === 'ready' && existing.renderedTitle !== effective.title) {
        return true;
      }
      return false;
    });

    if (toGenerate.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const captionItem of toGenerate) {
        if (cancelled) break;
        const highlight = videoState.highlights.find(
          (h) => h.id === captionItem.highlightId
        );
        if (highlight) {
          await generateThumbnailForHighlight(captionItem, highlight);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeStepId,
    videoState.videoUrl,
    videoState.captions,
    videoState.highlights,
    videoState.thumbnails,
    videoState.selectedLanguage,
  ]);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const next = WORKFLOW_STEPS[(index + 1) % WORKFLOW_STEPS.length];
      setActiveStepId(next.id);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const prev =
        WORKFLOW_STEPS[(index - 1 + WORKFLOW_STEPS.length) % WORKFLOW_STEPS.length];
      setActiveStepId(prev.id);
    }
  };

  const activeIndex = Math.max(
    0,
    WORKFLOW_STEPS.findIndex((step) => step.id === activeStepId)
  );
  const activeStep = WORKFLOW_STEPS[activeIndex] ?? WORKFLOW_STEPS[0];
  const approvedCaptions = videoState.captions.filter(
    (item) => item.reviewStatus === 'approved'
  );
  const completedSteps: Record<WorkflowStepId, boolean> = {
    upload:
      videoState.transcriptionStatus === 'success' &&
      videoState.transcript.length > 0,
    highlights: videoState.highlights.length > 0,
    captions: approvedCaptions.length > 0,
    clips:
      approvedCaptions.length > 0 &&
      approvedCaptions.every(
        (item) => videoState.clips[item.highlightId]?.status === 'ready'
      ),
    export: Boolean(lastExportSummary),
  };
  const progressPercent = ((activeIndex + 1) / WORKFLOW_STEPS.length) * 100;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      {/* Top Bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <a
              href="#top"
              onClick={(e) => {
                e.preventDefault();
                setActiveStepId('upload');
              }}
              className="font-display text-xl font-bold tracking-tight text-slate-900 inline-block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 rounded"
            >
              One-Take Repurposer
            </a>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Turn one long video into shorts, captions, thumbnails, and translations in
              your voice.
            </p>
          </div>

          <p className="font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap shrink-0">
            Step {activeStep.number} of 0{WORKFLOW_STEPS.length} · {activeStep.label}
          </p>
        </div>
      </header>

      {/* Left-to-Right Step Progress Bar & Workflow Tabs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 pt-3 pb-3.5 space-y-2.5">
          <nav
            aria-label="Repurposing workflow steps"
            role="tablist"
            className="flex md:grid md:grid-cols-5 items-stretch gap-2 overflow-x-auto"
          >
            {WORKFLOW_STEPS.map((step, index) => {
              const StepIcon = step.icon;
              const isActive = step.id === activeStepId;
              const isDone = completedSteps[step.id];

              return (
                <button
                  key={step.id}
                  type="button"
                  role="tab"
                  id={`tab-${step.id}`}
                  aria-selected={isActive}
                  aria-controls={`panel-${step.id}`}
                  onClick={() => setActiveStepId(step.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, index)}
                  className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : isDone
                      ? 'bg-slate-50 text-slate-900 hover:bg-slate-100 border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <span
                      className={`font-mono text-xs tabular-nums ${
                        isActive
                          ? 'text-slate-300'
                          : isDone
                          ? 'text-emerald-700 font-semibold'
                          : 'text-slate-400'
                      }`}
                    >
                      {step.number}
                    </span>
                    <StepIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{step.label}</span>
                  </span>

                  {isDone && (
                    <Check
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isActive ? 'text-emerald-400' : 'text-emerald-600'
                      }`}
                      aria-label="Completed"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Continuous Step Progress Bar */}
          <div
            role="progressbar"
            aria-label="Workflow step progress"
            aria-valuemin={1}
            aria-valuemax={WORKFLOW_STEPS.length}
            aria-valuenow={activeIndex + 1}
            className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden"
          >
            <div
              className="h-full bg-slate-900 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Stage Workspace */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {activeStepId === 'upload' ? (
          <section
            role="tabpanel"
            id="panel-upload"
            aria-labelledby="tab-upload"
          >
            <UploadStage
              videoState={videoState}
              onSelectVideo={handleSelectVideo}
              onRetryTranscription={handleRetryTranscription}
              onClearVideo={handleClearVideo}
              validationError={validationError}
              onDismissValidationError={() => setValidationError(null)}
            />
          </section>
        ) : activeStepId === 'highlights' ? (
          <section
            role="tabpanel"
            id="panel-highlights"
            aria-labelledby="tab-highlights"
          >
            <HighlightsStage
              videoState={videoState}
              onFindHighlights={() => void runFindHighlights()}
              onDeleteHighlight={handleDeleteHighlight}
              onGoToUpload={() => setActiveStepId('upload')}
            />
          </section>
        ) : activeStepId === 'captions' ? (
          <section
            role="tabpanel"
            id="panel-captions"
            aria-labelledby="tab-captions"
          >
            <CaptionsStage
              videoState={videoState}
              onVoiceSamplesChange={handleVoiceSamplesChange}
              onGenerateCaptions={() => void runGenerateCaptions()}
              onUpdateCaptionText={handleUpdateCaptionText}
              onUpdateTranslatedText={handleUpdateTranslatedText}
              onSelectLanguage={handleSelectLanguage}
              onRetryTranslation={handleRetryTranslation}
              onSetCaptionReview={handleSetCaptionReview}
              onGoToUpload={() => setActiveStepId('upload')}
              onGoToHighlights={() => setActiveStepId('highlights')}
              onGoToClips={() => setActiveStepId('clips')}
            />
          </section>
        ) : activeStepId === 'clips' ? (
          <section
            role="tabpanel"
            id="panel-clips"
            aria-labelledby="tab-clips"
          >
            <ClipsStage
              videoState={videoState}
              isBatchRendering={isBatchRendering}
              onRenderClip={(captionItem, highlight) =>
                void renderSingleClip(captionItem, highlight)
              }
              onRenderAllClips={() => void handleRenderAllClips()}
              onSelectThumbnailStyle={(captionItem, highlight, style) =>
                void generateThumbnailForHighlight(captionItem, highlight, style)
              }
              onRegenerateThumbnail={(captionItem, highlight) =>
                void generateThumbnailForHighlight(captionItem, highlight, undefined, true)
              }
              onGoToCaptions={() => setActiveStepId('captions')}
            />
          </section>
        ) : (
          <section
            role="tabpanel"
            id="panel-export"
            aria-labelledby="tab-export"
          >
            <ExportStage
              videoState={videoState}
              isExporting={isExporting}
              exportStatusText={exportStatusText}
              exportError={exportError}
              lastExportSummary={lastExportSummary}
              isBatchRendering={isBatchRendering}
              onDownloadExportZip={() => void handleDownloadExportZip()}
              onRenderMissingClips={() => void handleRenderAllClips(true)}
              onGoToUpload={() => setActiveStepId('upload')}
              onGoToCaptions={() => setActiveStepId('captions')}
              onGoToClips={() => setActiveStepId('clips')}
            />
          </section>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <RepurposerShell />
    </ErrorBoundary>
  );
}
