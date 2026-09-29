import type { Metadata } from "next";
import "@fontsource-variable/estedad";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZeroLab",
  description: "لابراتوار ایده تا قالب سیلیکونی",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
