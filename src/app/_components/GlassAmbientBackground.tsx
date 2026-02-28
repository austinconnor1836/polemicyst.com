'use client';

import { useEffect, useState } from 'react';

export default function GlassAmbientBackground() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const check = () => setVisible(document.documentElement.getAttribute('data-theme') === 'glass');

    check();

    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Blue orb */}
      <div className="absolute -top-[20%] -left-[10%] h-[60vh] w-[60vh] rounded-full bg-blue-600/15 blur-[120px] animate-glass-orb-1 motion-reduce:animate-none" />

      {/* Purple orb */}
      <div className="absolute top-[30%] -right-[15%] h-[55vh] w-[55vh] rounded-full bg-purple-600/12 blur-[100px] animate-glass-orb-2 motion-reduce:animate-none" />

      {/* Emerald orb */}
      <div className="absolute -bottom-[15%] left-[20%] h-[50vh] w-[50vh] rounded-full bg-emerald-500/10 blur-[110px] animate-glass-orb-3 motion-reduce:animate-none" />
    </div>
  );
}
