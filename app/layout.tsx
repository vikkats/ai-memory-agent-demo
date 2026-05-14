import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "AI Memory Agent Demo",
  description: "A sanitized portfolio demo for an AI memory-agent dashboard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
