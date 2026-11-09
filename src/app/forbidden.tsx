// Component Imports
import Providers from '@components/Providers'
import BlankLayout from '@layouts/BlankLayout'
import Forbidden from '@views/Forbidden'

// Util Imports
import { getServerMode, getSystemMode } from '@core/utils/serverHelpers'

// Rendered with HTTP 403 when a server component calls `forbidden()` (missing allowed Client Role).
const ForbiddenPage = async () => {
  // Vars
  const direction = 'ltr'
  const mode = await getServerMode()
  const systemMode = await getSystemMode()

  return (
    <Providers direction={direction}>
      <BlankLayout systemMode={systemMode}>
        <Forbidden mode={mode} />
      </BlankLayout>
    </Providers>
  )
}

export default ForbiddenPage

