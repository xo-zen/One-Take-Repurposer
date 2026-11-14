import {
  AlertCircle,
  ArrowLeft,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Scissors,
} from 'lucide-react';
import type {
  HighlightCaptionItem,
  HighlightMoment,
  RenderedClipItem,
  ThumbnailItem,
  ThumbnailStyleId,
  UploadedVideoState,
} from '../types/repurposer';
import {
  getEffectiveCaptionContent,
  getLanguageLabel,
} from '../utils/captionLanguage';
import { formatFileSize, formatTimestamp } from '../utils/formatTime';
import { THUMBNAIL_STYLE_OPTIONS } from '../utils/generateThumbnail';

interface ClipsStageProps {
  videoState: UploadedVideoState;
  isBatchRendering: boolean;
  onRenderClip: (captionItem: HighlightCaptionItem, highlight: HighlightMoment) => void;
  onRenderAllClips: () => void;
  onSelectThumbnailStyle: (
    captionItem: HighlightCaptionItem,
    highlight: HighlightMoment,
    style: ThumbnailStyleId
  ) => void;
  onRegenerateThumbnail: (
    captionItem: HighlightCaptionItem,
    highlight: HighlightMoment
  ) => void;
  onGoToCaptions: () => void;
}

function toSafeFilename(
  title: string,
  index: number,
  prefix: 'clip' | 'thumbnail',
  extension: 'mp4' | 'png'
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const num = String(index + 1).padStart(2, '0');
  return slug ? `${prefix}-${num}-${slug}.${extension}` : `${prefix}-${num}.${extension}`;
}

export function ClipsStage({
  videoState,
  isBatchRendering,
  onRenderClip,
  onRenderAllClips,
  onSelectThumbnailStyle,
  onRegenerateThumbnail,
  onGoToCaptions,
}: ClipsStageProps) {
  const approvedCaptions = videoState.captions.filter(
    (item) => item.reviewStatus === 'approved'
  );

  const anyClipRendering =
    isBatchRendering ||
    Object.values(videoState.clips).some(
      (clip) => clip.status === 'loading-core' || clip.status === 'rendering'
    );

  if (approvedCaptions.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 md:p-14 min-h-[420px] flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center mb-5">
          <Scissors className="w-5 h-5" aria-hidden="true" />
        </div>

        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 mb-2 text-balance max-w-md">
          Approve captions before creating clips
        </h1>

        <p className="text-sm text-slate-600 leading-relaxed max-w-md mb-7">
          Only items you approve in the Captions tab continue here. Head back to review
          your edits and approve the clips you want to render.
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

  const allReady = approvedCaptions.every(
    (item) => videoState.clips[item.highlightId]?.status === 'ready'
  );

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-base font-semibold text-slate-900">
            Vertical 9:16 Clips
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            {approvedCaptions.length} approved{' '}
            {approvedCaptions.length === 1 ? 'clip' : 'clips'} · 720×1280 (9:16) ·
            Burned-in subtitles ({getLanguageLabel(videoState.selectedLanguage)})
          </p>
        </div>

        <button
          type="button"
          onClick={onRenderAllClips}
          disabled={anyClipRendering || !videoState.file}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          {anyClipRendering ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              Rendering Clips...
            </>
          ) : (
            <>
              <Film className="w-3.5 h-3.5" aria-hidden="true" />
              {allReady ? 'Re-render All Clips' : 'Render All Clips'}
            </>
          )}
        </button>
      </div>

      {/* Approved Clip Cards */}
      <div className="space-y-6">
        {approvedCaptions.map((captionItem, index) => {
          const highlight = videoState.highlights.find(
            (h) => h.id === captionItem.highlightId
          );
          const clip: RenderedClipItem | undefined =
            videoState.clips[captionItem.highlightId];
          const thumbnail: ThumbnailItem | undefined =
            videoState.thumbnails[captionItem.highlightId];

          const isRendering =
            clip?.status === 'loading-core' || clip?.status === 'rendering';
          const isReady = clip?.status === 'ready' && Boolean(clip.clipUrl);
          const isError = clip?.status === 'error';
          const progressValue = clip?.progress ?? 0;

          const isThumbGenerating = thumbnail?.status === 'generating';
          const isThumbReady =
            thumbnail?.status === 'ready' && Boolean(thumbnail.thumbnailUrl);
          const isThumbError = thumbnail?.status === 'error';
          const activeThumbStyle: ThumbnailStyleId =
            thumbnail?.selectedStyle ?? 'editorial-bottom';

          const clipDuration = highlight
            ? Math.max(1, Math.round(highlight.end - highlight.start))
            : null;

          const effective = getEffectiveCaptionContent(
            captionItem,
            videoState.selectedLanguage
          );

          return (
            <article
              key={captionItem.highlightId}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden"
            >
              <div className="p-6 flex flex-col sm:flex-row gap-6 items-start">
              {/* 9:16 Preview Player Container */}
              <div className="w-full sm:w-[216px] shrink-0 mx-auto sm:mx-0">
                <div className="aspect-[9/16] w-full rounded-lg overflow-hidden bg-slate-950 border border-slate-200 flex flex-col items-center justify-center text-center p-4">
                  {isReady && clip?.clipUrl ? (
                    <video
                      src={clip.clipUrl}
                      controls
                      playsInline
                      className="w-full h-full object-contain bg-black"
                    />
                  ) : isRendering ? (
                    <div className="space-y-3 text-slate-200">
                      <Loader2
                        className="w-6 h-6 animate-spin mx-auto text-blue-400"
                        aria-hidden="true"
                      />
                      <p className="font-mono text-xs tabular-nums">
                        {clip?.status === 'loading-core'
                          ? 'Loading FFmpeg...'
                          : `Rendering ${progressValue}%`}
                      </p>
                    </div>
                  ) : isError ? (
                    <div className="space-y-2 text-red-300">
                      <AlertCircle className="w-6 h-6 mx-auto" aria-hidden="true" />
                      <p className="text-xs font-medium">Render failed</p>
                    </div>
                  ) : (
                    <div className="space-y-2 text-slate-400">
                      <Scissors className="w-6 h-6 mx-auto" aria-hidden="true" />
                      <p className="font-mono text-xs">9:16 Preview</p>
                      <p className="text-xs text-slate-500">
                        Click Render to generate
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Clip Metadata, Subtitle Preview, Progress & Actions */}
              <div className="flex-1 min-w-0 w-full flex flex-col justify-between gap-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums text-slate-500">
                    <span className="font-semibold text-slate-900">
                      Clip 0{index + 1}
                    </span>
                    {highlight && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {formatTimestamp(highlight.start)} –{' '}
                          {formatTimestamp(highlight.end)}
                          {clipDuration !== null ? ` (${clipDuration}s)` : ''}
                        </span>
                      </>
                    )}
                    {isReady && clip?.clipSizeBytes ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{formatFileSize(clip.clipSizeBytes)} MP4</span>
                      </>
                    ) : null}
                  </div>

                  <h2
                    lang={effective.language}
                    className="font-display text-lg font-semibold text-slate-900"
                  >
                    {effective.title}
                  </h2>

                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1">
                      Burned-in subtitle caption ({getLanguageLabel(effective.language)})
                    </p>
                    <p
                      lang={effective.language}
                      className="text-sm text-slate-700 leading-relaxed whitespace-pre-line"
                    >
                      {effective.caption}
                    </p>
                  </div>

                  <p
                    lang={effective.language}
                    className={`${
                      effective.language === 'en' ? 'font-mono text-xs' : 'text-sm'
                    } text-slate-500`}
                  >
                    {effective.hashtags.join('  ')}
                  </p>
                </div>

                {/* Progress Bar */}
                {(isRendering || isReady) && (
                  <div className="space-y-1.5" aria-live="polite">
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                      <span className="text-slate-600">
                        {clip?.status === 'loading-core'
                          ? 'Loading single-threaded FFmpeg WASM...'
                          : clip?.status === 'rendering'
                          ? 'Cropping 9:16 & burning subtitles...'
                          : 'Clip ready for preview and download'}
                      </span>
                      <span className="font-medium text-slate-900">
                        {progressValue}%
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progressValue}
                      className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200/80"
                    >
                      <div
                        className={`h-full transition-all duration-200 ${
                          isReady ? 'bg-emerald-600' : 'bg-blue-600'
                        }`}
                        style={{ width: `${progressValue}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Clear Error Message */}
                {isError && (
                  <div
                    role="alert"
                    className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-2.5"
                  >
                    <AlertCircle
                      className="w-4 h-4 text-red-600 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <p className="text-xs text-red-800 leading-relaxed">
                      {clip?.error ||
                        'Could not render this clip in the browser. Please try again.'}
                    </p>
                  </div>
                )}

                {/* Clip Actions */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {isReady && clip?.clipUrl && (
                    <a
                      href={clip.clipUrl}
                      download={toSafeFilename(captionItem.title, index, 'clip', 'mp4')}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      Download MP4
                    </a>
                  )}

                  {highlight && (
                    <button
                      type="button"
                      onClick={() => onRenderClip(captionItem, highlight)}
                      disabled={anyClipRendering || !videoState.file}
                      className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                        isReady
                          ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          : 'bg-slate-900 text-white hover:bg-slate-800'
                      }`}
                    >
                      {isRendering ? (
                        <>
                          <Loader2
                            className="w-3.5 h-3.5 animate-spin"
                            aria-hidden="true"
                          />
                          Rendering...
                        </>
                      ) : isReady ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                          Re-render
                        </>
                      ) : isError ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                          Retry Render
                        </>
                      ) : (
                        <>
                          <Film className="w-3.5 h-3.5" aria-hidden="true" />
                          Render 9:16 Clip
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
              </div>

              {/* Thumbnail Capture & 3-Style Selector */}
              <div className="p-6 border-t border-slate-200 bg-slate-50/40 flex flex-col sm:flex-row gap-6 items-start">
                <div className="w-full sm:w-[164px] shrink-0 mx-auto sm:mx-0">
                  <div className="aspect-[9/16] w-full rounded-lg overflow-hidden bg-slate-900 border border-slate-200 flex flex-col items-center justify-center text-center">
                    {isThumbReady && thumbnail?.thumbnailUrl ? (
                      <img
                        src={thumbnail.thumbnailUrl}
                        alt={`Thumbnail for ${effective.title}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : isThumbGenerating ? (
                      <div className="p-4 space-y-2 text-slate-200">
                        <Loader2
                          className="w-5 h-5 animate-spin mx-auto text-blue-400"
                          aria-hidden="true"
                        />
                        <p className="font-mono text-xs">Capturing frame...</p>
                      </div>
                    ) : isThumbError ? (
                      <div className="p-4 space-y-2 text-red-300">
                        <AlertCircle className="w-5 h-5 mx-auto" aria-hidden="true" />
                        <p className="text-xs font-medium">Thumbnail unavailable</p>
                      </div>
                    ) : (
                      <div className="p-4 space-y-2 text-slate-400">
                        <ImageIcon className="w-5 h-5 mx-auto" aria-hidden="true" />
                        <p className="font-mono text-xs">Thumbnail</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 min-w-0 w-full space-y-4">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-slate-900">
                      Thumbnail Cover
                    </h3>
                    <p className="font-mono text-xs tabular-nums text-slate-500 mt-0.5">
                      {thumbnail?.capturedAtSeconds !== null &&
                      thumbnail?.capturedAtSeconds !== undefined
                        ? `Frame captured at ${formatTimestamp(
                            thumbnail.capturedAtSeconds
                          )} · 720×1280 PNG`
                        : 'Best frame captured from highlight range · 720×1280 PNG'}
                    </p>
                  </div>

                  {/* 3 Style Choices */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-600">
                      Title & dark gradient style
                    </p>
                    <div
                      role="group"
                      aria-label={`Thumbnail style choices for ${captionItem.title}`}
                      className="flex flex-wrap items-center gap-2"
                    >
                      {THUMBNAIL_STYLE_OPTIONS.map((styleOption) => {
                        const isSelected = activeThumbStyle === styleOption.id;
                        return (
                          <button
                            key={styleOption.id}
                            type="button"
                            disabled={!highlight || isThumbGenerating}
                            aria-pressed={isSelected}
                            onClick={() => {
                              if (highlight) {
                                onSelectThumbnailStyle(
                                  captionItem,
                                  highlight,
                                  styleOption.id
                                );
                              }
                            }}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                              isSelected
                                ? 'bg-slate-900 text-white'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {styleOption.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {isThumbError && (
                    <div
                      role="alert"
                      className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-2.5"
                    >
                      <AlertCircle
                        className="w-4 h-4 text-red-600 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <p className="text-xs text-red-800 leading-relaxed">
                        {thumbnail?.error ||
                          'Could not capture a thumbnail frame from the video.'}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {isThumbReady && thumbnail?.thumbnailUrl && (
                      <a
                        href={thumbnail.thumbnailUrl}
                        download={toSafeFilename(
                          captionItem.title,
                          index,
                          'thumbnail',
                          'png'
                        )}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                      >
                        <Download className="w-3.5 h-3.5" aria-hidden="true" />
                        Download Thumbnail
                      </a>
                    )}

                    {highlight && (
                      <button
                        type="button"
                        disabled={isThumbGenerating || !videoState.videoUrl}
                        onClick={() => onRegenerateThumbnail(captionItem, highlight)}
                        className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                      >
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                        {isThumbError ? 'Retry Thumbnail' : 'Re-capture Frame'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
