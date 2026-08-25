import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Inter_Tight, Newsreader } from "next/font/google";

import "./globals.css";

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  display: "swap",
});

// The editor's voice. Warm serif against the cold monospace chrome is the
// central contrast of the design -- you write like a person, the machine
// annotates like an instrument.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "NWP-Core",
    template: "%s · NWP-Core",
  },
  description:
    "A next-word prediction transformer trained from scratch, running entirely in your browser. Watch the probability distribution as you type.",
  applicationName: "NWP-Core",
  openGraph: {
    title: "NWP-Core",
    description:
      "A 19.5M-parameter transformer trained from scratch on 262M tokens, quantised to int8 and served to your browser. No prompt leaves your machine.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#08090b",
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applied before paint so a paper-mode reload never flashes dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('nwp-theme');if(t==='paper')document.documentElement.setAttribute('data-theme','paper');}catch(e){}`,
          }}
        />
      </head>
      <body
        className={`${jetbrains.variable} ${interTight.variable} ${newsreader.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
