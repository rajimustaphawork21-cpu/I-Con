'use client'

// Third-party Imports
import classnames from 'classnames'

// Type Imports
import type { NavbarUser } from '@components/layout/shared/UserDropdown'

// Component Imports
import NavToggle from './NavToggle'
import ModeDropdown from '@components/layout/shared/ModeDropdown'
import UserDropdown from '@components/layout/shared/UserDropdown'

// Util Imports
import { verticalLayoutClasses } from '@layouts/utils/layoutClasses'

const NavbarContent = ({ user }: { user: NavbarUser }) => {
  return (
    <div className={classnames(verticalLayoutClasses.navbarContent, 'flex items-center justify-between gap-4 is-full')}>
      <div className='flex items-center gap-4'>
        <NavToggle />
        <ModeDropdown />
      </div>
      <div className='flex items-center'>
        <UserDropdown user={user} />
      </div>
    </div>
  )
}

export default NavbarContent
