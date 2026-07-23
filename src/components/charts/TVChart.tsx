import { useRef, useEffect } from "react";
import { useTheme } from "../common/ThemeContext";
import { AlpacaDatafeed } from "./datafeed";

interface TVChartProps {
  poolId: string;
  symbolName: string;
  className?: string;
}

declare global {
  interface Window {
    TradingView: any;
  }
}

export const TVChart: React.FC<TVChartProps> = ({ poolId, symbolName, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const { isDarkMode } = useTheme();

  useEffect(() => {
    if (!containerRef.current || !poolId) return;

    const datafeed = new AlpacaDatafeed(poolId);

    const widget = new window.TradingView.widget({
      container: containerRef.current,
      library_path: "/charting_library/",
      datafeed,
      symbol: symbolName,
      interval: "60",
      timezone: "Etc/UTC",
      theme: isDarkMode ? "dark" : "light",
      locale: "en",
      autosize: true,
      fullscreen: false,
      toolbar_bg: isDarkMode ? "#1e1e1e" : "#ffffff",
      overrides: {
        "paneProperties.background": isDarkMode ? "#1e1e1e" : "#ffffff",
        "paneProperties.backgroundType": "solid",
        "mainSeriesProperties.candleStyle.upColor": "#22c55e",
        "mainSeriesProperties.candleStyle.downColor": "#ef4444",
        "mainSeriesProperties.candleStyle.borderUpColor": "#22c55e",
        "mainSeriesProperties.candleStyle.borderDownColor": "#ef4444",
        "mainSeriesProperties.candleStyle.wickUpColor": "#22c55e",
        "mainSeriesProperties.candleStyle.wickDownColor": "#ef4444",
      },
      disabled_features: [
        "header_symbol_search",
        "header_compare",
        "symbol_search_hot_key",
        "display_market_status",
      ],
      enabled_features: [
        "hide_left_toolbar_by_default",
      ],
      drawings_access: {
        type: "black",
        tools: [{ name: "Regression Trend" }],
      },
      loading_screen: {
        backgroundColor: isDarkMode ? "#1e1e1e" : "#ffffff",
        foregroundColor: isDarkMode ? "#845fbc" : "#845fbc",
      },
    });

    widgetRef.current = widget;

    return () => {
      if (widgetRef.current) {
        widgetRef.current.remove();
        widgetRef.current = null;
      }
    };
  }, [poolId, symbolName, isDarkMode]);

  return <div ref={containerRef} className={className} />;
};
