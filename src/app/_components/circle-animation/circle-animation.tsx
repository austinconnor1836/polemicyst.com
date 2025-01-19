'use client';

import React from 'react';
import './circle-animation.css';

const CircleAnimation: React.FC = () => {
  return (
    <div className="circle-container">
      <svg width="200" height="200" viewBox="0 0 100 100">
        {/* First segment */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="red"
          strokeWidth="4"
          className="circle-segment segment-1"
        />
        {/* Second segment */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="green"
          strokeWidth="4"
          className="circle-segment segment-2"
        />
        {/* Third segment */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="blue"
          strokeWidth="4"
          className="circle-segment segment-3"
        />
      </svg>
    </div>
  );
};

export default CircleAnimation;
