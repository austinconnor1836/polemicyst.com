'use client';

import React, { useState } from 'react';

interface ContextMenuProps {
  visible: boolean;
  onCopy: () => void;
  onCopyUpperCase: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({
  visible,
  onCopy,
  onCopyUpperCase,
}) => {
  const [subMenuVisible, setSubMenuVisible] = useState(false);

  const toggleSubMenu = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the parent click
    setSubMenuVisible(!subMenuVisible);
  };

  return (
    <div
      className={`absolute mt-2 w-80 bg-white border border-gray-300 shadow-md rounded-md ${
        visible ? 'block' : 'hidden'
      }`}
    >
      <ul>
        <li className="relative">
          <div
            onClick={onCopy} // Copy action for the main item
            className="flex justify-between items-center px-4 py-2 cursor-pointer hover:bg-gray-100"
          >
            <span>Copy to Clipboard</span>
            <span
              onClick={toggleSubMenu} // Toggle sub-menu visibility
              className="ml-2 cursor-pointer transform transition-transform duration-200"
              style={{
                transform: subMenuVisible ? 'rotate(180deg)' : 'rotate(0deg)',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="feather feather-chevron-down"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </span>
          </div>
          {subMenuVisible && (
            <ul className="absolute left-3 top-full w-full bg-white border border-gray-300 shadow-md rounded-md">
              <li
                onClick={(e) => {
                  e.stopPropagation(); // Prevent menu close
                  onCopy(); // Call copy function
                }}
                className="px-4 py-2 cursor-pointer hover:bg-gray-100"
              >
                Copy to Clipboard
              </li>
              <li
                onClick={(e) => {
                  e.stopPropagation(); // Prevent menu close
                  onCopyUpperCase(); // Call copy uppercase function
                }}
                className="px-4 py-2 cursor-pointer hover:bg-gray-100"
              >
                + UPPER CASE
              </li>
            </ul>
          )}
        </li>
      </ul>
    </div>
  );
};

export default ContextMenu;
