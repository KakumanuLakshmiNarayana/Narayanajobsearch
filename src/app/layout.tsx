import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Agent",
  description: "Multi-tenant job search + tailored resume agent"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
