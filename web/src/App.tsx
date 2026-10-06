import { lazy, Suspense, useEffect, useState } from 'react'
import { commandsActive } from './api.ts'
import { Button } from '@/components/ui/button.tsx'
import { DemoBanner } from './components.tsx'
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
      <a className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground" href="#main">
        Skip to remote
      </a>
      <div className="mx-auto min-h-dvh w-full max-w-115 px-4 pt-[calc(0.875rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]" id="main">
        <UpdatePrompt />
        <Shell />
      </div>
    </GatewayProvider>
  )
}

function Shell() {
  const gateway = useGateway()
  const route = useRoute()
  if (gateway.phase === 'loading') return <p className="text-muted-foreground">Opening the remote…</p>
  if (gateway.phase === 'offline' && gateway.devices.length === 0) {
    return (
      <main className="grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Gateway unreachable</h1>
        <p>{gateway.notice}</p>
        <Button type="button" onClick={() => void gateway.reload()}>
          Try again
        </Button>
      </main>
    )
  }
  if (gateway.phase === 'anonymous') return <Onboarding />
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <div className="grid gap-4">
        {gateway.demoEnabled && route.name !== 'library' ? (
          <DemoBanner>Demo devices are loaded. Open a real remote only when its status does not say preview.</DemoBanner>
        ) : null}
        {route.name === 'library' ? <Library /> : null}
        {route.name === 'setup' ? <Setup /> : null}
        {route.name === 'remote' ? <RemoteScreen /> : null}
        {route.name === 'learn' || route.name === 'settings' || route.name === 'gateway' || route.name === 'diagnostics' ? (
          <More />
        ) : null}
      </div>
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
    <div className="mb-4 grid gap-3">
      <DemoBanner>An app update is ready. It will not replace the page during a command.</DemoBanner>
      {note ? <p className="text-sm">{note}</p> : null}
      <Button
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
      </Button>
    </div>
  )
}
