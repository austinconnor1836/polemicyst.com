'use client';

import React, { useState, useRef, useEffect } from 'react';
import '../../ui/global.css';

const Home: React.FC = () => {
  const textRef = useRef<HTMLParagraphElement | null>(null);

  const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore';
  // const text = 'magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum';

  return (
    <div>
      {/* <div className="p-4 cursor-pointer sm:p-6 md:p-8 lg:p-10 xl:p-12"> */}
      <div style={{ width: '1000px'}}>
        <p ref={textRef} className="text-base sm:text-lg md:text-xl lg:text-2xl xl:text-3xl">
          {/* {getHighlightedText(text, highlightRange)} */}
          {text}
        </p>
      </div>
      <FontSizeComponent />
    </div>
  );
};

export default Home;

const FontSizeComponent: React.FC = () => {
  const elementRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState<string>('');

  useEffect(() => {
    if (elementRef.current) {
      const computedStyle = window.getComputedStyle(elementRef.current);
      setFontSize(computedStyle.fontSize);
    }
  }, []);

  return (
    <div>
      <div ref={elementRef} style={{ fontSize: '16px' }}>
        This is a sample text.
      </div>
      <p>The font size of the above text is: {fontSize}</p>
    </div>
  );
};