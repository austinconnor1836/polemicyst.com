'use client';

import React from 'react';
import './rotating-button.css';
import { useTheme } from '@/app/context/ThemeContext';

const RotatingButton: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const cx = 50;
  const cy = 50;
  const r = 45;

  return (
    <div className="button-container" onClick={toggleTheme}>
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
      <button className="center-button">
        {theme === 'light' ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            className="w-6 h-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3v1.5M12 19.5V21M4.219 4.219l1.061 1.061M17.719 17.719l1.061 1.061M3 12h1.5M19.5 12H21M4.219 19.781l1.061-1.061M17.719 6.281l1.061-1.061M12 7.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z"
            />
          </svg>
        ) : (
          // <svg
          //   xmlns="http://www.w3.org/2000/svg"
          //   fill="none"
          //   viewBox="0 0 24 24"
          //   strokeWidth="1.5"
          //   stroke="currentColor"
          //   className="w-6 h-6"
          // >
          //   <path
          //     strokeLinecap="round"
          //     strokeLinejoin="round"
          //     d="M21.752 15.002A9.718 9.718 0 0112 21.75 9.75 9.75 0 1112 2.25c.338 0 .67.02 1 .05"
          //   />
          // </svg>
          <svg
            height="24px"
            width="24px"
            version="1.1"
            id="Capa_1"
            xmlns="http://www.w3.org/2000/svg"
            xmlnsXlink="http://www.w3.org/1999/xlink"
            viewBox="0 0 47.539 47.539"
            xmlSpace="preserve"
            className="w-6 h-6"
          >
            <g>
              <g>
                <path style={{ fill: '#010002' }} d="M24.997,47.511C11.214,47.511,0,36.298,0,22.515C0,12.969,5.314,4.392,13.869,0.132
                  c0.385-0.191,0.848-0.117,1.151,0.186s0.381,0.766,0.192,1.15C13.651,4.64,12.86,8.05,12.86,11.601
                  c0,12.681,10.316,22.997,22.997,22.997c3.59,0,7.033-0.809,10.236-2.403c0.386-0.191,0.848-0.117,1.151,0.186
                  c0.304,0.303,0.381,0.766,0.192,1.15C43.196,42.153,34.597,47.511,24.997,47.511z M12.248,3.372C5.862,7.608,2,14.709,2,22.515
                  c0,12.68,10.316,22.996,22.997,22.996c7.854,0,14.981-3.898,19.207-10.343c-2.668,0.95-5.464,1.43-8.346,1.43
                  c-13.783,0-24.997-11.214-24.997-24.997C10.861,8.761,11.327,6.005,12.248,3.372z"/>
              </g>
            </g>
          </svg>
        )}
      </button>
    </div>
  );
};

export default RotatingButton;