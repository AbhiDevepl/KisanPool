import { config } from '../../config';
import { ApiError } from '../../lib/envelope';
import type { Language } from '@kisanpool/shared';

/**
 * All Sarvam calls are proxied here so the key never leaves the server
 * (docs/ARCHITECTURE.md §5). A transport failure surfaces as AI_TOOL_ERROR —
 * the assistant says it could not do it rather than inventing a result.
 */
async function sarvamFetch(path: string, init: RequestInit): Promise<Response> {
  if (!config.sarvam.apiKey) {
    throw new ApiError('AI_TOOL_ERROR', 'Voice assistant is not configured on this server.');
  }

  const res = await fetch(`${config.sarvam.baseUrl}${path}`, {
    ...init,
    headers: {
      'api-subscription-key': config.sarvam.apiKey,
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[sarvam]', path, res.status, detail.slice(0, 300));
    throw new ApiError('AI_TOOL_ERROR', "I couldn't understand that. Please try on screen.");
  }
  return res;
}

export async function speechToText(
  file: Express.Multer.File,
): Promise<{ transcript: string; language: Language }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file.buffer)]), file.originalname || 'audio.m4a');
  form.append('model', config.sarvam.sttModel);
  form.append('mode', 'transcribe');

  const res = await sarvamFetch('/speech-to-text', { method: 'POST', body: form });
  const json = (await res.json()) as { transcript?: string; language_code?: string };

  return {
    transcript: json.transcript ?? '',
    language: normaliseLanguage(json.language_code),
  };
}

export async function textToSpeech(text: string, language: Language): Promise<string> {
  const res = await sarvamFetch('/text-to-speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      model: config.sarvam.ttsModel,
      target_language_code: toSarvamLocale(language),
    }),
  });

  const json = (await res.json()) as { audios?: string[] };
  const audio = json.audios?.[0];
  if (!audio) throw new ApiError('AI_TOOL_ERROR', 'I could not speak that reply.');
  return audio;
}

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function chatCompletion(messages: ChatTurn[]): Promise<string> {
  const res = await sarvamFetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.sarvam.chatModel,
      messages,
      temperature: 0.2,
    }),
  });

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? '';
}

export function normaliseLanguage(code: string | undefined): Language {
  const base = (code ?? 'en').slice(0, 2).toLowerCase();
  return base === 'mr' || base === 'hi' ? base : 'en';
}

function toSarvamLocale(language: Language): string {
  return { mr: 'mr-IN', hi: 'hi-IN', en: 'en-IN' }[language];
}

export const sarvamConfigured = (): boolean => Boolean(config.sarvam.apiKey);
