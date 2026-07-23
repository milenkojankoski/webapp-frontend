import { CANDLE_CHART_ENDPOINT, LINE_CHART_ENDPOINT } from "../config/constants";
import { logger } from "./logger";
import type {
    IBasicDataFeed,
    LibrarySymbolInfo,
    ResolutionString,
    Bar,
    PeriodParams,
    DatafeedConfiguration,
    SubscribeBarsCallback,
    DatafeedErrorCallback,
    ResolveCallback,
    HistoryCallback,
    OnReadyCallback,
    SearchSymbolsCallback
} from "../../public/charting_library";

// Map TradingView resolutions to our API timeframe shortcuts
const resolveTimeframe = (resolution: ResolutionString): string => {
    // Advanced Charts provides resolution in minutes (e.g. "60" = 1h, "1D" = 1d)
    const resMap: Record<string, string> = {
        '1': '1m',
        '5': '5m',
        '15': '15m',
        '60': '1h',
        '240': '4h',
        '1D': '1d',
        '1W': '1w',
        '1M': '1M'
    };
    return resMap[resolution] || '1h'; // default to 1h
};

// Chart prices/volumes arrive as raw base-token integer strings (human × 10^18,
// KTA on mainnet). Convert to a float WITHOUT the lossy 9-decimal rounding the
// generic formatter applies — otherwise sub-1e-9 tokens collapse to 0 on the chart.
const BASE_DECIMALS = 18;
const rawToPrice = (raw: string | number | undefined): number => {
    if (raw == null) return NaN;
    const v = typeof raw === "string" ? parseFloat(raw) : raw;
    return Number.isFinite(v) ? v / Math.pow(10, BASE_DECIMALS) : NaN;
};

const configurationData: DatafeedConfiguration = {
    supported_resolutions: ['1', '5', '15', '60', '240', '1D', '1W', '1M'] as ResolutionString[],
    exchanges: [
        { value: 'AlpacaDEX', name: 'AlpacaDEX', desc: 'AlpacaDEX' },
    ],
    symbols_types: [
        { name: 'Crypto', value: 'crypto' }
    ]
};

// Simple debounce/cache for bars to prevent over-fetching
const lastBarsCache = new Map<string, Bar>();

// Fetch with timeout to prevent TradingView from hanging forever
function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
}

export default function createDatafeed(poolId: string, pricescale: number = 1000000): IBasicDataFeed {
    return {
        onReady: (callback: OnReadyCallback) => {
            setTimeout(() => callback(configurationData));
        },

        searchSymbols: (
            _userInput: string,
            _exchange: string,
            _symbolType: string,
            onResultReadyCallback: SearchSymbolsCallback
        ) => {
            onResultReadyCallback([]);
        },

        resolveSymbol: (
            symbolName: string,
            onSymbolResolvedCallback: ResolveCallback,
            _onResolveErrorCallback: DatafeedErrorCallback
        ) => {
            const symbolInfo: LibrarySymbolInfo = {
                ticker: symbolName,
                name: symbolName,
                description: symbolName,
                type: 'crypto',
                session: '24x7',
                timezone: 'Etc/UTC',
                exchange: 'AlpacaDEX',
                listed_exchange: 'AlpacaDEX',
                minmov: 1,
                pricescale: pricescale,
                has_intraday: true,
                has_daily: true,
                has_weekly_and_monthly: true,
                supported_resolutions: configurationData.supported_resolutions,
                intraday_multipliers: ['1', '5', '15', '60', '240'],
                daily_multipliers: ['1'],
                weekly_multipliers: ['1'],
                monthly_multipliers: ['1'],
                volume_precision: 2,
                data_status: 'streaming',
                format: 'price'
            };

            setTimeout(() => onSymbolResolvedCallback(symbolInfo));
        },

        getBars: async (
            symbolInfo: LibrarySymbolInfo,
            resolution: ResolutionString,
            periodParams: PeriodParams,
            onHistoryCallback: HistoryCallback,
            _onErrorCallback: DatafeedErrorCallback
        ) => {
            const { from, to, firstDataRequest, countBack } = periodParams;
            const tf = resolveTimeframe(resolution);

            // countBack is the number of bars the library REQUIRES; from/to are only
            // a hint. Forwarding it lets the backend return the N most recent bars
            // even when the literal window holds fewer — without it, a sparsely
            // traded pool made the library paginate backwards until it gave up
            // (endless spinner / empty chart on e.g. the 5D range at 5m).
            const countBackParam = countBack ? `&countBack=${countBack}` : '';

            try {
                const response = await fetchWithTimeout(
                    `${CANDLE_CHART_ENDPOINT}?poolId=${encodeURIComponent(poolId)}&tf=${tf}&from=${from}&to=${to}${countBackParam}`
                );

                if (!response.ok) {
                    throw new Error(`Failed to fetch chart data (${response.status})`);
                }

                const data = await response.json();

                if (!data.series || data.series.length === 0) {
                    // Only try line-chart fallback on the first request
                    if (firstDataRequest) {
                        try {
                            const lineRes = await fetchWithTimeout(
                                `${LINE_CHART_ENDPOINT}?poolId=${encodeURIComponent(poolId)}&tf=${tf}&from=${from}&to=${to}${countBackParam}`
                            );
                            if (lineRes.ok) {
                                const lineData = await lineRes.json();
                                if (lineData.series && lineData.series.length > 0) {
                                    const bars = processBars(lineData.series);
                                    if (bars.length > 0) {
                                        lastBarsCache.set(`${symbolInfo.name}-${resolution}`, bars[bars.length - 1]);
                                        onHistoryCallback(bars, { noData: false });
                                        return;
                                    }
                                }
                            }
                        } catch (e) {
                            logger.warn("Fallback to line data failed", e);
                        }
                    }
                    onHistoryCallback([], { noData: true });
                    return;
                }

                const bars = processBars(data.series);

                if (bars.length === 0) {
                    onHistoryCallback([], { noData: true });
                } else {
                    if (firstDataRequest) {
                        lastBarsCache.set(`${symbolInfo.name}-${resolution}`, bars[bars.length - 1]);
                    }
                    onHistoryCallback(bars, { noData: false });
                }

            } catch (error) {
                console.error('[getBars] Error:', error);
                onHistoryCallback([], { noData: true });
            }
        },

        subscribeBars: (
            _symbolInfo: LibrarySymbolInfo,
            _resolution: ResolutionString,
            _onRealtimeCallback: SubscribeBarsCallback,
            _subscribeUID: string,
            _onResetCacheNeededCallback: () => void
        ) => {
            // Advanced streaming implementation would listen to WebSockets here
            // We subscribe, but data is currently only loaded on refresh/interval changes
            // Real-time updates could be added via our existing socket logic if desired.
        },

        unsubscribeBars: (_subscriberUID: string) => {
            // Cleanup subscription
        }
    };
}

// Map the API data structure to TradingView Bar structure
function processBars(series: any[]): Bar[] {
    return series
        .map((d: any) => {
            const time = d.timestamp;
            const open = rawToPrice(d.open);
            const high = d.high != null ? rawToPrice(d.high) : open;
            const low = d.low != null ? rawToPrice(d.low) : open;
            const close = d.close != null ? rawToPrice(d.close) : open;
            const volume = rawToPrice(d.volume); // raw base units → human (was shown ×10^18)

            // Format fallback values if the API returns a line instead of candles
            return {
                time: time,
                open: isNaN(open) ? close : open,
                high: isNaN(high) ? close : high,
                low: isNaN(low) ? close : low,
                close: close,
                volume: Number.isFinite(volume) ? volume : 0
            };
        })
        .filter(bar => !isNaN(bar.time) && !isNaN(bar.close))
        .sort((a, b) => a.time - b.time); // Must be strictly chronological
}
