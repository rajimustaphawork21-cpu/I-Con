// Next Imports
import { redirect } from 'next/navigation'

// MUI Imports
import Button from '@mui/material/Button'

// Type Imports
import type { ChildrenType } from '@core/types'

// Layout Imports
import LayoutWrapper from '@layouts/LayoutWrapper'
import VerticalLayout from '@layouts/VerticalLayout'
import HorizontalLayout from '@layouts/HorizontalLayout'

// Component Imports
import Providers from '@components/Providers'
import Navigation from '@components/layout/vertical/Navigation'
import Header from '@components/layout/horizontal/Header'
import Navbar from '@components/layout/vertical/Navbar'
import VerticalFooter from '@components/layout/vertical/Footer'
import HorizontalFooter from '@components/layout/horizontal/Footer'
import ScrollToTop from '@core/components/scroll-to-top'
import AuthSessionProvider from '@components/auth/AuthSessionProvider'
import ActivityTracker from '@components/auth/ActivityTracker'

// Auth Imports
import { getAuthenticatedSession } from '../../../modules/auth/infrastructure/server-session'

// Util Imports
import { getMode, getSystemMode } from '@core/utils/serverHelpers'

const Layout = async (props: ChildrenType) => {
  const { children } = props

  // Type guard to ensure lang is a valid Locale

  // Authentication only: any valid session may see the shell; no role is checked here.
  const session = await getAuthenticatedSession()

  if (!session) {
    redirect('/login')
  }

  // Vars
  const direction = 'ltr'
  const mode = await getMode()
  const systemMode = await getSystemMode()

  return (
    <AuthSessionProvider session={session}>
      <ActivityTracker />
      <Providers direction={direction}>
        <LayoutWrapper
          systemMode={systemMode}
          verticalLayout={
            <VerticalLayout navigation={<Navigation mode={mode} />} navbar={<Navbar />} footer={<VerticalFooter />}>
              {children}
            </VerticalLayout>
          }
          horizontalLayout={
            <HorizontalLayout header={<Header />} footer={<HorizontalFooter />}>
              {children}
            </HorizontalLayout>
          }
        />
        <ScrollToTop className='mui-fixed'>
          <Button variant='contained' className='is-10 bs-10 rounded-full p-0 min-is-0 flex items-center justify-center'>
            <i className='tabler-arrow-up' />
          </Button>
        </ScrollToTop>
      </Providers>
    </AuthSessionProvider>
  )
}

export default Layout
