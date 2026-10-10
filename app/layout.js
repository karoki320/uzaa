import './globals.css';
import { AuthProvider } from '@/lib/auth';

export const metadata = {
  title: 'Uzaa POS',
  description: 'Point of sale for Kenyan businesses',
  manifest: '/manifest.webmanifest',
  applicationName: 'Uzaa',
  appleWebApp: { capable: true, title: 'Uzaa', statusBarStyle: 'default' },
  icons: { apple: '/brand/apple-touch-icon.png' },
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#FFFDF6' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.__uzaaBip=null;addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__uzaaBip=e;dispatchEvent(new Event('uzaa-installable'))});" +
              "addEventListener('appinstalled',function(){window.__uzaaBip=null;dispatchEvent(new Event('uzaa-installable'))});" +
              "if('serviceWorker'in navigator)addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})});",
          }}
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
