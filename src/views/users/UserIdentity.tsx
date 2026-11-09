'use client'

// React Imports
import { useEffect, useState } from 'react'

// Next Imports
import Link from 'next/link'

// MUI Imports
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'

// User Imports
import {
  buildUserDetailRequestUrl,
  getUserDetailErrorKind,
  parseUserIdentity
} from '@/modules/users/presentation/user-detail'
import type { UserDetailErrorKind, UserIdentityDto } from '@/modules/users/presentation/user-detail'

type UserIdentityProps = {
  userId: string
}

const ERROR_CONTENT: Record<
  UserDetailErrorKind,
  { severity: 'error' | 'warning'; title: string; message: string }
> = {
  'session-expired': {
    severity: 'warning',
    title: 'Session expirée',
    message: 'Votre session a expiré. Reconnectez-vous pour consulter cet utilisateur.'
  },
  forbidden: {
    severity: 'error',
    title: 'Accès refusé',
    message: 'Vous n’êtes pas autorisé à consulter cet utilisateur.'
  },
  'not-found': {
    severity: 'warning',
    title: 'Utilisateur introuvable',
    message: 'Ce compte n’existe pas ou ne fait pas partie de votre périmètre autorisé.'
  },
  'protection-unavailable': {
    severity: 'error',
    title: 'Protection du compte indisponible',
    message: 'La protection de ce compte ne peut pas être vérifiée. La consultation est bloquée par sécurité.'
  },
  upstream: {
    severity: 'error',
    title: 'Annuaire indisponible',
    message: 'Le service d’annuaire est momentanément indisponible. Réessayez dans quelques instants.'
  },
  unknown: {
    severity: 'error',
    title: 'Erreur inattendue',
    message: 'Une erreur est survenue pendant le chargement de l’utilisateur.'
  }
}

const IdentityField = ({ label, value }: { label: string; value: string }) => (
  <Box>
    <Typography variant='caption' color='text.secondary'>
      {label}
    </Typography>
    <Typography className='font-medium break-words'>{value}</Typography>
  </Box>
)

const UserIdentity = ({ userId }: UserIdentityProps) => {
  const [user, setUser] = useState<UserIdentityDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorKind, setErrorKind] = useState<UserDetailErrorKind | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    const loadUser = async () => {
      setLoading(true)
      setUser(null)
      setErrorKind(null)

      try {
        const response = await fetch(buildUserDetailRequestUrl(userId), {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          signal: controller.signal
        })

        const payload: unknown = await response.json().catch(() => null)

        if (!response.ok) {
          setErrorKind(getUserDetailErrorKind(response.status, payload))

          return
        }

        const parsedUser = parseUserIdentity(payload)

        if (!parsedUser || parsedUser.id !== userId) {
          setErrorKind('upstream')

          return
        }

        setUser(parsedUser)
      } catch (error) {
        if ((error as { name?: string }).name !== 'AbortError') setErrorKind('upstream')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadUser()

    return () => controller.abort()
  }, [retry, userId])

  const errorContent = errorKind ? ERROR_CONTENT[errorKind] : null

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <Button
          component={Link}
          href='/users'
          color='secondary'
          size='small'
          startIcon={<i className='tabler-arrow-left' aria-hidden='true' />}
          className='mbe-3'
        >
          Retour à l’annuaire
        </Button>
        <Typography variant='h4' component='h1'>
          Identité de l’utilisateur
        </Typography>
        <Typography color='text.secondary' className='mbs-1'>
          Informations d’identité chargées depuis l’annuaire sécurisé.
        </Typography>
      </div>

      {loading ? (
        <Card>
          <CardContent>
            <Box className='flex min-bs-52 flex-col items-center justify-center gap-3' role='status'>
              <CircularProgress size={32} />
              <Typography color='text.secondary'>Chargement de l’utilisateur…</Typography>
            </Box>
          </CardContent>
        </Card>
      ) : null}

      {!loading && errorContent ? (
        <Alert
          severity={errorContent.severity}
          action={
            errorKind === 'session-expired' ? (
              <Button color='inherit' size='small' href='/login'>
                Se reconnecter
              </Button>
            ) : errorKind === 'upstream' || errorKind === 'unknown' ? (
              <Button color='inherit' size='small' onClick={() => setRetry(value => value + 1)}>
                Réessayer
              </Button>
            ) : undefined
          }
        >
          <Typography component='span' className='font-medium'>
            {errorContent.title}
          </Typography>{' '}
          {errorContent.message}
        </Alert>
      ) : null}

      {!loading && !errorKind && user ? (
        <Card>
          <CardContent className='flex flex-col gap-5'>
            <Box className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <Typography variant='h5'>{user.username}</Typography>
                <Typography color='text.secondary'>Compte utilisateur</Typography>
              </div>
              <Chip
                variant='tonal'
                color={user.enabled ? 'success' : 'secondary'}
                label={user.enabled ? 'Compte activé' : 'Compte désactivé'}
              />
            </Box>

            <Divider />

            <Box className='grid grid-cols-1 gap-5 sm:grid-cols-2'>
              <IdentityField label='Identifiant' value={user.username} />
              {user.firstName ? <IdentityField label='Prénom' value={user.firstName} /> : null}
              {user.lastName ? <IdentityField label='Nom' value={user.lastName} /> : null}
              {user.email ? <IdentityField label='E-mail' value={user.email} /> : null}
            </Box>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export default UserIdentity
