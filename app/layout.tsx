import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DashForge AI - Dashboard Builder',
  description: 'AI-powered web dashboard builder for files, APIs and databases.',
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
