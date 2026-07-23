import React, {
    useRef,
    useEffect,
    useState,
    useMemo,
    useLayoutEffect,
    useCallback
} from "react";

import type {
    MouseEvent as ReactMouseEvent,
    TouchEvent as ReactTouchEvent,
    UIEvent
} from "react";
import { createChart, ColorType, CrosshairMode, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import type { MouseEventParams } from 'lightweight-charts';
import type { ChartPoint, ChartType } from "../../types";
import { CANDLE_WIDTH, TOTAL_UNIT_WIDTH } from "../../config/constants";
import { parseFormattedPrice, formatAxisNumber, formatAmount18 } from "../../utils/formatters";
import { useTheme } from '../common/ThemeContext';

type DrawingTool = 'trendline' | 'rect' | 'channel';
interface DrawingPoint { time: number; price: number; }

interface TrendlineDrawing { id: string; tool: 'trendline'; color: string; p1: DrawingPoint; p2: DrawingPoint; }
interface RectDrawing { id: string; tool: 'rect'; color: string; p1: DrawingPoint; p2: DrawingPoint; }
interface ChannelDrawing { id: string; tool: 'channel'; color: string; p1: DrawingPoint; p2: DrawingPoint; p3: DrawingPoint; }
type Drawing = TrendlineDrawing | RectDrawing | ChannelDrawing;

interface PriceChartProps {
    data: ChartPoint[];
    loading: boolean;
    error: string | null;
    type: ChartType;
    className?: string;
}

interface CandleChartDrawingProps extends PriceChartProps {
    activeTool: DrawingTool | null;
    drawings: Drawing[];
    onDrawingComplete: (drawing: Drawing) => void;
    onToolDeactivate: () => void;
    isFullScreen?: boolean;
    maEnabled: Record<string, boolean>;
    onMaToggle: (label: string) => void;
}

/* ── Legend formatting helpers ─────────────────────────── */
const formatLegendPrice = (num: number): string => {
    if (num === 0) return '0';
    if (Math.abs(num) < 0.000001) return num.toExponential(3);
    if (Math.abs(num) < 0.01) return num.toFixed(6);
    if (Math.abs(num) < 1) return num.toFixed(4);
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const formatLegendPct = (num: number) => num.toFixed(2);
const formatLegendVol = (vol: number | string): string => {
    const num = typeof vol === 'string' ? parseFloat(vol) : vol;
    if (!num || isNaN(num)) return '—';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toFixed(2);
};

/* ── Moving Average helpers ────────────────────────────── */
const MA_CONFIG = [
    { period: 7, color: '#a78bfa', label: 'MA(7)' },   // light purple
    { period: 25, color: '#22d3ee', label: 'MA(25)' },   // turquoise
    { period: 99, color: '#c084fc', label: 'MA(99)' },   // soft purple
] as const;

const computeSMA = (closes: number[], period: number): (number | null)[] => {
    const result: (number | null)[] = [];
    for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) { result.push(null); continue; }
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += closes[j];
        result.push(sum / period);
    }
    return result;
};

// --- 1. LIGHTWEIGHT CHART ---
const hexToRgba = (hex: string, alpha: number): string => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const LINE_COLORS = [
    '#a78bfa', '#06b6d4', '#c084fc', '#14b8a6', '#818cf8',
    '#22d3ee', '#e879f9', '#2dd4bf', '#8b5cf6', '#67e8f9'
];

const LightweightCandleChart: React.FC<CandleChartDrawingProps> = ({ data, className, activeTool, drawings, onDrawingComplete, onToolDeactivate, isFullScreen, maEnabled, onMaToggle }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
    const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
    const candleSeriesRef = useRef<any>(null);
    const volumeSeriesRef = useRef<any>(null);
    const lineSeriesRefs = useRef<Map<string, any>>(new Map());
    const pendingPointsRef = useRef<DrawingPoint[]>([]);
    const previewSeriesRef = useRef<any>(null);
    const activeToolRef = useRef(activeTool);
    const drawingsRef = useRef(drawings);
    const drawingsCountRef = useRef(drawings.length);
    const barIntervalRef = useRef<number>(3600);
    const formattedDataRef = useRef<any[]>([]);
    const maSeriesRefs = useRef<Map<string, any>>(new Map());
    const maDataRef = useRef<Map<number, Record<string, number | null>>>(new Map());
    const cursorPosRef = useRef<{ time: number; price: number } | null>(null);
    const priceRangeRef = useRef<{ topPrice: number; bottomPrice: number; height: number } | null>(null);
    const { isDarkMode } = useTheme();

    const [legendData, setLegendData] = useState<{
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number | string;
        delta: number;
        percent: number;
        color: string;
    } | null>(null);

    const [maLegend, setMaLegend] = useState<Record<string, number | null> | null>(null);

    // Keep refs in sync so chart event handlers always read current values
    useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
    useEffect(() => { drawingsRef.current = drawings; drawingsCountRef.current = drawings.length; }, [drawings]);

    // Clean up preview line when tool is deactivated
    useEffect(() => {
        if (!activeTool && chartRef.current) {
            if (previewSeriesRef.current) {
                try { chartRef.current.removeSeries(previewSeriesRef.current); } catch { }
                previewSeriesRef.current = null;
            }
            pendingPointsRef.current = [];
            cursorPosRef.current = null;
            renderOverlay();
        }
    }, [activeTool]);

    // Canvas overlay render function for rect/channel drawings + previews
    const renderOverlay = useCallback(() => {
        const canvas = overlayCanvasRef.current;
        const chart = chartRef.current;
        const candleSeries = candleSeriesRef.current;
        if (!canvas || !chart || !candleSeries) return;

        const container = chartContainerRef.current;
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const timeScale = chart.timeScale();

        // Helper: convert DrawingPoint to pixel coords (works for future times too)
        const toPixel = (pt: DrawingPoint): { x: number; y: number } | null => {
            // Try direct conversion first (works for times within data range)
            let x = timeScale.timeToCoordinate(pt.time as any);
            // For future times not in any series, compute via logical coordinate
            if (x === null) {
                const fd = formattedDataRef.current;
                if (fd.length < 2) return null;
                const lastIdx = fd.length - 1;
                const lastTime = fd[lastIdx]?.time as number;
                const interval = barIntervalRef.current;
                if (!lastTime || !interval) return null;
                const logical = lastIdx + (pt.time - lastTime) / interval;
                x = timeScale.logicalToCoordinate(logical as any);
                if (x === null) return null;
            }
            const y = candleSeries.priceToCoordinate(pt.price);
            if (y === null) return null;
            return { x, y };
        };

        // Draw completed rect drawings
        const allDrawings = drawingsRef.current;
        for (const d of allDrawings) {
            if (d.tool === 'rect') {
                const a = toPixel(d.p1);
                const b = toPixel(d.p2);
                if (!a || !b) continue;
                ctx.fillStyle = hexToRgba(d.color, 0.08);
                ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
                ctx.strokeStyle = d.color;
                ctx.lineWidth = 2;
                ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
            } else if (d.tool === 'channel') {
                const a = toPixel(d.p1);
                const b = toPixel(d.p2);
                const c = toPixel(d.p3);
                if (!a || !b || !c) continue;
                // Offset = p3 perpendicular offset from line p1-p2
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const ox = c.x - a.x;
                const oy = c.y - a.y;
                // Project c onto perpendicular of line ab
                const len2 = dx * dx + dy * dy;
                if (len2 === 0) continue;
                const dot = (ox * (-dy) + oy * dx) / len2;
                const perpX = -dy * dot;
                const perpY = dx * dot;
                // Draw two parallel lines + fill
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.lineTo(b.x + perpX, b.y + perpY);
                ctx.lineTo(a.x + perpX, a.y + perpY);
                ctx.closePath();
                ctx.fillStyle = hexToRgba(d.color, 0.06);
                ctx.fill();
                ctx.strokeStyle = d.color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(a.x + perpX, a.y + perpY); ctx.lineTo(b.x + perpX, b.y + perpY);
                ctx.stroke();
            }
        }

        // Draw preview for active tool
        const pending = pendingPointsRef.current;
        const cursor = cursorPosRef.current;
        const tool = activeToolRef.current;
        if (!tool || !cursor) return;

        const cursorPx = toPixel(cursor);
        if (!cursorPx) return;

        const previewColor = LINE_COLORS[drawingsCountRef.current % LINE_COLORS.length];

        if (tool === 'rect' && pending.length === 1) {
            const a = toPixel(pending[0]);
            if (!a) return;
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = previewColor;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(Math.min(a.x, cursorPx.x), Math.min(a.y, cursorPx.y), Math.abs(cursorPx.x - a.x), Math.abs(cursorPx.y - a.y));
            ctx.fillStyle = hexToRgba(previewColor, 0.06);
            ctx.fillRect(Math.min(a.x, cursorPx.x), Math.min(a.y, cursorPx.y), Math.abs(cursorPx.x - a.x), Math.abs(cursorPx.y - a.y));
            ctx.setLineDash([]);
        } else if (tool === 'channel' && pending.length === 1) {
            const a = toPixel(pending[0]);
            if (!a) return;
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = previewColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(cursorPx.x, cursorPx.y); ctx.stroke();
            ctx.setLineDash([]);
        } else if (tool === 'channel' && pending.length === 2) {
            const a = toPixel(pending[0]);
            const b = toPixel(pending[1]);
            if (!a || !b) return;
            ctx.strokeStyle = previewColor;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const ox = cursorPx.x - a.x;
            const oy = cursorPx.y - a.y;
            const len2 = dx * dx + dy * dy;
            if (len2 > 0) {
                const dot = (ox * (-dy) + oy * dx) / len2;
                const perpX = -dy * dot;
                const perpY = dx * dot;
                ctx.setLineDash([6, 4]);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(a.x + perpX, a.y + perpY);
                ctx.lineTo(b.x + perpX, b.y + perpY);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
                ctx.lineTo(b.x + perpX, b.y + perpY); ctx.lineTo(a.x + perpX, a.y + perpY);
                ctx.closePath();
                ctx.fillStyle = hexToRgba(previewColor, 0.05);
                ctx.fill();
            }
        }
    }, []);

    const dataMap = useMemo(() => {
        const map = new Map<number, any>();
        data.forEach((d) => {
            const time = d.timestamp / 1000;
            const open = parseFormattedPrice(d.open);
            const close = parseFormattedPrice(d.close);
            const delta = close - open;
            const percent = (delta / open) * 100;

            map.set(time, {
                open,
                high: parseFormattedPrice(d.high),
                low: parseFormattedPrice(d.low),
                close,
                volume: (d as any).volume || 0,
                delta,
                percent,
                color: delta >= 0 ? '#22c55e' : '#ef4444'
            });
        });
        return map;
    }, [data]);

    useEffect(() => {
        if (!chartContainerRef.current || data.length === 0) return;
        const container = chartContainerRef.current;

        // Professional dark theme inspired by TradingView
        const backgroundColor = isDarkMode ? '#1e1e1e' : '#ffffff';
        const textColor = isDarkMode ? '#787b86' : '#999';
        const gridColor = isDarkMode ? '#2a2a2a' : '#f0f3fa';
        const borderColor = isDarkMode ? '#333333' : '#e0e3eb';

        const chart = createChart(container, {
            layout: {
                background: { type: ColorType.Solid, color: backgroundColor },
                textColor,
                fontFamily: "'Inter', -apple-system, sans-serif",
            },
            width: container.clientWidth,
            height: container.clientHeight,
            grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: isDarkMode ? '#555C68' : '#9B7DFF', style: 0, width: 1, labelBackgroundColor: isDarkMode ? '#333333' : '#845fbc' },
                horzLine: { color: isDarkMode ? '#555C68' : '#9B7DFF', style: 0, width: 1, labelBackgroundColor: isDarkMode ? '#333333' : '#845fbc' },
            },
            timeScale: {
                borderColor,
                timeVisible: true,
                secondsVisible: false,
                barSpacing: 10,
                minBarSpacing: 4,
                rightOffset: 20,
                visible: true,
            },
            rightPriceScale: { borderColor, autoScale: true },
        });

        chartRef.current = chart;
        lineSeriesRefs.current = new Map();
        pendingPointsRef.current = [];

        // Candle series
        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#22c55e',
            wickDownColor: '#ef4444',
            priceFormat: { type: 'price', precision: 6, minMove: 0.000001 },
        });
        candleSeriesRef.current = candleSeries;

        // Volume series
        const volumeSeries = chart.addSeries(HistogramSeries, {
            color: '#26a69a',
            priceFormat: { type: 'volume' },
            priceScaleId: '', // Overlay mode
        });
        volumeSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
        });
        volumeSeriesRef.current = volumeSeries;

        // Prepare candle data
        const formattedData = data.map((d) => ({
            time: (d.timestamp / 1000) as any,
            open: parseFormattedPrice(d.open),
            high: parseFormattedPrice(d.high),
            low: parseFormattedPrice(d.low),
            close: parseFormattedPrice(d.close),
        }));
        formattedData.sort((a, b) => (a.time as number) - (b.time as number));
        candleSeries.setData(formattedData);
        formattedDataRef.current = formattedData;

        // Prepare volume data
        const volumeData = data.map((d: any) => ({
            time: (d.timestamp / 1000) as any,
            value: typeof d.volume === 'string' ? parseFloat(d.volume) : d.volume || 0,
            color: parseFormattedPrice(d.close) >= parseFormattedPrice(d.open) ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'
        }));
        volumeSeries.setData(volumeData);

        // Moving averages (keyed by label for toggle support)
        const closes = formattedData.map(d => d.close);
        const maMap = new Map<number, Record<string, number | null>>();
        const maSeriesMap = new Map<string, any>();

        MA_CONFIG.forEach(({ period, color, label }) => {
            if (formattedData.length < period) return;
            const sma = computeSMA(closes, period);
            const lineData: any[] = [];
            formattedData.forEach((d, i) => {
                const val = sma[i];
                if (val !== null) lineData.push({ time: d.time, value: val });
                const existing = maMap.get(d.time as number) || {};
                existing[label] = val;
                maMap.set(d.time as number, existing);
            });

            if (lineData.length > 0) {
                const series = chart.addSeries(LineSeries, {
                    color,
                    lineWidth: 1,
                    lastValueVisible: false,
                    priceLineVisible: false,
                    crosshairMarkerVisible: false,
                    visible: maEnabled[label] !== false,
                });
                series.setData(lineData);
                maSeriesMap.set(label, series);
            }
        });

        maSeriesRefs.current = maSeriesMap;
        maDataRef.current = maMap;

        // Set initial MA legend
        if (formattedData.length > 0) {
            const lastTime = formattedData[formattedData.length - 1].time as number;
            setMaLegend(maMap.get(lastTime) || null);
        }

        // Bar interval for future-time extrapolation
        if (formattedData.length >= 2) {
            barIntervalRef.current =
                (formattedData[formattedData.length - 1].time as number) -
                (formattedData[formattedData.length - 2].time as number);
        }

        // Set initial legend to last candle
        if (formattedData.length > 0) {
            const lastTime = formattedData[formattedData.length - 1].time as number;
            const lastCandle = dataMap.get(lastTime);
            if (lastCandle) setLegendData(lastCandle);
        }

        // Helper: resolve a time value from mouse event (works in the future area too)
        const resolveTime = (param: MouseEventParams): number | null => {
            if (param.time) return param.time as number;
            if (!param.point) return null;
            const fd = formattedDataRef.current;
            if (fd.length < 1) return null;
            const lastIdx = fd.length - 1;
            const lastTime = fd[lastIdx]?.time as number;
            if (!lastTime) return null;
            try {
                const ts = chart.timeScale();
                const logical = ts.coordinateToLogical(param.point.x);
                if (logical !== null && logical !== undefined) {
                    return lastTime + Math.round((logical as number) - lastIdx) * barIntervalRef.current;
                }
                // Fallback: map pixel → logical via visible logical range
                const visRange = ts.getVisibleLogicalRange();
                if (!visRange) return null;
                const l1 = Math.floor(visRange.from as number);
                const l2 = Math.ceil(visRange.to as number);
                if (l1 === l2) return null;
                const x1 = ts.logicalToCoordinate(l1 as any);
                const x2 = ts.logicalToCoordinate(l2 as any);
                if (x1 === null || x2 === null || x1 === x2) return null;
                const logicalPos = l1 + (param.point.x - x1) / (x2 - x1) * (l2 - l1);
                return lastTime + Math.round(logicalPos - lastIdx) * barIntervalRef.current;
            } catch { return null; }
        };

        // Helper: resolve price from y-coordinate with fallback for empty future area
        const resolvePrice = (y: number): number | null => {
            const price = candleSeriesRef.current?.coordinateToPrice(y);
            if (price != null && !isNaN(price)) {
                // Cache price scale mapping for fallback
                const h = chartContainerRef.current?.clientHeight;
                if (h && h > 0) {
                    const topP = candleSeriesRef.current?.coordinateToPrice(0);
                    const botP = candleSeriesRef.current?.coordinateToPrice(h);
                    if (topP != null && botP != null && !isNaN(topP) && !isNaN(botP) && topP !== botP) {
                        priceRangeRef.current = { topPrice: topP, bottomPrice: botP, height: h };
                    }
                }
                return price;
            }
            // Fallback: use cached price scale mapping
            const range = priceRangeRef.current;
            if (!range || range.height === 0) return null;
            const ratio = y / range.height;
            return range.topPrice + ratio * (range.bottomPrice - range.topPrice);
        };

        // Crosshair move — update OHLCV legend + MA legend + preview
        const handleCrosshairMove = (param: MouseEventParams) => {
            if (param.time) {
                const time = param.time as number;
                const item = dataMap.get(time);
                if (item) setLegendData(item);
                const ma = maDataRef.current.get(time);
                if (ma) setMaLegend(ma);
            } else if (!activeToolRef.current) {
                if (formattedData.length > 0) {
                    const lastTime = formattedData[formattedData.length - 1].time as number;
                    const lastCandle = dataMap.get(lastTime);
                    if (lastCandle) setLegendData(lastCandle);
                    const lastMa = maDataRef.current.get(lastTime);
                    if (lastMa) setMaLegend(lastMa);
                }
            }

            // Update cursor position for overlay preview
            if (activeToolRef.current && param.point) {
                const cursorTime = resolveTime(param);
                const cursorPrice = resolvePrice(param.point.y);
                if (cursorTime != null && cursorPrice != null && !isNaN(cursorPrice)) {
                    cursorPosRef.current = { time: cursorTime, price: cursorPrice };

                    const tool = activeToolRef.current;
                    const pending = pendingPointsRef.current;

                    // Trendline preview via LineSeries
                    if (tool === 'trendline' && pending.length === 1 && previewSeriesRef.current) {
                        const p1 = pending[0];
                        const pts = [
                            { time: p1.time as any, value: p1.price },
                            { time: cursorTime as any, value: cursorPrice },
                        ].sort((a: any, b: any) => a.time - b.time);
                        previewSeriesRef.current.setData(pts);
                    }

                    // Rect/channel preview via canvas overlay
                    if (tool === 'rect' || tool === 'channel') {
                        renderOverlay();
                    }
                }
            } else {
                cursorPosRef.current = null;
            }
        };
        chart.subscribeCrosshairMove(handleCrosshairMove);

        // Click handler for all drawing tools
        const handleClick = (param: MouseEventParams) => {
            const tool = activeToolRef.current;
            if (!tool) return;
            if (!param.point) return;

            const clickTime = resolveTime(param);
            const clickPrice = resolvePrice(param.point.y);
            if (clickTime == null || clickPrice == null || isNaN(clickPrice)) return;

            const pt: DrawingPoint = { time: clickTime, price: clickPrice };
            const pending = pendingPointsRef.current;
            const color = LINE_COLORS[drawingsCountRef.current % LINE_COLORS.length];

            if (tool === 'trendline') {
                if (pending.length === 0) {
                    // First click — start preview LineSeries
                    pendingPointsRef.current = [pt];
                    if (previewSeriesRef.current) {
                        try { chart.removeSeries(previewSeriesRef.current); } catch { }
                    }
                    const preview = chart.addSeries(LineSeries, {
                        color,
                        lineWidth: 2,
                        lineStyle: 2,
                        pointMarkersVisible: true,
                        pointMarkersRadius: 4,
                        lastValueVisible: false,
                        priceLineVisible: false,
                        autoscaleInfoProvider: () => null,
                    });
                    preview.setData([{ time: pt.time as any, value: pt.price }]);
                    previewSeriesRef.current = preview;
                } else {
                    // Second click — complete
                    const p1 = pending[0];
                    if (previewSeriesRef.current) {
                        try { chart.removeSeries(previewSeriesRef.current); } catch { }
                        previewSeriesRef.current = null;
                    }
                    onDrawingComplete({
                        id: `trendline_${Date.now()}`,
                        tool: 'trendline',
                        color,
                        p1,
                        p2: pt,
                    });
                    pendingPointsRef.current = [];
                    onToolDeactivate();
                }
            } else if (tool === 'rect') {
                if (pending.length === 0) {
                    pendingPointsRef.current = [pt];
                } else {
                    // Complete rect
                    onDrawingComplete({ id: `rect_${Date.now()}`, tool: 'rect', color, p1: pending[0], p2: pt });
                    pendingPointsRef.current = [];
                    cursorPosRef.current = null;
                    renderOverlay();
                    onToolDeactivate();
                }
            } else if (tool === 'channel') {
                if (pending.length < 2) {
                    pendingPointsRef.current = [...pending, pt];
                } else {
                    // Third click — complete channel
                    onDrawingComplete({ id: `channel_${Date.now()}`, tool: 'channel', color, p1: pending[0], p2: pending[1], p3: pt });
                    pendingPointsRef.current = [];
                    cursorPosRef.current = null;
                    renderOverlay();
                    onToolDeactivate();
                }
            }
        };
        chart.subscribeClick(handleClick);

        // Re-render overlay on visible range changes (zoom/scroll)
        const handleVisibleRangeChange = () => { renderOverlay(); };
        chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

        const handleResize = () => {
            if (container && chartRef.current) {
                chartRef.current.applyOptions({ width: container.clientWidth, height: container.clientHeight });
                renderOverlay();
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.unsubscribeCrosshairMove(handleCrosshairMove);
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
            chart.remove();
            lineSeriesRefs.current = new Map();
            previewSeriesRef.current = null;
        };
    }, [data, dataMap, isDarkMode, maEnabled]); // activeTool uses ref

    // Sync drawings: trendline/ray as LineSeries, rect/channel via overlay
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;

        // Remove series for drawings that no longer exist
        const currentIds = new Set(drawings.map(d => d.id));
        for (const [id, series] of lineSeriesRefs.current.entries()) {
            if (!currentIds.has(id)) {
                try { chart.removeSeries(series); } catch { }
                lineSeriesRefs.current.delete(id);
            }
        }

        // Add LineSeries for trendline drawings
        drawings.forEach((drawing) => {
            if (drawing.tool !== 'trendline') return;
            if (lineSeriesRefs.current.has(drawing.id)) return;

            const series = chart.addSeries(LineSeries, {
                color: drawing.color,
                lineWidth: 2,
                lineStyle: 0,
                pointMarkersVisible: true,
                pointMarkersRadius: 3,
                lastValueVisible: false,
                priceLineVisible: false,
                crosshairMarkerVisible: false,
                autoscaleInfoProvider: () => null,
            });

            const pts = [
                { time: drawing.p1.time as any, value: drawing.p1.price },
                { time: drawing.p2.time as any, value: drawing.p2.price },
            ].sort((a, b) => a.time - b.time);
            series.setData(pts);
            lineSeriesRefs.current.set(drawing.id, series);
        });

        // Re-render overlay for rect/channel
        renderOverlay();
    }, [drawings, renderOverlay]);

    // Toggle MA series visibility
    useEffect(() => {
        for (const { label } of MA_CONFIG) {
            const series = maSeriesRefs.current.get(label);
            if (series) {
                series.applyOptions({ visible: maEnabled[label] !== false });
            }
        }
    }, [maEnabled]);

    // Update cursor style without re-creating chart
    useEffect(() => {
        if (chartContainerRef.current) {
            chartContainerRef.current.style.cursor = activeTool ? 'crosshair' : 'default';
        }
    }, [activeTool]);

    return (
        <div className={`relative ${className || 'w-full h-80'}`}>
            <div className="relative w-full h-full">
                <div ref={chartContainerRef} className="w-full h-full" />

                {/* Canvas overlay for rect/channel drawings */}
                <canvas
                    ref={overlayCanvasRef}
                    className="absolute top-0 left-0 w-full h-full"
                    style={{ pointerEvents: 'none', zIndex: 5 }}
                />

                {/* Professional OHLCV legend — offset down in fullscreen to avoid close button overlap */}
                {legendData && (
                    <div className={`absolute z-40 pointer-events-none select-none max-w-[calc(100%-80px)] ${isFullScreen ? 'top-14 left-4' : 'top-2 left-2'}`}>
                        <div className="flex flex-wrap items-center gap-x-1 gap-y-0 text-[11px] leading-relaxed font-mono tracking-tight">
                            <span className="text-gray-500 dark:text-[#787b86] font-sans font-medium text-[10px]">O</span>
                            <span style={{ color: legendData.color }}>{formatLegendPrice(legendData.open)}</span>
                            <span className="text-gray-500 dark:text-[#787b86] font-sans font-medium text-[10px] ml-1.5">H</span>
                            <span style={{ color: legendData.color }}>{formatLegendPrice(legendData.high)}</span>
                            <span className="text-gray-500 dark:text-[#787b86] font-sans font-medium text-[10px] ml-1.5">L</span>
                            <span style={{ color: legendData.color }}>{formatLegendPrice(legendData.low)}</span>
                            <span className="text-gray-500 dark:text-[#787b86] font-sans font-medium text-[10px] ml-1.5">C</span>
                            <span style={{ color: legendData.color }}>{formatLegendPrice(legendData.close)}</span>
                            <span className="text-gray-500 dark:text-[#787b86] font-sans font-medium text-[10px] ml-2">Vol</span>
                            <span className="text-gray-400 dark:text-[#787b86]">{formatLegendVol(legendData.volume)}</span>
                            <span style={{ color: legendData.color }} className="font-semibold ml-2">
                                {legendData.delta >= 0 ? '+' : ''}{formatLegendPrice(legendData.delta)} ({legendData.percent >= 0 ? '+' : ''}{formatLegendPct(legendData.percent)}%)
                            </span>
                        </div>
                        {/* MA toggle buttons with values */}
                        <div className="flex flex-wrap items-center gap-2 mt-[6px] pointer-events-auto">
                            {MA_CONFIG.map(({ label, color }) => {
                                const isEnabled = maEnabled[label] !== false;
                                const val = maLegend?.[label];

                                return (
                                    <button
                                        key={label}
                                        onClick={() => onMaToggle(label)}
                                        data-ma-label={label}
                                        className={`flex items-center gap-1.5 px-2 py-[2px] rounded border text-[10px] font-sans transition-all duration-200 ${isEnabled
                                            ? 'bg-gray-100 dark:bg-[#2a2e39]/80 shadow-sm opacity-100'
                                            : 'bg-transparent opacity-60 hover:opacity-100 hover:bg-gray-50 dark:hover:bg-[#2a2e39]/40'
                                            }`}
                                        style={{ borderColor: isEnabled ? hexToRgba(color, 0.3) : 'transparent' }}
                                    >
                                        <span
                                            className="inline-block w-2 h-2 rounded-full"
                                            style={{
                                                backgroundColor: isEnabled ? color : 'transparent',
                                                border: `1px solid ${color}`
                                            }}
                                        />
                                        <span
                                            style={isEnabled ? { color } : {}}
                                            className={`font-semibold tracking-wide ${!isEnabled ? 'text-gray-500 dark:text-gray-400' : ''}`}
                                        >
                                            {label}
                                        </span>
                                        {val != null && (
                                            <span className={`font-mono tracking-tight ml-[1px] ${isEnabled ? 'text-gray-800 dark:text-gray-200' : 'text-gray-500 dark:text-gray-500'}`}>
                                                {formatLegendPrice(val)}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- 2. CUSTOM AREA CHART ---
interface HoverPoint { x: number; y: number; price: string; date: string; }

const CustomAreaChart: React.FC<PriceChartProps> = ({ data, loading, error, className }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const [hoverPoint, setHoverPoint] = useState<HoverPoint | null>(null);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const dragStartXRef = useRef(0);
    const dragStartScrollLeftRef = useRef(0);
    const padding = { top: 20, bottom: 30, left: 10, right: 60 };

    const { isDarkMode } = useTheme();

    const points = useMemo(() => {
        return data.map((p) => ({
            timestamp: p.timestamp,
            priceStr: p.price,
            val: parseFormattedPrice(p.price),
        }));
    }, [data]);

    const totalContentWidth = useMemo(() => {
        if (points.length < 2) return 0;
        return (points.length * TOTAL_UNIT_WIDTH) + padding.left + padding.right;
    }, [points.length]);

    useLayoutEffect(() => {
        const handleResize = () => {
            if (scrollContainerRef.current) setContainerWidth(scrollContainerRef.current.clientWidth);
        };
        window.addEventListener("resize", handleResize);
        handleResize();
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useLayoutEffect(() => {
        if (scrollContainerRef.current && totalContentWidth > 0) {
            scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth;
        }
    }, [totalContentWidth, loading]);

    useEffect(() => {
        const handleMouseUp = () => setIsDragging(false);
        window.addEventListener("mouseup", handleMouseUp);
        return () => window.removeEventListener("mouseup", handleMouseUp);
    }, []);

    const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
        setScrollLeft(e.currentTarget.scrollLeft);
        setHoverPoint(null);
    }, []);

    const drawChart = useCallback(() => {
        const canvas = canvasRef.current;
        const container = scrollContainerRef.current;
        if (!canvas || !container || points.length < 2 || loading || error) return;

        const width = container.clientWidth;
        const height = container.clientHeight || 320;

        const dpr = window.devicePixelRatio || 1;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const bgColor = isDarkMode ? "#1e1e1e" : "#FFFFFF";
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);

        const startPixel = scrollLeft - padding.left;
        const endPixel = scrollLeft + width - padding.right;
        let startIndex = Math.floor(startPixel / TOTAL_UNIT_WIDTH);
        let endIndex = Math.ceil(endPixel / TOTAL_UNIT_WIDTH);
        startIndex = Math.max(0, startIndex);
        endIndex = Math.min(points.length - 1, endIndex);

        const visiblePoints = points.slice(startIndex, endIndex + 1);
        if (visiblePoints.length === 0) return;

        const allVals = visiblePoints.map((p) => p.val);
        let minPrice = Math.min(...allVals);
        let maxPrice = Math.max(...allVals);
        const rangeBuffer = (maxPrice - minPrice) * 0.05;
        minPrice -= rangeBuffer;
        maxPrice += rangeBuffer;

        const priceRange = maxPrice - minPrice || 1;
        const chartHeight = height - padding.top - padding.bottom;

        const getY = (val: number) => {
            const normalized = (val - minPrice) / priceRange;
            return padding.top + chartHeight - normalized * chartHeight;
        };

        const getX = (index: number) => {
            const absoluteX = padding.left + (index * TOTAL_UNIT_WIDTH) + (CANDLE_WIDTH / 2);
            return absoluteX - scrollLeft;
        };

        // Grid lines logic
        const numGridLines = 5;
        const gridColor = isDarkMode ? "#333333" : "#f3f4f6";
        const labelColor = isDarkMode ? "#9ca3af" : "#9ca3af";

        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = labelColor;
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;

        for (let i = 0; i < numGridLines; i++) {
            const ratio = i / (numGridLines - 1);
            const yPos = padding.top + chartHeight * ratio;
            const priceVal = maxPrice - ratio * priceRange;
            ctx.beginPath(); ctx.setLineDash([4, 4]); ctx.moveTo(0, yPos); ctx.lineTo(width, yPos); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillText(formatAxisNumber(priceVal), width - padding.right + 8, yPos);
        }

        // Draw Series
        const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
        gradient.addColorStop(0, "rgba(147, 51, 234, 0.25)"); gradient.addColorStop(1, "rgba(255, 255, 255, 0.0)");
        ctx.beginPath();
        const drawStart = Math.max(0, startIndex - 1);
        const drawEnd = Math.min(points.length - 1, endIndex + 1);

        for (let i = drawStart; i <= drawEnd; i++) {
            const x = getX(i); const y = getY(points[i].val);
            if (i === drawStart) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineTo(getX(drawEnd), height - padding.bottom); ctx.lineTo(getX(drawStart), height - padding.bottom);
        ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();

        ctx.beginPath(); ctx.lineWidth = 2; ctx.strokeStyle = "#9333ea"; ctx.lineJoin = "round";
        for (let i = drawStart; i <= drawEnd; i++) {
            const x = getX(i); const y = getY(points[i].val);
            if (i === drawStart) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Tooltip
        if (hoverPoint) {
            ctx.strokeStyle = "rgba(147, 51, 234, 0.3)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(hoverPoint.x, padding.top); ctx.lineTo(hoverPoint.x, height - padding.bottom); ctx.stroke(); ctx.setLineDash([]);
            const tooltipText = [hoverPoint.date, `Price: ${hoverPoint.price}`];
            ctx.font = "12px Inter, sans-serif";
            const maxTextWidth = Math.max(...tooltipText.map((t) => ctx.measureText(t).width));
            const boxWidth = maxTextWidth + 24; const boxHeight = 50;
            let boxX = hoverPoint.x + 15; let boxY = hoverPoint.y - boxHeight / 2;
            if (boxX + boxWidth > width) boxX = hoverPoint.x - boxWidth - 15; if (boxY < 10) boxY = 10;

            ctx.fillStyle = isDarkMode ? "rgba(42, 42, 42, 0.96)" : "rgba(255, 255, 255, 0.96)";
            ctx.strokeStyle = isDarkMode ? "#4b5563" : "#e5e7eb";
            ctx.shadowColor = "rgba(0, 0, 0, 0.15)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;

            ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8); else ctx.rect(boxX, boxY, boxWidth, boxHeight);
            ctx.fill(); ctx.shadowColor = "transparent"; ctx.stroke();

            ctx.textAlign = "left"; ctx.textBaseline = "top";
            ctx.fillStyle = isDarkMode ? "#d1d5db" : "#6b7280";
            ctx.font = "11px Inter, sans-serif";
            ctx.fillText(tooltipText[0], boxX + 12, boxY + 12);

            ctx.font = "600 12px Inter, sans-serif"; ctx.fillStyle = "#9333ea"; ctx.fillText(tooltipText[1], boxX + 12, boxY + 28);
        }
    }, [points, loading, error, hoverPoint, scrollLeft, containerWidth, isDarkMode]);

    useLayoutEffect(() => {
        window.requestAnimationFrame(drawChart);
    }, [drawChart]);

    const handleMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        if (!scrollContainerRef.current) return;
        setIsDragging(true);
        dragStartXRef.current = e.clientX;
        dragStartScrollLeftRef.current = scrollContainerRef.current.scrollLeft;
        e.preventDefault();
    };

    const handlePointerMove = (e: ReactMouseEvent<HTMLCanvasElement> | ReactTouchEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas || loading || points.length < 2) return;
        if (isDragging && scrollContainerRef.current) {
            let clientX: number;
            if ("touches" in e) { if (e.touches.length === 0) return; clientX = e.touches[0].clientX; }
            else { clientX = (e as ReactMouseEvent).clientX; }
            const deltaX = clientX - dragStartXRef.current;
            scrollContainerRef.current.scrollLeft = dragStartScrollLeftRef.current - deltaX;
            setHoverPoint(null); e.preventDefault(); return;
        }
        let clientX;
        if ("touches" in e) { if (e.touches.length > 0) clientX = e.touches[0].clientX; else return; }
        else { clientX = (e as ReactMouseEvent).clientX; }
        const rect = canvas.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        if (mouseX < padding.left || mouseX > rect.width - padding.right) { setHoverPoint(null); return; }

        const height = scrollContainerRef.current?.clientHeight || 320;

        const absoluteX = scrollLeft + mouseX;
        const index = Math.round((absoluteX - padding.left - (CANDLE_WIDTH / 2)) / TOTAL_UNIT_WIDTH);
        if (index >= 0 && index < points.length) {
            const point = points[index];
            let minPrice = Math.min(...points.map(p => p.val));
            let maxPrice = Math.max(...points.map(p => p.val));
            const rangeBuffer = (maxPrice - minPrice) * 0.05; minPrice -= rangeBuffer; maxPrice += rangeBuffer;
            const priceRange = maxPrice - minPrice || 1;
            const chartHeight = height - padding.top - padding.bottom;
            const normalizedY = (point.val - minPrice) / priceRange;
            const chartY = padding.top + chartHeight - normalizedY * chartHeight;
            const chartX = padding.left + (index * TOTAL_UNIT_WIDTH) + (CANDLE_WIDTH / 2) - scrollLeft;
            setHoverPoint({ x: chartX, y: chartY, price: formatAmount18(point.priceStr), date: new Date(point.timestamp).toLocaleString() });
        } else { setHoverPoint(null); }
    };
    return (
        <div className={`bg-white dark:bg-[#1e1e1e] rounded-xl shadow-inner border border-gray-200 dark:border-[#333333] relative ${className || 'w-full h-80'}`}>
            <style>{`.no-scrollbar::-webkit-scrollbar { display: none; } .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
            <div ref={scrollContainerRef} onScroll={handleScroll} className="w-full h-full overflow-x-auto overflow-y-hidden no-scrollbar relative cursor-crosshair">
                <div style={{ width: `${totalContentWidth}px`, height: '1px' }} />
                <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handlePointerMove} onTouchStart={handlePointerMove} onTouchMove={handlePointerMove} onTouchEnd={() => { setHoverPoint(null); setIsDragging(false); }} onMouseLeave={() => { if (!isDragging) setHoverPoint(null); }} className="sticky left-0 top-0" style={{ display: "block", cursor: isDragging ? "grabbing" : "crosshair" }} />
            </div>
        </div>
    );
};

// --- 3. MAIN EXPORT ---
const DRAWING_TOOLS: { tool: DrawingTool; title: string; icon: (size: number) => React.ReactNode }[] = [
    {
        tool: 'trendline',
        title: 'Trendline',
        icon: (s) => (
            <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="20" x2="20" y2="4" />
                <circle cx="4" cy="20" r="2" />
                <circle cx="20" cy="4" r="2" />
            </svg>
        ),
    },
    {
        tool: 'rect',
        title: 'Rectangle',
        icon: (s) => (
            <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="1" />
            </svg>
        ),
    },
    {
        tool: 'channel',
        title: 'Parallel Channel',
        icon: (s) => (
            <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="2" y1="18" x2="22" y2="6" />
                <line x1="2" y1="12" x2="22" y2="0" />
            </svg>
        ),
    },
];

const TOOL_HINTS: Record<DrawingTool, string> = {
    trendline: 'Click two points to draw a trendline',
    rect: 'Click two corners to draw a rectangle',
    channel: 'Click 3 points: two for the edge line, one for width',
};

const DEFAULT_MA_ENABLED: Record<string, boolean> = { 'MA(7)': true, 'MA(25)': true, 'MA(99)': false };

export const PriceChart: React.FC<PriceChartProps> = (props) => {
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [activeTool, setActiveTool] = useState<DrawingTool | null>(null);
    const [drawings, setDrawings] = useState<Drawing[]>([]);
    const [maEnabled, setMaEnabled] = useState<Record<string, boolean>>(DEFAULT_MA_ENABLED);
    const { loading, error, data, type } = props;

    const handleDrawingComplete = useCallback((drawing: Drawing) => {
        setDrawings(prev => [...prev, drawing]);
    }, []);

    const handleUndo = useCallback(() => {
        setDrawings(prev => prev.slice(0, -1));
    }, []);

    const handleClearAll = useCallback(() => {
        setDrawings([]);
    }, []);

    const toggleTool = useCallback((tool: DrawingTool) => {
        setActiveTool(prev => prev === tool ? null : tool);
    }, []);

    const handleMaToggle = useCallback((label: string) => {
        setMaEnabled(prev => ({ ...prev, [label]: prev[label] === false ? true : false }));
    }, []);



    // Trigger resize event when toggling fullscreen so the chart library re-measures
    useEffect(() => {
        window.dispatchEvent(new Event('resize'));
    }, [isFullScreen]);

    // Prevent background scrolling when in fullscreen & close on Escape
    useEffect(() => {
        if (isFullScreen) {
            document.body.style.overflow = 'hidden';
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape') setIsFullScreen(false);
            };
            window.addEventListener('keydown', handleKeyDown);
            return () => {
                document.body.style.overflow = '';
                window.removeEventListener('keydown', handleKeyDown);
            };
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isFullScreen]);

    const MaximizeIcon = () => (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
    );

    const MinimizeIcon = () => (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
        </svg>
    );

    if (loading) return <div className="text-center py-12 text-gray-500 italic">Loading chart data...</div>;
    if (error) return <div className="text-center py-12 text-red-500 font-bold">Chart Error: {error}</div>;
    if (data.length < 2) return <div className="text-center py-12 text-gray-500 italic">No historical data available.</div>;

    const containerClass = isFullScreen
        ? "fixed top-0 left-full w-[100vh] h-[100vw] z-[100] bg-white dark:bg-[#1e1e1e] origin-top-left rotate-90 md:left-0 md:w-screen md:h-screen md:rotate-0 md:transform-none"
        : `${props.className || 'w-full h-80'} relative`;

    const btnBase = isFullScreen
        ? 'p-3 rounded-lg'
        : 'p-2 rounded-md';
    const btnNormal = `${btnBase} bg-white/90 dark:bg-[#2a2e39]/90 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-[#363a45] shadow-sm hover:bg-gray-50 dark:hover:bg-[#363a45] hover:text-[#845fbc] dark:hover:text-[#a78bfa] transition-colors`;
    const btnActive = `${btnBase} bg-[#845fbc] text-white border border-[#845fbc] shadow-sm transition-colors`;
    const iconSize = isFullScreen ? 20 : 16;

    return (
        <div key={isFullScreen ? 'fs' : 'norm'} className={containerClass}>
            <div className={`w-full h-full ${isFullScreen ? 'p-3 md:p-6' : ''}`}>
                {type === 'candle' ? (
                    <LightweightCandleChart
                        {...props}
                        className="w-full h-full"
                        activeTool={activeTool}
                        drawings={drawings}
                        onDrawingComplete={handleDrawingComplete}
                        onToolDeactivate={() => setActiveTool(null)}
                        isFullScreen={isFullScreen}
                        maEnabled={maEnabled}
                        onMaToggle={handleMaToggle}
                    />
                ) : (
                    <CustomAreaChart {...props} className="w-full h-full" />
                )}
            </div>

            {/* Toolbar */}
            <div className={`absolute z-30 flex items-center gap-1.5 ${isFullScreen ? 'top-4 right-4 md:top-8 md:right-8' : 'top-2 right-2'}`}>
                {type === 'candle' && (
                    <>
                        {/* Drawing tool buttons */}
                        {DRAWING_TOOLS.map(({ tool, title, icon }) => (
                            <button
                                key={tool}
                                onClick={() => toggleTool(tool)}
                                className={activeTool === tool ? btnActive : btnNormal}
                                title={activeTool === tool ? `Cancel ${title}` : title}
                            >
                                {icon(iconSize)}
                            </button>
                        ))}

                        {/* Undo */}
                        {drawings.length > 0 && (
                            <button onClick={handleUndo} className={btnNormal} title="Undo Last Drawing">
                                <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="1 4 1 10 7 10" />
                                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                                </svg>
                            </button>
                        )}

                        {/* Clear All */}
                        {drawings.length > 0 && (
                            <button
                                onClick={handleClearAll}
                                className={`${btnBase} bg-white/90 dark:bg-[#2a2e39]/90 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-[#363a45] shadow-sm hover:bg-gray-50 dark:hover:bg-[#363a45] hover:text-red-400 transition-colors`}
                                title="Clear All Drawings"
                            >
                                <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                            </button>
                        )}
                    </>
                )}

                {/* Fullscreen toggle */}
                <button
                    onClick={() => setIsFullScreen(!isFullScreen)}
                    className={btnNormal}
                    title={isFullScreen ? 'Exit Fullscreen' : 'Fullscreen'}
                >
                    {isFullScreen ? <MinimizeIcon /> : <MaximizeIcon />}
                </button>
            </div>

            {/* Close button — prominent in fullscreen (top-left) */}
            {isFullScreen && (
                <button
                    onClick={() => setIsFullScreen(false)}
                    className="absolute top-4 left-4 md:top-8 md:left-8 z-30 w-10 h-10 flex items-center justify-center bg-gray-800/70 hover:bg-gray-700 text-white rounded-full backdrop-blur-sm transition-colors"
                    title="Close"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            )}

            {/* Drawing tool indicator */}
            {activeTool && (
                <div className={`absolute left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-[#845fbc]/90 text-white text-xs font-bold rounded-full shadow-lg backdrop-blur-sm ${isFullScreen ? 'bottom-6' : 'bottom-2'}`}>
                    {TOOL_HINTS[activeTool]}
                </div>
            )}
        </div>
    );
};
