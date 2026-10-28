import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Extract',
  description: 'Google data extraction app for Power BI-ready API exports.',
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
