"use client"

import { Languages } from "lucide-react"

import { LOCALES, useI18n } from "@/lib/i18n"

/**
 * Both languages are shown at once rather than behind a dropdown: with two
 * options a toggle costs one click instead of two, and someone who cannot read
 * the current language can still see their own listed.
 */
export default function LanguagePicker() {
  const { locale, setLocale, t } = useI18n()

  return (
    <div
      className="inline-flex items-center gap-1 rounded-xl border border-border/60 bg-card/50 px-1.5 py-1 backdrop-blur"
      role="group"
      aria-label={t.language.label}
    >
      <Languages className="h-3.5 w-3.5 shrink-0 text-violet-400" aria-hidden />
      {LOCALES.map((option) => (
        <button
          key={option.code}
          type="button"
          lang={option.html}
          onClick={() => setLocale(option.code)}
          aria-pressed={locale === option.code}
          className={`rounded-lg px-1.5 py-0.5 text-xs transition-colors ${
            locale === option.code
              ? "bg-violet-500/20 text-violet-200"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
