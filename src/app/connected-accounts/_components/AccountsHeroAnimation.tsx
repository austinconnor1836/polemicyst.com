import React from 'react';

type AccountsHeroAnimationProps = {
  className?: string;
};

export function AccountsHeroAnimation({ className }: AccountsHeroAnimationProps) {
  return (
    <div className={className} aria-hidden="true">
      <svg
        viewBox="0 0 1200 240"
        className="h-full w-full"
        aria-hidden="true"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient
            id="fh-lane"
            x1="0"
            y1="0"
            x2="1200"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.0" />
            <stop offset="20%" stopColor="#22c55e" stopOpacity="0.7" />
            <stop offset="50%" stopColor="#06b6d4" stopOpacity="0.8" />
            <stop offset="80%" stopColor="#a855f7" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0.0" />
          </linearGradient>

          <radialGradient id="fh-bg" cx="50%" cy="45%" r="75%">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.18" />
            <stop offset="45%" stopColor="#a855f7" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.0" />
          </radialGradient>

          <linearGradient id="fh-scan" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0.10" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>

          <filter id="fh-glow" x="-40%" y="-60%" width="180%" height="220%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="
                1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.85 0"
              result="colored"
            />
            <feMerge>
              <feMergeNode in="colored" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <pattern id="fh-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke="rgba(255,255,255,0.09)"
              strokeWidth="1"
            />
          </pattern>
        </defs>

        {/* background */}
        <rect x="0" y="0" width="1200" height="240" fill="url(#fh-bg)" />
        <rect x="0" y="0" width="1200" height="240" fill="url(#fh-grid)" opacity="0.65" />

        {/* floating “cards” that hint at a feed list */}
        <g className="fh-float fh-delay-1" opacity="0.9">
          <rect x="110" y="54" width="260" height="44" rx="12" fill="rgba(255,255,255,0.06)" />
          <rect x="132" y="68" width="150" height="8" rx="4" fill="rgba(255,255,255,0.22)" />
          <rect x="132" y="82" width="100" height="6" rx="3" fill="rgba(255,255,255,0.14)" />
        </g>
        <g className="fh-float fh-delay-2" opacity="0.9">
          <rect x="820" y="46" width="270" height="46" rx="12" fill="rgba(255,255,255,0.06)" />
          <rect x="842" y="62" width="170" height="8" rx="4" fill="rgba(255,255,255,0.22)" />
          <rect x="842" y="77" width="120" height="6" rx="3" fill="rgba(255,255,255,0.14)" />
        </g>
        <g className="fh-float fh-delay-3" opacity="0.9">
          <rect x="560" y="150" width="300" height="50" rx="12" fill="rgba(255,255,255,0.06)" />
          <rect x="582" y="168" width="190" height="8" rx="4" fill="rgba(255,255,255,0.22)" />
          <rect x="582" y="183" width="130" height="6" rx="3" fill="rgba(255,255,255,0.14)" />
        </g>

        {/* three “feed lanes” */}
        <g filter="url(#fh-glow)">
          <path
            d="M -20 130 C 190 70, 360 190, 560 130 S 960 70, 1220 130"
            fill="none"
            stroke="url(#fh-lane)"
            strokeWidth="4"
            opacity="0.35"
          />
          <path
            className="fh-dash fh-speed-1"
            d="M -20 130 C 190 70, 360 190, 560 130 S 960 70, 1220 130"
            fill="none"
            stroke="url(#fh-lane)"
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0.9"
          />

          <path
            d="M -20 86 C 220 140, 430 40, 640 86 S 980 140, 1220 86"
            fill="none"
            stroke="url(#fh-lane)"
            strokeWidth="3"
            opacity="0.25"
          />
          <path
            className="fh-dash fh-speed-2"
            d="M -20 86 C 220 140, 430 40, 640 86 S 980 140, 1220 86"
            fill="none"
            stroke="url(#fh-lane)"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.75"
          />

          <path
            d="M -20 174 C 210 220, 430 120, 650 174 S 990 220, 1220 174"
            fill="none"
            stroke="url(#fh-lane)"
            strokeWidth="3"
            opacity="0.22"
          />
          <path
            className="fh-dash fh-speed-3"
            d="M -20 174 C 210 220, 430 120, 650 174 S 990 220, 1220 174"
            fill="none"
            stroke="url(#fh-lane)"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.7"
          />
        </g>

        {/* scan highlight */}
        <g className="fh-scan" style={{ mixBlendMode: 'overlay' }}>
          <rect x="-280" y="0" width="280" height="240" fill="url(#fh-scan)" />
        </g>
      </svg>

      <style>{`
        .fh-dash {
          stroke-dasharray: 2 18;
          animation: fh-dash 7.5s linear infinite;
        }
        .fh-speed-1 { animation-duration: 6.2s; }
        .fh-speed-2 { animation-duration: 7.6s; }
        .fh-speed-3 { animation-duration: 9.2s; }

        @keyframes fh-dash {
          to { stroke-dashoffset: -260; }
        }

        .fh-float {
          transform-origin: center;
          animation: fh-float 5.4s ease-in-out infinite;
        }
        .fh-delay-1 { animation-delay: 0.0s; }
        .fh-delay-2 { animation-delay: 0.9s; }
        .fh-delay-3 { animation-delay: 1.6s; }

        @keyframes fh-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-7px); }
        }

        .fh-scan {
          animation: fh-scan 8.5s ease-in-out infinite;
        }
        @keyframes fh-scan {
          0% { transform: translateX(-260px); opacity: 0.0; }
          10% { opacity: 0.9; }
          50% { opacity: 0.7; }
          90% { opacity: 0.9; }
          100% { transform: translateX(1480px); opacity: 0.0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .fh-dash, .fh-float, .fh-scan { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
