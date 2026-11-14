import { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Captions,
  Check,
  Languages,
  Loader2,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import type {
  CaptionReviewStatus,
  SupportedLanguage,
  UploadedVideoState,
} from '../types/repurposer';
import { LANGUAGE_OPTIONS, getLanguageLabel } from '../utils/captionLanguage';
import { formatTimestamp } from '../utils/formatTime';

const DEMO_VOICE_SAMPLES = [
  'Stop over-editing your first 5 seconds. Nobody cares about your logo intro—tell them what actually changes if they watch till the end 🎯',
  'Tested this one-take workflow for 30 days straight. Zero fancy transitions, way clearer ideas, and double the average watch time. Ship fast, refine later.',
  'Hot take: most "viral hooks" fail because they sound like a template instead of a real person talking. Write how you speak—short sentences and zero fluff 👇',
].join('\n\n');

interface CaptionsStageProps {
  videoState: UploadedVideoState;
  onVoiceSamplesChange: (value: string) => void;
  onGenerateCaptions: () => void;
  onUpdateCaptionText: (
    highlightId: string,
    updates: { title?: string; voiceCaption?: string }
  ) => void;
  onUpdateTranslatedText: (
    highlightId: string,
    language: 'hi' | 'bn',
    updates: { title?: string; caption?: string }
  ) => void;
  onSelectLanguage: (language: SupportedLanguage) => void;
  onRetryTranslation: () => void;
  onSetCaptionReview: (highlightId: string, status: CaptionReviewStatus) => void;
  onGoToUpload: () => void;
  onGoToHighlights: () => void;
  onGoToClips: () => void;
}

export function CaptionsStage({
  videoState,
  onVoiceSamplesChange,
  onGenerateCaptions,
  onUpdateCaptionText,
  onUpdateTranslatedText,
  onSelectLanguage,
  onRetryTranslation,
  onSetCaptionReview,
  onGoToUpload,
  onGoToHighlights,
  onGoToClips,
}: CaptionsStageProps) {
  const [sampleValidationError, setSampleValidationError] = useState<string | null>(null);

  const hasTranscript =
    videoState.transcriptionStatus === 'success' && videoState.transcript.length > 0;
  const hasHighlights = videoState.highlights.length > 0;
  const isBusy = videoState.captionsStatus === 'loading';
  const isTranslating = videoState.translationStatus === 'loading';
  const activeLanguage = videoState.selectedLanguage;
  const activeLanguageLabel = getLanguageLabel(activeLanguage);

  const handleLoadDemo = () => {
    setSampleValidationError(null);
    onVoiceSamplesChange(DEMO_VOICE_SAMPLES);
  };

  const handleGenerateClick = () => {
    if (!videoState.voiceSamples.trim()) {
      setSampleValidationError(
        'Paste 2 or 3 of your past posts above so Gemini can match your voice.'
      );
      return;
    }
    setSampleValidationError(null);
    onGenerateCaptions();
  };

  if (!hasTranscript) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 md:p-14 min-h-[420px] flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center mb-5">
          <Captions className="w-5 h-5" aria-hidden="true" />
        </div>

        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 mb-2 text-balance max-w-md">
          Upload and transcribe a video first
        </h1>

        <p className="text-sm text-slate-600 leading-relaxed max-w-md mb-7">
          Captions are written for your selected highlights. Start in Upload to add a video
          and generate its transcript.
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

  if (!hasHighlights) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 md:p-14 min-h-[420px] flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center mb-5">
          <Captions className="w-5 h-5" aria-hidden="true" />
        </div>

        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 mb-2 text-balance max-w-md">
          Select highlights before writing captions
        </h1>

        <p className="text-sm text-slate-600 leading-relaxed max-w-md mb-7">
          Generate or keep at least one highlight in the Highlights tab so Gemini knows
          which moments to caption in your voice.
        </p>

        <button
          type="button"
          onClick={onGoToHighlights}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Go to Highlights
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Voice Samples Input */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div>
            <label
              htmlFor="voice-samples-input"
              className="font-display text-base font-semibold text-slate-900 block"
            >
              Your Voice Samples
            </label>
            <p className="text-xs text-slate-500 mt-0.5">
              Paste 2 or 3 of your past posts so Gemini matches your tone, cadence, and
              style for all {videoState.highlights.length}{' '}
              {videoState.highlights.length === 1 ? 'highlight' : 'highlights'}.
            </p>
          </div>

          <button
            type="button"
            onClick={handleLoadDemo}
            disabled={isBusy}
            className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 self-start sm:self-auto"
          >
            Load demo
          </button>
        </div>

        <textarea
          id="voice-samples-input"
          rows={5}
          value={videoState.voiceSamples}
          onChange={(e) => {
            if (sampleValidationError && e.target.value.trim()) {
              setSampleValidationError(null);
            }
            onVoiceSamplesChange(e.target.value);
          }}
          disabled={isBusy}
          placeholder={`Paste 2 or 3 past captions or posts here, separated by a blank line.\n\nExample:\nStop over-editing your first 5 seconds. Nobody cares about your logo animation—tell them what changes if they watch till the end.\n\nTested this one-take workflow for 30 days. Fewer cuts, clearer ideas, twice the watch time.`}
          className="w-full rounded-lg border border-slate-200 bg-[#F8FAFC] px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:outline-none transition-colors leading-relaxed disabled:opacity-60"
        />

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-h-[20px]">
            {sampleValidationError && (
              <p role="alert" className="text-xs font-medium text-red-600">
                {sampleValidationError}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleGenerateClick}
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {isBusy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Generating Captions...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                {videoState.captions.length > 0
                  ? 'Regenerate Captions'
                  : 'Generate Captions'}
              </>
            )}
          </button>
        </div>
      </section>

      {/* Loading Skeleton */}
      {isBusy && (
        <div className="space-y-6" aria-live="polite">
          <div className="bg-white border border-slate-200 rounded-xl px-6 py-4 flex items-center gap-3">
            <Loader2
              className="w-4 h-4 text-blue-600 animate-spin shrink-0"
              aria-hidden="true"
            />
            <span className="text-sm font-medium text-slate-700">
              Writing titles, hashtags, and side-by-side captions in your voice...
            </span>
          </div>

          {videoState.highlights.map((hl) => (
            <div
              key={hl.id}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden animate-pulse"
            >
              <div className="px-6 py-4 border-b border-slate-200 space-y-2">
                <div className="h-3.5 w-36 bg-slate-200 rounded" />
                <div className="h-5 w-72 bg-slate-200 rounded" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
                <div className="p-6 space-y-3 bg-slate-50/70">
                  <div className="h-4 w-32 bg-slate-200 rounded" />
                  <div className="h-4 w-full bg-slate-200 rounded" />
                  <div className="h-4 w-5/6 bg-slate-200 rounded" />
                </div>
                <div className="p-6 space-y-3">
                  <div className="h-4 w-32 bg-slate-200 rounded" />
                  <div className="h-4 w-full bg-slate-200 rounded" />
                  <div className="h-4 w-5/6 bg-slate-200 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {videoState.captionsStatus === 'error' && (
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
                Could not generate captions
              </p>
              <p className="text-sm text-red-700 mt-1 leading-relaxed">
                {videoState.captionsError ||
                  'An unexpected error occurred while contacting Gemini.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerateClick}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Try Again
          </button>
        </div>
      )}

      {/* Side-by-Side Comparison & Translation Cards */}
      {!isBusy && videoState.captions.length > 0 && (() => {
        const totalCount = videoState.captions.length;
        const editedCount = videoState.captions.filter(
          (item) =>
            item.voiceCaption !== item.originalVoiceCaption ||
            item.title !== item.originalTitle
        ).length;
        const approvedCount = videoState.captions.filter(
          (item) => item.reviewStatus === 'approved'
        ).length;

        return (
          <div className="space-y-6">
            {/* Language Selector + Review & Edit Summary Bar */}
            <div className="bg-white border border-slate-200 rounded-xl px-6 py-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <Languages className="w-4 h-4 text-slate-500" aria-hidden="true" />
                    <span>Language</span>
                  </div>

                  <div
                    role="group"
                    aria-label="Caption language"
                    className="inline-flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200/80"
                  >
                    {LANGUAGE_OPTIONS.map((option) => {
                      const isSelected = activeLanguage === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => onSelectLanguage(option.id)}
                          aria-pressed={isSelected}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                            isSelected
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {option.id === 'en' ? (
                            option.label
                          ) : (
                            <span>
                              {option.label}{' '}
                              <span
                                lang={option.id}
                                className={
                                  isSelected ? 'text-slate-300' : 'text-slate-400'
                                }
                              >
                                ({option.nativeLabel})
                              </span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {activeLanguage !== 'en' && (
                    <button
                      type="button"
                      onClick={onRetryTranslation}
                      disabled={isTranslating}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isTranslating ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      Re-translate
                    </button>
                  )}
                </div>

                {approvedCount > 0 ? (
                  <button
                    type="button"
                    onClick={onGoToClips}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  >
                    Continue to Clips
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">
                    Approve at least one item to continue to Clips
                  </span>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums text-slate-700">
                  <span>
                    You edited {editedCount} of {totalCount}{' '}
                    {totalCount === 1 ? 'caption' : 'captions'}
                  </span>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="font-medium text-slate-900">
                    Approved {approvedCount} of {totalCount}
                  </span>
                </div>

                {activeLanguage !== 'en' && (
                  <p className="text-xs text-slate-500">
                    English original stays available on every card · Subtitles &amp;
                    thumbnails will use {activeLanguageLabel}
                  </p>
                )}
              </div>
            </div>

            {/* Translation Loading Banner */}
            {activeLanguage !== 'en' && isTranslating && (
              <div
                aria-live="polite"
                className="bg-white border border-slate-200 rounded-xl px-6 py-4 flex items-center gap-3"
              >
                <Loader2
                  className="w-4 h-4 text-blue-600 animate-spin shrink-0"
                  aria-hidden="true"
                />
                <span className="text-sm font-medium text-slate-700">
                  Translating titles, captions, and hashtags into {activeLanguageLabel}{' '}
                  while keeping your tone and emojis...
                </span>
              </div>
            )}

            {/* Translation Error Alert */}
            {activeLanguage !== 'en' && videoState.translationStatus === 'error' && (
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
                      Could not translate captions into {activeLanguageLabel}
                    </p>
                    <p className="text-sm text-red-700 mt-1 leading-relaxed">
                      {videoState.translationError ||
                        'An unexpected error occurred while translating with Gemini.'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onRetryTranslation}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Try Again
                </button>
              </div>
            )}

            {videoState.captions.map((captionItem, index) => {
              const matchingHighlight = videoState.highlights.find(
                (h) => h.id === captionItem.highlightId
              );
              const isApproved = captionItem.reviewStatus === 'approved';
              const isRejected = captionItem.reviewStatus === 'rejected';
              const isEdited =
                captionItem.voiceCaption !== captionItem.originalVoiceCaption ||
                captionItem.title !== captionItem.originalTitle;
              const translatedContent =
                activeLanguage !== 'en'
                  ? captionItem.translations?.[activeLanguage]
                  : undefined;

              return (
                <article
                  key={captionItem.highlightId}
                  className={`bg-white border rounded-xl overflow-hidden transition-colors ${
                    isApproved
                      ? 'border-emerald-300'
                      : isRejected
                      ? 'border-slate-200 opacity-75'
                      : 'border-slate-200'
                  }`}
                >
                  <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs tabular-nums text-slate-500 mb-1.5">
                        Highlight 0{index + 1}
                        {matchingHighlight
                          ? ` · ${formatTimestamp(
                              matchingHighlight.start
                            )} – ${formatTimestamp(matchingHighlight.end)}`
                          : ''}
                        {isEdited ? ' · Edited' : ''}
                      </p>

                      {activeLanguage === 'en' ? (
                        <input
                          type="text"
                          value={captionItem.title}
                          onChange={(e) =>
                            onUpdateCaptionText(captionItem.highlightId, {
                              title: e.target.value,
                            })
                          }
                          aria-label={`Title for Highlight 0${index + 1}`}
                          className="w-full font-display text-lg font-semibold text-slate-900 bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-500 focus:bg-[#F8FAFC] rounded-lg px-2.5 py-1.5 -mx-2.5 focus:outline-none transition-colors"
                        />
                      ) : translatedContent ? (
                        <input
                          type="text"
                          lang={activeLanguage}
                          value={translatedContent.title}
                          onChange={(e) =>
                            onUpdateTranslatedText(
                              captionItem.highlightId,
                              activeLanguage,
                              { title: e.target.value }
                            )
                          }
                          aria-label={`${activeLanguageLabel} title for Highlight 0${
                            index + 1
                          }`}
                          className="w-full font-display text-lg font-semibold text-slate-900 bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-500 focus:bg-[#F8FAFC] rounded-lg px-2.5 py-1.5 -mx-2.5 focus:outline-none transition-colors"
                        />
                      ) : (
                        <p className="font-display text-lg font-semibold text-slate-900 py-1.5">
                          {captionItem.title}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          onSetCaptionReview(
                            captionItem.highlightId,
                            isApproved ? 'pending' : 'approved'
                          )
                        }
                        aria-pressed={isApproved}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                          isApproved
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        {isApproved ? 'Approved' : 'Approve'}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onSetCaptionReview(
                            captionItem.highlightId,
                            isRejected ? 'pending' : 'rejected'
                          )
                        }
                        aria-pressed={isRejected}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                          isRejected
                            ? 'bg-red-600 text-white hover:bg-red-700'
                            : 'bg-slate-100 text-slate-700 hover:bg-red-50 hover:text-red-700'
                        }`}
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                        {isRejected ? 'Rejected' : 'Reject'}
                      </button>
                    </div>
                  </div>

                  {activeLanguage === 'en' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
                      {/* Generic AI Column */}
                      <div className="p-6 bg-slate-50/70 flex flex-col justify-between gap-4">
                        <div>
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <span className="text-xs font-semibold text-slate-600">
                              Generic AI
                            </span>
                            <span className="font-mono text-xs tabular-nums text-slate-600">
                              Tone match {captionItem.genericToneMatchScore}/100
                            </span>
                          </div>

                          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                            {captionItem.genericCaption}
                          </p>
                        </div>

                        <p className="text-xs text-slate-500 leading-relaxed pt-3 border-t border-slate-200/80">
                          {captionItem.genericToneMatchExplanation}
                        </p>
                      </div>

                      {/* In Your Voice Column (Editable) */}
                      <div className="p-6 bg-white flex flex-col justify-between gap-4">
                        <div>
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <span className="text-xs font-semibold text-slate-900">
                              In your voice
                            </span>
                            <span className="font-mono text-xs font-medium tabular-nums text-blue-700">
                              Tone match {captionItem.voiceToneMatchScore}/100
                            </span>
                          </div>

                          <textarea
                            rows={5}
                            value={captionItem.voiceCaption}
                            onChange={(e) =>
                              onUpdateCaptionText(captionItem.highlightId, {
                                voiceCaption: e.target.value,
                              })
                            }
                            aria-label={`Caption in your voice for Highlight 0${
                              index + 1
                            }`}
                            className="w-full rounded-lg border border-slate-200 bg-[#F8FAFC] px-3.5 py-2.5 text-sm text-slate-900 leading-relaxed focus:bg-white focus:border-blue-500 focus:outline-none transition-colors resize-y"
                          />

                          <p className="mt-3 font-mono text-xs text-slate-600 leading-relaxed">
                            {captionItem.hashtags.join('  ')}
                          </p>
                        </div>

                        <p className="text-xs text-slate-600 leading-relaxed pt-3 border-t border-slate-100">
                          {captionItem.voiceToneMatchExplanation}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
                      {/* English Original Reference Column */}
                      <div className="p-6 bg-slate-50/70 flex flex-col justify-between gap-4">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-semibold text-slate-600">
                              English Original
                            </span>
                            <span className="font-mono text-xs tabular-nums text-slate-600">
                              Tone match {captionItem.voiceToneMatchScore}/100
                            </span>
                          </div>

                          <p className="font-display text-sm font-semibold text-slate-900">
                            {captionItem.title}
                          </p>

                          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                            {captionItem.voiceCaption}
                          </p>

                          <p className="font-mono text-xs text-slate-500 leading-relaxed">
                            {captionItem.hashtags.join('  ')}
                          </p>
                        </div>

                        <p className="text-xs text-slate-500 leading-relaxed pt-3 border-t border-slate-200/80">
                          {captionItem.voiceToneMatchExplanation}
                        </p>
                      </div>

                      {/* Translated Column (Editable) */}
                      <div className="p-6 bg-white flex flex-col justify-between gap-4">
                        {translatedContent ? (
                          <>
                            <div>
                              <div className="flex items-center justify-between gap-3 mb-3">
                                <span className="text-xs font-semibold text-slate-900">
                                  {activeLanguageLabel} Translation · In your voice
                                </span>
                                <span
                                  lang={activeLanguage}
                                  className="text-xs font-medium text-blue-700"
                                >
                                  {activeLanguage === 'hi' ? 'हिन्दी' : 'বাংলা'}
                                </span>
                              </div>

                              <textarea
                                rows={5}
                                lang={activeLanguage}
                                value={translatedContent.caption}
                                onChange={(e) =>
                                  onUpdateTranslatedText(
                                    captionItem.highlightId,
                                    activeLanguage,
                                    { caption: e.target.value }
                                  )
                                }
                                aria-label={`${activeLanguageLabel} caption for Highlight 0${
                                  index + 1
                                }`}
                                className="w-full rounded-lg border border-slate-200 bg-[#F8FAFC] px-3.5 py-2.5 text-sm text-slate-900 leading-relaxed focus:bg-white focus:border-blue-500 focus:outline-none transition-colors resize-y"
                              />

                              <p
                                lang={activeLanguage}
                                className="mt-3 text-sm text-slate-700 leading-relaxed"
                              >
                                {translatedContent.hashtags.join('  ')}
                              </p>
                            </div>

                            <p className="text-xs text-slate-500 leading-relaxed pt-3 border-t border-slate-100">
                              Preserves your tone and emojis from the English original.
                            </p>
                          </>
                        ) : isTranslating ? (
                          <div className="space-y-3 animate-pulse">
                            <div className="h-4 w-40 bg-slate-200 rounded" />
                            <div className="h-24 w-full bg-slate-200 rounded-lg" />
                            <div className="h-4 w-3/4 bg-slate-200 rounded" />
                          </div>
                        ) : (
                          <div className="flex flex-col items-start justify-center gap-3 py-4">
                            <p className="text-sm text-slate-600">
                              {activeLanguageLabel} translation is not loaded yet for this
                              highlight.
                            </p>
                            <button
                              type="button"
                              onClick={onRetryTranslation}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                              Translate to {activeLanguageLabel}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

