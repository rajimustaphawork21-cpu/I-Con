'use client'

// React Imports
import { useRef } from 'react'

// MUI Imports
import Button from '@mui/material/Button'

// Third-party Imports
import { getCsrfToken } from 'next-auth/react'

/**
 * Keycloak SSO logout is a real form POST (never a link) carrying the Auth.js
 * CSRF token, so it cannot be started by a cross-site request or a GET navigation.
 */
const KeycloakLogoutButton = () => {
  const formRef = useRef<HTMLFormElement>(null)
  const tokenRef = useRef<HTMLInputElement>(null)

  const handleClick = async () => {
    const csrfToken = await getCsrfToken()

    if (!csrfToken || !formRef.current || !tokenRef.current) return

    tokenRef.current.value = csrfToken
    formRef.current.submit()
  }

  return (
    <form ref={formRef} method='post' action='/api/auth/keycloak-logout'>
      <input ref={tokenRef} type='hidden' name='csrfToken' defaultValue='' />
      <Button
        fullWidth
        variant='outlined'
        color='error'
        size='small'
        type='button'
        endIcon={<i className='tabler-logout' />}
        onClick={handleClick}
        sx={{ '& .MuiButton-endIcon': { marginInlineStart: 1.5 } }}
      >
        Sign out of Keycloak SSO
      </Button>
    </form>
  )
}

export default KeycloakLogoutButton
