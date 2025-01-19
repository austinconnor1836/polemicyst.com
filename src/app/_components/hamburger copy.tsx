'use client';

import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import IconButton from '@mui/material/IconButton';
import { RootState } from '../../lib/store';
import { toggleMenu } from '../../lib/slices/uiSlice';
import { useAppDispatch, useAppSelector } from '@/lib/hooks';

const HamburgerMenu: React.FC = () => {
  const dispatch = useAppDispatch();
  const isMenuOpen = useAppSelector((state: RootState) => state.ui.isMenuOpen);
  const theme = useAppSelector((state: RootState) => state.ui.theme);
  // const iconColor = theme === 'dark' ? '#FFFFFF' : '#FFFFFF'; // Light color for dark theme, dark color for light theme
  const styles = {
    iconButton: {
    },
    innerIcon: {
      transform: 'rotate(0deg)',
      transition: 'transform 0.3s ease-in-out',
    },
  }

  return (
    <></>
    // <IconButton onClick={() => dispatch(toggleMenu())} className="absolute top-16 z-10 ml-2">
    // <IconButton onClick={() => dispatch(toggleMenu())} className={`absolute top-16 z-10 ${theme === 'dark' ? 'light' : 'dark'}`}>
    //   {isMenuOpen ? (
    //     // <CloseIcon style={{ transition: 'transform 0.3s ease-in-out', transform: 'rotate(0deg)' }} />
    //     <CloseIcon fontSize='large' style={styles.innerIcon} />
    //   ) : (
    //     // <MenuIcon style={{ transition: 'transform 0.3s ease-in-out', transform: 'rotate(0deg)' }} />
    //     <MenuIcon fontSize='large'style={styles.innerIcon} />
    //   )}
    // </IconButton>
  );
};

export default HamburgerMenu;
