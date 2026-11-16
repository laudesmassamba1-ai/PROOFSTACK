import { normalizeUiLocale, type UiLocale } from "@proofstack/contracts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type MessageKey as BaseKey, en, fr } from "./dictionaries.js";
import { type MarketingKey, marketingEn, marketingFr } from "./marketing.js";

export type MessageKey = BaseKey | MarketingKey;
type Messages = Record<MessageKey, string>;

const DICTIONARIES: Record<UiLocale, Messages> = {
  en: { ...en, ...marketingEn },
  fr: { ...fr, ...marketingFr },
};

const STORAGE_KEY = "proofstack.locale";

interface I18nValue {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  messages: Messages;
}

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLocale(): UiLocale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeUiLocale(stored);
    const nav = window.navigator.language;
    // A French-speaking visitor gets French, but an explicit stored choice wins.
    return normalizeUiLocale(nav);
  } catch {
    return "en";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>(() => readStoredLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* private mode: the choice still applies for this visit */
    }
  }, [locale]);

  const setLocale = useCallback((next: UiLocale) => setLocaleState(next), []);

  const value = useMemo<I18nValue>(() => {
    const messages = DICTIONARIES[locale];
    return {
      locale,
      setLocale,
      messages,
      t: (key, vars) => {
        const template = messages[key] ?? DICTIONARIES.en[key] ?? key;
        if (!vars) return template;
        return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
          String(vars[name] ?? `{${name}}`)
        );
      },
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
