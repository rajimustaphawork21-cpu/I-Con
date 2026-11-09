// Next Imports
import type { Metadata } from 'next'

// MUI Imports
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'

// Auth Imports
import { requirePortalAccess } from '@/libs/auth/guards'
import { getFirstName, getProfileLabel } from '@/libs/auth/claims'

export const metadata: Metadata = {
  title: 'Accueil | I-Con'
}

const WelcomePage = async () => {
  // Server-side authorization: session + an authorized icon-bff Client Role (default deny).
  const session = await requirePortalAccess()

  const firstName = getFirstName(session.user)
  const profileLabel = getProfileLabel(session.clientRoles)

  return (
    <Card>
      <CardContent className='flex flex-col gap-2 sm:p-8'>
        <Typography variant='h4' component='h1'>
          {firstName ? `Bienvenue, ${firstName}` : 'Bienvenue'}
        </Typography>
        <Typography color='text.secondary'>Vous êtes connecté à I-Con.</Typography>
        {profileLabel ? (
          <Typography color='text.primary' className='mbs-2'>
            <span className='font-medium'>Profil :</span> {profileLabel}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default WelcomePage

