import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, VolumeX, Sparkles } from 'lucide-react';
import { soundManager } from './audio';
import './App.css';

// Palette of vibrant celebratory Diwali colors
const PALETTES = [
  ['#FFD700', '#FFA500', '#FF4500', '#FFF8DC'],
  ['#FF1493', '#FF69B4', '#9400D3', '#E6E6FA'],
  ['#00FFFF', '#00BFFF', '#1E90FF', '#E0FFFF'],
  ['#32CD32', '#7CFC00', '#00FA9A', '#F0FFF0'],
  ['#FF8C00', '#FFA07A', '#FFD700', '#FFFFE0'],
  ['#FF3366', '#FF9933', '#FFFF66', '#FFFFFF'],
];

// Pre-compute RGB values from hex for fast rgba() string building
const PALETTE_RGB = PALETTES.map((pal) =>
  pal.map((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  })
);

// ── Hard limits ──
const MAX_PARTICLES = 600;
const MAX_EMBERS = 30;
const MAX_ROCKETS = 12;

// ── Swap-and-pop removal: O(1) instead of splice O(n) ──
function swapRemove(arr, i) {
  arr[i] = arr[arr.length - 1];
  arr.pop();
}

export default function App() {
  const [isDiyaLit, setIsDiyaLit] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showSkyHint, setShowSkyHint] = useState(false);
  const [showCredit, setShowCredit] = useState(false);

  const canvasRef = useRef(null);
  const diyaLitRef = useRef(false);
  const flashRef = useRef(null);
  const creditTimerRef = useRef(null);

  const skyStateRef = useRef({
    stars: [],
    shootingStars: [],
    rockets: [],
    particles: [],
    embers: [],
    width: window.innerWidth,
    height: window.innerHeight,
    diyaPos: { x: window.innerWidth / 2, y: window.innerHeight - 70 },
  });

  // Keep ref in sync to avoid re-creating the render loop
  useEffect(() => {
    diyaLitRef.current = isDiyaLit;
  }, [isDiyaLit]);

  // Initialize sound engine once
  useEffect(() => {
    soundManager.init();
  }, []);

  // ── Single render loop, never re-created ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    const state = skyStateRef.current;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.width = window.innerWidth;
      state.height = window.innerHeight;
      canvas.width = state.width * dpr;
      canvas.height = state.height * dpr;
      canvas.style.width = state.width + 'px';
      canvas.style.height = state.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      state.diyaPos = { x: state.width / 2, y: state.height - 70 };

      // Stars — pre-compute fillStyle string once
      const starCount = Math.min(Math.floor((state.width * state.height) / 3600), 280);
      state.stars = Array.from({ length: starCount }, () => {
        const hue = Math.random() > 0.8 ? (Math.random() > 0.5 ? 210 : 45) : 60;
        return {
          x: Math.random() * state.width,
          y: Math.random() * (state.height * 0.78),
          size: Math.random() * 1.4 + 0.4,
          alpha: Math.random() * 0.75 + 0.25,
          speed: Math.random() * 0.018 + 0.006,
          phase: Math.random() * Math.PI * 2,
          r: hue === 210 ? 180 : 255,
          g: hue === 210 ? 210 : (hue === 45 ? 230 : 250),
          b: hue === 210 ? 255 : (hue === 45 ? 200 : 240),
        };
      });
    };

    window.addEventListener('resize', resize);
    resize();

    let animId;
    let t = 0;

    // Reusable sin table (avoids per-particle Math.sin each frame)
    const SIN_TABLE_SIZE = 1024;
    const SIN_TABLE = new Float32Array(SIN_TABLE_SIZE);
    for (let i = 0; i < SIN_TABLE_SIZE; i++) {
      SIN_TABLE[i] = Math.sin((i / SIN_TABLE_SIZE) * Math.PI * 2);
    }
    const fastSin = (x) => {
      const idx = ((x % (Math.PI * 2)) + Math.PI * 2) * (SIN_TABLE_SIZE / (Math.PI * 2));
      return SIN_TABLE[((idx | 0) % SIN_TABLE_SIZE + SIN_TABLE_SIZE) % SIN_TABLE_SIZE];
    };

    const PI2 = Math.PI * 2;

    const render = () => {
      t++;
      const W = state.width;
      const H = state.height;
      ctx.clearRect(0, 0, W, H);

      // ── 1. Stars (simple fills, NO shadowBlur) ──
      const stars = state.stars;
      for (let i = 0, len = stars.length; i < len; i++) {
        const s = stars[i];
        const twinkle = fastSin(t * s.speed + s.phase) * 0.35 + 0.65;
        const a = s.alpha * twinkle;
        if (a < 0.05) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgb(${s.r},${s.g},${s.b})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, PI2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── 2. Shooting Stars (rare, max 2) ──
      if (Math.random() < 0.006 && state.shootingStars.length < 2) {
        state.shootingStars.push({
          x: Math.random() * W * 0.8,
          y: Math.random() * H * 0.33,
          length: Math.random() * 70 + 50,
          speed: Math.random() * 9 + 12,
          angle: Math.PI / 4 + (Math.random() - 0.5) * 0.2,
          life: 1.0,
          decay: 0.028 + Math.random() * 0.02,
        });
      }
      for (let i = state.shootingStars.length - 1; i >= 0; i--) {
        const s = state.shootingStars[i];
        const cosA = Math.cos(s.angle);
        const sinA = Math.sin(s.angle);
        const tailX = s.x - cosA * s.length;
        const tailY = s.y - sinA * s.length;

        const grad = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
        grad.addColorStop(0, `rgba(255,255,255,${s.life * 0.9})`);
        grad.addColorStop(0.35, `rgba(255,220,150,${s.life * 0.5})`);
        grad.addColorStop(1, 'rgba(255,200,100,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();

        s.x += cosA * s.speed;
        s.y += sinA * s.speed;
        s.life -= s.decay;
        if (s.life <= 0 || s.x > W || s.y > H) {
          state.shootingStars.splice(i, 1);
        }
      }

      // ── 3. Diya Embers (additive blend, no shadowBlur) ──
      if (diyaLitRef.current) {
        const embers = state.embers;
        if (Math.random() < 0.25 && embers.length < MAX_EMBERS) {
          embers.push({
            x: state.diyaPos.x + (Math.random() - 0.5) * 24,
            y: state.diyaPos.y - 18,
            vx: (Math.random() - 0.5) * 1.0,
            vy: -(Math.random() * 1.6 + 0.7),
            size: Math.random() * 1.8 + 0.8,
            life: 1.0,
            decay: Math.random() * 0.016 + 0.009,
            isGold: Math.random() > 0.4,
          });
        }

        ctx.globalCompositeOperation = 'lighter';
        for (let i = embers.length - 1; i >= 0; i--) {
          const em = embers[i];
          em.x += em.vx + fastSin(t * 0.05 + em.y * 0.02) * 0.35;
          em.y += em.vy;
          em.life -= em.decay;
          if (em.life <= 0) { swapRemove(embers, i); continue; }

          const sz = em.size * em.life;
          ctx.globalAlpha = em.life * 0.7;
          ctx.fillStyle = em.isGold ? '#FFA500' : '#FF6600';
          ctx.beginPath();
          ctx.arc(em.x, em.y, sz, 0, PI2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }

      // ── 4. Rockets (max 12, minimal trail) ──
      const rockets = state.rockets;
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.x += r.vx;
        r.y += r.vy;
        r.vy += 0.14;

        // Store last 6 positions directly in flat arrays
        r.tx[r.ti % 6] = r.x;
        r.ty[r.ti % 6] = r.y;
        r.ti++;
        const trailLen = Math.min(r.ti, 6);

        // Draw trail as single path
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        if (trailLen > 1) {
          ctx.beginPath();
          const oldest = (r.ti - trailLen + 6) % 6;
          ctx.moveTo(r.tx[oldest], r.ty[oldest]);
          for (let j = 1; j < trailLen; j++) {
            const idx = (oldest + j) % 6;
            ctx.lineTo(r.tx[idx], r.ty[idx]);
          }
          ctx.strokeStyle = 'rgba(255,200,100,0.5)';
          ctx.stroke();
        }

        // Rocket head — simple circle, no shadowBlur
        ctx.fillStyle = '#FFF5E0';
        ctx.beginPath();
        ctx.arc(r.x, r.y, 2.2, 0, PI2);
        ctx.fill();

        // Glow halo via additive blend
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#FF9900';
        ctx.beginPath();
        ctx.arc(r.x, r.y, 6, 0, PI2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        if (r.y <= r.targetY || r.vy >= 0) {
          explodeFirework(r.x, r.y, r.paletteIdx, r.type);
          swapRemove(rockets, i);
        }
      }

      // ── 5. Firework Particles (optimized: additive blend, no shadowBlur) ──
      const particles = state.particles;
      const pLen = particles.length;
      if (pLen > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';

        for (let i = pLen - 1; i >= 0; i--) {
          const p = particles[i];
          p.vx *= p.friction;
          p.vy *= p.friction;
          p.vy += p.gravity;

          // Store previous pos for streamer line
          const prevX = p.x;
          const prevY = p.y;
          p.x += p.vx;
          p.y += p.vy;
          p.alpha -= p.decay;

          if (p.alpha <= 0) {
            swapRemove(particles, i);
            continue;
          }

          // Shimmer via fast sin lookup
          const shimmer = fastSin(t * p.shimmerSpeed + p.shimmerPhase);
          let drawAlpha = p.alpha;
          if (p.isStrobe) {
            drawAlpha *= shimmer > 0.2 ? 1.0 : (shimmer < -0.25 ? 0.25 : 0.6);
          } else {
            drawAlpha *= shimmer * 0.22 + 0.78;
          }
          if (drawAlpha < 0.02) continue;

          const sz = Math.max(0.5, p.size * (0.35 + 0.65 * p.alpha));

          // Streamer trail line (fast single segment, no array)
          if (p.hasTrail) {
            const speed = Math.abs(p.vx) + Math.abs(p.vy);
            if (speed > 0.4) {
              ctx.globalAlpha = drawAlpha * 0.35;
              ctx.strokeStyle = p.colorStr;
              ctx.lineWidth = Math.max(0.6, sz * 0.65);
              ctx.beginPath();
              ctx.moveTo(prevX, prevY);
              ctx.lineTo(p.x, p.y);
              ctx.stroke();
            }
          }

          // Particle dot (core)
          ctx.globalAlpha = drawAlpha;
          ctx.fillStyle = p.colorStr;
          ctx.beginPath();
          ctx.arc(p.x, p.y, sz, 0, PI2);
          ctx.fill();

          // Glow halo (larger translucent circle instead of shadowBlur)
          if (sz > 0.9) {
            ctx.globalAlpha = drawAlpha * 0.18;
            ctx.beginPath();
            ctx.arc(p.x, p.y, sz * 2.8, 0, PI2);
            ctx.fill();
          }

          // White-hot glint when shimmer peaks (only bright particles)
          if (shimmer > 0.65 && p.alpha > 0.25) {
            ctx.globalAlpha = drawAlpha * 0.6;
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(p.x, p.y, sz * 0.5, 0, PI2);
            ctx.fill();
          }
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }

      // ── Flash overlay drawn directly on canvas (avoids React re-render) ──
      const flash = flashRef.current;
      if (flash && flash.alpha > 0) {
        flash.alpha -= 0.025;
        if (flash.alpha > 0) {
          ctx.globalAlpha = flash.alpha * 0.25;
          ctx.fillStyle = flash.color;
          const grd = ctx.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, W * 0.5);
          grd.addColorStop(0, flash.color);
          grd.addColorStop(1, 'transparent');
          ctx.fillStyle = grd;
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
        } else {
          flashRef.current = null;
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []); // ← Runs exactly once. Uses refs to read dynamic state.

  // ── Explode firework (optimized particle creation) ──
  const explodeFirework = useCallback((x, y, paletteIdx, type) => {
    const state = skyStateRef.current;
    soundManager.playFirework(0.85);

    // Canvas-drawn flash (no React state)
    flashRef.current = { x, y, color: PALETTES[paletteIdx][0], alpha: 1.0 };

    const isMobile = state.width < 768;
    const isWillow = type === 'willow';
    const isRing = type === 'ring';

    // Budget-aware particle count — scale down when we already have many alive
    const existing = state.particles.length;
    const budget = MAX_PARTICLES - existing;
    if (budget <= 20) return; // too many on screen, skip this burst

    const baseCount = isMobile ? (isWillow ? 90 : 110) : (isWillow ? 140 : 170);
    const count = Math.min(baseCount, budget - 15); // leave room for core particles

    const rgbPal = PALETTE_RGB[paletteIdx];

    for (let i = 0; i < count; i++) {
      let vx, vy;

      if (isRing) {
        const angle = (i / count) * PI2;
        const ringSpeed = (isMobile ? 6 : 9) + (Math.random() - 0.5) * 1.0;
        vx = Math.cos(angle) * ringSpeed;
        vy = Math.sin(angle) * ringSpeed;
      } else {
        const angle = Math.random() * PI2;
        const layer = Math.random();
        let speed;
        if (isWillow) {
          speed = layer > 0.35
            ? Math.random() * 4.2 + (isMobile ? 5.0 : 7.0)
            : Math.random() * 3.2 + 1.8;
        } else {
          if (layer > 0.55) {
            speed = Math.random() * 3.8 + (isMobile ? 6.5 : 10.0);
          } else if (layer > 0.2) {
            speed = Math.random() * 3.2 + (isMobile ? 3.8 : 5.5);
          } else {
            speed = Math.random() * 2.2 + 1.3;
          }
        }
        const spread = Math.pow(Math.random(), 0.38);
        vx = Math.cos(angle) * speed * spread;
        vy = Math.sin(angle) * speed * spread;
      }

      const rgb = rgbPal[Math.floor(Math.random() * rgbPal.length)];
      const colorStr = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

      const decay = isWillow
        ? Math.random() * 0.004 + 0.0048
        : Math.random() * 0.0045 + 0.006;

      state.particles.push({
        x, y, vx, vy,
        size: Math.random() * 2.0 + 1.2,
        colorStr,
        alpha: 1,
        decay,
        gravity: isWillow ? 0.042 : 0.036,
        friction: isWillow ? 0.984 : 0.978,
        hasTrail: isWillow || Math.random() > 0.5,
        shimmerSpeed: Math.random() * 0.32 + 0.18,
        shimmerPhase: Math.random() * PI2,
        isStrobe: Math.random() < 0.5,
      });
    }

    // White core burst
    const coreCount = Math.min(isMobile ? 14 : 24, MAX_PARTICLES - state.particles.length);
    for (let j = 0; j < coreCount; j++) {
      const angle = Math.random() * PI2;
      const speed = Math.random() * 2.8 + 0.6;
      state.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1.3,
        colorStr: 'rgb(255,255,255)',
        alpha: 1,
        decay: Math.random() * 0.013 + 0.016,
        gravity: 0.018,
        friction: 0.94,
        hasTrail: false,
        shimmerSpeed: 0.45,
        shimmerPhase: Math.random() * PI2,
        isStrobe: true,
      });
    }
  }, []);

  const PI2 = Math.PI * 2;

  // Launch rocket
  const launchRocketTo = useCallback((targetX, targetY) => {
    soundManager.unlock();
    const state = skyStateRef.current;
    if (state.rockets.length >= MAX_ROCKETS) return;

    const startX = targetX + (Math.random() - 0.5) * 70;
    const startY = state.height + 20;
    const dx = targetX - startX;
    const dy = targetY - startY;
    const dist = Math.hypot(dx, dy);
    const speed = Math.min(20, Math.max(13, dist / 30));
    const angle = Math.atan2(dy, dx);

    const paletteIdx = Math.floor(Math.random() * PALETTES.length);
    const types = ['peony', 'willow', 'ring', 'chrysanthemum'];

    state.rockets.push({
      x: startX,
      y: startY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      targetY: Math.max(40, targetY),
      paletteIdx,
      type: types[Math.floor(Math.random() * types.length)],
      tx: new Float32Array(6),
      ty: new Float32Array(6),
      ti: 0,
    });
  }, []);

  // Sky tap handler
  const handleSkyPointerDown = useCallback((e) => {
    if (e.target.closest('.watermark-wrap')) return;
    setShowCredit(false);
    if (!diyaLitRef.current) return;
    if (e.target.closest('.sound-btn') || e.target.closest('.diya-container')) return;

    const x = e.clientX;
    const y = e.clientY;
    const targetY = Math.min(y, skyStateRef.current.height * 0.72);

    launchRocketTo(x, targetY);

    if (Math.random() < 0.35) {
      setTimeout(() => {
        launchRocketTo(
          x + (Math.random() - 0.5) * 110,
          targetY + (Math.random() - 0.5) * 50
        );
      }, 150);
    }
  }, [launchRocketTo]);

  // Diya click
  const handleDiyaClick = useCallback((e) => {
    e.stopPropagation();
    soundManager.unlock();
    if (!diyaLitRef.current) {
      setIsDiyaLit(true);
      setShowSkyHint(true);
      setTimeout(() => setShowSkyHint(false), 5500);
      setTimeout(() => {
        const state = skyStateRef.current;
        launchRocketTo(state.width * 0.5, state.height * 0.28);
      }, 600);
    }
  }, [launchRocketTo]);

  const handleToggleSound = useCallback((e) => {
    e.stopPropagation();
    const active = soundManager.toggleMute();
    setIsMuted(!active);
  }, []);

  // Watermark credit tooltip
  const handleWatermarkClick = useCallback((e) => {
    e.stopPropagation();
    if (creditTimerRef.current) {
      clearTimeout(creditTimerRef.current);
      creditTimerRef.current = null;
    }
    setShowCredit((prev) => {
      const next = !prev;
      if (next) {
        creditTimerRef.current = setTimeout(() => {
          setShowCredit(false);
          creditTimerRef.current = null;
        }, 2400);
      }
      return next;
    });
  }, []);

  useEffect(() => () => clearTimeout(creditTimerRef.current), []);

  return (
    <div className="diwali-app" onPointerDown={handleSkyPointerDown}>
      <div className="sky-gradient" />
      <canvas ref={canvasRef} className="firework-canvas" />

      <button
        className="sound-btn"
        onClick={handleToggleSound}
        aria-label={isMuted ? 'Unmute Sound' : 'Mute Sound'}
        title={isMuted ? 'Sound Off' : 'Sound On'}
      >
        {isMuted ? <VolumeX size={19} /> : <Volume2 size={19} />}
      </button>

      <div className={`greeting-container ${isDiyaLit ? 'revealed' : ''}`}>
        <div className="sanskrit-sloka">
          <Sparkles size={14} className="sparkle-icon" />
          <span>तमसो मा ज्योतिर्गमय</span>
          <Sparkles size={14} className="sparkle-icon" />
        </div>
        <h1 className="diwali-title">Happy Diwali</h1>
        <p className="diwali-subtitle">
          May the divine radiance illuminate your life with infinite joy, good health & prosperity
        </p>
      </div>

      <div className={`sky-hint ${showSkyHint ? 'visible' : ''}`}>
        ✨ Tap anywhere across the night sky for fireworks ✨
      </div>

      {/* Brand watermark */}
      <div className="watermark-wrap">
        {showCredit && (
          <div className="credit-tip" role="status">
            Made with love by Xe✨
          </div>
        )}
        <button
          type="button"
          className="watermark"
          aria-label="Credits"
          title="Credits"
          onClick={handleWatermarkClick}
        >
          <img
            src="/watermark.svg"
            alt=""
            aria-hidden="true"
            draggable="false"
          />
        </button>
      </div>

      <div className={`ambient-glow ${isDiyaLit ? 'lit' : ''}`} />

      <div
        className="diya-container"
        onClick={handleDiyaClick}
        role="button"
        tabIndex={0}
        aria-label="Diya Oil Lamp"
      >
        <div className={`flame-system ${isDiyaLit ? 'ignited' : ''}`}>
          <div className="flame-outer" />
          <div className="flame-middle" />
          <div className="flame-core" />
          <div className="flame-base-blue" />
        </div>

        <svg
          className="diya-svg"
          viewBox="0 0 160 85"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="brassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#E5A65E" />
              <stop offset="35%" stopColor="#B36B22" />
              <stop offset="70%" stopColor="#7A3E0D" />
              <stop offset="100%" stopColor="#4A2204" />
            </linearGradient>
            <linearGradient id="rimGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FFD285" />
              <stop offset="50%" stopColor="#FFEAA7" />
              <stop offset="100%" stopColor="#D48B38" />
            </linearGradient>
            <radialGradient id="oilGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4A2800" />
              <stop offset="80%" stopColor="#2A1400" />
              <stop offset="100%" stopColor="#150800" />
            </radialGradient>
            <filter id="diyaShadow" x="-20%" y="-20%" width="140%" height="150%">
              <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#000000" floodOpacity="0.7" />
            </filter>
          </defs>

          <ellipse cx="80" cy="74" rx="48" ry="8" fill="rgba(0,0,0,0.55)" />
          <path
            d="M 18 28 C 22 55, 52 72, 80 72 C 108 72, 138 55, 142 28 C 125 36, 95 38, 80 38 C 65 38, 35 36, 18 28 Z"
            fill="url(#brassGrad)"
            filter="url(#diyaShadow)"
          />
          <path
            d="M 40 45 Q 80 62 120 45"
            stroke="#FFD285"
            strokeWidth="1.2"
            strokeDasharray="2 3"
            opacity="0.85"
            fill="none"
          />
          <circle cx="80" cy="58" r="2.5" fill="#FFEAA7" />
          <circle cx="64" cy="54" r="1.8" fill="#FFD285" />
          <circle cx="96" cy="54" r="1.8" fill="#FFD285" />
          <circle cx="50" cy="48" r="1.5" fill="#D48B38" />
          <circle cx="110" cy="48" r="1.5" fill="#D48B38" />
          <ellipse cx="80" cy="28" rx="62" ry="11" fill="url(#brassGrad)" />
          <ellipse cx="80" cy="28" rx="60" ry="9.5" fill="url(#rimGrad)" />
          <ellipse cx="80" cy="28" rx="52" ry="7" fill="url(#oilGrad)" />
          <path d="M 80 28 C 80 20, 81 12, 80 5" stroke="#4A3B2C" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M 79.5 7 L 80.5 4" stroke="#E0B070" strokeWidth="1.8" strokeLinecap="round" />
        </svg>

        {!isDiyaLit && (
          <div className="tap-invite">
            <span>Tap Diya to Light</span>
          </div>
        )}
      </div>
    </div>
  );
}
