'use client'

import { type FormEvent, useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
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

import { INITIAL_USERS_PAGE_STATE, resolveUsersPageState, type UsersPageState } from './users-page-state'

const DEFAULT_PAGE_SIZE = 10

const UsersPage = () => {
  const [state, setState] = useState<UsersPageState>(INITIAL_USERS_PAGE_STATE)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [draftSearch, setDraftSearch] = useState('')
  const [search, setSearch] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    const load = async () => {
      setState({ kind: 'loading' })

      const parameters = new URLSearchParams({
        first: String(page * pageSize),
        max: String(pageSize)
      })

      const countParameters = new URLSearchParams()

      if (search.length > 0) {
        parameters.set('search', search)
        countParameters.set('search', search)
      }

      try {
        const [listResponse, countResponse] = await Promise.all([
          fetch(`/api/users?${parameters.toString()}`, {
            cache: 'no-store',
            signal: controller.signal
          }),
          fetch(`/api/users/count?${countParameters.toString()}`, {
            cache: 'no-store',
            signal: controller.signal
          })
        ])

        const [listPayload, countPayload] = await Promise.all([readJson(listResponse), readJson(countResponse)])

        const nextState = resolveUsersPageState(listResponse.status, listPayload, countResponse.status, countPayload)

        if (nextState.kind === 'unauthenticated') {
          window.location.assign('/login')

          return
        }

        setState(nextState)
      } catch {
        if (!controller.signal.aborted) setState({ kind: 'error' })
      }
    }

    void load()

    return () => controller.abort()
  }, [page, pageSize, retry, search])

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(0)
    setSearch(draftSearch.trim())
  }

  const count = state.kind === 'ready' || state.kind === 'empty' ? state.count : 0

  return (
    <Card>
      <CardHeader title='Users' subheader='Read-only users in the configured Keycloak Realm' />
      <CardContent className='flex flex-col gap-6'>
        <Box component='form' onSubmit={submitSearch} className='flex flex-wrap items-center gap-3'>
          <TextField
            label='Search users'
            value={draftSearch}
            onChange={event => setDraftSearch(event.target.value)}
            size='small'
            inputProps={{ maxLength: 256 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position='start'>
                  <i className='tabler-search' aria-hidden='true' />
                </InputAdornment>
              )
            }}
          />
          <Button type='submit' variant='contained'>
            Search
          </Button>
          {(search.length > 0 || draftSearch.length > 0) && (
            <Button
              type='button'
              variant='text'
              onClick={() => {
                setDraftSearch('')
                setSearch('')
                setPage(0)
              }}
            >
              Clear
            </Button>
          )}
        </Box>

        {state.kind === 'loading' && (
          <Box role='status' className='flex min-bs-48 flex-col items-center justify-center gap-3'>
            <CircularProgress size={36} />
            <Typography color='text.secondary'>Loading users…</Typography>
          </Box>
        )}

        {state.kind === 'forbidden' && <Alert severity='warning'>You do not have permission to view users.</Alert>}

        {state.kind === 'error' && (
          <Alert
            severity='error'
            action={
              <Button color='inherit' size='small' onClick={() => setRetry(value => value + 1)}>
                Retry
              </Button>
            }
          >
            Users could not be loaded. Try again.
          </Alert>
        )}

        {state.kind === 'empty' && (
          <Alert severity='info'>No users found{search.length > 0 ? ' for this search' : ''}.</Alert>
        )}

        {state.kind === 'ready' && (
          <TableContainer>
            <Table aria-label='Keycloak users'>
              <TableHead>
                <TableRow>
                  <TableCell>Username</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {state.users.map(user => (
                  <TableRow key={user.id} hover>
                    <TableCell>{user.username}</TableCell>
                    <TableCell>{user.email ?? '—'}</TableCell>
                    <TableCell>
                      <Chip
                        size='small'
                        variant='tonal'
                        color={user.enabled ? 'success' : 'secondary'}
                        label={user.enabled ? 'Enabled' : 'Disabled'}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {(state.kind === 'ready' || state.kind === 'empty') && (
          <TablePagination
            component='div'
            count={count}
            page={count === 0 ? 0 : page}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[5, 10, 25, 50, 100]}
            onPageChange={(_, nextPage) => setPage(nextPage)}
            onRowsPerPageChange={event => {
              setPageSize(Number(event.target.value))
              setPage(0)
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export default UsersPage
