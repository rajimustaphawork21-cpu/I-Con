// Next Imports
import type { Metadata } from 'next'

// View Imports
import UserDirectory from '@/views/users/UserDirectory'

export const metadata: Metadata = {
  title: 'Utilisateurs | I-Con'
}

const UsersPage = () => <UserDirectory />

export default UsersPage
