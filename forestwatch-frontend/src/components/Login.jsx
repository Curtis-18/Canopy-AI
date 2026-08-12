import { useState } from 'react'
import { useAuth } from '../context/useAuth'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = mode === 'signin'
      ? await signIn(email, password)
      : await signUp(email, password)
    setLoading(false)
    if (error) setError(error.message)
  }

  return (
    <div className="login-screen">
      <form onSubmit={handleSubmit} className="login-form">
        <h1>Canopy AI</h1>
        <p className="login-subtitle">
          {mode === 'signin' ? 'Sign in to your account' : 'Create an account'}
        </p>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        {error && <p className="login-error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>
        <button type="button" className="login-toggle" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}