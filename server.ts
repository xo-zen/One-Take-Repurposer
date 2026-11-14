import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
const INLINE_THRESHOLD_BYTES = 14 * 1024 * 1024; // ~14 MB binary (~18.7 MB base64, safely under 20 MB inline limit)
const MAX_DURATION_SECONDS = 300; // 5 minutes
const TRANSCRIPTION_MODEL = 'gemini-4-hydrogen';

interface RawTranscriptSegment {
  start?: unknown;
  end?: unknown;
  text?: unknown;
}

interface NormalizedTranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

interface IncomingTranscriptSegment {
  id?: unknown;
  start?: unknown;
  end?: unknown;
  text?: unknown;
}

interface RawHighlightMoment {
  start?: unknown;
  end?: unknown;
  reason?: unknown;
  hook_score?: unknown;
}

interface ValidatedHighlightMoment {
  id: string;
  start: number;
  end: number;
  reason: string;
  hook_score: number;
}

function stripMarkdownFences(raw: string): string {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return cleaned;
}

function parseAndValidateHighlights(
  rawText: string,
  durationSeconds?: number
): ValidatedHighlightMoment[] | null {
  const cleaned = stripMarkdownFences(rawText);
  if (!cleaned) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return null;
  }

  const hasDuration =
    typeof durationSeconds === 'number' &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0;

  const validated: ValidatedHighlightMoment[] = [];

  for (let i = 0; i < Math.min(parsed.length, 3); i++) {
    const item = parsed[i] as RawHighlightMoment | null;
    if (!item || typeof item !== 'object') {
      return null;
    }

    const start = Number(item.start);
    const end = Number(item.end);
    const hookScore = Number(item.hook_score);
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      !Number.isFinite(hookScore) ||
      !reason ||
      start < 0 ||
      end <= start
    ) {
      return null;
    }

    const clampedStart = hasDuration
      ? Math.min(start, Math.max(0, durationSeconds - 0.5))
      : start;
    const clampedEnd = hasDuration
      ? Math.min(Math.max(end, clampedStart + 0.5), durationSeconds)
      : end;
    const normalizedScore = Math.round(Math.max(1, Math.min(100, hookScore)));

    validated.push({
      id: `hl-${Date.now()}-${i + 1}`,
      start: Number(clampedStart.toFixed(2)),
      end: Number(clampedEnd.toFixed(2)),
      reason,
      hook_score: normalizedScore,
    });
  }

  return validated.length > 0 ? validated : null;
}

interface IncomingCaptionHighlight {
  id?: unknown;
  start?: unknown;
  end?: unknown;
  reason?: unknown;
  transcriptText?: unknown;
}

interface RawCaptionItem {
  highlightId?: unknown;
  title?: unknown;
  voiceCaption?: unknown;
  hashtags?: unknown;
  voiceToneMatchScore?: unknown;
  voiceToneMatchExplanation?: unknown;
  genericCaption?: unknown;
  genericToneMatchScore?: unknown;
  genericToneMatchExplanation?: unknown;
}

interface ValidatedCaptionItem {
  highlightId: string;
  title: string;
  voiceCaption: string;
  hashtags: string[];
  voiceToneMatchScore: number;
  voiceToneMatchExplanation: string;
  genericCaption: string;
  genericToneMatchScore: number;
  genericToneMatchExplanation: string;
}

function normalizeHashtags(rawTags: unknown): string[] | null {
  if (!Array.isArray(rawTags)) return null;
  const cleaned = rawTags
    .map((tag) => (typeof tag === 'string' ? tag.trim().replace(/\s+/g, '') : ''))
    .filter((tag) => tag.length > 0)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));

  const unique = Array.from(new Set(cleaned)).slice(0, 5);
  return unique.length === 5 ? unique : null;
}

function parseAndValidateCaptions(
  rawText: string,
  expectedHighlightIds: string[]
): ValidatedCaptionItem[] | null {
  const cleaned = stripMarkdownFences(rawText);
  if (!cleaned) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length !== expectedHighlightIds.length) {
    return null;
  }

  const byId = new Map<string, ValidatedCaptionItem>();

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as RawCaptionItem | null;
    if (!item || typeof item !== 'object') return null;

    const highlightId =
      typeof item.highlightId === 'string' && expectedHighlightIds.includes(item.highlightId)
        ? item.highlightId
        : expectedHighlightIds[i];

    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const voiceCaption =
      typeof item.voiceCaption === 'string' ? item.voiceCaption.trim() : '';
    const genericCaption =
      typeof item.genericCaption === 'string' ? item.genericCaption.trim() : '';
    const voiceToneMatchExplanation =
      typeof item.voiceToneMatchExplanation === 'string'
        ? item.voiceToneMatchExplanation.trim()
        : '';
    const genericToneMatchExplanation =
      typeof item.genericToneMatchExplanation === 'string'
        ? item.genericToneMatchExplanation.trim()
        : '';

    const voiceToneMatchScore = Number(item.voiceToneMatchScore);
    const genericToneMatchScore = Number(item.genericToneMatchScore);
    const hashtags = normalizeHashtags(item.hashtags);

    if (
      !title ||
      !voiceCaption ||
      !genericCaption ||
      !voiceToneMatchExplanation ||
      !genericToneMatchExplanation ||
      !hashtags ||
      !Number.isFinite(voiceToneMatchScore) ||
      !Number.isFinite(genericToneMatchScore)
    ) {
      return null;
    }

    byId.set(highlightId, {
      highlightId,
      title,
      voiceCaption,
      hashtags,
      voiceToneMatchScore: Math.round(Math.max(0, Math.min(100, voiceToneMatchScore))),
      voiceToneMatchExplanation,
      genericCaption,
      genericToneMatchScore: Math.round(
        Math.max(0, Math.min(100, genericToneMatchScore))
      ),
      genericToneMatchExplanation,
    });
  }

  if (byId.size !== expectedHighlightIds.length) {
    return null;
  }

  return expectedHighlightIds.map((id) => byId.get(id)!);
}

interface IncomingTranslationItem {
  highlightId?: unknown;
  title?: unknown;
  caption?: unknown;
  hashtags?: unknown;
}

interface ValidatedTranslationItem {
  highlightId: string;
  title: string;
  caption: string;
  hashtags: string[];
}

function parseAndValidateTranslations(
  rawText: string,
  expectedHighlightIds: string[]
): ValidatedTranslationItem[] | null {
  const cleaned = stripMarkdownFences(rawText);
  if (!cleaned) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length !== expectedHighlightIds.length) {
    return null;
  }

  const byId = new Map<string, ValidatedTranslationItem>();

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as IncomingTranslationItem | null;
    if (!item || typeof item !== 'object') return null;

    const highlightId =
      typeof item.highlightId === 'string' && expectedHighlightIds.includes(item.highlightId)
        ? item.highlightId
        : expectedHighlightIds[i];

    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const caption = typeof item.caption === 'string' ? item.caption.trim() : '';
    const hashtags = normalizeHashtags(item.hashtags);

    if (!title || !caption || !hashtags) {
      return null;
    }

    byId.set(highlightId, {
      highlightId,
      title,
      caption,
      hashtags,
    });
  }

  if (byId.size !== expectedHighlightIds.length) {
    return null;
  }

  return expectedHighlightIds.map((id) => byId.get(id)!);
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isRetryableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return /RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
    message
  );
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries || !isRetryableError(err)) {
        throw err;
      }
      const delayMs = 1000 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function formatFriendlyGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);

  if (raw === 'MISSING_API_KEY') {
    return {
      status: 500,
      message:
        'Gemini API key is missing. Add GEMINI_API_KEY in Settings > Secrets and try again.',
    };
  }
  if (/API_KEY_INVALID|PERMISSION_DENIED|403/i.test(raw)) {
    return {
      status: 403,
      message:
        'Your Gemini API key could not be verified. Check GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (/RESOURCE_EXHAUSTED|429/i.test(raw)) {
    return {
      status: 429,
      message:
        'Gemini API rate limit reached. Please wait a moment and try transcribing again.',
    };
  }
  if (/NOT_FOUND|404/i.test(raw)) {
    return {
      status: 502,
      message: 'The transcription model is temporarily unavailable. Please try again.',
    };
  }
  if (/INVALID_ARGUMENT|400/i.test(raw)) {
    return {
      status: 400,
      message:
        'Gemini could not read this media format. Try converting the video to MP4 or WebM and uploading again.',
    };
  }

  return {
    status: 500,
    message: 'Transcription failed due to a temporary server issue. Please try again.',
  };
}

function normalizeSegments(
  rawSegments: RawTranscriptSegment[],
  durationSeconds?: number
): NormalizedTranscriptSegment[] {
  const hasDuration =
    typeof durationSeconds === 'number' &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0;

  const cleaned = rawSegments
    .map((seg, index): NormalizedTranscriptSegment | null => {
      const text = typeof seg.text === 'string' ? seg.text.trim() : '';
      if (!text) return null;

      let start = Number(seg.start);
      let end = Number(seg.end);
      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end <= start) end = start + 1;

      if (hasDuration) {
        start = Math.min(start, Math.max(0, durationSeconds - 0.1));
        end = Math.min(Math.max(end, start + 0.1), durationSeconds);
      }

      return {
        id: `seg-${index + 1}`,
        start: Number(start.toFixed(2)),
        end: Number(end.toFixed(2)),
        text,
      };
    })
    .filter((item): item is NormalizedTranscriptSegment => item !== null)
    .sort((a, b) => a.start - b.start);

  return cleaned.map((seg, index) => ({
    ...seg,
    id: `seg-${index + 1}`,
  }));
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post(
    '/api/transcribe',
    express.raw({
      type: ['audio/*', 'video/*', 'application/octet-stream'],
      limit: '22mb',
    }),
    async (req: Request, res: Response) => {
      let uploadedFileName: string | null = null;
      let ai: GoogleGenAI | null = null;

      try {
        ai = getGeminiClient();

        if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
          res.status(400).json({
            error: 'No audio or video data was received. Please select a video file and try again.',
          });
          return;
        }

        if (req.body.byteLength > MAX_FILE_BYTES) {
          res.status(413).json({
            error: 'The uploaded media exceeds the 20 MB limit. Please choose a smaller video.',
          });
          return;
        }

        const headerMime =
          (typeof req.headers['x-mime-type'] === 'string' && req.headers['x-mime-type']) ||
          (typeof req.headers['content-type'] === 'string' && req.headers['content-type']) ||
          'audio/wav';
        const mimeType = headerMime.split(';')[0].trim().toLowerCase();

        if (!mimeType.startsWith('audio/') && !mimeType.startsWith('video/')) {
          res.status(400).json({
            error: 'Unsupported media type. Please upload an MP4, WebM, MOV, or standard video file.',
          });
          return;
        }

        const durationHeader = Number(req.headers['x-duration-seconds']);
        const durationSeconds =
          Number.isFinite(durationHeader) && durationHeader > 0 ? durationHeader : undefined;

        if (durationSeconds && durationSeconds > MAX_DURATION_SECONDS + 1) {
          res.status(400).json({
            error: 'Videos must be 5 minutes or shorter. Please choose a shorter video.',
          });
          return;
        }

        let mediaPart:
          | { inlineData: { mimeType: string; data: string } }
          | { fileData: { fileUri: string; mimeType: string } };

        if (req.body.byteLength <= INLINE_THRESHOLD_BYTES) {
          mediaPart = {
            inlineData: {
              mimeType,
              data: req.body.toString('base64'),
            },
          };
        } else {
          const blob = new Blob([new Uint8Array(req.body)], { type: mimeType });
          const uploaded = await ai.files.upload({
            file: blob,
            config: { mimeType },
          });
          uploadedFileName = uploaded.name ?? null;

          let fileMeta = uploaded;
          const startedAt = Date.now();
          while (fileMeta.state === 'PROCESSING') {
            if (Date.now() - startedAt > 60_000) {
              throw new Error('Timed out while processing uploaded media.');
            }
            await new Promise((resolve) => setTimeout(resolve, 1500));
            if (uploadedFileName) {
              fileMeta = await ai.files.get({ name: uploadedFileName });
            }
          }

          if (fileMeta.state === 'FAILED' || !fileMeta.uri) {
            throw new Error('Gemini could not process the uploaded media file.');
          }

          mediaPart = {
            fileData: {
              fileUri: fileMeta.uri,
              mimeType: fileMeta.mimeType || mimeType,
            },
          };
        }

        const durationHint = durationSeconds
          ? `The total media duration is ${durationSeconds.toFixed(2)} seconds. Ensure every timestamp satisfies 0 <= start < end <= ${durationSeconds.toFixed(2)}.`
          : 'Ensure every timestamp is in chronological order with 0 <= start < end.';

        const promptText = [
          'Transcribe all spoken dialogue in this media accurately in its original language.',
          'Split the transcript into natural sentence or phrase segments (typically 2 to 8 seconds each).',
          'For each segment, provide exact start and end timestamps in seconds as numbers.',
          durationHint,
          'Do not paraphrase or summarize; keep the creator’s exact wording.',
          'If there is no audible speech, return an empty segments array.',
        ].join(' ');

        const response = await withRetry(() =>
          ai!.models.generateContent({
            model: TRANSCRIPTION_MODEL,
            contents: {
              parts: [mediaPart, { text: promptText }],
            },
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  segments: {
                    type: Type.ARRAY,
                    description: 'Chronological list of spoken transcript segments.',
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        start: {
                          type: Type.NUMBER,
                          description: 'Segment start time in seconds.',
                        },
                        end: {
                          type: Type.NUMBER,
                          description: 'Segment end time in seconds.',
                        },
                        text: {
                          type: Type.STRING,
                          description: 'Spoken words in this segment.',
                        },
                      },
                      required: ['start', 'end', 'text'],
                    },
                  },
                },
                required: ['segments'],
              },
            },
          })
        );

        const rawJson = (response.text ?? '').trim();
        let parsed: { segments?: RawTranscriptSegment[] } = {};
        try {
          parsed = JSON.parse(rawJson) as { segments?: RawTranscriptSegment[] };
        } catch {
          res.status(502).json({
            error: 'Received an unexpected transcript format from Gemini. Please try again.',
          });
          return;
        }

        const segments = normalizeSegments(
          Array.isArray(parsed.segments) ? parsed.segments : [],
          durationSeconds
        );

        res.json({
          segments,
          model: TRANSCRIPTION_MODEL,
        });
      } catch (err) {
        console.error('Transcription error:', err);
        const friendly = formatFriendlyGeminiError(err);
        res.status(friendly.status).json({ error: friendly.message });
      } finally {
        if (ai && uploadedFileName) {
          try {
            await ai.files.delete({ name: uploadedFileName });
          } catch (cleanupErr) {
            console.warn('Could not clean up temporary Gemini file:', cleanupErr);
          }
        }
      }
    }
  );

  app.post(
    '/api/highlights',
    express.json({ limit: '2mb' }),
    async (req: Request, res: Response) => {
      try {
        const ai = getGeminiClient();
        const body = req.body as {
          transcript?: IncomingTranscriptSegment[];
          durationSeconds?: unknown;
        };

        if (!Array.isArray(body?.transcript) || body.transcript.length === 0) {
          res.status(400).json({
            error:
              'A transcript is required before finding highlights. Please upload and transcribe a video first.',
          });
          return;
        }

        const sanitizedTranscript = body.transcript
          .map((seg) => ({
            start: Number(seg.start),
            end: Number(seg.end),
            text: typeof seg.text === 'string' ? seg.text.trim() : '',
          }))
          .filter(
            (seg) =>
              Number.isFinite(seg.start) &&
              Number.isFinite(seg.end) &&
              seg.start >= 0 &&
              seg.end > seg.start &&
              seg.text.length > 0
          );

        if (sanitizedTranscript.length === 0) {
          res.status(400).json({
            error:
              'The transcript has no spoken segments to analyze. Please try re-transcribing a video with speech.',
          });
          return;
        }

        const rawDuration = Number(body.durationSeconds);
        const lastEnd = sanitizedTranscript[sanitizedTranscript.length - 1].end;
        const durationSeconds =
          Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : lastEnd;

        const transcriptLines = sanitizedTranscript
          .map(
            (seg) => `[${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s] ${seg.text}`
          )
          .join('\n');

        const durationGuidance =
          durationSeconds >= 15
            ? 'Each highlight MUST be between 15 and 45 seconds long (end - start between 15 and 45 seconds), unless a single natural clip cannot reach 15 seconds.'
            : `The full video is ${durationSeconds.toFixed(
                1
              )} seconds long, so choose up to 3 strongest moments within 0 to ${durationSeconds.toFixed(
                2
              )} seconds.`;

        const basePrompt = [
          'Analyze this timestamped video transcript and select the 3 strongest moments for short-form vertical video (Shorts/Reels/TikTok).',
          'Criteria for each moment:',
          '- Strong opening hook in the first few seconds that grabs attention.',
          '- Clear, self-contained idea or payoff that makes sense without watching the whole video.',
          `- ${durationGuidance}`,
          `- Align start and end timestamps cleanly with the transcript boundaries within 0 to ${durationSeconds.toFixed(
            2
          )} seconds.`,
          '- Return ONLY a strict JSON array of objects with keys: start (number in seconds), end (number in seconds), reason (concise 1-2 sentence explanation of why this moment works), hook_score (integer 1 to 100 rating hook strength).',
          '- Do not wrap the JSON in markdown fences or add any extra text.',
          '',
          'Transcript:',
          transcriptLines,
        ].join('\n');

        let validatedHighlights: ValidatedHighlightMoment[] | null = null;

        for (let attempt = 0; attempt < 2; attempt++) {
          const promptText =
            attempt === 0
              ? basePrompt
              : `${basePrompt}\n\nIMPORTANT: Your previous response was not valid JSON matching [{start, end, reason, hook_score}]. Return ONLY a valid JSON array of 1 to 3 objects where start and end are numbers (0 <= start < end), reason is a non-empty string, and hook_score is a number from 1 to 100.`;

          const response = await withRetry(() =>
            ai.models.generateContent({
              model: TRANSCRIPTION_MODEL,
              contents: promptText,
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  description: 'Up to 3 strongest short-form video highlights.',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      start: {
                        type: Type.NUMBER,
                        description: 'Highlight start time in seconds.',
                      },
                      end: {
                        type: Type.NUMBER,
                        description: 'Highlight end time in seconds.',
                      },
                      reason: {
                        type: Type.STRING,
                        description:
                          'Why this moment has a strong hook and clear standalone idea.',
                      },
                      hook_score: {
                        type: Type.NUMBER,
                        description: 'Hook strength score from 1 to 100.',
                      },
                    },
                    required: ['start', 'end', 'reason', 'hook_score'],
                  },
                },
              },
            })
          );

          const rawText = response.text ?? '';
          validatedHighlights = parseAndValidateHighlights(rawText, durationSeconds);
          if (validatedHighlights) {
            break;
          }
        }

        if (!validatedHighlights) {
          res.status(502).json({
            error:
              'Gemini returned an unexpected highlights format after retrying. Please try again.',
          });
          return;
        }

        res.json({
          highlights: validatedHighlights,
          model: TRANSCRIPTION_MODEL,
        });
      } catch (err) {
        console.error('Highlights error:', err);
        const friendly = formatFriendlyGeminiError(err);
        res.status(friendly.status).json({ error: friendly.message });
      }
    }
  );

  app.post(
    '/api/captions',
    express.json({ limit: '2mb' }),
    async (req: Request, res: Response) => {
      try {
        const ai = getGeminiClient();
        const body = req.body as {
          highlights?: IncomingCaptionHighlight[];
          voiceSamples?: unknown;
        };

        const voiceSamples =
          typeof body?.voiceSamples === 'string' ? body.voiceSamples.trim() : '';

        if (!voiceSamples) {
          res.status(400).json({
            error:
              'Please paste 2 or 3 examples of your past posts so Gemini can match your voice.',
          });
          return;
        }

        if (!Array.isArray(body?.highlights) || body.highlights.length === 0) {
          res.status(400).json({
            error:
              'At least one highlight is required before generating captions. Find highlights first.',
          });
          return;
        }

        const sanitizedHighlights = body.highlights
          .map((item, idx) => ({
            id:
              typeof item.id === 'string' && item.id.trim()
                ? item.id.trim()
                : `hl-${idx + 1}`,
            start: Number(item.start),
            end: Number(item.end),
            reason: typeof item.reason === 'string' ? item.reason.trim() : '',
            transcriptText:
              typeof item.transcriptText === 'string' ? item.transcriptText.trim() : '',
          }))
          .filter(
            (item) =>
              Number.isFinite(item.start) &&
              Number.isFinite(item.end) &&
              (item.transcriptText.length > 0 || item.reason.length > 0)
          );

        if (sanitizedHighlights.length === 0) {
          res.status(400).json({
            error:
              'No valid highlight details were provided. Please regenerate highlights and try again.',
          });
          return;
        }

        const expectedIds = sanitizedHighlights.map((h) => h.id);

        const highlightsBlock = sanitizedHighlights
          .map(
            (h, index) =>
              [
                `Highlight ${index + 1} (highlightId: "${h.id}", ${h.start.toFixed(
                  2
                )}s - ${h.end.toFixed(2)}s):`,
                `Transcript: ${h.transcriptText || '(no transcript text)'}`,
                `Why it works: ${h.reason || '(not provided)'}`,
              ].join('\n')
          )
          .join('\n\n');

        const basePrompt = [
          'You are helping a content creator repurpose video highlights into social media captions while preserving their authentic personal voice.',
          '',
          'Creator’s Past Posts (Voice Samples):',
          '"""',
          voiceSamples,
          '"""',
          '',
          'Highlights to Caption:',
          highlightsBlock,
          '',
          'For EACH highlight above (preserving the exact highlightId), generate:',
          '1. title: A concise, scroll-stopping title in the creator’s own voice.',
          '2. voiceCaption: A social caption written in the creator’s voice matching the tone, sentence length, vocabulary, punctuation, capitalization, and formatting habits of the pasted samples.',
          '3. hashtags: Exactly 5 relevant hashtags (each starting with #) tailored to the clip and creator’s style.',
          '4. genericCaption: A plain "generic AI" social caption for the same moment (polished, cliché, typical AI social copy that does NOT imitate the creator’s personal quirks).',
          '5. voiceToneMatchScore: An honest score from 0 to 100 measuring how closely voiceCaption matches the pasted samples.',
          '6. voiceToneMatchExplanation: Exactly one concise sentence explaining why voiceCaption matches the samples.',
          '7. genericToneMatchScore: An honest score from 0 to 100 measuring how closely genericCaption matches the pasted samples.',
          '8. genericToneMatchExplanation: Exactly one concise sentence explaining how well genericCaption matches (or misses) the samples.',
          '',
          `Return ONLY a strict JSON array with exactly ${sanitizedHighlights.length} objects in the same order as the highlights above.`,
        ].join('\n');

        let validatedCaptions: ValidatedCaptionItem[] | null = null;

        for (let attempt = 0; attempt < 2; attempt++) {
          const promptText =
            attempt === 0
              ? basePrompt
              : `${basePrompt}\n\nIMPORTANT: Your previous response did not match the required JSON schema. Return ONLY a valid JSON array with ${sanitizedHighlights.length} items, each containing highlightId, title, voiceCaption, exactly 5 hashtags, voiceToneMatchScore (0-100), voiceToneMatchExplanation, genericCaption, genericToneMatchScore (0-100), and genericToneMatchExplanation.`;

          const response = await withRetry(() =>
            ai.models.generateContent({
              model: TRANSCRIPTION_MODEL,
              contents: promptText,
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  description: 'Captions and tone match scores for each highlight.',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      highlightId: { type: Type.STRING },
                      title: { type: Type.STRING },
                      voiceCaption: { type: Type.STRING },
                      hashtags: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      voiceToneMatchScore: { type: Type.NUMBER },
                      voiceToneMatchExplanation: { type: Type.STRING },
                      genericCaption: { type: Type.STRING },
                      genericToneMatchScore: { type: Type.NUMBER },
                      genericToneMatchExplanation: { type: Type.STRING },
                    },
                    required: [
                      'highlightId',
                      'title',
                      'voiceCaption',
                      'hashtags',
                      'voiceToneMatchScore',
                      'voiceToneMatchExplanation',
                      'genericCaption',
                      'genericToneMatchScore',
                      'genericToneMatchExplanation',
                    ],
                  },
                },
              },
            })
          );

          const rawText = response.text ?? '';
          validatedCaptions = parseAndValidateCaptions(rawText, expectedIds);
          if (validatedCaptions) {
            break;
          }
        }

        if (!validatedCaptions) {
          res.status(502).json({
            error:
              'Gemini returned an unexpected captions format after retrying. Please try again.',
          });
          return;
        }

        res.json({
          captions: validatedCaptions,
          model: TRANSCRIPTION_MODEL,
        });
      } catch (err) {
        console.error('Captions error:', err);
        const friendly = formatFriendlyGeminiError(err);
        res.status(friendly.status).json({ error: friendly.message });
      }
    }
  );

  app.post(
    '/api/translate',
    express.json({ limit: '2mb' }),
    async (req: Request, res: Response) => {
      try {
        const ai = getGeminiClient();
        const body = req.body as {
          targetLanguage?: unknown;
          voiceSamples?: unknown;
          items?: IncomingTranslationItem[];
        };

        const targetLanguage =
          body?.targetLanguage === 'hi' || body?.targetLanguage === 'bn'
            ? body.targetLanguage
            : null;

        if (!targetLanguage) {
          res.status(400).json({
            error: 'Please choose either Hindi or Bengali as the translation language.',
          });
          return;
        }

        if (!Array.isArray(body?.items) || body.items.length === 0) {
          res.status(400).json({
            error: 'Generate captions first before translating them.',
          });
          return;
        }

        const sanitizedItems = body.items
          .map((item, idx) => ({
            highlightId:
              typeof item.highlightId === 'string' && item.highlightId.trim()
                ? item.highlightId.trim()
                : `hl-${idx + 1}`,
            title: typeof item.title === 'string' ? item.title.trim() : '',
            caption: typeof item.caption === 'string' ? item.caption.trim() : '',
            hashtags: Array.isArray(item.hashtags)
              ? item.hashtags
                  .map((t) => (typeof t === 'string' ? t.trim() : ''))
                  .filter(Boolean)
              : [],
          }))
          .filter((item) => item.title.length > 0 || item.caption.length > 0);

        if (sanitizedItems.length === 0) {
          res.status(400).json({
            error: 'No valid caption content was provided to translate.',
          });
          return;
        }

        const expectedIds = sanitizedItems.map((item) => item.highlightId);
        const languageName =
          targetLanguage === 'hi'
            ? 'Hindi (written naturally in Devanagari script)'
            : 'Bengali (written naturally in Bengali/Bangla script)';

        const voiceSamples =
          typeof body?.voiceSamples === 'string' ? body.voiceSamples.trim() : '';

        const itemsBlock = sanitizedItems
          .map(
            (item, idx) =>
              [
                `Item ${idx + 1} (highlightId: "${item.highlightId}"):`,
                `Title: ${item.title}`,
                `Caption: ${item.caption}`,
                `Hashtags: ${item.hashtags.join(' ')}`,
              ].join('\n')
          )
          .join('\n\n');

        const basePrompt = [
          `Translate the following creator titles, captions, and 5 hashtags from English into ${languageName}.`,
          'Requirements:',
          '- Preserve the creator’s personal tone, energy, punchy phrasing, line breaks, and ALL emojis accurately.',
          '- Write natural, idiomatic phrasing that sounds like a real creator speaking natively in that language—never stiff word-for-word translation.',
          '- Translate or adapt the 5 hashtags naturally into the target language script (each starting with #, no spaces inside a hashtag).',
          voiceSamples
            ? `\nReference creator voice samples (English, for tone & style):\n"""\n${voiceSamples}\n"""`
            : '',
          '',
          'Items to translate:',
          itemsBlock,
          '',
          `Return ONLY a strict JSON array with ${sanitizedItems.length} objects matching [{highlightId, title, caption, hashtags}] in the same order.`,
        ]
          .filter(Boolean)
          .join('\n');

        let validatedTranslations: ValidatedTranslationItem[] | null = null;

        for (let attempt = 0; attempt < 2; attempt++) {
          const promptText =
            attempt === 0
              ? basePrompt
              : `${basePrompt}\n\nIMPORTANT: Your previous response did not match the required JSON schema. Return ONLY a valid JSON array with ${sanitizedItems.length} objects, each containing highlightId, title, caption, and exactly 5 hashtags.`;

          const response = await withRetry(() =>
            ai.models.generateContent({
              model: TRANSCRIPTION_MODEL,
              contents: promptText,
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  description: 'Translated title, caption, and 5 hashtags per highlight.',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      highlightId: { type: Type.STRING },
                      title: { type: Type.STRING },
                      caption: { type: Type.STRING },
                      hashtags: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                    },
                    required: ['highlightId', 'title', 'caption', 'hashtags'],
                  },
                },
              },
            })
          );

          const rawText = response.text ?? '';
          validatedTranslations = parseAndValidateTranslations(rawText, expectedIds);
          if (validatedTranslations) {
            break;
          }
        }

        if (!validatedTranslations) {
          res.status(502).json({
            error:
              'Gemini returned an unexpected translation format after retrying. Please try again.',
          });
          return;
        }

        res.json({
          language: targetLanguage,
          translations: validatedTranslations,
          model: TRANSCRIPTION_MODEL,
        });
      } catch (err) {
        console.error('Translation error:', err);
        const friendly = formatFriendlyGeminiError(err);
        res.status(friendly.status).json({ error: friendly.message });
      }
    }
  );

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api')) {
      next(err);
      return;
    }
    const status = (err as { status?: number })?.status;
    if (status === 413 || (err as { type?: string })?.type === 'entity.too.large') {
      res.status(413).json({
        error: 'The uploaded media exceeds the 20 MB limit. Please choose a smaller video file.',
      });
      return;
    }
    console.error('API middleware error:', err);
    res.status(500).json({
      error: 'An unexpected server error occurred. Please try again.',
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`One-Take Repurposer server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
