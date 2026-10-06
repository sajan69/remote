import { useEffect, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { Header } from '../components.tsx'
import { useRoute } from '../router.ts'
import { useGateway } from '../state.tsx'

export default function More() {
  const route = useRoute()
  if (route.name === 'learn') return <Learn id={route.id} />
  if (route.name === 'gateway') return <GatewayPage />
  if (route.name === 'diagnostics') return <Diagnostics />
  return <Settings />
}

function Settings() {
  const gateway = useGateway()
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  return (
    <main className="stack loose">
      <Header title="Settings" back>
        <span className="icon-button" aria-hidden="true" />
      </Header>
      <label className="field">
        Theme
        <select
          value={gateway.prefs.theme}
          onChange={(event) => void gateway.setPrefs({ theme: event.target.value as 'system' | 'light' | 'dark' })}
        >
          <option value="system">Match this phone</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={gateway.prefs.vibrate}
          onChange={(event) => void gateway.setPrefs({ vibrate: event.target.checked })}
        />
        Vibrate on press when the phone allows it
      </label>
      <a className="choice" href="#/gateway">
        Gateway and Home Assistant
      </a>
      <a className="choice" href="#/diagnostics">
        Diagnostics
      </a>
      <button
        type="button"
        onClick={() => {
          void api.exportConfig().then((config) => {
            const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = 'remote-export.json'
            link.click()
            URL.revokeObjectURL(url)
          })
        }}
      >
        Export configuration
      </button>
      <p className="small muted">Exports omit pairing codes and Home Assistant tokens.</p>
      <button type="button" onClick={() => void gateway.signOut()}>
        Sign out of this phone
      </button>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault()
          void api
            .reset(confirm)
            .then((result) => setMessage(`Gateway reset. New pairing code: ${result.pairingCode}`))
            .catch((reason: unknown) => setMessage(reason instanceof ApiError ? reason.message : 'Reset failed.'))
        }}
      >
        <label className="field">
          Reset the gateway
          <input value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="reset local gateway" />
        </label>
        <button type="submit">Reset local data</button>
      </form>
      <section className="note stack">
        <h2>About this build</h2>
        <p className="small">
          One lightweight remote for your supported devices, with clear setup for the hardware or integration each device needs.
          No model has been lab-verified in this build. A control is shown only when an integration advertises it, and a one-way
          infrared send is never described as a confirmed appliance response.
        </p>
      </section>
      {message ? <p role="status">{message}</p> : null}
    </main>
  )
}

function GatewayPage() {
  const gateway = useGateway()
  const [message, setMessage] = useState<string | null>(gateway.status?.homeAssistant.message ?? null)
  useEffect(() => {
    void api.status().then((status) => setMessage(status.homeAssistant.message)).catch(() => undefined)
  }, [])

  return (
    <main className="stack loose">
      <Header title="Gateway" back />
      <section className="note stack">
        <h2>Home Assistant</h2>
        <p>{message}</p>
        <p className="small muted">
          Set HA_BASE_URL and HA_TOKEN in the gateway environment, then restart it. The token stays on the gateway and is not
          entered in the browser.
        </p>
        <p className="small muted">
          Raw infrared frames also need IR_RAW_DOMAIN, IR_RAW_SERVICE, and IR_RAW_ENTITY_ID pointing at a service you created
          for your bridge. Named remote commands use a Home Assistant remote entity instead.
        </p>
      </section>
      <button
        type="button"
        onClick={() => {
          void api
            .demo(!gateway.demoEnabled)
            .then((result) => {
              gateway.replaceDevices(result.devices, result.demoEnabled)
            })
            .catch((reason: unknown) => setMessage(reason instanceof ApiError ? reason.message : 'Demo mode did not change.'))
        }}
      >
        {gateway.demoEnabled ? 'Remove demo devices' : 'Add labelled demo devices'}
      </button>
      <button type="button" onClick={() => void api.revokeAll().then(() => gateway.reload())}>
        Sign out every phone ({gateway.status?.sessions ?? 0})
      </button>
    </main>
  )
}

function Diagnostics() {
  const [entries, setEntries] = useState<Array<{ id: string; at: string; code: string; message: string }>>([])
  useEffect(() => {
    void api.diagnostics().then((result) => setEntries(result.entries)).catch(() => undefined)
  }, [])
  return (
    <main className="stack loose">
      <Header title="Diagnostics" back />
      {entries.length === 0 ? <p className="muted">No gateway notes yet.</p> : null}
      {entries.slice().reverse().map((entry) => (
        <article key={entry.id} className="note">
          <p className="small muted">{new Date(entry.at).toLocaleString()}</p>
          <p>{entry.message}</p>
        </article>
      ))}
    </main>
  )
}

function Learn({ id }: { id: string }) {
  const gateway = useGateway()
  const device = gateway.devices.find((item) => item.id === id)
  const [capability, setCapability] = useState('volume_up')
  const [commandName, setCommandName] = useState('volume_up')
  const [message, setMessage] = useState<string | null>(null)
  const [testId, setTestId] = useState<string | null>(null)

  if (!device) return <main className="stack"><Header title="Learn" back /><p>That remote is gone.</p></main>
  if (device.category === 'ac' || !device.learnSupported) {
    return (
      <main className="stack">
        <Header title="Learn" back />
        <p>Button learning needs a bridge that supports it. Air-conditioner state is not learned one temperature at a time.</p>
      </main>
    )
  }

  return (
    <main className="stack loose">
      <Header title="Learn a button" back />
      <p className="small muted">Press the original remote once when Home Assistant asks. This app does not keep a copy of the infrared timings; the bridge stores the command.</p>
      <label className="field">
        Button
        <input value={capability} onChange={(event) => setCapability(event.target.value)} />
      </label>
      <label className="field">
        Bridge command name
        <input value={commandName} onChange={(event) => setCommandName(event.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => {
          setMessage('Waiting for the original remote…')
          void api
            .learn(device.id, { capability, commandName })
            .then(() => setMessage('Captured. Send one test before saving it.'))
            .catch((reason: unknown) => setMessage(reason instanceof ApiError ? reason.message : 'Learning failed.'))
        }}
      >
        Learn
      </button>
      <button
        type="button"
        onClick={() => {
          void gateway
            .sendCommand(device, capability, {})
            .then((command) => {
              setTestId(command.id)
              setMessage('Test sent. Save it only if the appliance responded.')
            })
            .catch((reason: unknown) => setMessage(reason instanceof ApiError ? reason.message : 'The test was not sent.'))
        }}
      >
        Send one test
      </button>
      <button
        type="button"
        disabled={!testId}
        onClick={() => {
          void api
            .saveLearned(device.id, { capability, commandName, testCommandId: testId, userConfirmed: true })
            .then(() => setMessage('Saved on this gateway as a learned command.'))
            .catch((reason: unknown) => setMessage(reason instanceof ApiError ? reason.message : 'It was not saved.'))
        }}
      >
        It worked — save
      </button>
      {message ? <p role="status">{message}</p> : null}
    </main>
  )
}
