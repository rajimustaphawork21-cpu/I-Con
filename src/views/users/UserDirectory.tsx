'use client'

// React Imports
import { useEffect, useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import InputAdornment from '@mui/material/InputAdornment'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

// User Imports
import {
  buildDirectoryRequestUrl,
  getDirectoryErrorKind,
  isDirectorySearchValid,
  normalizeDirectorySearch,
  parseDirectoryPage
} from '@/modules/users/presentation/user-directory'
import type { DirectoryErrorKind, DirectoryPageDto } from '@/modules/users/presentation/user-directory'

const EMPTY_PAGE: DirectoryPageDto = { users: [], total: 0, page: 1, pageSize: 20 }

const ERROR_CONTENT: Record<DirectoryErrorKind, { severity: 'error' | 'warning'; title: string; message: string }> = {
  'invalid-search': {
    severity: 'warning',
    title: 'Recherche invalide',
    message: 'Saisissez au moins 3 caractères pour lancer une recherche.'
  },
  'session-expired': {
    severity: 'warning',
    title: 'Session expirée',
    message: 'Votre session a expiré. Reconnectez-vous pour consulter l’annuaire.'
  },
  forbidden: {
    severity: 'error',
    title: 'Accès refusé',
    message: 'Vous n’êtes pas autorisé à consulter cet annuaire.'
  },
  upstream: {
    severity: 'error',
    title: 'Annuaire indisponible',
    message: 'Le service d’annuaire est momentanément indisponible. Réessayez dans quelques instants.'
  },
  unknown: {
    severity: 'error',
    title: 'Erreur inattendue',
    message: 'Une erreur est survenue pendant le chargement de l’annuaire.'
  }
}

const UserDirectory = () => {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [directoryPage, setDirectoryPage] = useState<DirectoryPageDto>(EMPTY_PAGE)
  const [loading, setLoading] = useState(true)
  const [errorKind, setErrorKind] = useState<DirectoryErrorKind | null>(null)
  const [retry, setRetry] = useState(0)

  const normalizedSearch = normalizeDirectorySearch(search)
  const invalidSearch = !isDirectorySearchValid(normalizedSearch)
  const searchIsSettled = normalizedSearch === debouncedSearch

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(normalizedSearch), 350)

    return () => window.clearTimeout(timer)
  }, [normalizedSearch])

  useEffect(() => {
    if (!searchIsSettled) return

    if (invalidSearch) {
      setLoading(false)
      setErrorKind('invalid-search')

      return
    }

    const controller = new AbortController()

    const loadUsers = async () => {
      setLoading(true)
      setErrorKind(null)

      try {
        const response = await fetch(buildDirectoryRequestUrl(debouncedSearch, page, pageSize), {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          signal: controller.signal
        })

        const payload: unknown = await response.json().catch(() => null)

        if (!response.ok) {
          setErrorKind(getDirectoryErrorKind(response.status))

          return
        }

        const parsedPage = parseDirectoryPage(payload)

        if (!parsedPage) {
          setErrorKind('upstream')

          return
        }

        setDirectoryPage(parsedPage)
      } catch (error) {
        if ((error as { name?: string }).name !== 'AbortError') setErrorKind('upstream')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadUsers()

    return () => controller.abort()
  }, [debouncedSearch, invalidSearch, page, pageSize, retry, searchIsSettled])

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const errorContent = errorKind ? ERROR_CONTENT[errorKind] : null

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <Typography variant='h4' component='h1'>
          Annuaire des utilisateurs
        </Typography>
        <Typography color='text.secondary' className='mbs-1'>
          Recherchez et consultez les comptes autorisés dans votre périmètre.
        </Typography>
      </div>

      <Card>
        <CardContent className='flex flex-col gap-5'>
          <TextField
            fullWidth
            label='Rechercher un utilisateur'
            placeholder='Nom, prénom, identifiant ou e-mail'
            value={search}
            onChange={event => handleSearchChange(event.target.value)}
            error={invalidSearch}
            helperText={
              invalidSearch
                ? 'Saisissez au moins 3 caractères.'
                : 'Laissez le champ vide pour afficher les comptes autorisés.'
            }
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position='start'>
                    <i className='tabler-search' aria-hidden='true' />
                  </InputAdornment>
                )
              }
            }}
          />

          {errorContent ? (
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

          {loading && !invalidSearch ? (
            <Box className='flex min-bs-52 flex-col items-center justify-center gap-3' role='status'>
              <CircularProgress size={32} />
              <Typography color='text.secondary'>Chargement de l’annuaire…</Typography>
            </Box>
          ) : null}

          {!loading && !errorKind && directoryPage.users.length === 0 ? (
            <Box className='flex min-bs-52 flex-col items-center justify-center gap-2 text-center'>
              <i className='tabler-users-minus text-4xl text-textSecondary' aria-hidden='true' />
              <Typography variant='h6'>Aucun utilisateur trouvé</Typography>
              <Typography color='text.secondary'>Modifiez votre recherche ou vérifiez votre périmètre.</Typography>
            </Box>
          ) : null}

          {!loading && !errorKind && directoryPage.users.length > 0 ? (
            <>
              <TableContainer>
                <Table aria-label='Résultats de l’annuaire des utilisateurs'>
                  <TableHead>
                    <TableRow>
                      <TableCell>Identifiant</TableCell>
                      <TableCell>Prénom</TableCell>
                      <TableCell>Nom</TableCell>
                      <TableCell>E-mail</TableCell>
                      <TableCell>État du compte</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {directoryPage.users.map(user => (
                      <TableRow key={user.id} hover>
                        <TableCell>{user.username}</TableCell>
                        <TableCell>{user.firstName || '—'}</TableCell>
                        <TableCell>{user.lastName || '—'}</TableCell>
                        <TableCell>{user.email || '—'}</TableCell>
                        <TableCell>
                          <Chip
                            size='small'
                            variant='tonal'
                            color={user.enabled ? 'success' : 'secondary'}
                            label={user.enabled ? 'Activé' : 'Désactivé'}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <TablePagination
                component='div'
                count={directoryPage.total}
                page={page - 1}
                rowsPerPage={pageSize}
                rowsPerPageOptions={[20, 50, 100]}
                onPageChange={(_event, nextPage) => setPage(nextPage + 1)}
                onRowsPerPageChange={event => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
                labelRowsPerPage='Résultats par page'
                labelDisplayedRows={({ from, to, count }) => `${from}–${to} sur ${count}`}
                getItemAriaLabel={type =>
                  type === 'first'
                    ? 'Première page'
                    : type === 'last'
                      ? 'Dernière page'
                      : type === 'next'
                        ? 'Page suivante'
                        : 'Page précédente'
                }
              />
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

export default UserDirectory
