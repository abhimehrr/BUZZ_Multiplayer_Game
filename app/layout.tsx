import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "BUZZ — multiplayer quiz",
  description: "A real-time multiplayer buzzer quiz for friends.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body cz-shortcut-listen="true">{children}</body>
    </html>
  );
}
