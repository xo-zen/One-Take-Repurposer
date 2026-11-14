# One-Take Repurposer

**Built for Genarrative Clash** — *Where Gen AI Meets Human Creativity*

One-Take Repurposer helps content creators turn **one** long-form video into ready-to-publish short-form assets—vertical `9:16` clips with burned-in subtitles, voice-matched captions, styled thumbnails, and multilingual translations—while keeping the **human creator as the final author**. Nothing is exported without the creator's explicit approval.

---

## Core Philosophy: Human-in-the-Loop AI

- **Your Voice, Not Generic AI**: Paste 2–3 examples of your past posts and compare a generic AI draft side by side against a caption written in your personal tone, cadence, and punctuation—scored `0–100` for tone match.
- **Creator Authorship First**: Every generated title, caption, and translation is editable inline, tracked with live edit counters, and gated behind explicit **Approve** / **Reject** controls.
- **Zero-Cost Browser Processing**: Video cropping, subtitle burn-in, frame capture, thumbnail compositing, and `.zip` packaging all run directly in the browser—no paid video-processing APIs required.

---

## Left-to-Right 5-Step Workflow

### 1. Upload (`01 Upload`)
- Upload a video file (up to **5 minutes** and **20 MB**) with an integrated HTML5 preview player.
- Extracts `16 kHz` mono WAV audio directly in the browser via Web Audio (`OfflineAudioContext`), automatically falling back to the video file if audio decoding isn't supported.
- Sends the media to the **Gemini API** (`/api/transcribe`) to produce a clickable, playback-synced transcript with `[start, end, text]` timestamps.

### 2. Highlights (`02 Highlights`)
- Sends the timestamped transcript to Gemini (`/api/highlights`) to identify the **3 strongest short-form moments** (`15–45s` with a strong opening hook and standalone payoff).
- Enforces strict JSON validation (`[{ start, end, reason, hook_score }]`), strips markdown fences, and retries automatically if malformed.
- Displays overlapping transcript text, hook reasoning, hook score, a jump-to-moment play button, and the ability to delete unwanted highlights.

### 3. Captions & Translations (`03 Captions`)
- **Voice Matching**: Paste 2–3 past posts and generate a **Title**, **Caption**, and **5 Hashtags** per highlight (`/api/captions`).
- **Side-by-Side Proof**: View **Generic AI** next to **In your voice**, each with a `0–100` tone match score and one-line explanation.
- **Inline Editing & Approval**: Edit any title or caption directly, track *"You edited X of Y captions · Approved Z of Y"*, and approve or reject each item. Only approved items advance to Clips and Export.
- **Multilingual Switching (`English`, `Hindi`, `Bengali`)**: Switch languages to translate titles, captions, and 5 hashtags with Gemini (`/api/translate`) while preserving your tone and emojis. The **English Original** stays visible side by side, and translated text renders using `Noto Sans Devanagari` and `Noto Sans Bengali`.

### 4. Clips & Thumbnails (`04 Clips`)
- **9:16 Vertical Shorts**: Uses `ffmpeg.wasm` (single-threaded build served locally from `/public/ffmpeg/`) to crop each approved highlight to `720×1280` (`9:16`) and burn in timed caption subtitles rendered onto transparent canvas overlays (with full Hindi, Bengali, and emoji font support).
- **Per-Clip Controls**: Live progress bar (`0–100%`), in-browser MP4 preview player, individual and batch rendering, and MP4 download.
- **Thumbnail Generator**: Scores candidate frames inside each highlight range (falling back to the midpoint) to capture the sharpest frame, then lets you toggle between **3 dark-gradient title overlay styles** (`Editorial Bottom`, `Bold Center`, `Top Headline`) and download as a `720×1280` PNG.

### 5. Export (`05 Export`)
- **Impact Summary**: Shows **Clips Made**, **Captions Edited**, **Languages** included, and **Estimated Editing Time Saved** (calculated at `30 minutes per clip`).
- **One-Click ZIP Bundle**: Bundles all approved `9:16` MP4 clips (`clips/`), PNG thumbnails (`thumbnails/`), and a UTF-8 `captions-and-translations.txt` file containing all English originals, edited captions, hashtags, and translations into a single downloadable `.zip` via `JSZip`.
- Any unrendered approved clips or thumbnails are automatically prepared before bundling if not already rendered.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide Icons |
| **AI** | Google Gemini API (`@google/genai`) via server-side Express routes |
| **In-Browser Video** | `@ffmpeg/ffmpeg` (`0.12.x`), `@ffmpeg/core` (single-threaded WASM) |
| **Thumbnail & Subtitle Rendering** | HTML5 `<canvas>` + Google Fonts (`Plus Jakarta Sans`, `DM Sans`, `Noto Sans Devanagari`, `Noto Sans Bengali`) |
| **Packaging** | `JSZip` (client-side `.zip` generation) |
| **Backend Server** | Node.js + Express (`server.ts` serving Vite middleware in dev & static `dist/` in production) |

---

## Project Structure

```text
├── public/ffmpeg/               # Local single-threaded ffmpeg-core.js & ffmpeg-core.wasm
├── server.ts                    # Express server + Gemini API proxy routes (/api/*)
├── index.html                   # App entry + Google Fonts (Latin, Devanagari, Bengali)
├── src/
│   ├── App.tsx                  # Central workflow state, step navigation, & orchestration
│   ├── index.css                # Tailwind v4 + font-family configuration
│   ├── types/repurposer.ts      # Shared TypeScript interfaces across all stages
│   ├── components/
│   │   ├── ErrorBoundary.tsx    # Graceful fallback UI on unexpected runtime errors
│   │   ├── UploadStage.tsx      # Stage 1: Video upload, player, & timestamped transcript
│   │   ├── HighlightsStage.tsx  # Stage 2: 3 AI-picked highlights, playback jump, delete
│   │   ├── CaptionsStage.tsx    # Stages 3, 4 & 7: Voice samples, comparison, editing, approve, translate
│   │   ├── ClipsStage.tsx       # Stages 5 & 6: 9:16 FFmpeg clips + 3-style thumbnails
│   │   └── ExportStage.tsx      # Stage 8: Summary stats + approval-gated ZIP export
│   └── utils/
│       ├── extractAudio.ts      # Browser 16 kHz mono WAV audio extraction + video fallback
│       ├── renderClip.ts        # Single-threaded ffmpeg.wasm 9:16 crop & subtitle burn-in
│       ├── generateThumbnail.ts # Best-frame scoring + 3 dark-gradient thumbnail styles
│       ├── captionLanguage.ts   # Active language resolver (English / Hindi / Bengali)
│       ├── exportBundle.ts      # JSZip bundler & captions-and-translations.txt builder
│       └── formatTime.ts        # Timestamp & file-size formatters
└── .env.example                 # Required environment variable template
```

---

## API Endpoints

All Gemini API calls run server-side in `server.ts` so `GEMINI_API_KEY` is never exposed to the browser:

- `GET /api/health` — Server health check
- `POST /api/transcribe` — Accepts binary audio/video up to `20 MB` and returns timestamped transcript segments
- `POST /api/highlights` — Extracts up to 3 high-hook `15–45s` moments with strict JSON validation + retry
- `POST /api/captions` — Generates voice-matched vs generic AI captions, titles, 5 hashtags, and tone match scores
- `POST /api/translate` — Translates titles, captions, and hashtags into Hindi (`hi`) or Bengali (`bn`) while keeping creator tone and emojis

---

## Local Setup

### Prerequisites
- Node.js `20+`
- A Gemini API key

### Installation & Running

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   Copy `.env.example` to `.env` and add your Gemini API key:
   ```bash
   cp .env.example .env
   ```
   ```env
   GEMINI_API_KEY="your_gemini_api_key_here"
   ```

3. **Start the development server** (runs Express + Vite on port `3000`):
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

4. **Type-check & build for production**:
   ```bash
   npm run lint
   npm run build
   npm start
   ```
