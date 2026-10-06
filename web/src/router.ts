import { useEffect, useState } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'setup' }
  | { name: 'remote'; id: string }
  | { name: 'learn'; id: string }
  | { name: 'settings' }
  | { name: 'gateway' }
  | { name: 'diagnostics' }

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/'
  if (path.startsWith('/remote/')) return { name: 'remote', id: decodeURIComponent(path.slice('/remote/'.length)) }
  if (path.startsWith('/learn/')) return { name: 'learn', id: decodeURIComponent(path.slice('/learn/'.length)) }
  if (path === '/setup') return { name: 'setup' }
  if (path === '/settings') return { name: 'settings' }
  if (path === '/gateway') return { name: 'gateway' }
  if (path === '/diagnostics') return { name: 'diagnostics' }
  return { name: 'library' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function go(path: string): void {
  window.location.hash = path
}
