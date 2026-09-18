import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Depth — Live Hyperliquid Order Book",
  description:
    "A live view of BTC and ETH liquidity. Fast top-of-book updates and full market depth, powered by Hyperliquid.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
