import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RelyBricks Admin",
  description: "Property management admin portal",
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
