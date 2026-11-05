// Next Imports
import { redirect } from 'next/navigation'

// Starter demo route retired for the Authentication MVP: the protected Welcome page is the only entry point.
export default function Page() {
  redirect('/welcome')
}
