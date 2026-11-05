'use client'

// MUI Imports
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { styled } from '@mui/material/styles'

// Type Imports
import type { SystemMode } from '@core/types'

// Component Imports
import VuexyLogo from '@core/svg/Logo'

// Hook Imports
import { useImageVariant } from '@core/hooks/useImageVariant'

// Server Action Imports
import {
  signInWithKeycloak,
  signOutWithKeycloak,
} from '@/libs/auth/actions'

type Props = {
  mode: SystemMode

  // Set only for an authenticated session WITHOUT the required realm role (authorized users are redirected).
  user: { name: string | null; email: string | null } | null
  authError?: string
  logoutIncomplete?: boolean
}

// Styled Custom Components
const LoginIllustration = styled('img')(({ theme }) => ({
  position: 'relative',
  zIndex: 1,
  blockSize: 'auto',
  maxBlockSize: 560,
  maxInlineSize: 'min(78%, 640px)',
  filter: 'grayscale(1)',
  opacity: 0.78,
  transition: 'opacity 200ms ease-in-out',
  [theme.breakpoints.down(1536)]: {
    maxBlockSize: 500
  },
  [theme.breakpoints.down('lg')]: {
    maxBlockSize: 400
  }
}))

const MaskImg = styled('img')({
  blockSize: 'auto',
  maxBlockSize: 320,
  inlineSize: '100%',
  position: 'absolute',
  insetBlockEnd: 0,
  filter: 'grayscale(1)',
  opacity: 0.22
})

const VisualPanel = styled('section')({
  position: 'relative',
  isolation: 'isolate',
  overflow: 'hidden',
  background:
    'linear-gradient(145deg, var(--mui-palette-background-default) 0%, var(--mui-palette-background-paper) 100%)',
  '&::before': {
    content: '""',
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    opacity: 0.32,
    backgroundImage: 'radial-gradient(var(--mui-palette-divider) 1px, transparent 1px)',
    backgroundSize: '24px 24px',
    maskImage: 'linear-gradient(to bottom, black, transparent 82%)'
  }
})

const LoginCard = styled(Paper)(({ theme }) => ({
  boxSizing: 'border-box',
  inlineSize: '100%',
  maxInlineSize: 430,
  padding: theme.spacing(8),
  border: '1px solid var(--mui-palette-divider)',
  borderRadius: theme.shape.borderRadius * 2,
  boxShadow: theme.shadows[8],
  [theme.breakpoints.down('sm')]: {
    padding: theme.spacing(6)
  }
}))

const Brand = () => (
  <Box className='flex items-center gap-3' aria-label='I-Con'>
    <Box
      className='flex items-center justify-center rounded-md'
      sx={{
        inlineSize: 36,
        blockSize: 36,
        color: 'text.primary',
        bgcolor: 'action.hover',
        border: theme => `1px solid ${theme.palette.divider}`
      }}
    >
      <VuexyLogo fontSize='1.25rem' aria-hidden='true' />
    </Box>
    <Typography variant='h5' component='span' className='font-semibold tracking-tight'>
      I-Con
    </Typography>
  </Box>
)

const LoginV2 = ({ mode, user, authError, logoutIncomplete }: Props) => {
  // Vars
  const darkImg = '/images/pages/auth-mask-dark.png'
  const lightImg = '/images/pages/auth-mask-light.png'
  const darkIllustration = '/images/illustrations/auth/v2-login-dark.png'
  const lightIllustration = '/images/illustrations/auth/v2-login-light.png'
  const borderedDarkIllustration = '/images/illustrations/auth/v2-login-dark-border.png'
  const borderedLightIllustration = '/images/illustrations/auth/v2-login-light-border.png'

  // Hooks
  const authBackground = useImageVariant(mode, lightImg, darkImg)

  const characterIllustration = useImageVariant(
    mode,
    lightIllustration,
    darkIllustration,
    borderedLightIllustration,
    borderedDarkIllustration
  )

  return (
    <Box className='flex min-bs-[100dvh]' sx={{ bgcolor: 'background.default' }}>
      <VisualPanel className='hidden md:flex flex-1 flex-col justify-between p-10 lg:p-14 border-ie'>
        <Box className='relative z-[1]'>
          <Brand />
        </Box>

        <Box className='flex flex-1 items-center justify-center'>
          <LoginIllustration src={characterIllustration} alt='' aria-hidden='true' />
          <MaskImg src={authBackground} alt='' aria-hidden='true' />
        </Box>

        <Typography variant='body2' color='text.secondary' className='relative z-[1]'>
          Portail professionnel I-Con
        </Typography>
      </VisualPanel>

      <Box
        component='main'
        className='flex min-bs-[100dvh] is-full items-center justify-center p-6 sm:p-10 md:is-[520px] lg:is-[560px]'
        sx={{ bgcolor: 'background.paper' }}
      >
        <Box className='flex is-full max-is-[430px] flex-col gap-6'>
          <Box className='md:hidden'>
            <Brand />
          </Box>

          <LoginCard elevation={0}>
            <Box className='flex flex-col gap-6'>
              <Box className='flex flex-col gap-2'>
                <Typography variant='h4' component='h1' className='font-semibold'>
                  Bienvenue sur I-Con
                </Typography>
                <Typography color='text.secondary'>Connectez-vous avec votre compte professionnel.</Typography>
              </Box>

              {user ? (
                <>
                  <Box
                    role='alert'
                    className='flex items-start gap-3 rounded-md p-4'
                    sx={{ bgcolor: 'action.hover', border: theme => `1px solid ${theme.palette.divider}` }}
                  >
                    <i className='tabler-lock-access mbs-0.5 text-warning' aria-hidden='true' />
                    <Box className='flex flex-col gap-1'>
                      <Typography variant='body2' className='font-medium' color='text.primary'>
                        Accès non autorisé
                      </Typography>
                      <Typography variant='body2' color='text.secondary'>
                        Connecté en tant que {user.name ?? user.email ?? 'utilisateur'}
                        {user.name && user.email ? ` (${user.email})` : ''}. Votre compte ne dispose pas du profil
                        requis pour accéder à I-Con.
                      </Typography>
                      <Typography variant='body2' color='text.secondary'>
                        Si votre profil a été modifié récemment, déconnectez-vous puis reconnectez-vous.
                      </Typography>
                    </Box>
                  </Box>

                  <form action={signOutWithKeycloak}>
                    <Button
                      fullWidth
                      type='submit'
                      size='large'
                      variant='outlined'
                      color='secondary'
                      startIcon={<i className='tabler-logout' aria-hidden='true' />}
                      sx={{ minBlockSize: 48 }}
                    >
                      Se déconnecter
                    </Button>
                  </form>
                </>
              ) : (
                <>
                  {logoutIncomplete ? (
                    <Box
                      role='alert'
                      className='flex items-start gap-3 rounded-md p-4'
                      sx={{ bgcolor: 'action.hover', border: theme => `1px solid ${theme.palette.divider}` }}
                    >
                      <i className='tabler-alert-triangle mbs-0.5 text-warning' aria-hidden='true' />
                      <Typography variant='body2' color='text.secondary'>
                        Votre session I-Con a été fermée, mais la déconnexion SSO Keycloak n’a pas pu être confirmée.
                        Avant de vous reconnecter, vérifiez ou fermez votre session Keycloak.
                      </Typography>
                    </Box>
                  ) : null}

                  {authError ? (
                    <Box
                      role='alert'
                      className='flex items-start gap-3 rounded-md p-4'
                      sx={{ bgcolor: 'action.hover', border: theme => `1px solid ${theme.palette.divider}` }}
                    >
                      <i className='tabler-alert-circle mbs-0.5 text-error' aria-hidden='true' />
                      <Typography variant='body2' color='text.secondary'>
                        La connexion a échoué. Veuillez réessayer ou contacter votre administrateur.
                      </Typography>
                    </Box>
                  ) : null}

                  <form action={signInWithKeycloak}>
                    <Button
                      fullWidth
                      type='submit'
                      size='large'
                      variant='contained'
                      startIcon={<i className='tabler-lock' aria-hidden='true' />}
                      sx={{ minBlockSize: 48 }}
                    >
                      Se connecter avec SSO
                    </Button>
                  </form>

                  <Box
                    className='flex items-start gap-3 rounded-md p-4'
                    sx={{ bgcolor: 'action.hover', border: theme => `1px solid ${theme.palette.divider}` }}
                  >
                    <i className='tabler-info-circle mbs-0.5 text-textSecondary' aria-hidden='true' />
                    <Typography variant='body2' color='text.secondary'>
                      Vous serez redirigé vers le service d’authentification sécurisé I-Con.
                    </Typography>
                  </Box>
                </>
              )}
            </Box>
          </LoginCard>

          <Typography variant='caption' color='text.secondary' className='text-center'>
            Accès réservé aux utilisateurs autorisés.
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

export default LoginV2
