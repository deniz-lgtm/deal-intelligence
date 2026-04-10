import OpenAI from "openai";

// 25 MB — OpenAI Whisper's current per-request file size limit.
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

let _client: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. Add it to enable site-walk audio transcription."
    );
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

export interface TranscriptionResult {
  text: string;
  duration: number | null;
}

/**
 * Transcribe an audio or video file using OpenAI Whisper.
 * Whisper's /audio/transcriptions endpoint natively accepts common audio and
 * video formats (mp3, mp4, mpeg, mpga, m4a, wav, webm, mov) up to 25 MB.
 */
export async function transcribeMedia(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<TranscriptionResult> {
  if (buffer.length > WHISPER_MAX_BYTES) {
    throw new Error(
      `File is ${(buffer.length / (1024 * 1024)).toFixed(1)}MB — exceeds Whisper's 25MB limit. Please upload a shorter recording or compress it first.`
    );
  }

  const client = getOpenAI();

  // The OpenAI SDK expects a File-like object. Construct one from the buffer.
  const file = new File([new Uint8Array(buffer)], filename, { type: mimeType });

  const result = await client.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
  });

  // verbose_json returns { text, duration, language, segments }
  const anyResult = result as unknown as { text: string; duration?: number };
  return {
    text: anyResult.text || "",
    duration: typeof anyResult.duration === "number" ? Math.round(anyResult.duration) : null,
  };
}

export function isSupportedMediaMime(mime: string): { ok: boolean; media_type: "audio" | "video" | null } {
  const m = mime.toLowerCase();
  if (m.startsWith("audio/")) return { ok: true, media_type: "audio" };
  if (m.startsWith("video/")) return { ok: true, media_type: "video" };
  return { ok: false, media_type: null };
}
