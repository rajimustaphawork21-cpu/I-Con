'use client'

// React Imports
import { useEffect, useReducer, useState } from 'react'

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
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Tab from '@mui/material/Tab'
import Typography from '@mui/material/Typography'

// MUI Lab Imports
import TabContext from '@mui/lab/TabContext'
import TabPanel from '@mui/lab/TabPanel'

// Component Imports
import CustomTabList from '@core/components/mui/TabList'

// User Imports
import {
  INITIAL_SIMULATED_UNLOCK_STATE,
  buildUserDetailRequestUrl,
  getUserDetailErrorKind,
  loadSimulatedUnlockCapability,
  reduceSimulatedUnlockUiState,
  parseUserIdentity
} from '@/modules/users/presentation/user-detail'
import type {
  SimulatedUnlockCapabilityDto,
  UserDetailErrorKind,
  UserIdentityDto
} from '@/modules/users/presentation/user-detail'

type UserIdentityProps = {
  userId: string
}

const ERROR_CONTENT: Record<UserDetailErrorKind, { severity: 'error' | 'warning'; title: string; message: string }> = {
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
  const [activeTab, setActiveTab] = useState<'identity' | 'security'>('identity')
  const [demoCapability, setDemoCapability] = useState<SimulatedUnlockCapabilityDto | null>(null)
  const [demoLoading, setDemoLoading] = useState(false)

  const [simulatedUnlock, dispatchSimulatedUnlock] = useReducer(
    reduceSimulatedUnlockUiState,
    INITIAL_SIMULATED_UNLOCK_STATE
  )

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

  useEffect(() => {
    if (!user) {
      setDemoCapability(null)
      setDemoLoading(false)

      return
    }

    const controller = new AbortController()

    const loadCapability = async () => {
      setDemoLoading(true)
      setDemoCapability(null)

      const capability = await loadSimulatedUnlockCapability(user.id, fetch, controller.signal)

      if (controller.signal.aborted) return

      setDemoCapability(capability)
      dispatchSimulatedUnlock({ type: 'reset', locked: capability?.simulatedLocked === true })
      setDemoLoading(false)
    }

    void loadCapability()

    return () => controller.abort()
  }, [user])

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
          <CardContent>
            <TabContext value={activeTab}>
              <CustomTabList
                onChange={(_event, value) => setActiveTab(value as 'identity' | 'security')}
                aria-label='Sections de la fiche utilisateur'
              >
                <Tab
                  value='identity'
                  label='Identité'
                  icon={<i className='tabler-user' aria-hidden='true' />}
                  iconPosition='start'
                />
                <Tab
                  value='security'
                  label='Sécurité'
                  icon={<i className='tabler-shield-lock' aria-hidden='true' />}
                  iconPosition='start'
                />
              </CustomTabList>

              <TabPanel value='identity'>
                <Box className='flex flex-col gap-5'>
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
                </Box>
              </TabPanel>

              <TabPanel value='security'>
                <Box className='flex flex-col gap-5'>
                  <Box className='flex flex-wrap items-start justify-between gap-3'>
                    <div>
                      <Typography variant='h5'>Sécurité du compte</Typography>
                      <Typography color='text.secondary' className='mbs-1'>
                        Démonstration locale du parcours de déblocage.
                      </Typography>
                    </div>
                    <Chip variant='tonal' color='info' label='Simulation locale' />
                  </Box>

                  <Alert severity='info'>
                    Aucun appel d’écriture n’est envoyé à Keycloak. L’état affiché dans cet onglet est simulé et
                    distinct de l’état de verrouillage réel du compte.
                  </Alert>

                  {demoLoading ? (
                    <Box className='flex items-center gap-3' role='status'>
                      <CircularProgress size={24} />
                      <Typography color='text.secondary'>Vérification de l’éligibilité de la simulation…</Typography>
                    </Box>
                  ) : null}

                  {!demoLoading && demoCapability?.enabled && demoCapability.eligible ? (
                    <Box className='flex flex-col gap-4 rounded border border-solid p-5' sx={{ borderColor: 'divider' }}>
                      <Box className='flex flex-wrap items-center justify-between gap-3'>
                        <div>
                          <Typography className='font-medium'>État de verrouillage simulé</Typography>
                          <Typography variant='body2' color='text.secondary'>
                            Compte de démonstration uniquement
                          </Typography>
                        </div>
                        <Chip
                          variant='tonal'
                          color={simulatedUnlock.locked ? 'warning' : 'success'}
                          label={simulatedUnlock.locked ? 'Verrouillé (simulation)' : 'Débloqué (simulation)'}
                        />
                      </Box>

                      {simulatedUnlock.feedback ? <Alert severity='success'>{simulatedUnlock.feedback}</Alert> : null}

                      {simulatedUnlock.locked ? (
                        <Box>
                          <Button
                            variant='contained'
                            color='warning'
                            startIcon={<i className='tabler-lock-open' aria-hidden='true' />}
                            onClick={() => dispatchSimulatedUnlock({ type: 'open-confirmation' })}
                          >
                            Débloquer (simulation)
                          </Button>
                        </Box>
                      ) : null}
                    </Box>
                  ) : null}

                  {!demoLoading && (!demoCapability?.enabled || !demoCapability.eligible) ? (
                    <Alert severity='warning'>
                      La démonstration de déblocage n’est pas disponible pour cet opérateur ou ce compte.
                    </Alert>
                  ) : null}
                </Box>
              </TabPanel>
            </TabContext>
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={simulatedUnlock.confirmationOpen}
        onClose={() => dispatchSimulatedUnlock({ type: 'cancel' })}
        aria-labelledby='simulated-unlock-dialog-title'
      >
        <DialogTitle id='simulated-unlock-dialog-title'>Confirmer le déblocage simulé</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Confirmez-vous le déblocage simulé de ce compte ? Cette action modifie uniquement l’état local de la
            démonstration. Le compte Keycloak reste inchangé.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color='secondary' onClick={() => dispatchSimulatedUnlock({ type: 'cancel' })}>
            Annuler
          </Button>
          <Button variant='contained' color='warning' onClick={() => dispatchSimulatedUnlock({ type: 'confirm' })}>
            Confirmer le déblocage simulé
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}

export default UserIdentity
