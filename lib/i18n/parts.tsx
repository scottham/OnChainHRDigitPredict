import type { ReactNode } from "react"

/**
 * Inline code inside a translated sentence.
 *
 * Message files need it constantly -- env var names, commands, RPC method
 * names -- and repeating the class list in every locale is how two locales end
 * up styled differently.
 */
export function Mono({ children }: { children: ReactNode }) {
  return <code className="font-mono">{children}</code>
}
