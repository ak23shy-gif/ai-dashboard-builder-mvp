import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Google Extract — Your data, ready to go',
  description: 'Extract Google data into clean CSV and JSON files.',
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
