import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Rapport Pack",
  description: "Qloo-powered cultural briefings and role plays for contact centre agents who serve callers in another country.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
