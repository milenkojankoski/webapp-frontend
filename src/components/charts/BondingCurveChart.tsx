import React, { useRef, useEffect } from 'react';
import Chart, { type TooltipItem } from 'chart.js/auto';

export interface ChartDataPoint {
    tokensSold: number;
    price: number;
}

export interface PriceChartProps {
    data: ChartDataPoint[];
    curveType: string;
    currentSold?: number;
    maxSupply?: number;
    listingPrice?: number;
}

export const PriceChart: React.FC<PriceChartProps> = ({ data, curveType, currentSold, listingPrice }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const chartInstanceRef = useRef<Chart | null>(null);

    useEffect(() => {
        if (!canvasRef.current || data.length === 0) return;

        if (chartInstanceRef.current) {
            chartInstanceRef.current.destroy();
        }

        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        const gradientFuture = ctx.createLinearGradient(0, 0, 0, 400);
        gradientFuture.addColorStop(0, 'rgba(132, 95, 188, 0.2)');
        gradientFuture.addColorStop(1, 'rgba(132, 95, 188, 0.0)');

        const datasets: any[] = [];

        datasets.push({
            label: 'Price Curve',
            data: data.map(d => ({ x: d.tokensSold, y: d.price })),
            borderColor: '#845fbc',
            borderWidth: 2,
            backgroundColor: gradientFuture,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#14b8a6',
            pointHoverBorderColor: '#fff',
            tension: 0.4,
            order: 2
        });

        if (currentSold !== undefined) {
            const currentPoint = data.reduce((prev, curr) =>
                Math.abs(curr.tokensSold - currentSold) < Math.abs(prev.tokensSold - currentSold) ? curr : prev
            );

            datasets.push({
                label: 'Current Spot',
                data: [{ x: currentPoint.tokensSold, y: currentPoint.price }],
                pointStyle: 'circle',
                pointRadius: 6,
                pointBackgroundColor: '#14b8a6',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                showLine: false,
                order: 1
            });
        }

        if (listingPrice !== undefined && listingPrice > 0) {
            const maxTokens = Math.max(...data.map(d => d.tokensSold));
            datasets.push({
                label: 'Listing Price',
                data: [{ x: maxTokens * 0.99, y: listingPrice }],
                pointStyle: 'circle',
                pointRadius: 8,
                pointBackgroundColor: '#14b8a6',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                showLine: false,
                order: 0
            });
        }

        const fontColor = document.documentElement.classList.contains('dark') ? '#9ca3af' : '#6b7280';
        const gridColor = document.documentElement.classList.contains('dark') ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

        // Ensure y-axis includes listing price with some headroom
        const maxCurvePrice = Math.max(...data.map(d => d.price));
        const isFlat = curveType && curveType.toLowerCase() === 'fixed';

        let yMin: number | undefined;
        let yMax: number | undefined;

        if (isFlat && maxCurvePrice > 0) {
            // For static/fixed curves, center the line in the middle of the chart
            const topPrice = listingPrice && listingPrice > maxCurvePrice ? listingPrice : maxCurvePrice;
            yMin = 0;
            yMax = topPrice * 2;
        } else if (listingPrice && listingPrice > 0) {
            yMax = Math.max(maxCurvePrice, listingPrice) * 1.15;
        }

        chartInstanceRef.current = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { top: 4, left: 0, right: 8, bottom: 0 }
                },
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: document.documentElement.classList.contains('dark') ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
                        titleColor: document.documentElement.classList.contains('dark') ? '#fff' : '#000',
                        bodyColor: document.documentElement.classList.contains('dark') ? '#fff' : '#000',
                        borderColor: document.documentElement.classList.contains('dark') ? '#333' : '#e5e7eb',
                        borderWidth: 1,
                        padding: 12,
                        cornerRadius: 12,
                        displayColors: false,
                        callbacks: {
                            label: (context: TooltipItem<'line'>) => {
                                const val = Number(context.raw ? (context.raw as any).y : 0);
                                return `Price: ${val.toFixed(6)} KTA`;
                            },
                            title: (context: TooltipItem<'line'>[]) => {
                                const val = Number(context[0].raw ? (context[0].raw as any).x : 0);
                                return `Sales: ${new Intl.NumberFormat('en-US', { notation: 'compact' }).format(val)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        grid: { display: false },
                        border: { display: true, color: gridColor, width: 1 },
                        max: Math.max(...data.map(d => d.tokensSold)),
                        ticks: {
                            color: fontColor,
                            font: { family: "'Outfit', 'Inter', sans-serif", size: 12, weight: 500 },
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 5,
                            padding: 4,
                            callback: (val) => new Intl.NumberFormat('en-US').format(Number(val))
                        }
                    },
                    y: {
                        grid: { display: false },
                        border: { display: true, color: gridColor, width: 1 },
                        min: yMin,
                        max: yMax,
                        ticks: {
                            color: fontColor,
                            font: { family: "'Outfit', 'Inter', sans-serif", size: 12, weight: 500 },
                            padding: 0, // Remove padding to shift labels left
                            callback: (val) => `KTA ${Number(val).toFixed(6)}`
                        }
                    }
                }
            }
        });
    }, [data, curveType, currentSold, listingPrice]);

    return (
        <div className="w-full h-full">
            <canvas ref={canvasRef}></canvas>
        </div>
    );
};
