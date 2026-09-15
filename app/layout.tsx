import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DashForge AI',
  description: 'AI-powered dashboard builder for connected datasets.',
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
