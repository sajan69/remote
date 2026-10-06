import { useState } from 'react'
import { ApiError } from '../api.ts'
import { useGateway } from '../state.tsx'

export default function Onboarding() {
  const gateway = useGateway()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <main className="stack loose">
      <p className="small muted">Local gateway</p>
      <h1 className="wordmark">Remote</h1>
      <p>One lightweight remote for the devices this gateway can reach, with the hardware or integration each one needs.</p>
      <section className="note stack">
        <h2>What a phone cannot do</h2>
        <p className="small">A browser cannot add an infrared emitter, speak every radio remote, or discover every appliance on the network. Legacy infrared devices need a transmitter bridge. This app sends commands only through the paired gateway.</p>
      </section>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault()
          setPending(true)
          setError(null)
          void gateway
            .pair(code)
            .catch((reason: unknown) => {
              setError(reason instanceof ApiError ? reason.message : 'Pairing did not complete.')
            })
            .finally(() => setPending(false))
        }}
      >
        <label className="field">
          Pairing code
          <input
            value={code}
            autoComplete="one-time-code"
            inputMode="text"
            spellCheck={false}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </label>
        <p className="small muted">The code is printed by the gateway when it starts. It is kept on that computer, not in this page’s address.</p>
        {error ? <p className="danger">{error}</p> : null}
        <button type="submit" disabled={pending || code.trim().length < 8}>
          {pending ? 'Checking…' : 'Pair this phone'}
        </button>
      </form>
    </main>
  )
}
