import { defaultT, UserFacingError, type MessageKey, type Translator } from './i18n';
import type { ApiSettings } from './settings';
export type Request = (request: { url: string; method: string; headers: Record<string, string>; body: string; throw: boolean }) => Promise<{ status: number; json: unknown }>;
export type ConversionMode = 'text' | 'image';
export function completionUrl(base: string, t: Translator = defaultT): string {
  let url: URL;
  try { url = new URL(base.trim()); }
  catch { throw new UserFacingError('api.invalidUrl', {}, t); }
  if (url.username || url.password || url.search || url.hash) throw new UserFacingError('api.urlCredentials', {}, t);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new UserFacingError('api.httpsRequired', {}, t);
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return url.toString();
}
export function extractCompletion(json: unknown, t: Translator = defaultT): string {
  const data = json as { choices?: { finish_reason?: string; message?: { content?: unknown; refusal?: string } }[] };
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new UserFacingError('api.outputTruncated', {}, t);
  if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new UserFacingError('api.refused', {}, t);
  const content = choice?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('') : '';
  if (!text.trim()) throw new UserFacingError('api.emptyOutput', {}, t);
  // Never strip valid code fences: the source may itself be code.
  return text;
}
export async function convertWithApi(options: {
  t?: Translator;
  api: ApiSettings; key: string; mode: ConversionMode; input: string; images?: string[];
  instructions: string; timeoutSeconds: number; signal: AbortSignal; request: Request;
}): Promise<string> {
  const { api, key, mode, input, signal, request } = options;
  const t = options.t ?? defaultT;
  const model = api.model.trim();
  const section = mode === 'image' ? t('api.imageSection') : t('api.textSection');
  if (!model) throw new UserFacingError('api.modelMissing', { section }, t);
  if (!key.trim()) throw new UserFacingError('api.keyMissing', { section }, t);
  if (!api.baseUrl.trim()) throw new UserFacingError('api.urlMissing', { section }, t);
  if (signal.aborted) throw new UserFacingError('api.cancelled', {}, t);
  const url = completionUrl(api.baseUrl, t);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const response = await Promise.race([
      request({ url, method: 'POST', throw: false,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
        body: JSON.stringify({ model, stream: false, messages: [
          { role: 'system', content: api.prompt + (options.instructions.trim() ? `\n\n${options.instructions}` : '') },
          { role: 'user', content: mode === 'image' ? [
            { type: 'text', text: options.images ? input : '' },
            ...(options.images ?? [input]).map(url => ({ type: 'image_url', image_url: { url } }))
          ] : input }
        ] }) }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new UserFacingError('api.timeout', {}, t)), options.timeoutSeconds * 1000);
        abort = () => reject(new UserFacingError('api.cancelled', {}, t));
        signal.addEventListener('abort', abort, { once: true });
      })
    ]);
    if (signal.aborted) throw new UserFacingError('api.cancelled', {}, t);
    if (response.status < 200 || response.status >= 300) {
      const hints: Record<number, MessageKey> = { 401: 'api.status401', 403: 'api.status403', 404: 'api.status404', 413: 'api.status413', 429: 'api.status429' };
      throw new UserFacingError('api.requestFailed', { status: response.status, hint: t(hints[response.status] ?? 'api.statusOther') }, t);
    }
    return extractCompletion(response.json, t);
  } catch (error) {
    // Do not display raw transport errors: they may contain credentials or source text.
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError('api.connectionFailed', {}, t);
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener('abort', abort);
  }
}
