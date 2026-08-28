"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import type { Locale as RainbowKitLocale } from "@rainbow-me/rainbowkit"

import { en } from "./en"
import { zh } from "./zh"

export type Locale = "en" | "zh"

/** The English set defines the shape; every other locale must match it. */
export type Messages = typeof en

/**
 * Locales offered in the picker, in the order they appear.
 *
 * `html` goes on <html lang>; `rainbowkit` is the tag RainbowKit knows, so the
 * wallet modal -- which this app does not own the copy for -- follows the same
 * choice rather than staying English inside a Chinese page.
 */
export const LOCALES: {
  code: Locale
  label: string
  html: string
  rainbowkit: RainbowKitLocale
}[] = [
  { code: "en", label: "EN", html: "en", rainbowkit: "en" },
  { code: "zh", label: "中文", html: "zh-Hans", rainbowkit: "zh-Hans" },
]

/**
 * Fallback, and the locale the page is prerendered in. Anything the browser
 * asks for that is not translated lands here rather than on empty text.
 */
export const DEFAULT_LOCALE: Locale = "en"

const DICTIONARIES: Record<Locale, Messages> = { en, zh }

const STORAGE_KEY = "locale"

const isLocale = (v: unknown): v is Locale => v === "en" || v === "zh"

/**
 * Which locale to start in: an explicit choice from a previous visit first,
 * then what the browser asks for, then English.
 *
 * navigator.languages is in preference order and holds full tags -- "zh-CN",
 * "zh-Hant-TW", "en-GB" -- so match on the primary subtag. A browser that
 * prefers a language this app does not have (fr, then zh) still gets its
 * second choice rather than being forced to English.
 */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    // storage blocked -- fall through to the browser's own preference
  }

  if (typeof navigator === "undefined") return DEFAULT_LOCALE
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of preferred) {
    const primary = tag?.toLowerCase().split("-")[0]
    if (isLocale(primary)) return primary
  }
  return DEFAULT_LOCALE
}

type I18nValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Messages
  /** The active entry from LOCALES, for consumers that need its tags. */
  entry: (typeof LOCALES)[number]
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  /**
   * Always start at the fallback.
   *
   * The page is prerendered to static HTML in English, and rendering anything
   * else on the first client pass would not match that HTML -- React would
   * discard the tree with a hydration error. The real locale is applied in an
   * effect, one paint later.
   */
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    setLocaleState(detectLocale())
  }, [])

  const entry = LOCALES.find((l) => l.code === locale) ?? LOCALES[0]

  /**
   * `lang` is what a screen reader picks its voice from and what the browser
   * offers to translate against, so leaving it at "en" on a Chinese page is
   * not cosmetic. <html> is outside this tree, so it is set imperatively --
   * nothing else writes to it, unlike the title.
   */
  useEffect(() => {
    document.documentElement.lang = entry.html
  }, [entry])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // storage blocked -- the choice just will not survive a reload
    }
  }, [])

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: DICTIONARIES[locale], entry }),
    [locale, setLocale, entry]
  )

  return (
    <I18nContext.Provider value={value}>
      {/* React hoists this into <head>. Rendering it rather than assigning
          document.title is what makes it survive later commits. */}
      <title>{DICTIONARIES[locale].meta.title}</title>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>")
  return value
}

/** Messages alone, which is all most components need. */
export function useT(): Messages {
  return useI18n().t
}
