'use client'

// MUI Imports
import useMediaQuery from '@mui/material/useMediaQuery'
import { styled, useTheme } from '@mui/material/styles'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

// Third-party Imports
import classnames from 'classnames'

// Type Imports
import type { SystemMode } from '@core/types'

// Hook Imports
import { useImageVariant } from '@core/hooks/useImageVariant'

// Server Action Imports
import { signOutWithKeycloak } from '@/libs/auth/actions'

// Styled Components
const MaskImg = styled('img')({
  blockSize: 'auto',
  maxBlockSize: 355,
  inlineSize: '100%',
  position: 'absolute',
  insetBlockEnd: 0,
  zIndex: -1
})

const Forbidden = ({ mode }: { mode: SystemMode }) => {
  // Vars
  const darkImg = '/images/pages/misc-mask-dark.png'
  const lightImg = '/images/pages/misc-mask-light.png'

  // Hooks
  const theme = useTheme()
  const hidden = useMediaQuery(theme.breakpoints.down('md'))
  const miscBackground = useImageVariant(mode, lightImg, darkImg)

  return (
    <main className='flex items-center justify-center min-bs-[100dvh] relative p-6 overflow-x-hidden'>
      <div className='flex items-center flex-col text-center gap-6 max-is-[480px]'>
        <i className='tabler-lock-access text-[64px] text-textSecondary' aria-hidden='true' />
        <div className='flex flex-col gap-2'>
          <Typography className='font-medium text-8xl' color='text.primary'>
            403
          </Typography>
          <Typography variant='h4' component='h1'>
            Accès refusé
          </Typography>
          <Typography color='text.secondary'>
            Votre compte ne dispose pas du profil requis pour accéder à cette page.
          </Typography>
          <Typography variant='body2' color='text.secondary'>
            Si votre profil a été modifié récemment, déconnectez-vous puis reconnectez-vous.
          </Typography>
        </div>
        <form action={signOutWithKeycloak}>
          <Button type='submit' variant='contained' startIcon={<i className='tabler-logout' aria-hidden='true' />}>
            Se déconnecter
          </Button>
        </form>
      </div>
      {!hidden && (
        <MaskImg
          alt=''
          aria-hidden='true'
          src={miscBackground}
          className={classnames({ 'scale-x-[-1]': theme.direction === 'rtl' })}
        />
      )}
    </main>
  )
}

export default Forbidden

