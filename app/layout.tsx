import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NavMenu } from "@/components/NavMenu";
import "./styles.css";

export const metadata: Metadata = {
  title: "AI Memory Agent Demo",
  description:
    "A runnable, sanitized demo of a memory-augmented agent: layered prompts, pluggable vector backends, a validated tool loop, scheduled check-ins, and maintenance cycles.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NavMenu />
        <main className="page-shell">{children}</main>
      </body>
    </html>
  );
}
