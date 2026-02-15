import { useState } from 'react';
import { api, setAuthTokens } from '@/lib/api';

interface LoginPageProps {
  onLoginSuccess: () => void;
  appName?: string;
  mode?: string;
}

export function LoginPage({ onLoginSuccess, appName = 'Verbatim Studio', mode }: LoginPageProps) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const result = await api.auth.login(username, password);
      setAuthTokens(result.access_token, result.refresh_token);
      onLoginSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const result = await api.auth.register(username, email, password);
      if (result.is_active) {
        setRegisterSuccess(`Admin account created for ${result.username}. You can now sign in.`);
      } else {
        setRegisterSuccess(`Account created for ${result.username}. An admin must approve your account before you can sign in.`);
      }
      setIsRegistering(false);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-foreground">{appName}</h1>
          {mode && (
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{mode}</p>
          )}
        </div>

        {registerSuccess && (
          <div className="p-3 rounded-md bg-success/10 text-success text-sm">
            {registerSuccess}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        <form onSubmit={isRegistering ? handleRegister : handleLogin} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-medium text-foreground">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Enter username"
            />
          </div>

          {isRegistering && (
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Enter email"
              />
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Enter password"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isLoading ? (isRegistering ? 'Creating account...' : 'Signing in...') : (isRegistering ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        <div className="text-center">
          <button
            type="button"
            onClick={() => {
              setIsRegistering(!isRegistering);
              setError(null);
              setRegisterSuccess(null);
            }}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {isRegistering ? 'Already have an account? Sign in' : 'Need an account? Register'}
          </button>
        </div>
      </div>
    </div>
  );
}
