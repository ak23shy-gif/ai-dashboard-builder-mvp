import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DashForge AI - AI Dashboard Builder',
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

