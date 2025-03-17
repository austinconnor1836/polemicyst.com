'use client'

import React from 'react'
import Navbar from './_components/navbar'
import SidePanel from './_components/sidenav'

const SharedLayout: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <>
      <Navbar />
      <SidePanel />
      <main>{children}</main>
    </>
  )
}

export default SharedLayout
