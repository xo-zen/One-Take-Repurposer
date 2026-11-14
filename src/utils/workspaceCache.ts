import type {
  CaptionsStatus,
  HighlightCaptionItem,
  HighlightMoment,
  HighlightsStatus,
  RenderedClipItem,
  SupportedLanguage,
  ThumbnailItem,
  TranscriptSegment,
  UploadedVideoState,
  WorkflowStepId,
} from '../types/repurposer';

const DB_NAME = 'one-take-repurposer-cache';
const DB_VERSION = 1;
const STORE_WORKSPACE = 'workspace';
const STORE_CLIPS = 'clips';
const STORE_TRANSCRIPTS = 'transcriptCache';
const WORKSPACE_KEY = 'current';

interface CachedThumbnailMeta {
  highlightId: string;
  selectedStyle: ThumbnailItem['selectedStyle'];
  capturedAtSeconds: number | null;
  frameDataUrl: string | null;
  renderedTitle: string;
}

interface CachedWorkspaceRecord {
  id: string;
  updatedAt: number;
  activeStepId: WorkflowStepId;
  file: File | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  durationSeconds: number | null;
  extractionMode: UploadedVideoState['extractionMode'];
  transcript: TranscriptSegment[];
  transcriptionStatus: UploadedVideoState['transcriptionStatus'];
  highlights: HighlightMoment[];
  highlightsStatus: HighlightsStatus;
  voiceSamples: string;
  captions: HighlightCaptionItem[];
  captionsStatus: CaptionsStatus;
  selectedLanguage: SupportedLanguage;
  thumbnails: Record<string, CachedThumbnailMeta>;
}

interface CachedClipRecord {
  highlightId: string;
  blob: Blob;
  sizeBytes: number;
}

export interface CachedTranscriptRecord {
  fingerprint: string;
  fileName: string;
  fileSize: number;
  durationSeconds: number | null;
  extractionMode: UploadedVideoState['extractionMode'];
  transcript: TranscriptSegment[];
  cachedAt: number;
}

export function getFileFingerprint(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_WORKSPACE)) {
          db.createObjectStore(STORE_WORKSPACE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_CLIPS)) {
          db.createObjectStore(STORE_CLIPS, { keyPath: 'highlightId' });
        }
        if (!db.objectStoreNames.contains(STORE_TRANSCRIPTS)) {
          db.createObjectStore(STORE_TRANSCRIPTS, { keyPath: 'fingerprint' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function normalizeTranscriptionStatus(
  status: UploadedVideoState['transcriptionStatus'],
  transcript: TranscriptSegment[]
): UploadedVideoState['transcriptionStatus'] {
  if (status === 'success' && transcript.length > 0) return 'success';
  if (status === 'success') return 'success';
  return 'idle';
}

export async function loadCachedWorkspace(): Promise<{
  activeStepId: WorkflowStepId;
  videoState: UploadedVideoState;
} | null> {
  const db = await openCacheDb();
  if (!db) return null;

  try {
    const workspaceRecord = await new Promise<CachedWorkspaceRecord | undefined>(
      (resolve) => {
        const tx = db.transaction(STORE_WORKSPACE, 'readonly');
        const store = tx.objectStore(STORE_WORKSPACE);
        const req = store.get(WORKSPACE_KEY);
        req.onsuccess = () => resolve(req.result as CachedWorkspaceRecord | undefined);
        req.onerror = () => resolve(undefined);
      }
    );

    if (!workspaceRecord || (!workspaceRecord.file && workspaceRecord.transcript.length === 0)) {
      db.close();
      return null;
    }

    const clipRecords = await new Promise<CachedClipRecord[]>((resolve) => {
      const tx = db.transaction(STORE_CLIPS, 'readonly');
      const store = tx.objectStore(STORE_CLIPS);
      const req = store.getAll();
      req.onsuccess = () =>
        resolve(Array.isArray(req.result) ? (req.result as CachedClipRecord[]) : []);
      req.onerror = () => resolve([]);
    });

    db.close();

    const restoredFile = workspaceRecord.file ?? null;
    const restoredVideoUrl = restoredFile ? URL.createObjectURL(restoredFile) : null;
    const restoredTranscript = Array.isArray(workspaceRecord.transcript)
      ? workspaceRecord.transcript
      : [];
    const restoredHighlights = Array.isArray(workspaceRecord.highlights)
      ? workspaceRecord.highlights
      : [];
    const restoredCaptions = Array.isArray(workspaceRecord.captions)
      ? workspaceRecord.captions.map((item) => ({
          ...item,
          translations: item.translations ?? {},
        }))
      : [];

    const restoredClips: Record<string, RenderedClipItem> = {};
    for (const clip of clipRecords) {
      if (clip?.highlightId && clip.blob instanceof Blob) {
        restoredClips[clip.highlightId] = {
          highlightId: clip.highlightId,
          status: 'ready',
          progress: 100,
          clipUrl: URL.createObjectURL(clip.blob),
          clipSizeBytes: clip.sizeBytes || clip.blob.size,
          error: null,
        };
      }
    }

    const restoredThumbnails: Record<string, ThumbnailItem> = {};
    const savedThumbs = workspaceRecord.thumbnails ?? {};
    for (const [highlightId, thumbMeta] of Object.entries(savedThumbs)) {
      if (thumbMeta?.frameDataUrl) {
        restoredThumbnails[highlightId] = {
          highlightId,
          status: 'idle',
          selectedStyle: thumbMeta.selectedStyle ?? 'editorial-bottom',
          capturedAtSeconds: thumbMeta.capturedAtSeconds ?? null,
          frameDataUrl: thumbMeta.frameDataUrl,
          renderedTitle: thumbMeta.renderedTitle ?? '',
          thumbnailUrl: null,
          error: null,
        };
      }
    }

    const transcriptionStatus = normalizeTranscriptionStatus(
      workspaceRecord.transcriptionStatus,
      restoredTranscript
    );

    const highlightsStatus: HighlightsStatus =
      workspaceRecord.highlightsStatus === 'success' && restoredHighlights.length > 0
        ? 'success'
        : 'idle';

    const captionsStatus: CaptionsStatus =
      workspaceRecord.captionsStatus === 'success' && restoredCaptions.length > 0
        ? 'success'
        : 'idle';

    return {
      activeStepId: workspaceRecord.activeStepId || 'upload',
      videoState: {
        file: restoredFile,
        fileName: workspaceRecord.fileName || '',
        fileSize: workspaceRecord.fileSize || 0,
        mimeType: workspaceRecord.mimeType || '',
        videoUrl: restoredVideoUrl,
        durationSeconds: workspaceRecord.durationSeconds ?? null,
        extractionMode: workspaceRecord.extractionMode ?? null,
        transcript: restoredTranscript,
        transcriptionStatus,
        transcriptionError: null,
        highlights: restoredHighlights,
        highlightsStatus,
        highlightsError: null,
        voiceSamples: workspaceRecord.voiceSamples || '',
        captions: restoredCaptions,
        captionsStatus,
        captionsError: null,
        selectedLanguage: workspaceRecord.selectedLanguage || 'en',
        translationStatus: 'idle',
        translationError: null,
        clips: restoredClips,
        thumbnails: restoredThumbnails,
      },
    };
  } catch {
    try {
      db.close();
    } catch {
      // Ignore close failure
    }
    return null;
  }
}

export async function saveCachedWorkspace(
  activeStepId: WorkflowStepId,
  videoState: UploadedVideoState
): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;

  try {
    const thumbnailMetaMap: Record<string, CachedThumbnailMeta> = {};
    for (const [highlightId, thumb] of Object.entries(videoState.thumbnails)) {
      if (thumb?.frameDataUrl) {
        thumbnailMetaMap[highlightId] = {
          highlightId,
          selectedStyle: thumb.selectedStyle,
          capturedAtSeconds: thumb.capturedAtSeconds,
          frameDataUrl: thumb.frameDataUrl,
          renderedTitle: thumb.renderedTitle,
        };
      }
    }

    const record: CachedWorkspaceRecord = {
      id: WORKSPACE_KEY,
      updatedAt: Date.now(),
      activeStepId,
      file: videoState.file,
      fileName: videoState.fileName,
      fileSize: videoState.fileSize,
      mimeType: videoState.mimeType,
      durationSeconds: videoState.durationSeconds,
      extractionMode: videoState.extractionMode,
      transcript: videoState.transcript,
      transcriptionStatus: videoState.transcriptionStatus,
      highlights: videoState.highlights,
      highlightsStatus: videoState.highlightsStatus,
      voiceSamples: videoState.voiceSamples,
      captions: videoState.captions,
      captionsStatus: videoState.captionsStatus,
      selectedLanguage: videoState.selectedLanguage,
      thumbnails: thumbnailMetaMap,
    };

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_WORKSPACE, 'readwrite');
      tx.objectStore(STORE_WORKSPACE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore storage quota or private-mode errors
  } finally {
    try {
      db.close();
    } catch {
      // Ignore
    }
  }
}

export async function saveCachedClipBlob(
  highlightId: string,
  clipUrl: string,
  sizeBytes: number
): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;

  try {
    const response = await fetch(clipUrl);
    if (!response.ok) return;
    const blob = await response.blob();

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_CLIPS, 'readwrite');
      tx.objectStore(STORE_CLIPS).put({
        highlightId,
        blob,
        sizeBytes: sizeBytes || blob.size,
      } satisfies CachedClipRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore storage errors
  } finally {
    try {
      db.close();
    } catch {
      // Ignore
    }
  }
}

export async function deleteCachedClipBlob(highlightId: string): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;

  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_CLIPS, 'readwrite');
      tx.objectStore(STORE_CLIPS).delete(highlightId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore
  } finally {
    try {
      db.close();
    } catch {
      // Ignore
    }
  }
}

export async function clearCachedClips(): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;

  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_CLIPS, 'readwrite');
      tx.objectStore(STORE_CLIPS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore
  } finally {
    try {
      db.close();
    } catch {
      // Ignore
    }
  }
}

export async function clearCachedWorkspace(): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;

  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction([STORE_WORKSPACE, STORE_CLIPS], 'readwrite');
      tx.objectStore(STORE_WORKSPACE).delete(WORKSPACE_KEY);
      tx.objectStore(STORE_CLIPS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore
  } finally {
    try {
      db.close();
    } catch {
      // Ignore
    }
  }
}

export async function saveTranscriptCache(
  file: File,
  data: {
    durationSeconds: number | null;
    extractionMode: UploadedVideoState['extractionMode'];
    transcript: TranscriptSegment[];
  }
): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;

  try {
    const record: CachedTranscriptRecord = {
      fingerprint: getFileFingerprint(file),
      fileName: file.name,
      fileSize: file.size,
      durationSeconds: data.durationSeconds,
      extractionMode: data.extractionMode,
      transcript: data.transcript,
      cachedAt: Date.now(),
    };

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_TRANSCRIPTS, 'readwrite');
      tx.objectStore(STORE_TRANSCRIPTS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore
  } finally {
    try {
      db.close();
    } catch {
      // Ignore
    }
  }
}

export async function loadTranscriptCacheForFile(
  file: File
): Promise<CachedTranscriptRecord | null> {
  const db = await openCacheDb();
  if (!db) return null;

  try {
    const fingerprint = getFileFingerprint(file);
    const record = await new Promise<CachedTranscriptRecord | undefined>((resolve) => {
      const tx = db.transaction(STORE_TRANSCRIPTS, 'readonly');
      const req = tx.objectStore(STORE_TRANSCRIPTS).get(fingerprint);
      req.onsuccess = () => resolve(req.result as CachedTranscriptRecord | undefined);
      req.onerror = () => resolve(undefined);
    });
    return record ?? null;
  } catch {
    return null;
  } finally {
    try {
      db.close();
    } catch {
      // Ignore
    }
  }
}
