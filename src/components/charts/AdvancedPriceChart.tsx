import React, { useEffect, useMemo, useRef } from 'react';
import { widget } from '../../../public/charting_library';
import type { ChartingLibraryWidgetOptions, LanguageCode, ResolutionString } from '../../../public/charting_library';
import createDatafeed from '../../utils/datafeed';
import { useTheme } from '../common/ThemeContext';

interface AdvancedPriceChartProps {
    poolId: string;
    symbol: string;
    className?: string;
    /** Current price as a raw base-token integer string (human × 10^18) — used to
     *  size the price axis so cheap tokens don't lose precision. */
    priceHint?: string;
}

// Derive a TradingView pricescale (10^decimals) that shows ~5 significant figures
// for the given price. Bucketed to a power of ten so it only changes on a ~10x
// price move — keeping it stable prevents the chart widget from remounting on
// every price tick. Falls back to 1e6 when no price is known.
function pricescaleFromRaw(raw?: string): number {
    const v = raw ? parseFloat(raw) / 1e18 : NaN;
    if (!Number.isFinite(v) || v <= 0) return 1000000;
    const decimals = Math.max(2, Math.min(12, Math.ceil(-Math.log10(v)) + 5));
    return Math.pow(10, decimals);
}

const AdvancedPriceChart: React.FC<AdvancedPriceChartProps> = ({ poolId, symbol, className, priceHint }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const widgetRef = useRef<any>(null);
    const { isDarkMode } = useTheme();

    // Stable across price ticks; only changes when the price crosses a decade.
    const pricescale = useMemo(() => pricescaleFromRaw(priceHint), [priceHint]);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        // Base Configuration
        const widgetOptions: ChartingLibraryWidgetOptions = {
            symbol: symbol,
            datafeed: createDatafeed(poolId, pricescale),
            interval: '60' as ResolutionString, // Default to 1h
            container: chartContainerRef.current,
            library_path: '/charting_library/',
            locale: 'en' as LanguageCode,
            disabled_features: [
                'use_localstorage_for_settings',
                'header_symbol_search',       // Custom search is outside chart
                'header_compare',
                'header_saveload'             // Disabled save/load state to keep simple
            ],
            enabled_features: [],
            fullscreen: false,
            autosize: true,
            theme: isDarkMode ? 'dark' : 'light',
            custom_css_url: '/charting_library/custom.css', // Optional file if you add specific overrides
            overrides: {
                // Professional color scheme for candles
                "mainSeriesProperties.candleStyle.upColor": "#22c55e",
                "mainSeriesProperties.candleStyle.downColor": "#ef4444",
                "mainSeriesProperties.candleStyle.drawWick": true,
                "mainSeriesProperties.candleStyle.drawBorder": false,
                "mainSeriesProperties.candleStyle.borderColor": "#22c55e",
                "mainSeriesProperties.candleStyle.borderUpColor": "#22c55e",
                "mainSeriesProperties.candleStyle.borderDownColor": "#ef4444",
                "mainSeriesProperties.candleStyle.wickUpColor": "#22c55e",
                "mainSeriesProperties.candleStyle.wickDownColor": "#ef4444",

                "paneProperties.background": isDarkMode ? "#1e1e1e" : "#ffffff",
                "paneProperties.backgroundType": "solid",
                "paneProperties.vertGridProperties.color": isDarkMode ? "#2a2a2a" : "#f0f3fa",
                "paneProperties.horzGridProperties.color": isDarkMode ? "#2a2a2a" : "#f0f3fa",
                "scalesProperties.textColor": isDarkMode ? "#787b86" : "#999",
                "scalesProperties.lineColor": isDarkMode ? "#333333" : "#e0e3eb",

                // Drawing tools defaults (Pastel Purple)
                "linetooltrendline.linecolor": "#c4a1ff",
                "linetoolhorzline.linecolor": "#c4a1ff",
                "linetoolvertline.linecolor": "#c4a1ff",
                "linetoolray.linecolor": "#c4a1ff",
                "linetoolextended.linecolor": "#c4a1ff",
                "linetoolparallelchannel.linecolor": "#c4a1ff",
                "linetoolpitchfork.linecolor": "#c4a1ff",
                "linetoolfibretracement.trendline.color": "#c4a1ff",
                "linetoolbrush.linecolor": "#c4a1ff",
                "linetoolpath.linecolor": "#c4a1ff",
            }
        };

        const tvWidget = new widget(widgetOptions);
        widgetRef.current = tvWidget;

        tvWidget.onChartReady(() => {
            // Add custom primary Moving Average (e.g. MA 7) easily on load
            tvWidget.activeChart().createStudy('Moving Average', false, false, { length: 7 }, { "Plot.color": "#a78bfa" });
            // Add custom secondary Moving Average (e.g. MA 25)
            tvWidget.activeChart().createStudy('Moving Average', false, false, { length: 25 }, { "Plot.color": "#22d3ee" });

            // Volume is now automatically managed by the charting library
            // since the backend datafeed provides native volume data.
        });

        return () => {
            if (widgetRef.current) {
                widgetRef.current.remove();
                widgetRef.current = null;
            }
        };
    }, [poolId, symbol, isDarkMode, pricescale]);

    return (
        <div className={`relative ${className || 'w-full h-80'}`}>
            <div ref={chartContainerRef} className="w-full h-full" />
        </div>
    );
};

export default AdvancedPriceChart;
