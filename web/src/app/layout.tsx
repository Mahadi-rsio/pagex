import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import Script from "next/script";
import { TopLoader } from "@/components/TopLoader";
import { Suspense } from "react";

const themeInitScript = `
(() => {
  const storageKey = "theme";
  const storedTheme = window.localStorage.getItem(storageKey);
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme =
    storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : systemPrefersDark
        ? "dark"
        : "light";

  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
})();
`;

export const metadata: Metadata = {
    title: "Cloudisy Console",
    description:
        "Manage, deploy, and monitor your cloud applications from one unified console.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <Script
                    id="theme-init"
                    strategy="beforeInteractive"
                    dangerouslySetInnerHTML={{ __html: themeInitScript }}
                />
            </head>
            <body className="min-h-screen bg-background font-sans text-foreground antialiased">
                <Suspense fallback={null}>
                    <TopLoader />
                </Suspense>
                {children}
                <Toaster position="bottom-right" />
            </body>
        </html>
    );
}
