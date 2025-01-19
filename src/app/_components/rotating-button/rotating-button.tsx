'use client';

import React from 'react';
import './rotating-button.css';

const RotatingButton: React.FC = () => {
    const cx = 50;
    const cy = 50;
    const r = 45;
  return (
    <div className="button-container">
      <svg width="65" height="65" viewBox="0 0 100 100" className="rotating-outline">
        <circle
          cx={`${cx}`}
          cy={`${cy}`}
          r={`${r}`}
          fill="none"
          stroke="red"
          strokeWidth="4"
          strokeDasharray="94 189"
        />
        <circle
          cx={`${cx}`}
          cy={`${cy}`}
          r={`${r}`}
          fill="none"
          stroke="green"
          strokeWidth="4"
          strokeDasharray="94 189"
          strokeDashoffset="94"
        />
        <circle
          cx={`${cx}`}
          cy={`${cy}`}
          r={`${r}`}
          fill="none"
          stroke="blue"
          strokeWidth="4"
          strokeDasharray="94 189"
          strokeDashoffset="188"
        />
      </svg>
      <button className="center-button"></button>
    </div>
  );
};

export default RotatingButton;
