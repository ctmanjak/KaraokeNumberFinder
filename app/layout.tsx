import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppAuthBoundary } from "@/components/auth/AppAuthBoundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "KaraokeNumberFinder",
  description: "Foreign-language karaoke number search"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AppAuthBoundary>{children}</AppAuthBoundary>
      </body>
    </html>
  );
}
