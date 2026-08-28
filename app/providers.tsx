"use client"

import { useState, type ReactNode } from "react"
import { WagmiProvider } from "wagmi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit"
import "@rainbow-me/rainbowkit/styles.css"

import { wagmiConfig } from "@/lib/wagmi"
import { I18nProvider, useI18n } from "@/lib/i18n"

const accent = {
  accentColor: "#7c3aed",
  accentColorForeground: "white",
  borderRadius: "large" as const,
}

/**
 * Both themes are handed to RainbowKit at once so it can switch via CSS.
 * Picking one from useTheme() instead would render a different <style> block on
 * the server than on the client and trip a hydration mismatch.
 */
const rainbowTheme = {
  lightMode: lightTheme(accent),
  darkMode: darkTheme(accent),
}

export function Providers({ children }: { children: ReactNode }) {
  // One client per mount, so SSR and client don't share a cache.
  const [queryClient] = useState(() => new QueryClient())

  return (
    <I18nProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <LocalizedRainbowKit>{children}</LocalizedRainbowKit>
        </QueryClientProvider>
      </WagmiProvider>
    </I18nProvider>
  )
}

/**
 * RainbowKit owns the copy in the connect button and the wallet modal, so it
 * has to be told the locale too -- otherwise picking 中文 leaves an English
 * dialog sitting in the middle of a Chinese page.
 */
function LocalizedRainbowKit({ children }: { children: ReactNode }) {
  const { entry } = useI18n()

  return (
    <RainbowKitProvider theme={rainbowTheme} modalSize="compact" locale={entry.rainbowkit}>
      {children}
    </RainbowKitProvider>
  )
}
