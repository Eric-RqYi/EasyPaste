import zhCN from './locales/zh-CN.json';
import en from './locales/en.json';
import ko from './locales/ko.json';

export type Locale = 'zh-CN' | 'en' | 'ko';
export type MessageKey = keyof typeof zhCN;
export type MessageParams = Readonly<Record<string, string | number>>;
export type Translator = (key: MessageKey, params?: MessageParams) => string;
export type Catalog = Record<MessageKey, string>;
export type CatalogRegistry = Partial<Record<Locale, Partial<Catalog>>>;
export const DEFAULT_LOCALE: Locale = 'zh-CN';
export const LOCALES = ['zh-CN', 'en', 'ko'] as const;
const catalogs = { 'zh-CN': zhCN, en, ko } satisfies Record<Locale, Catalog>;

export function normalizeLocale(value: unknown): Locale {
  return LOCALES.includes(value as Locale) ? value as Locale : DEFAULT_LOCALE;
}

export function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
}

/** A locale is selectable only when every message and placeholder is present. */
export function isLocaleReady(locale: Locale, registry: CatalogRegistry = catalogs): boolean {
  const catalog = registry[locale];
  return !!catalog && (Object.keys(zhCN) as MessageKey[]).every(key => {
    const value = catalog[key];
    return typeof value === 'string' && !!value.trim()
      && JSON.stringify(placeholders(value)) === JSON.stringify(placeholders(zhCN[key]));
  });
}

/** Translators are scoped to a plugin/window; no process-wide mutable language. */
export function createTranslator(locale: unknown = DEFAULT_LOCALE, registry: CatalogRegistry = catalogs): Translator {
  const catalog = registry[normalizeLocale(locale)];
  return (key, params = {}) => {
    const candidate = catalog?.[key];
    const template = typeof candidate === 'string' && candidate.trim()
      && JSON.stringify(placeholders(candidate)) === JSON.stringify(placeholders(zhCN[key]))
      ? candidate : zhCN[key];
    // One pass: user text containing braces, $&, or $1 stays literal.
    return template.replace(/\{(\w+)\}/g, (token, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : token);
  };
}

export const defaultT = createTranslator();

/** Stable keys replace language-dependent error-message matching. */
export class UserFacingError extends Error {
  constructor(readonly key: MessageKey, readonly params: MessageParams = {}, t: Translator = defaultT) {
    super(t(key, params));
    this.name = 'UserFacingError';
  }
}

/** Never display raw host/transport errors, which can contain secrets or source text. */
export function errorText(error: unknown, t: Translator = defaultT, fallback: MessageKey = 'common.operationFailed'): string {
  return error instanceof UserFacingError ? t(error.key, error.params) : t(fallback);
}
