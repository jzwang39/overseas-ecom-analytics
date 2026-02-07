import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";
import type { ReactNode } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "海外电商数据分析",
  description: "海外电商数据分析与运营工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {process.env.NODE_ENV === "development" ? (
          <Script
            id="patch-perf-measure"
            strategy="beforeInteractive"
          >{`(function(){try{var w=window;if(w.__oeaPatchedPerfMeasure)return;w.__oeaPatchedPerfMeasure=true;var p=w.performance;if(!p||typeof p.measure!=="function")return;var orig=p.measure.bind(p);p.measure=function(){try{return orig.apply(p,arguments);}catch(e){var m=e&&e.message?e.message:String(e);if(m.indexOf("cannot have a negative time stamp")!==-1||m.indexOf("cannot have a negative timestamp")!==-1)return;throw e;}};}catch(e){}})();`}</Script>
        ) : null}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
