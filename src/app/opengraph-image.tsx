import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Clipfire — Turn long-form video into viral clips, automatically';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'radial-gradient(circle at 30% 20%, #1e293b 0%, #0f172a 50%, #020617 100%)',
        color: '#f8fafc',
        padding: '80px',
        fontFamily: 'system-ui',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '20px',
            background: 'linear-gradient(135deg, #f97316 0%, #dc2626 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '40px',
            fontWeight: 800,
          }}
        >
          C
        </div>
        <div style={{ fontSize: '56px', fontWeight: 800, letterSpacing: '-2px' }}>Clipfire</div>
      </div>
      <div
        style={{
          fontSize: '64px',
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-2px',
          marginTop: '40px',
          maxWidth: '900px',
        }}
      >
        Turn long-form video into viral clips, automatically.
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 'auto',
          paddingTop: '40px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '24px',
          color: '#94a3b8',
        }}
      >
        <span>AI scoring tuned for Reels, Shorts, and TikTok</span>
        <span style={{ color: '#f97316', fontWeight: 600 }}>polemicyst.com</span>
      </div>
    </div>,
    size
  );
}
