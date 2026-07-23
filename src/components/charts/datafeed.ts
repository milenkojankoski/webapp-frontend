import { CANDLE_CHART_ENDPOINT } from "../../config/constants";
import { parseFormattedPrice } from "../../utils/formatters";

const RESOLUTIONS_MAP: Record<string, string> = {
  "60": "1h",
  "1D": "1d",
  "1W": "1w",
  "1M": "1m",
};

const SUPPORTED_RESOLUTIONS = ["60", "1D", "1W", "1M"];

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface DatafeedConfig {
  supported_resolutions: string[];
  supports_marks: boolean;
  supports_timescale_marks: boolean;
  supports_time: boolean;
}

interface SymbolInfo {
  name: string;
  ticker: string;
  description: string;
  type: string;
  session: string;
  timezone: string;
  exchange: string;
  listed_exchange: string;
  format: string;
  minmov: number;
  pricescale: number;
  has_intraday: boolean;
  has_daily: boolean;
  has_weekly_and_monthly: boolean;
  supported_resolutions: string[];
  volume_precision: number;
  data_status: string;
}

interface PeriodParams {
  from: number;
  to: number;
  countBack?: number;
  firstDataRequest?: boolean;
}

export class AlpacaDatafeed {
  private poolId: string;

  constructor(poolId: string) {
    this.poolId = poolId;
  }

  onReady(callback: (config: DatafeedConfig) => void): void {
    setTimeout(() => {
      callback({
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: false,
      });
    }, 0);
  }

  searchSymbols(
    _userInput: string,
    _exchange: string,
    _symbolType: string,
    onResult: (result: never[]) => void
  ): void {
    onResult([]);
  }

  resolveSymbol(
    symbolName: string,
    onResolve: (info: SymbolInfo) => void,
    _onError: (reason: string) => void
  ): void {
    setTimeout(() => {
      onResolve({
        name: symbolName,
        ticker: symbolName,
        description: symbolName,
        type: "crypto",
        session: "24x7",
        timezone: "Etc/UTC",
        exchange: "Alpaca DEX",
        listed_exchange: "Alpaca DEX",
        format: "price",
        minmov: 1,
        pricescale: 1000000,
        has_intraday: true,
        has_daily: true,
        has_weekly_and_monthly: true,
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        volume_precision: 2,
        data_status: "streaming",
      });
    }, 0);
  }

  async getBars(
    _symbolInfo: SymbolInfo,
    resolution: string,
    periodParams: PeriodParams,
    onResult: (bars: Bar[], meta: { noData: boolean }) => void,
    onError: (reason: string) => void
  ): Promise<void> {
    const tf = RESOLUTIONS_MAP[resolution];
    if (!tf) {
      onResult([], { noData: true });
      return;
    }

    try {
      const url = `${CANDLE_CHART_ENDPOINT}?poolId=${encodeURIComponent(this.poolId)}&tf=${tf}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const series = data.series || [];

      if (series.length === 0) {
        onResult([], { noData: true });
        return;
      }

      const bars: Bar[] = series
        .map((point: any) => ({
          time: point.timestamp, // already in ms
          open: parseFormattedPrice(point.open),
          high: parseFormattedPrice(point.high),
          low: parseFormattedPrice(point.low),
          close: parseFormattedPrice(point.close || point.price),
          volume: typeof point.volume === "string" ? parseFloat(point.volume) : point.volume || 0,
        }))
        .filter((bar: Bar) => bar.time >= periodParams.from * 1000 && bar.time <= periodParams.to * 1000)
        .sort((a: Bar, b: Bar) => a.time - b.time);

      onResult(bars, { noData: bars.length === 0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown datafeed error";
      onError(msg);
    }
  }

  subscribeBars(): void {
    // No real-time streaming for now
  }

  unsubscribeBars(): void {
    // No real-time streaming for now
  }
}
