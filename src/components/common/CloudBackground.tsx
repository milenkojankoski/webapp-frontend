import React, { useEffect, useRef } from 'react';

/**
 * Bridge network background — viewport-filling.
 * Nodes connected by sweeping arcs with glowing pulses traveling along them,
 * visualizing value flowing between chains. Mouse brightens nearby elements.
 * Pure Canvas 2D.
 */
const BridgeBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let active = true;
    let w = 0, h = 0;
    const mouse = { x: -9999, y: -9999 };

    const MOUSE_RADIUS = 220;
    const NODE_COUNT = 30;

    interface Node {
      x: number; y: number;
      homeX: number; homeY: number;
      r: number;
      phase: number;
      speed: number;
    }

    interface Arc {
      from: number; to: number;
      curvature: number;    // how much the arc bows (sign = direction)
      pulses: Pulse[];
    }

    interface Pulse {
      t: number;            // 0..1 position along arc
      speed: number;        // units per second
      size: number;
      brightness: number;
    }

    let nodes: Node[] = [];
    let arcs: Arc[] = [];

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * devicePixelRatio;
      canvas.height = h * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };

    const init = () => {
      resize();
      nodes = [];
      arcs = [];

      // Place nodes with some spacing via simple rejection
      for (let i = 0; i < NODE_COUNT; i++) {
        let x: number, y: number, ok: boolean;
        let attempts = 0;
        do {
          x = 60 + Math.random() * (w - 120);
          y = 60 + Math.random() * (h - 120);
          ok = true;
          for (const n of nodes) {
            const d = Math.sqrt((n.homeX - x) ** 2 + (n.homeY - y) ** 2);
            if (d < 90) { ok = false; break; }
          }
          attempts++;
        } while (!ok && attempts < 50);

        nodes.push({
          x, y,
          homeX: x, homeY: y,
          r: 2.5 + Math.random() * 2,
          phase: Math.random() * Math.PI * 2,
          speed: 0.2 + Math.random() * 0.3,
        });
      }

      // Connect nodes — each node connects to 2-3 nearest neighbors
      const connections = new Set<string>();
      for (let i = 0; i < nodes.length; i++) {
        const distances: { j: number; d: number }[] = [];
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const dx = nodes[i].homeX - nodes[j].homeX;
          const dy = nodes[i].homeY - nodes[j].homeY;
          distances.push({ j, d: Math.sqrt(dx * dx + dy * dy) });
        }
        distances.sort((a, b) => a.d - b.d);
        const connectCount = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < Math.min(connectCount, distances.length); k++) {
          const j = distances[k].j;
          if (distances[k].d > w * 0.45) continue; // skip very long arcs
          const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
          if (connections.has(key)) continue;
          connections.add(key);

          const arc: Arc = {
            from: i, to: j,
            curvature: (0.15 + Math.random() * 0.25) * (Math.random() > 0.5 ? 1 : -1),
            pulses: [],
          };
          // Seed initial pulses
          const pulseCount = 1 + Math.floor(Math.random() * 3);
          for (let p = 0; p < pulseCount; p++) {
            arc.pulses.push({
              t: Math.random(),
              speed: 0.06 + Math.random() * 0.08,
              size: 2.5 + Math.random() * 2,
              brightness: 0.5 + Math.random() * 0.5,
            });
          }
          arcs.push(arc);
        }
      }
    };

    const isDark = () => document.documentElement.classList.contains('dark');

    // Get point on quadratic bezier
    const bezierPoint = (ax: number, ay: number, cx: number, cy: number, bx: number, by: number, t: number) => {
      const u = 1 - t;
      return {
        x: u * u * ax + 2 * u * t * cx + t * t * bx,
        y: u * u * ay + 2 * u * t * cy + t * t * by,
      };
    };

    const animate = () => {
      if (!active) return;
      ctx.clearRect(0, 0, w, h);

      const dark = isDark();
      const mx = mouse.x;
      const my = mouse.y;
      const now = performance.now() * 0.001;
      const dt = 1 / 60; // approximate

      // Update node positions (gentle float)
      for (const node of nodes) {
        const fx = Math.sin(now * 0.2 * node.speed + node.phase) * 20
                 + Math.sin(now * 0.1 * node.speed + node.phase * 2.1) * 10;
        const fy = Math.cos(now * 0.15 * node.speed + node.phase * 1.5) * 18
                 + Math.cos(now * 0.08 * node.speed + node.phase * 0.7) * 8;

        node.x += (node.homeX + fx - node.x) * 0.03;
        node.y += (node.homeY + fy - node.y) * 0.03;
      }

      // Draw arcs and pulses
      for (const arc of arcs) {
        const a = nodes[arc.from];
        const b = nodes[arc.to];

        // Control point for quadratic bezier
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        // Perpendicular offset
        const nx = -dy / len;
        const ny = dx / len;
        const cpX = midX + nx * len * arc.curvature;
        const cpY = midY + ny * len * arc.curvature;

        // Mouse proximity to arc midpoint
        const arcMidDist = Math.sqrt((midX - mx) ** 2 + (midY - my) ** 2);
        const arcMouseT = arcMidDist < MOUSE_RADIUS ? (1 - arcMidDist / MOUSE_RADIUS) : 0;

        // Draw arc
        const arcAlpha = (dark ? 0.06 : 0.04) + arcMouseT * 0.15;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cpX, cpY, b.x, b.y);
        ctx.strokeStyle = dark
          ? `rgba(167, 139, 250, ${arcAlpha})`
          : `rgba(132, 95, 188, ${arcAlpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Update and draw pulses
        for (const pulse of arc.pulses) {
          pulse.t += pulse.speed * dt;
          if (pulse.t > 1) pulse.t -= 1;

          const pt = bezierPoint(a.x, a.y, cpX, cpY, b.x, b.y, pulse.t);

          // Pulse mouse proximity
          const pDist = Math.sqrt((pt.x - mx) ** 2 + (pt.y - my) ** 2);
          const pMouseT = pDist < MOUSE_RADIUS ? (1 - pDist / MOUSE_RADIUS) : 0;

          const baseAlpha = (dark ? 0.25 : 0.2) * pulse.brightness + pMouseT * 0.4;
          const r = pulse.size + pMouseT * 3;

          // Glow
          const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 3);
          if (dark) {
            grad.addColorStop(0, `rgba(167, 139, 250, ${baseAlpha * 0.6})`);
            grad.addColorStop(0.5, `rgba(167, 139, 250, ${baseAlpha * 0.15})`);
            grad.addColorStop(1, 'rgba(167, 139, 250, 0)');
          } else {
            grad.addColorStop(0, `rgba(132, 95, 188, ${baseAlpha * 0.5})`);
            grad.addColorStop(0.5, `rgba(132, 95, 188, ${baseAlpha * 0.12})`);
            grad.addColorStop(1, 'rgba(132, 95, 188, 0)');
          }
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r * 3, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();

          // Core dot
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          ctx.fillStyle = dark
            ? `rgba(167, 139, 250, ${baseAlpha})`
            : `rgba(132, 95, 188, ${baseAlpha})`;
          ctx.fill();
        }
      }

      // Draw nodes
      for (const node of nodes) {
        const dx = node.x - mx;
        const dy = node.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mouseT = dist < MOUSE_RADIUS ? (1 - dist / MOUSE_RADIUS) : 0;

        const pulse = Math.sin(now * 1.2 + node.phase) * 0.2 + 1;
        const r = node.r * pulse;

        const baseAlpha = dark ? 0.18 : 0.14;
        const alpha = baseAlpha + mouseT * 0.5;

        // Outer glow ring
        if (mouseT > 0.15) {
          const grad = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r + 12 * mouseT);
          if (dark) {
            grad.addColorStop(0, `rgba(167, 139, 250, ${mouseT * 0.15})`);
            grad.addColorStop(1, 'rgba(167, 139, 250, 0)');
          } else {
            grad.addColorStop(0, `rgba(132, 95, 188, ${mouseT * 0.12})`);
            grad.addColorStop(1, 'rgba(132, 95, 188, 0)');
          }
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 12 * mouseT, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Node core
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = dark
          ? `rgba(167, 139, 250, ${alpha})`
          : `rgba(132, 95, 188, ${alpha})`;
        ctx.fill();

        // Thin ring around node
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 2, 0, Math.PI * 2);
        ctx.strokeStyle = dark
          ? `rgba(167, 139, 250, ${alpha * 0.4})`
          : `rgba(132, 95, 188, ${alpha * 0.3})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      requestAnimationFrame(animate);
    };

    init();
    requestAnimationFrame(animate);

    const onResize = () => { init(); }; // re-place nodes on resize
    const onMouseMove = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onMouseLeave = () => { mouse.x = -9999; mouse.y = -9999; };

    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseleave', onMouseLeave);

    return () => {
      active = false;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-0"
      aria-hidden="true"
    />
  );
};

export default BridgeBackground;
