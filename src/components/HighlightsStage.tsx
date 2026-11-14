import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { HighlightMoment, TranscriptSegment, UploadedVideoState } from '../types/repurposer';
import { formatTimestamp } from '../utils/formatTime';

interface HighlightsStageProps {
  videoState: UploadedVideoState;
  onFindHighlights: () => void;
  onDeleteHighlight: (id: string) => void;
  onGoToUpload: () => void;
}

function getHighlightTranscriptText(
  transcript: TranscriptSegment[],
  start: number,
  end: number
): string {
  const overlapping = transcript.filter((seg) => seg.end > start && seg.start < end);
  if (overlapping.length > 0) {
    return overlapping.map((seg) => seg.text).join(' ');
  }

  // Fallback to closest segment if boundaries sit right between segments
  const closest = transcript.reduce<TranscriptSegment | null>((best, seg) => {
    const segMid = (seg.start + seg.end) / 2;
    const targetMid = (start + end) / 2;
    if (!best) return seg;
    const bestMid = (best.start + best.end) / 2;
    return Math.abs(segMid - targetMid) < Math.abs(bestMid - targetMid) ? seg : best;
  }, null);

  return closest ? closest.text : '';
}

export function HighlightsStage({
  videoState,
  onFindHighlights,
  onDeleteHighlight,
  onGoToUpload,
}: HighlightsStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  const hasVideo = Boolean(videoState.videoUrl);
  const hasTranscript =
    videoState.transcriptionStatus === 'success' && videoState.transcript.length > 0;
  const isBusy = videoState.highlightsStatus === 'loading';

  // Keep play/pause button label synchronized with the video element
  useEffect(() => {
    const player = videoRef.current;
    if (!player) return;

    const handlePlay = () => setIsVideoPlaying(true);
    const handlePause = () => setIsVideoPlaying(false);
    const handleEnded = () => {
      setIsVideoPlaying(false);
      setActiveHighlightId(null);
    };

    const handleTimeUpdate = () => {
      if (!activeHighlightId) return;
      const current = videoState.highlights.find((h) => h.id === activeHighlightId);
      if (!current) return;
      if (player.currentTime >= current.end) {
        player.pause();
        setActiveHighlightId(null);
      }
    };

    player.addEventListener('play', handlePlay);
    player.addEventListener('pause', handlePause);
    player.addEventListener('ended', handleEnded);
    player.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      player.removeEventListener('play', handlePlay);
      player.removeEventListener('pause', handlePause);
      player.removeEventListener('ended', handleEnded);
      player.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [activeHighlightId, videoState.highlights]);

  const handlePlayHighlight = (highlight: HighlightMoment) => {
    const player = videoRef.current;
    if (!player) return;

    if (activeHighlightId === highlight.id && !player.paused) {
      player.pause();
      return;
    }

    setActiveHighlightId(highlight.id);
    player.currentTime = highlight.start;
    void player.play().catch(() => {
      // Playback may require direct gesture if blocked
    });
  };

  if (!hasVideo || !hasTranscript) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 md:p-14 min-h-[420px] flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center mb-5">
          <Sparkles className="w-5 h-5" aria-hidden="true" />
        </div>

        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 mb-2 text-balance max-w-md">
          {hasVideo &&
          (videoState.transcriptionStatus === 'extracting' ||
            videoState.transcriptionStatus === 'transcribing')
            ? 'Transcript still in progress'
            : 'Upload and transcribe a video first'}
        </h1>

        <p className="text-sm text-slate-600 leading-relaxed max-w-md mb-7">
          {hasVideo &&
          (videoState.transcriptionStatus === 'extracting' ||
            videoState.transcriptionStatus === 'transcribing')
            ? 'Your video is currently being transcribed. Once the timestamped transcript is ready, you can surface the strongest short-form moments here.'
            : 'Highlights are selected from your timestamped transcript. Head back to Upload to add a video with spoken dialogue.'}
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Video Preview Player */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden lg:sticky lg:top-6">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <h2 className="font-display text-base font-semibold text-slate-900 truncate">
            Preview Player
          </h2>
          {activeHighlightId && (
            <span className="font-mono text-xs text-blue-700 tabular-nums whitespace-nowrap">
              {(() => {
                const current = videoState.highlights.find(
                  (h) => h.id === activeHighlightId
                );
                return current
                  ? `Playing ${formatTimestamp(current.start)} – ${formatTimestamp(
                      current.end
                    )}`
                  : '';
              })()}
            </span>
          )}
        </div>

        <div className="bg-slate-950 aspect-video w-full">
          <video
            ref={videoRef}
            src={videoState.videoUrl ?? undefined}
            controls
            playsInline
            className="w-full h-full object-contain"
          />
        </div>

        <div className="px-6 py-4 border-t border-slate-200 space-y-1">
          <p className="text-sm font-medium text-slate-900 truncate" title={videoState.fileName}>
            {videoState.fileName}
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            {videoState.durationSeconds !== null
              ? formatTimestamp(videoState.durationSeconds)
              : '--:--'}{' '}
            · {videoState.transcript.length} transcript segments
          </p>
        </div>
      </div>

      {/* Right Column: Highlights List */}
      <div className="lg:col-span-7 space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-base font-semibold text-slate-900">
              Short-Form Highlights
            </h1>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {videoState.highlightsStatus === 'loading'
                ? 'Analyzing transcript with Gemini...'
                : videoState.highlightsStatus === 'success'
                ? `${videoState.highlights.length} ${
                    videoState.highlights.length === 1 ? 'highlight' : 'highlights'
                  } kept · 15–45s target`
                : videoState.highlightsStatus === 'error'
                ? 'Highlight detection paused'
                : 'Ready to find the 3 strongest moments'}
            </p>
          </div>

          <button
            type="button"
            onClick={onFindHighlights}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {isBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {videoState.highlights.length > 0 ? 'Regenerate' : 'Find Highlights'}
          </button>
        </div>

        {isBusy && (
          <div className="space-y-6" aria-live="polite">
            <div className="bg-white border border-slate-200 rounded-xl px-6 py-4 flex items-center gap-3">
              <Loader2
                className="w-4 h-4 text-blue-600 animate-spin shrink-0"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-slate-700">
                Finding the 3 strongest short-form moments from your transcript...
              </span>
            </div>

            {[1, 2, 3].map((card) => (
              <div
                key={card}
                className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 animate-pulse"
              >
                <div className="flex items-center justify-between">
                  <div className="h-4 w-48 bg-slate-200 rounded" />
                  <div className="h-8 w-24 bg-slate-100 rounded-lg" />
                </div>
                <div className="space-y-2 pt-1">
                  <div className="h-4 bg-slate-200 rounded w-11/12" />
                  <div className="h-4 bg-slate-200 rounded w-4/5" />
                </div>
                <div className="border-t border-slate-100 pt-3">
                  <div className="h-3.5 bg-slate-100 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {videoState.highlightsStatus === 'error' && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle
                className="w-5 h-5 text-red-600 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold text-red-900">
                  Could not find highlights
                </p>
                <p className="text-sm text-red-700 mt-1 leading-relaxed">
                  {videoState.highlightsError ||
                    'An unexpected error occurred while analyzing the transcript.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onFindHighlights}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Try Again
            </button>
          </div>
        )}

        {videoState.highlightsStatus === 'success' &&
          videoState.highlights.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
              <p className="text-sm font-semibold text-slate-900 mb-1">
                All highlights removed
              </p>
              <p className="text-sm text-slate-500 max-w-md mx-auto mb-5">
                You removed all suggested moments. Generate fresh highlights from your
                transcript anytime.
              </p>
              <button
                type="button"
                onClick={onFindHighlights}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                Find 3 Highlights
              </button>
            </div>
          )}

        {!isBusy &&
          videoState.highlights.length > 0 &&
          videoState.highlights.map((highlight, index) => {
            const clipDuration = Math.max(
              1,
              Math.round(highlight.end - highlight.start)
            );
            const transcriptText = getHighlightTranscriptText(
              videoState.transcript,
              highlight.start,
              highlight.end
            );
            const isCurrentlyPlaying =
              activeHighlightId === highlight.id && isVideoPlaying;

            return (
              <article
                key={highlight.id}
                className={`bg-white border rounded-xl p-6 transition-colors ${
                  activeHighlightId === highlight.id
                    ? 'border-blue-400'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-slate-500">
                    <span className="font-semibold text-slate-900">
                      Highlight 0{index + 1}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {formatTimestamp(highlight.start)} –{' '}
                      {formatTimestamp(highlight.end)} ({clipDuration}s)
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Hook score {highlight.hook_score}/100</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handlePlayHighlight(highlight)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                        isCurrentlyPlaying
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                      }`}
                    >
                      {isCurrentlyPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" aria-hidden="true" />
                          Play
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (activeHighlightId === highlight.id) {
                          videoRef.current?.pause();
                          setActiveHighlightId(null);
                        }
                        onDeleteHighlight(highlight.id);
                      }}
                      aria-label={`Delete Highlight 0${index + 1}`}
                      title="Delete highlight"
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <p className="text-sm text-slate-900 leading-relaxed">
                  {transcriptText
                    ? `“${transcriptText}”`
                    : 'Transcript text unavailable for this time range.'}
                </p>

                <div className="mt-4 pt-3 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-500 mb-1">
                    Why this moment works
                  </p>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    {highlight.reason}
                  </p>
                </div>
              </article>
            );
          })}
      </div>
    </div>
  );
}
