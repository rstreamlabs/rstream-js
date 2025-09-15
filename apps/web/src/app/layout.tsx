// See LICENSE file in the project root for license information.

import "@/styles/globals.css";
import { Geist } from "next/font/google";
import type { Metadata } from "next";

const font = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TODO",
  description: "TODO",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={font.className}>{children}</body>
    </html>
  );
}
