import { lazy, Suspense, useEffect, useState } from 'react'
import { commandsActive } from './api.ts'
import { Library } from './screens/library.tsx'
import Onboarding from './screens/onboarding.tsx'
import { useRoute } from './router.ts'
import { GatewayProvider, useGateway } from './state.tsx'

const Setup = lazy(() => import('./screens/setup.tsx'))
const RemoteScreen = lazy(() => import('./screens/remotes.tsx'))
const More = lazy(() => import('./screens/more.tsx'))

export default function App() {
  return (
    <GatewayProvider>
      <a className="skip" href="#main">
        Skip to remote
      </a>
      <div className="app" id="main">
        <UpdatePrompt />
        <Shell />
      </div>
    </GatewayProvider>
  )
}

function Shell() {
  const gateway = useGateway()
  const route = useRoute()
  if (gateway.phase === 'loading') return <p className="muted">Opening the remote…</p>
  if (gateway.phase === 'offline' && gateway.devices.length === 0) {
    return (
      <main className="stack">
        <h1>Gateway unreachable</h1>
        <p>{gateway.notice}</p>
        <button type="button" onClick={() => void gateway.reload()}>
          Try again
        </button>
      </main>
    )
  }
  if (gateway.phase === 'anonymous') return <Onboarding />
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      {gateway.demoEnabled && route.name !== 'library' ? (
        <div className="banner">Demo devices are loaded. Open a real remote only when its status does not say preview.</div>
      ) : null}
      {route.name === 'library' ? <Library /> : null}
      {route.name === 'setup' ? <Setup /> : null}
      {route.name === 'remote' ? <RemoteScreen /> : null}
      {route.name === 'learn' || route.name === 'settings' || route.name === 'gateway' || route.name === 'diagnostics' ? (
        <More />
      ) : null}
    </Suspense>
  )
}

function UpdatePrompt() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration) return
      if (registration.waiting) setWaiting(registration.waiting)
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker)
        })
      })
    })
  }, [])
  if (!waiting) return null
  return (
    <div className="banner">
      <p>An app update is ready. It will not replace the page during a command.</p>
      {note ? <p>{note}</p> : null}
      <button
        type="button"
        onClick={() => {
          if (commandsActive()) {
            setNote('Finish the button you are holding, then update.')
            return
          }
          waiting.postMessage('skip-waiting')
        }}
      >
        Update
      </button>
    </div>
  )
}
