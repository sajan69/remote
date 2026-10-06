import { useState } from 'react'
import type { Category, ConfirmationMode } from '@remote/protocol'
import { api, ApiError, type DiscoveryEntity } from '../api.ts'
import { commandText, Header } from '../components.tsx'
import { go } from '../router.ts'
import { useGateway } from '../state.tsx'
import type { CommandRecord } from '@remote/protocol'

const CHOICES: Array<{ id: Category; title: string; detail: string }> = [
  { id: 'tv', title: 'Television', detail: 'Power, volume, and navigation when the integration advertises them.' },
  { id: 'ac', title: 'Air conditioner', detail: 'Temperature, mode, fan, and swing from a climate entity or protocol profile.' },
  { id: 'fan', title: 'Fan', detail: 'Power, speed, and oscillation.' },
  { id: 'soundbar', title: 'Soundbar', detail: 'Power, volume, and input.' },
  { id: 'projector', title: 'Projector', detail: 'Power, input, and navigation when available.' },
  { id: 'set_top_box', title: 'Set-top box', detail: 'Navigation, channels, and playback.' },
  { id: 'light', title: 'Light', detail: 'Power, brightness, and colour temperature when advertised.' },
  { id: 'generic', title: 'Other', detail: 'Only the buttons a profile or bridge actually exposes.' },
]

export default function Setup() {
  const gateway = useGateway()
  const [category, setCategory] = useState<Category | null>(null)
  const [entities, setEntities] = useState<DiscoveryEntity[] | null>(null)
  const [entity, setEntity] = useState<DiscoveryEntity | null>(null)
  const [measured, setMeasured] = useState(false)
  const [command, setCommand] = useState<CommandRecord | null>(null)
  const [testId, setTestId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [room, setRoom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const matches = entities?.filter((item) => category && item.allowedCategories.includes(category)) ?? []

  async function discover() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.discover()
      setEntities(result.entities)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Discovery failed.')
    } finally {
      setBusy(false)
    }
  }

  async function enableDemo() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.demo(true)
      gateway.replaceDevices(result.devices, result.demoEnabled)
      go('#/')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Demo mode did not start.')
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    if (!entity) return
    const capability = entity.capabilities.find((item) => item.available)
    if (!capability) {
      setError('This integration did not advertise a control to test.')
      return
    }
    setBusy(true)
    setError(null)
    const id = crypto.randomUUID()
    setTestId(id)
    try {
      const args = argumentsFor(capability)
      const result = await api.trial({ connectionId: entity.connectionId, capability: capability.id, arguments: args, id })
      setCommand(result.command)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'The test was not sent.')
    } finally {
      setBusy(false)
    }
  }

  async function save(userConfirmed: boolean) {
    if (!entity || !category) return
    setBusy(true)
    setError(null)
    const confirmation: ConfirmationMode = measured && entity.confirmation === 'transmission_only' ? 'state' : entity.confirmation
    try {
      await api.createDevice({
        connectionId: entity.connectionId,
        category,
        name: name || entity.name,
        room: room || 'Home',
        confirmation,
        acknowledgeMeasuredState: measured,
        acknowledgeDemo: entity.simulated,
        userConfirmed,
        testCommandId: testId,
      })
      go('#/')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'The remote was not saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="stack loose">
      <Header title="Add a device" back />
      {!category ? (
        <section className="stack">
          <h2>What are you controlling?</h2>
          {CHOICES.map((choice) => (
            <button key={choice.id} type="button" className="choice" onClick={() => setCategory(choice.id)}>
              <strong>{choice.title}</strong>
              <span className="small muted">{choice.detail}</span>
            </button>
          ))}
        </section>
      ) : null}
      {category && !entity ? (
        <section className="stack">
          <h2>Where does the gateway find it?</h2>
          <p className="small muted">The browser does not scan Bluetooth, infrared, or the whole network. Discovery asks the gateway for integrations it is already allowed to use.</p>
          <button type="button" disabled={busy} onClick={() => void discover()}>
            {busy ? 'Looking…' : 'Look in Home Assistant'}
          </button>
          <button type="button" disabled={busy} onClick={() => void enableDemo()}>
            Preview with demo devices
          </button>
          <p className="small muted">Demo devices are labelled and never report a real appliance success.</p>
          {matches.length > 0 ? (
            <div className="stack">
              {matches.map((item) => (
                <button
                  key={item.connectionId}
                  type="button"
                  className="choice"
                  onClick={() => {
                    setEntity(item)
                    setName(item.name)
                  }}
                >
                  <strong>{item.name}</strong>
                  <span className="small muted">
                    {item.connectionId}
                    {item.simulated ? ' · Preview' : ''}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {entities && matches.length === 0 ? <p>No matching devices were advertised. Check the integration, or use a labelled preview.</p> : null}
        </section>
      ) : null}
      {entity && category ? (
        <section className="stack">
          <h2>{entity.name}</h2>
          <div className="note stack">
            <p>Supported: {entity.capabilities.map((item) => item.label).join(', ') || 'None advertised.'}</p>
            {entity.unsupported.length > 0 ? (
              <ul>
                {entity.unsupported.slice(0, 6).map((item) => (
                  <li key={item.id}>
                    {item.label}: {item.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="small">No model in this build is lab-verified. A test you confirm is your observation, not a compatibility certificate.</p>
          </div>
          {entity.confirmation === 'transmission_only' && !entity.simulated ? (
            <label className="row">
              <input type="checkbox" checked={measured} onChange={(event) => setMeasured(event.target.checked)} />
              The appliance itself reports state. An infrared bridge that only remembers the last command does not.
            </label>
          ) : null}
          {!entity.simulated ? (
            <div className="stack">
              <div className="row">
                <button type="button" disabled={busy} onClick={() => void sendTest()}>
                  Send one test
                </button>
                <button
                  type="button"
                  disabled={!testId}
                  onClick={() => {
                    if (testId) void api.cancel(testId).then((result) => setCommand(result.command)).catch((reason: unknown) => {
                      setError(reason instanceof ApiError ? reason.message : 'The test could not be stopped.')
                    })
                  }}
                >
                  Stop
                </button>
              </div>
              <p className="live" role="status">{commandText(command) || 'One command at a time. Nothing is sent until you ask.'}</p>
              <button type="button" disabled={!command || !['transmitted', 'appliance_confirmed'].includes(command.status)} onClick={() => void save(true)}>
                It worked — name it
              </button>
              <button type="button" onClick={() => setError('This device is unsupported here until a different integration or profile passes a test.')}>
                This device isn’t supported
              </button>
            </div>
          ) : (
            <button type="button" disabled={busy} onClick={() => void save(false)}>
              Add the labelled preview
            </button>
          )}
          <label className="field">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            Room
            <input value={room} onChange={(event) => setRoom(event.target.value)} />
          </label>
        </section>
      ) : null}
      {error ? <p className="danger" role="alert">{error}</p> : null}
    </main>
  )
}

function argumentsFor(capability: DiscoveryEntity['capabilities'][number]): Record<string, unknown> {
  if (capability.kind === 'toggle') return { value: true }
  if (capability.kind === 'range') return { value: capability.range?.min ?? 1 }
  if (capability.kind === 'enum') return { value: capability.enumValues?.[0] ?? '' }
  if (capability.kind === 'state') {
    const args: Record<string, unknown> = {}
    for (const field of capability.stateFields ?? []) {
      if (field.kind === 'boolean') args[field.id] = true
      if (field.kind === 'number') args[field.id] = field.min ?? 0
      if (field.kind === 'enum') args[field.id] = field.values?.[0]
    }
    return args
  }
  return {}
}
