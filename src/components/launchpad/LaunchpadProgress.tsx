import React from 'react';

interface LaunchpadProgressProps {
    percent: number; // 0 to 100
    width?: number;
    height?: number;
    curve?: string;
}

export const LaunchpadProgress: React.FC<LaunchpadProgressProps> = ({ percent, width = 100, height = 30, curve = 'linear' }) => {
    // Generate path points
    const points = width;
    const pathData = [];

    // Config for graph
    const startY = height - 2; // Bottom (with padding)
    const endY = 2;   // Top (with padding)

    // Normalize curve type
    const curveType = (curve || 'linear').toLowerCase();

    // Determine visual style
    const isLineBar = curveType === 'linear' || curveType === 'fixed';
    const strokeWidth = isLineBar ? 6 : 3;

    for (let i = 0; i <= points; i++) {
        const x = i;
        const t = i / points;

        // Calculate Normalized Y (0 to 1)
        let normalizedY = 0;

        if (curveType === 'sigmoid') {
            // Sigmoid: 3t^2 - 2t^3 (S-Curve)
            normalizedY = 3 * t * t - 2 * t * t * t;
        } else if (curveType === 'exponential') {
            // Exponential: t^2 (Convex J-Curve)
            normalizedY = t * t;
        } else {
            // Linear/Fixed: Constant horizontal line (Progress Bar)
            normalizedY = 0.5;
        }

        // Map to Screen Coordinates
        // For linear bar, we keep it centered. For curves, mapped from startY to endY.
        let y;
        if (isLineBar) {
            y = height / 2;
        } else {
            y = startY - (startY - endY) * normalizedY;
        }

        if (i === 0) pathData.push(`M ${x},${y}`);
        else pathData.push(`L ${x},${y}`);
    }

    const d = pathData.join(" ");

    return (
        <div className="flex flex-col items-center justify-center">
            <div className="relative" style={{ width, height }}>
                {/* Background Line (Purple) */}
                <svg width={width} height={height} className="absolute top-0 left-0 overflow-visible">
                    <path d={d} stroke="#845fbc" strokeWidth={strokeWidth} fill="none" strokeOpacity="0.3" strokeLinecap="round" />
                </svg>

                {/* Foreground Line (Turquoise - Progress) */}
                <div className="absolute top-0 left-0 overflow-hidden" style={{ width: `${Math.min(percent, 100)}%`, height: '100%', transition: 'width 0.5s ease-out' }}>
                    <svg width={width} height={height} className="overflow-visible">
                        <path d={d} stroke="#14b8a6" strokeWidth={strokeWidth} fill="none" strokeLinecap="round" />
                    </svg>
                </div>
            </div>

            {/* Percentage Text */}
            <div className="mt-1 text-xs font-bold text-teal-500">
                {percent.toFixed(1)}%
            </div>
        </div>
    );
};
