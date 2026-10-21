import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import "styles/globals.css"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mode="light">
      {/*
        Browser extensions (Grammarly, LastPass, etc.) inject their own
        attributes onto <body> before React hydrates, which makes the client
        props disagree with the server-rendered HTML. `suppressHydrationWarning`
        tells React to tolerate attribute differences on this element only.
      */}
      <body suppressHydrationWarning>
        <main className="relative">{props.children}</main>
      </body>
    </html>
  )
}
