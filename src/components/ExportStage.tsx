import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Package,
} from 'lucide-react';
import type { UploadedVideoState } from '../types/repurposer';
import { getEffectiveCaptionContent } from '../utils/captionLanguage';
import {
  MINUTES_SAVED_PER_CLIP,
  formatEditingTimeSaved,
  getPreparedLanguages,
} from '../utils/exportBundle';
import { formatFileSize, formatTimestamp } from '../utils/formatTime';

interface ExportStageProps {
  videoState: UploadedVideoState;
  isExporting: boolean;
  exportStatusText: string | null;
  exportError: string | null;
  lastExportSummary: { fileName: string; sizeBytes: number } | null;
  isBatchRendering: boolean;
  onDownloadExportZip: () => void;
  onRenderMissingClips: () => void;
  onGoToUpload: () => void;
  onGoToCaptions: () => void;
  onGoToClips: () => void;
}

export function ExportStage({
  videoState,
  isExporting,
  exportStatusText,
  exportError,
  lastExportSummary,
  isBatchRendering,
  onDownloadExportZip,
  onRenderMissingClips,
  onGoToUpload,
  onGoToCaptions,
  onGoToClips,
}: ExportStageProps) {
  const hasTranscript =
    videoState.transcriptionStatus === 'success' && videoState.transcript.length > 0;
  const approvedCaptions = videoState.captions.filter(
    (item) => item.reviewStatus === 'approved'
  );

  if (!hasTranscript) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 md:p-14 min-h-[420px] flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center mb-5">
          <Download className="w-5 h-5" aria-hidden="true" />
        </div>

        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 mb-2 text-balance max-w-md">
          Upload a video to start repurposing
        </h1>

        <p className="text-sm text-slate-600 leading-relaxed max-w-md mb-7">
          Nothing is exported without your approval. Start by uploading a video, finding
          highlights, and approving your captions.
        </p>

        <button
          type="button"
          onClick={onGoToUpload}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Go to Upload
        </button>
      </div>
    );
  }

  if (approvedCaptions.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 md:p-14 min-h-[420px] flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center mb-5">
          <Download className="w-5 h-5" aria-hidden="true" />
        </div>

        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 mb-2 text-balance max-w-md">
          Approve items before exporting
        </h1>

        <p className="text-sm text-slate-600 leading-relaxed max-w-md mb-7">
          Nothing leaves your workspace without your explicit approval. Review and approve
          your captions first to build your export bundle.
        </p>

        <button
          type="button"
          onClick={onGoToCaptions}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Go to Captions
        </button>
      </div>
    );
  }

  const readyClipsCount = approvedCaptions.filter(
    (item) => videoState.clips[item.highlightId]?.status === 'ready'
  ).length;
  const readyThumbnailsCount = approvedCaptions.filter(
    (item) => videoState.thumbnails[item.highlightId]?.status === 'ready'
  ).length;
  const missingClipsCount = approvedCaptions.length - readyClipsCount;

  const totalCaptionsCount = videoState.captions.length;
  const editedCaptionsCount = videoState.captions.filter(
    (item) =>
      item.voiceCaption !== item.originalVoiceCaption ||
      item.title !== item.originalTitle
  ).length;

  const { labels: preparedLanguages } = getPreparedLanguages(approvedCaptions);
  const estimatedMinutesSaved = readyClipsCount * MINUTES_SAVED_PER_CLIP;
  const potentialMinutesSaved = approvedCaptions.length * MINUTES_SAVED_PER_CLIP;
  const excludedCount = videoState.captions.length - approvedCaptions.length;

  const anyClipRendering =
    isBatchRendering ||
    Object.values(videoState.clips).some(
      (clip) => clip.status === 'loading-core' || clip.status === 'rendering'
    );
  const isBusy = isExporting || anyClipRendering;

  return (
    <div className="space-y-6">
      {/* Export Summary Metrics */}
      <section
        aria-label="Export summary"
        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <div className="p-6">
            <p className="text-xs font-medium text-slate-500">Clips Made</p>
            <p className="mt-2 font-display text-2xl font-bold tracking-tight tabular-nums text-slate-900">
              {readyClipsCount}
            </p>
            <p className="mt-1 font-mono text-xs tabular-nums text-slate-500">
              of {approvedCaptions.length} approved
            </p>
          </div>

          <div className="p-6">
            <p className="text-xs font-medium text-slate-500">Captions Edited</p>
            <p className="mt-2 font-display text-2xl font-bold tracking-tight tabular-nums text-slate-900">
              {editedCaptionsCount}
            </p>
            <p className="mt-1 font-mono text-xs tabular-nums text-slate-500">
              of {totalCaptionsCount} generated
            </p>
          </div>

          <div className="p-6">
            <p className="text-xs font-medium text-slate-500">Languages</p>
            <p className="mt-2 font-display text-lg font-bold tracking-tight text-slate-900">
              {preparedLanguages.join(', ')}
            </p>
            <p className="mt-1 font-mono text-xs tabular-nums text-slate-500">
              {preparedLanguages.length}{' '}
              {preparedLanguages.length === 1 ? 'language' : 'languages'} included
            </p>
          </div>

          <div className="p-6">
            <p className="text-xs font-medium text-slate-500">
              Estimated Editing Time Saved
            </p>
            <p className="mt-2 font-display text-2xl font-bold tracking-tight tabular-nums text-slate-900">
              {formatEditingTimeSaved(
                readyClipsCount > 0 ? estimatedMinutesSaved : potentialMinutesSaved
              )}
            </p>
            <p className="mt-1 font-mono text-xs tabular-nums text-slate-500">
              {readyClipsCount > 0
                ? `${MINUTES_SAVED_PER_CLIP} min per clip made`
                : `${MINUTES_SAVED_PER_CLIP} min × ${approvedCaptions.length} approved once rendered`}
            </p>
          </div>
        </div>
      </section>

      {/* Bundle Action Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-slate-700" aria-hidden="true" />
              <h1 className="font-display text-lg font-semibold text-slate-900">
                Download Approved Export Bundle
              </h1>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed max-w-2xl">
              Packages all approved 9:16 MP4 clips, PNG thumbnails, and a UTF-8 text file
              containing titles, captions, hashtags, English originals, and translations
              into one ZIP archive.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {missingClipsCount > 0 && (
              <button
                type="button"
                onClick={onRenderMissingClips}
                disabled={isBusy || !videoState.file}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <Film className="w-3.5 h-3.5" aria-hidden="true" />
                Render {missingClipsCount} Missing{' '}
                {missingClipsCount === 1 ? 'Clip' : 'Clips'}
              </button>
            )}

            <button
              type="button"
              onClick={onDownloadExportZip}
              disabled={isBusy}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Preparing ZIP...
                </>
              ) : anyClipRendering ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Rendering Clips...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" aria-hidden="true" />
                  Download Export ZIP
                </>
              )}
            </button>
          </div>
        </div>

        {/* Bundle Contents Summary Line */}
        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600 font-mono tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            clips/ ({readyClipsCount}/{approvedCaptions.length} MP4 ready)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            thumbnails/ ({readyThumbnailsCount}/{approvedCaptions.length} PNG ready)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            captions-and-translations.txt ({preparedLanguages.length}{' '}
            {preparedLanguages.length === 1 ? 'language' : 'languages'})
          </span>
        </div>

        {isBusy && exportStatusText && (
          <div
            aria-live="polite"
            className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 flex items-center gap-2.5 text-xs font-medium text-slate-700"
          >
            <Loader2
              className="w-4 h-4 text-blue-600 animate-spin shrink-0"
              aria-hidden="true"
            />
            <span>{exportStatusText}</span>
          </div>
        )}

        {exportError && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-2.5"
          >
            <AlertCircle
              className="w-4 h-4 text-red-600 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-xs text-red-800 leading-relaxed">{exportError}</p>
          </div>
        )}

        {lastExportSummary && !isBusy && !exportError && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 text-xs text-emerald-900">
              <CheckCircle2
                className="w-4 h-4 text-emerald-600 shrink-0"
                aria-hidden="true"
              />
              <span>
                Downloaded{' '}
                <span className="font-mono font-medium">
                  {lastExportSummary.fileName}
                </span>{' '}
                ({formatFileSize(lastExportSummary.sizeBytes)})
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Approved Deliverables Checklist */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Approved Deliverables ({approvedCaptions.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Only highlights you approved in Captions are included in this export.
            </p>
          </div>

          <button
            type="button"
            onClick={onGoToClips}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            Adjust clips &amp; thumbnails
          </button>
        </div>

        <div className="divide-y divide-slate-200">
          {approvedCaptions.map((captionItem, index) => {
            const highlight = videoState.highlights.find(
              (h) => h.id === captionItem.highlightId
            );
            const clip = videoState.clips[captionItem.highlightId];
            const thumbnail = videoState.thumbnails[captionItem.highlightId];
            const effective = getEffectiveCaptionContent(
              captionItem,
              videoState.selectedLanguage
            );

            const itemLanguages = ['English'];
            if (captionItem.translations?.hi) itemLanguages.push('Hindi');
            if (captionItem.translations?.bn) itemLanguages.push('Bengali');

            const clipStatusLabel =
              clip?.status === 'ready'
                ? `MP4 ready${
                    clip.clipSizeBytes ? ` (${formatFileSize(clip.clipSizeBytes)})` : ''
                  }`
                : clip?.status === 'rendering'
                ? `Rendering ${clip.progress}%`
                : clip?.status === 'loading-core'
                ? 'Loading FFmpeg...'
                : clip?.status === 'error'
                ? 'Render failed'
                : 'Will render for ZIP';

            const thumbStatusLabel =
              thumbnail?.status === 'ready'
                ? 'Thumbnail PNG ready'
                : thumbnail?.status === 'generating'
                ? 'Capturing thumbnail...'
                : thumbnail?.status === 'error'
                ? 'Thumbnail failed'
                : 'Will capture for ZIP';

            return (
              <div
                key={captionItem.highlightId}
                className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-4 min-w-0">
                  <div className="w-11 aspect-[9/16] rounded bg-slate-900 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                    {thumbnail?.status === 'ready' && thumbnail.thumbnailUrl ? (
                      <img
                        src={thumbnail.thumbnailUrl}
                        alt={`Thumbnail preview for ${effective.title}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon
                        className="w-4 h-4 text-slate-500"
                        aria-hidden="true"
                      />
                    )}
                  </div>

                  <div className="min-w-0 space-y-1">
                    <p className="font-mono text-xs tabular-nums text-slate-500">
                      Clip 0{index + 1}
                      {highlight
                        ? ` · ${formatTimestamp(highlight.start)} – ${formatTimestamp(
                            highlight.end
                          )}`
                        : ''}
                    </p>
                    <p
                      lang={effective.language}
                      className="font-display text-sm font-semibold text-slate-900 truncate"
                    >
                      {effective.title}
                    </p>
                    {effective.language !== 'en' && (
                      <p className="text-xs text-slate-500 truncate">
                        English: {captionItem.title}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap sm:flex-col sm:items-end gap-1.5 text-xs font-mono tabular-nums shrink-0">
                  <span
                    className={
                      clip?.status === 'ready'
                        ? 'text-emerald-700 font-medium'
                        : clip?.status === 'error'
                        ? 'text-red-600 font-medium'
                        : 'text-slate-600'
                    }
                  >
                    {clipStatusLabel}
                  </span>
                  <span
                    className={
                      thumbnail?.status === 'ready'
                        ? 'text-emerald-700'
                        : thumbnail?.status === 'error'
                        ? 'text-red-600'
                        : 'text-slate-500'
                    }
                  >
                    {thumbStatusLabel} · {itemLanguages.join(', ')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {excludedCount > 0 && (
          <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
            {excludedCount} unapproved {excludedCount === 1 ? 'highlight' : 'highlights'}{' '}
            excluded — nothing leaves your workspace without your approval.
          </div>
        )}
      </section>
    </div>
  );
}
