import { useAuth } from '../context/useAuth'
import Login from './Login'

export default function AuthGate({ children }) {
  const { session, loading } = useAuth()

  if (loading) {
    return <div className="auth-loading">Loading...</div>
  }

  if (!session) {
    return <Login />
  }

  return children
}