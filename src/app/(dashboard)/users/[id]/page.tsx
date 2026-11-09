// Next Imports
import type { Metadata } from 'next'

// View Imports
import UserIdentity from '@/views/users/UserIdentity'

export const metadata: Metadata = {
  title: 'Identité utilisateur | I-Con'
}

type UserIdentityPageProps = {
  params: Promise<{ id: string }>
}

const UserIdentityPage = async ({ params }: UserIdentityPageProps) => {
  const { id } = await params

  return <UserIdentity userId={id} />
}

export default UserIdentityPage
