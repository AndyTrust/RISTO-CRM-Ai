import React, { useState, useEffect } from 'react'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase } from '../supabase'

export function AuthGate({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Loading
  if (session === undefined) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <img src="/logo-light.png" alt="Risto CRM" className="h-24 w-auto mx-auto mb-4 opacity-90" />
          <p className="text-gray-500 text-sm">Caricamento...</p>
        </div>
      </div>
    )
  }

  // Non autenticato → mostra login
  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
          <div className="text-center mb-8">
            <img src="/logo-light.png" alt="Risto CRM" className="h-16 w-auto mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-800">Risto CRM</h1>
            <p className="text-gray-500 text-sm mt-1">Accedi per continuare</p>
          </div>
          <Auth
            supabaseClient={supabase}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: '#1a1a2e',
                    brandAccent: '#16213e',
                  }
                }
              }
            }}
            providers={[]}
            localization={{
              variables: {
                sign_in: {
                  email_label: 'Email',
                  password_label: 'Password',
                  button_label: 'Accedi',
                  loading_button_label: 'Accesso in corso...',
                  email_input_placeholder: 'La tua email',
                  password_input_placeholder: 'La tua password',
                },
              }
            }}
          />
        </div>
      </div>
    )
  }

  // Autenticato → mostra app
  return children
}

export default AuthGate
