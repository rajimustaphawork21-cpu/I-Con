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
  INITIAL_USER_UNLOCK_STATE,
  buildUserDetailRequestUrl,
  executeUserUnlock,
  getUserDetailErrorKind,
  loadUserUnlockStatus,
  parseUserIdentity,
  reduceUserUnlockUiState
} from '@/modules/users/presentation/user-detail'
import type { UserDetailErrorKind, UserIdentityDto } from '@/modules/users/presentation/user-detail'

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
  const [unlockLoading, setUnlockLoading] = useState(false)

  const [unlockUi, dispatchUnlock] = useReducer(reduceUserUnlockUiState, INITIAL_USER_UNLOCK_STATE)

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
      dispatchUnlock({ type: 'reset', status: null })
      setUnlockLoading(false)

      return
    }

    const controller = new AbortController()

    const loadStatus = async () => {
      setUnlockLoading(true)
      dispatchUnlock({ type: 'reset', status: null })

      const status = await loadUserUnlockStatus(user.id, fetch, controller.signal)

      if (controller.signal.aborted) return

      dispatchUnlock({ type: 'reset', status })
      setUnlockLoading(false)
    }

    void loadStatus()

    return () => controller.abort()
  }, [user])

  const handleConfirmUnlock = async () => {
    if (
      !user ||
      unlockUi.submitting ||
      !unlockUi.enabled ||
      !unlockUi.eligible ||
      unlockUi.locked !== true ||
      unlockUi.unknownCorrelationId
    ) {
      return
    }

    dispatchUnlock({ type: 'submit-start' })

    const result = await executeUserUnlock(user.id, fetch)

    if (result.outcome === 'unlocked') {
      dispatchUnlock({ type: 'submit-success' })

      return
    }

    if (result.outcome === 'unknown') {
      dispatchUnlock({ type: 'submit-unknown', correlationId: result.correlationId })

      return
    }

    if (result.outcome === 'not-locked') {
      dispatchUnlock({ type: 'submit-not-locked', message: result.message })

      return
    }

    dispatchUnlock({ type: 'submit-error', message: result.message })
  }

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
                        État de verrouillage anti-force brute Keycloak et déblocage contrôlé.
                      </Typography>
                    </div>
                  </Box>

                  {unlockLoading ? (
                    <Box className='flex items-center gap-3' role='status'>
                      <CircularProgress size={24} />
                      <Typography color='text.secondary'>
                        Vérification de l’état de verrouillage Keycloak…
                      </Typography>
                    </Box>
                  ) : null}

                  {!unlockLoading && unlockUi.enabled && unlockUi.locked !== null ? (
                    <Box className='flex flex-col gap-4 rounded border border-solid p-5' sx={{ borderColor: 'divider' }}>
                      <Box className='flex flex-wrap items-center justify-between gap-3'>
                        <div>
                          <Typography className='font-medium'>État de verrouillage Keycloak</Typography>
                          <Typography variant='body2' color='text.secondary'>
                            {unlockUi.unknownCorrelationId
                              ? 'Le résultat de la dernière demande de déblocage est incertain.'
                              : unlockUi.locked
                                ? 'Ce compte est temporairement verrouillé par la protection anti-force brute.'
                                : 'Aucun verrouillage anti-force brute actif sur ce compte.'}
                          </Typography>
                        </div>
                        <Chip
                          variant='tonal'
                          color={
                            unlockUi.unknownCorrelationId
                              ? 'error'
                              : unlockUi.locked
                                ? 'warning'
                                : 'success'
                          }
                          label={
                            unlockUi.unknownCorrelationId
                              ? 'État incertain (UNKNOWN)'
                              : unlockUi.locked
                                ? 'Verrouillé'
                                : 'Non verrouillé'
                          }
                        />
                      </Box>

                      {unlockUi.feedback ? <Alert severity='success'>{unlockUi.feedback}</Alert> : null}

                      {unlockUi.unknownCorrelationId ? (
                        <Alert severity='error'>
                          Résultat du déblocage incertain (UNKNOWN). Identifiant de corrélation :{' '}
                          <strong>{unlockUi.unknownCorrelationId}</strong>. Ne relancez pas l’opération avant
                          réconciliation.
                        </Alert>
                      ) : null}

                      {unlockUi.error ? <Alert severity='error'>{unlockUi.error}</Alert> : null}

                      {unlockUi.eligible && unlockUi.locked && !unlockUi.unknownCorrelationId ? (
                        <Box>
                          <Button
                            variant='contained'
                            color='warning'
                            disabled={unlockUi.submitting}
                            startIcon={<i className='tabler-lock-open' aria-hidden='true' />}
                            onClick={() => dispatchUnlock({ type: 'open-confirmation' })}
                          >
                            Débloquer
                          </Button>
                        </Box>
                      ) : null}
                    </Box>
                  ) : null}

                  {!unlockLoading && (!unlockUi.enabled || unlockUi.locked === null) ? (
                    <Alert severity='warning'>
                      Le déblocage du compte n’est pas disponible pour cet opérateur ou ce compte.
                    </Alert>
                  ) : null}
                </Box>
              </TabPanel>
            </TabContext>
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={unlockUi.confirmationOpen}
        onClose={() => dispatchUnlock({ type: 'cancel' })}
        aria-labelledby='user-unlock-dialog-title'
      >
        <DialogTitle id='user-unlock-dialog-title'>Confirmer le déblocage du compte</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Confirmez-vous le déblocage du compte {user?.username ?? ''} dans Keycloak ? Cette opération supprimera le
            verrouillage anti-force brute et sera enregistrée dans la piste d’audit PostgreSQL.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color='secondary' disabled={unlockUi.submitting} onClick={() => dispatchUnlock({ type: 'cancel' })}>
            Annuler
          </Button>
          <Button variant='contained' color='warning' disabled={unlockUi.submitting} onClick={handleConfirmUnlock}>
            Confirmer le déblocage
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}

export default UserIdentity
