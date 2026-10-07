import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCAN — Solana Token Intelligence",
  description:
    "See the dev. See the buyers. Know your exit.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}