import type { ApiSettings } from './settings';
export type Request = (request: { url: string; method: string; headers: Record<string, string>; body: string; throw: boolean }) => Promise<{ status: number; json: unknown }>;
export type ConversionMode = 'text' | 'image';
export function completionUrl(base: string): string {
  const url = new URL(base.trim());
  if (url.username || url.password || url.search || url.hash) throw new Error('Base URL 不能包含凭据、查询参数或锚点。');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('请使用 HTTPS；本地 localhost 服务可使用 HTTP。');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return url.toString();
}
export function extractCompletion(json: unknown): string {
  const data = json as { choices?: { finish_reason?: string; message?: { content?: unknown; refusal?: string } }[] };
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('模型输出被截断，请缩短输入或更换支持更长输出的模型。');
  if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new Error('供应商未能转换这段内容。');
  const content = choice?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('') : '';
  if (!text.trim()) throw new Error('API 未返回文本，请确认模型支持 Chat Completions 和所选输入类型。');
  // Never strip valid code fences: the source may itself be code.
  return text;
}
export async function convertWithApi(options: {
  api: ApiSettings; key: string; mode: ConversionMode; input: string; images?: string[];
  instructions: string; timeoutSeconds: number; signal: AbortSignal; request: Request;
}): Promise<string> {
  const { api, key, mode, input, signal, request } = options;
  const model = api.model.trim();
  const section = mode === 'image' ? '图片转换' : '智能转换';
  if (!model) throw new Error(`请在 EasyPaste 设置的「${section}」中填写 Model Name（模型名称）。`);
  if (!key.trim()) throw new Error(`请在 EasyPaste 设置的「${section}」中配置 API Key。`);
  if (!api.baseUrl.trim()) throw new Error(`请在 EasyPaste 设置的「${section}」中填写 Base URL。`);
  if (signal.aborted) throw new Error('已取消转换');
  const url = completionUrl(api.baseUrl);
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
        timer = setTimeout(() => reject(new Error('请求超时，请检查网络或模型配置后重试。')), options.timeoutSeconds * 1000);
        abort = () => reject(new Error('已取消转换'));
        signal.addEventListener('abort', abort, { once: true });
      })
    ]);
    if (signal.aborted) throw new Error('已取消转换');
    if (response.status < 200 || response.status >= 300) {
      const hints: Record<number, string> = { 401: 'API Key 无效', 403: '没有模型访问权限', 404: '地址或模型不存在', 413: '输入或图片过大', 429: '额度不足或请求过于频繁' };
      throw new Error(`API 请求失败（${response.status}）：${hints[response.status] ?? '请检查供应商服务状态和设置'}`);
    }
    return extractCompletion(response.json);
  } catch (error) {
    // Do not display raw transport errors: they may contain credentials or source text.
    if (error instanceof Error && /^(API 请求失败|模型输出|供应商未能|API 未返回|请求超时|已取消)/.test(error.message)) throw error;
    throw new Error('无法连接 API，请检查网络、Base URL 与供应商配置。');
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener('abort', abort);
  }
}
