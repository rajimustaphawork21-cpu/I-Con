// Type Imports
import type { NavbarUser } from '@components/layout/shared/UserDropdown'

// Component Imports
import LayoutNavbar from '@layouts/components/vertical/Navbar'
import NavbarContent from './NavbarContent'

const Navbar = ({ user }: { user: NavbarUser }) => {
  return (
    <LayoutNavbar>
      <NavbarContent user={user} />
    </LayoutNavbar>
  )
}

export default Navbar
