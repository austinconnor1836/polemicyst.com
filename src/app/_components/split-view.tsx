import React from 'react'
import { useSelector } from 'react-redux';
import { RootState } from '../../lib/store';

type Props = {}

const SplitView: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const theme = useSelector((state: RootState) => state.ui.theme);
    const { isMenuOpen } = useSelector((state: RootState) => state.ui);
    
    return (
      <div className={`relative h-screen overflow-hidden ${theme === 'dark' ? 'dark' : ''}`}>
        {isMenuOpen ? (
        <div className="flex h-full">
            {/* <SidePanel /> */}
            <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
    ) : (
        <>
            rest of screen
            {/* {children}
            {openChats.map((chatId) => (
              <ChatBot key={chatId} id={chatId} onClose={handleCloseChat} />
            ))} */}
        </>
    )}
      </div>
    );
}

export default SplitView;