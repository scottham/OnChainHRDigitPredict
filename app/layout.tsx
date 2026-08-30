import type { Metadata } from "next"
import { Geist, Azeret_Mono as Geist_Mono } from "next/font/google"
import { Toaster } from "sonner"

import { ThemeProvider } from "@/components/theme-provider"
import { Providers } from "./providers"
import "./globals.css"

const geistSans = Geist({ subsets: ["latin"], variable: "--font-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

/**
 * No `title` here on purpose: the page's title has to follow the language
 * picker, and a title in the metadata export is re-rendered by React on every
 * commit, so assigning document.title imperatively is silently undone. The
 * provider renders the <title> element instead -- React hoists it into <head>
 * and it is part of the prerendered HTML, in the fallback locale, like this
 * description is.
 */
export const metadata: Metadata = {
  description:
    "A convolutional network whose weights live in an NFT and whose forward pass runs entirely in EVM contracts across Ethereum, OP, and Monad networks.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <Providers>
            {children}
            <Toaster position="bottom-right" richColors closeButton />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  )
}
