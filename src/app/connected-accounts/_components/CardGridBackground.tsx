import React from 'react';

type CardGridBackgroundProps = {
  className?: string;
};

export function CardGridBackground({ className }: CardGridBackgroundProps) {
  return (
    <div className={className} aria-hidden="true">
      <svg
        viewBox="0 0 600 600"
        className="h-full w-full"
        aria-hidden="true"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {/* Grid pattern */}
          <pattern id="cg-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(99,179,237,0.08)"
              strokeWidth="0.5"
            />
          </pattern>

          {/* Finer sub-grid */}
          <pattern id="cg-subgrid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path
              d="M 10 0 L 0 0 0 10"
              fill="none"
              stroke="rgba(99,179,237,0.03)"
              strokeWidth="0.5"
            />
          </pattern>

          {/* Pulse glow gradient */}
          <radialGradient id="cg-pulse-1" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
            <stop offset="40%" stopColor="#38bdf8" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="cg-pulse-2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#818cf8" stopOpacity="0.2" />
            <stop offset="40%" stopColor="#818cf8" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="cg-pulse-3" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.18" />
            <stop offset="40%" stopColor="#34d399" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </radialGradient>

          {/* Ambient background glow */}
          <radialGradient id="cg-ambient" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="#1e3a5f" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Background */}
        <rect width="600" height="600" fill="url(#cg-ambient)" />

        {/* Sub-grid layer */}
        <rect width="600" height="600" fill="url(#cg-subgrid)" />

        {/* Main grid layer */}
        <rect width="600" height="600" fill="url(#cg-grid)" />

        {/* Node dots at key intersections */}
        <g className="cg-nodes" opacity="0.5">
          <circle cx="120" cy="120" r="1.5" fill="#38bdf8" className="cg-node cg-node-1" />
          <circle cx="280" cy="80" r="1.5" fill="#818cf8" className="cg-node cg-node-2" />
          <circle cx="440" cy="160" r="1.5" fill="#34d399" className="cg-node cg-node-3" />
          <circle cx="200" cy="280" r="1.5" fill="#38bdf8" className="cg-node cg-node-4" />
          <circle cx="360" cy="320" r="1.5" fill="#818cf8" className="cg-node cg-node-1" />
          <circle cx="480" cy="400" r="1.5" fill="#34d399" className="cg-node cg-node-2" />
          <circle cx="80" cy="400" r="1.5" fill="#38bdf8" className="cg-node cg-node-3" />
          <circle cx="320" cy="480" r="1.5" fill="#818cf8" className="cg-node cg-node-4" />
          <circle cx="520" cy="520" r="1.5" fill="#34d399" className="cg-node cg-node-1" />
          <circle cx="160" cy="520" r="1.5" fill="#38bdf8" className="cg-node cg-node-2" />
        </g>

        {/* Pulse rings — origin 1 (top-left area) */}
        <g>
          <circle
            cx="120"
            cy="120"
            r="0"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="1"
            className="cg-ring cg-ring-1"
          />
          <circle cx="120" cy="120" r="0" fill="url(#cg-pulse-1)" className="cg-ripple cg-ring-1" />
        </g>

        {/* Pulse rings — origin 2 (center-right area) */}
        <g>
          <circle
            cx="440"
            cy="280"
            r="0"
            fill="none"
            stroke="#818cf8"
            strokeWidth="0.8"
            className="cg-ring cg-ring-2"
          />
          <circle cx="440" cy="280" r="0" fill="url(#cg-pulse-2)" className="cg-ripple cg-ring-2" />
        </g>

        {/* Pulse rings — origin 3 (bottom area) */}
        <g>
          <circle
            cx="280"
            cy="460"
            r="0"
            fill="none"
            stroke="#34d399"
            strokeWidth="0.8"
            className="cg-ring cg-ring-3"
          />
          <circle cx="280" cy="460" r="0" fill="url(#cg-pulse-3)" className="cg-ripple cg-ring-3" />
        </g>

        {/* Faint horizontal scan line */}
        <rect
          x="0"
          y="0"
          width="600"
          height="2"
          fill="rgba(56,189,248,0.12)"
          className="cg-scanline"
        />
      </svg>

      <style>{`
        /* Pulse rings expand outward and fade */
        .cg-ring {
          animation: cg-ring-expand 6s ease-out infinite;
          transform-origin: center;
        }
        .cg-ring-1 { animation-delay: 0s; }
        .cg-ring-2 { animation-delay: 2s; }
        .cg-ring-3 { animation-delay: 4s; }

        @keyframes cg-ring-expand {
          0% {
            r: 0;
            opacity: 0.6;
            stroke-width: 1.2;
          }
          70% {
            opacity: 0.15;
          }
          100% {
            r: 180;
            opacity: 0;
            stroke-width: 0.2;
          }
        }

        /* Ripple fill expands with ring */
        .cg-ripple {
          animation: cg-ripple-expand 6s ease-out infinite;
        }
        .cg-ripple.cg-ring-1 { animation-delay: 0s; }
        .cg-ripple.cg-ring-2 { animation-delay: 2s; }
        .cg-ripple.cg-ring-3 { animation-delay: 4s; }

        @keyframes cg-ripple-expand {
          0% {
            r: 0;
            opacity: 0.5;
          }
          100% {
            r: 180;
            opacity: 0;
          }
        }

        /* Node dots pulse gently */
        .cg-node {
          animation: cg-node-glow 3s ease-in-out infinite;
        }
        .cg-node-1 { animation-delay: 0s; }
        .cg-node-2 { animation-delay: 0.7s; }
        .cg-node-3 { animation-delay: 1.4s; }
        .cg-node-4 { animation-delay: 2.1s; }

        @keyframes cg-node-glow {
          0%, 100% {
            r: 1.5;
            opacity: 0.3;
          }
          50% {
            r: 3;
            opacity: 0.8;
          }
        }

        /* Horizontal scan line drifts down */
        .cg-scanline {
          animation: cg-scanline-move 10s linear infinite;
        }

        @keyframes cg-scanline-move {
          0% {
            transform: translateY(-10px);
            opacity: 0;
          }
          5% {
            opacity: 0.5;
          }
          95% {
            opacity: 0.5;
          }
          100% {
            transform: translateY(610px);
            opacity: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .cg-ring,
          .cg-ripple,
          .cg-node,
          .cg-scanline {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
