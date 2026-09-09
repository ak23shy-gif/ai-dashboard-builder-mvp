import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Google API Data Extractor',
  description: 'AI-native dashboard builder for CSV, Excel, API and database-backed analytics.',
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

