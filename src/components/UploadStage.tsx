import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  AlertCircle,
  Film,
  Loader2,
  RefreshCw,
  RotateCcw,
  Upload,
} from 'lucide-react';
import type { UploadedVideoState } from '../types/repurposer';
import { formatFileSize, formatTimestamp } from '../utils/formatTime';

interface UploadStageProps {
  videoState: UploadedVideoState;
  onSelectVideo: (file: File) => void;
  onRetryTranscription: () => void;
  onClearVideo: () => void;
  validationError: string | null;
  onDismissValidationError: () => void;
}

export function UploadStage({
  videoState,
  onSelectVideo,
  onRetryTranscription,
  onClearVideo,
  validationError,
  onDismissValidationError,
}: UploadStageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const isBusy =
    videoState.transcriptionStatus === 'extracting' ||
    videoState.transcriptionStatus === 'transcribing';

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onSelectVideo(file);
    }
    event.target.value = '';
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      onSelectVideo(file);
    }
  };

  const handleSeekToSegment = (startSeconds: number) => {
    const player = videoPlayerRef.current;
    if (!player) return;
    player.currentTime = startSeconds;
    setCurrentTime(startSeconds);
    void player.play().catch(() => {
      // Autoplay might be blocked if user hasn't interacted directly with media
    });
  };

  const openFilePicker = () => {
    onDismissValidationError();
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        className="sr-only"
        aria-label="Choose a video file to upload"
      />

      {validationError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-start justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-red-900">Unable to load video</p>
              <p className="text-sm text-red-700 mt-0.5">{validationError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismissValidationError}
            className="text-xs font-medium text-red-700 hover:text-red-900 px-2.5 py-1.5 rounded-md hover:bg-red-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {!videoState.videoUrl ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`bg-white border rounded-xl p-10 md:p-16 min-h-[420px] flex flex-col items-center justify-center text-center transition-colors duration-150 ${
            isDragging
              ? 'border-blue-500 bg-blue-50/40'
              : 'border-slate-200 border-dashed'
          }`}
        >
          <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center mb-5">
            <Upload className="w-5 h-5" aria-hidden="true" />
          </div>

          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 mb-2 text-balance max-w-md">
            Upload your source video
          </h1>

          <p className="text-sm text-slate-600 leading-relaxed max-w-md mb-2">
            Drop a single long-form video here or choose a file from your device. We will
            extract the audio in your browser and transcribe it into timestamped segments.
          </p>

          <p className="text-xs text-slate-500 font-mono tabular-nums mb-7">
            MP4, WebM, or MOV · Up to 5 minutes · Max 20 MB
          </p>

          <button
            type="button"
            onClick={openFilePicker}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap"
          >
            <Film className="w-4 h-4" aria-hidden="true" />
            Choose Video
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Video Preview Player */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <h2 className="font-display text-base font-semibold text-slate-900 truncate">
                Source Video
              </h2>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={openFilePicker}
                  disabled={isBusy}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={onClearVideo}
                  disabled={isBusy}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="bg-slate-950 aspect-video w-full">
              <video
                ref={videoPlayerRef}
                src={videoState.videoUrl}
                controls
                playsInline
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                className="w-full h-full object-contain"
              />
            </div>

            <div className="px-5 py-4 border-t border-slate-200 space-y-1.5">
              <p className="text-sm font-medium text-slate-900 truncate" title={videoState.fileName}>
                {videoState.fileName}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                <span>
                  {videoState.durationSeconds !== null
                    ? formatTimestamp(videoState.durationSeconds)
                    : '--:--'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatFileSize(videoState.fileSize)}</span>
                {videoState.extractionMode && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {videoState.extractionMode === 'audio-wav'
                        ? 'Browser audio extracted'
                        : 'Direct video fallback'}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Timestamped Transcript */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Transcript
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                  {videoState.transcriptionStatus === 'success'
                    ? `${videoState.transcript.length} timestamped ${
                        videoState.transcript.length === 1 ? 'segment' : 'segments'
                      }`
                    : videoState.transcriptionStatus === 'extracting'
                    ? 'Preparing audio in your browser'
                    : videoState.transcriptionStatus === 'transcribing'
                    ? 'Generating timestamped transcript with Gemini'
                    : videoState.transcriptionStatus === 'error'
                    ? 'Transcription paused'
                    : 'Ready to transcribe'}
                </p>
              </div>

              {(videoState.transcriptionStatus === 'success' ||
                videoState.transcriptionStatus === 'error') && (
                <button
                  type="button"
                  onClick={onRetryTranscription}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  Re-transcribe
                </button>
              )}
            </div>

            {isBusy && (
              <div className="p-5 space-y-4" aria-live="polite">
                <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <Loader2
                    className="w-4 h-4 text-blue-600 animate-spin shrink-0"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium text-slate-700">
                    {videoState.transcriptionStatus === 'extracting'
                      ? 'Extracting audio track in your browser...'
                      : 'Transcribing speech with Gemini...'}
                  </span>
                </div>

                <div className="divide-y divide-slate-100">
                  {[1, 2, 3, 4, 5].map((row) => (
                    <div key={row} className="py-3.5 flex items-start gap-4 animate-pulse">
                      <div className="h-4 w-24 bg-slate-200 rounded shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-slate-200 rounded w-11/12" />
                        <div className="h-4 bg-slate-100 rounded w-3/5" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {videoState.transcriptionStatus === 'error' && (
              <div className="p-6" role="alert">
                <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle
                      className="w-5 h-5 text-red-600 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="text-sm font-semibold text-red-900">
                        Could not complete transcription
                      </p>
                      <p className="text-sm text-red-700 mt-1 leading-relaxed">
                        {videoState.transcriptionError ||
                          'An unexpected error occurred while contacting Gemini.'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onRetryTranscription}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    Try Again
                  </button>
                </div>
              </div>
            )}

            {videoState.transcriptionStatus === 'success' && (
              <>
                {videoState.transcript.length === 0 ? (
                  <div className="p-10 text-center">
                    <p className="text-sm font-medium text-slate-900 mb-1">
                      No spoken dialogue detected
                    </p>
                    <p className="text-sm text-slate-500 max-w-md mx-auto">
                      Gemini did not detect clear speech in this video. Try uploading a clip
                      with spoken audio or re-transcribe.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
                    {videoState.transcript.map((segment) => {
                      const isActive =
                        currentTime >= segment.start && currentTime <= segment.end;

                      return (
                        <li key={segment.id}>
                          <button
                            type="button"
                            onClick={() => handleSeekToSegment(segment.start)}
                            className={`w-full text-left px-5 py-3.5 flex items-baseline gap-4 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-600 ${
                              isActive
                                ? 'bg-blue-50/70'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            <span
                              className={`font-mono text-xs tabular-nums whitespace-nowrap shrink-0 ${
                                isActive
                                  ? 'text-blue-700 font-medium'
                                  : 'text-slate-500'
                              }`}
                            >
                              {formatTimestamp(segment.start)} –{' '}
                              {formatTimestamp(segment.end)}
                            </span>
                            <span className="text-sm text-slate-800 leading-relaxed">
                              {segment.text}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
