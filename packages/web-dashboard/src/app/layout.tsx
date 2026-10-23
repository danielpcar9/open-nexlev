import React from 'react';

export const metadata = {
  title: 'Open-NexLev — YouTube Niche Finder & Outlier Explorer',
  description: 'Open source YouTube niche discovery, outlier score detector, RPM calculator and transcript extractor.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, padding: 0, background: '#090d16' }}>{children}</body>
    </html>
  );
}
