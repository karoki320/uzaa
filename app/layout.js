import './globals.css';
import { AuthProvider } from '@/lib/auth';
import AssistantHost from '@/components/AssistantHost';

export const metadata = {
  title: 'Uzaa POS',
  description: 'Point of sale for Kenyan businesses',
  manifest: '/manifest.webmanifest',
  applicationName: 'Uzaa',
  appleWebApp: { capable: true, title: 'Uzaa', statusBarStyle: 'default' },
  icons: { apple: '/brand/apple-touch-icon.png' },
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#CDD9E2' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
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
              // dark or light before the first paint (chosen per phone, see components/ThemePick.js)
              "try{var t=localStorage.getItem('uzaa_theme')||'light';var d=t==='dark'||(t==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}" +
              "window.__uzaaBip=null;addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__uzaaBip=e;dispatchEvent(new Event('uzaa-installable'))});" +
              "addEventListener('appinstalled',function(){window.__uzaaBip=null;dispatchEvent(new Event('uzaa-installable'))});" +
              "if('serviceWorker'in navigator)addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})});",
          }}
        />
      </head>
      <body>
        <AuthProvider>{children}<AssistantHost /></AuthProvider>
      </body>
    </html>
  );
}
