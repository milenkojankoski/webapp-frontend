import React, { useEffect, useRef } from 'react';

/**
 * Flowing particle network background — fills the viewport.
 * Particles drift in organic Lissajous patterns with connection lines.
 * Mouse cursor pushes nearby particles and brightens the local area.
 * Pure Canvas 2D — no GPU/WebGL required.
 */
const ParticleNetwork: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let active = true;
    let w = 0, h = 0;
    const mouse = { x: -9999, y: -9999 };

    const COUNT = 200;
    const CONNECT_DIST = 120;
    const MOUSE_RADIUS = 180;

    interface Particle {
      x: number; y: number;
      homeX: number; homeY: number;
      baseR: number;
      phase: number;
      speed: number;
    }

    let particles: Particle[] = [];

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * devicePixelRatio;
      canvas.height = h * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };

    const init = () => {
      resize();
      particles = [];
      for (let i = 0; i < COUNT; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        particles.push({
          x, y,
          homeX: x, homeY: y,
          baseR: 1.2 + Math.random() * 1.8,
          phase: Math.random() * Math.PI * 2,
          speed: 0.3 + Math.random() * 0.5,
        });
      }
    };

    const isDark = () => document.documentElement.classList.contains('dark');

    const animate = () => {
      if (!active) return;
      ctx.clearRect(0, 0, w, h);

      const dark = isDark();
      const mx = mouse.x;
      const my = mouse.y;
      const t = performance.now() * 0.001;

      for (const p of particles) {
        const flowX = Math.sin(t * 0.15 * p.speed + p.phase) * 60
                     + Math.sin(t * 0.08 * p.speed + p.phase * 2.3) * 30;
        const flowY = Math.cos(t * 0.12 * p.speed + p.phase * 1.7) * 50
                     + Math.cos(t * 0.06 * p.speed + p.phase * 0.5) * 25;

        let targetX = p.homeX + flowX;
        let targetY = p.homeY + flowY;

        const dx = targetX - mx;
        const dy = targetY - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_RADIUS && dist > 0) {
          const push = (1 - dist / MOUSE_RADIUS) * 60;
          targetX += (dx / dist) * push;
          targetY += (dy / dist) * push;
        }

        p.x += (targetX - p.x) * 0.04;
        p.y += (targetY - p.y) * 0.04;
      }

      // Connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECT_DIST) {
            const fade = 1 - dist / CONNECT_DIST;
            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;
            const mDist = Math.sqrt((midX - mx) ** 2 + (midY - my) ** 2);
            const mBoost = mDist < MOUSE_RADIUS ? (1 - mDist / MOUSE_RADIUS) * 0.3 : 0;
            const alpha = fade * (dark ? 0.14 : 0.10) + mBoost;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = dark
              ? `rgba(167, 139, 250, ${alpha})`
              : `rgba(132, 95, 188, ${alpha})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }

      // Particles
      for (const p of particles) {
        const pulse = Math.sin(t * 1.5 + p.phase) * 0.25 + 1;
        const r = p.baseR * pulse;

        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mouseT = dist < MOUSE_RADIUS ? (1 - dist / MOUSE_RADIUS) : 0;

        const baseAlpha = dark ? 0.22 : 0.16;
        const alpha = baseAlpha + mouseT * 0.5;

        if (mouseT > 0.25) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 5 * mouseT, 0, Math.PI * 2);
          ctx.fillStyle = dark
            ? `rgba(167, 139, 250, ${mouseT * 0.1})`
            : `rgba(132, 95, 188, ${mouseT * 0.08})`;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = dark
          ? `rgba(167, 139, 250, ${alpha})`
          : `rgba(132, 95, 188, ${alpha})`;
        ctx.fill();
      }

      requestAnimationFrame(animate);
    };

    init();
    requestAnimationFrame(animate);

    const onResize = () => resize();
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

export default ParticleNetwork;
