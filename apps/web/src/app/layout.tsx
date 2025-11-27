// See LICENSE file in the project root for license information.

import "@/styles/globals.css";
import { Geist } from "next/font/google";
import type { Metadata } from "next";

const font = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "rstream demo application",
  description: "Web application showcasing rstream features.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${font.className} antialiased`}>
        <div className="mx-auto max-w-3xl px-6 sm:px-8 lg:px-10">
          {children}
        </div>
      </body>
    </html>
  );
}
