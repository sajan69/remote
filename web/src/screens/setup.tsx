import { useState } from 'react'
import type { Category, CommandRecord, ConfirmationMode } from '@remote/protocol'
import { AirVent, Fan, Lightbulb, Plus, Projector, Speaker, Tv, TvMinimal, type LucideIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { api, ApiError, type DiscoveryEntity } from '../api.ts'
import { commandText, Header } from '../components.tsx'
import { go } from '../router.ts'
import { useGateway } from '../state.tsx'

const CHOICES: Array<{ id: Category; title: string; detail: string; icon: LucideIcon }> = [
  { id: 'tv', title: 'Television', detail: 'Power, volume, and navigation when the integration advertises them.', icon: Tv },
  { id: 'ac', title: 'Air conditioner', detail: 'Temperature, mode, fan, and swing from a climate entity or protocol profile.', icon: AirVent },
  { id: 'fan', title: 'Fan', detail: 'Power, speed, and oscillation.', icon: Fan },
  { id: 'soundbar', title: 'Soundbar', detail: 'Power, volume, and input.', icon: Speaker },
  { id: 'projector', title: 'Projector', detail: 'Power, input, and navigation when available.', icon: Projector },
  { id: 'set_top_box', title: 'Set-top box', detail: 'Navigation, channels, and playback.', icon: TvMinimal },
  { id: 'light', title: 'Light', detail: 'Power, brightness, and colour temperature when advertised.', icon: Lightbulb },
  { id: 'generic', title: 'Other', detail: 'Only the buttons a profile or bridge actually exposes.', icon: Plus },
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
    <main className="grid gap-5">
      <Header title="Add a device" back />
      {!category ? (
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">What are you controlling?</h2>
          {CHOICES.map((choice) => {
            const Icon = choice.icon
            return (
              <button key={choice.id} type="button" className="text-left" onClick={() => setCategory(choice.id)}>
                <Card className="transition-colors hover:bg-accent">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Icon className="size-4" />
                      {choice.title}
                    </CardTitle>
                    <CardDescription>{choice.detail}</CardDescription>
                  </CardHeader>
                </Card>
              </button>
            )
          })}
        </section>
      ) : null}
      {category && !entity ? (
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">Where does the gateway find it?</h2>
          <p className="text-sm text-muted-foreground">The browser does not scan Bluetooth, infrared, or the whole network. Discovery asks the gateway for integrations it is already allowed to use.</p>
          <Button type="button" disabled={busy} onClick={() => void discover()}>
            {busy ? 'Looking…' : 'Look in Home Assistant'}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void enableDemo()}>
            Preview with demo devices
          </Button>
          <p className="text-sm text-muted-foreground">Demo devices are labelled and never report a real appliance success.</p>
          {matches.length > 0 ? (
            <div className="grid gap-2">
              {matches.map((item) => (
                <button
                  key={item.connectionId}
                  type="button"
                  className="text-left"
                  onClick={() => {
                    setEntity(item)
                    setName(item.name)
                  }}
                >
                  <Card>
                    <CardHeader>
                      <CardTitle>{item.name}</CardTitle>
                      <CardDescription>
                        {item.connectionId}
                        {item.simulated ? ' · Preview' : ''}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </button>
              ))}
            </div>
          ) : null}
          {entities && matches.length === 0 ? <p>No matching devices were advertised. Check the integration, or use a labelled preview.</p> : null}
        </section>
      ) : null}
      {entity && category ? (
        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">{entity.name}</h2>
          <Alert>
            <AlertDescription className="grid gap-2">
              <p>Supported: {entity.capabilities.map((item) => item.label).join(', ') || 'None advertised.'}</p>
              {entity.unsupported.length > 0 ? (
                <ul className="list-disc pl-4">
                  {entity.unsupported.slice(0, 6).map((item) => (
                    <li key={item.id}>
                      {item.label}: {item.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p>No model in this build is lab-verified. A test you confirm is your observation, not a compatibility certificate.</p>
            </AlertDescription>
          </Alert>
          {entity.confirmation === 'transmission_only' && !entity.simulated ? (
            <Label className="flex min-h-11 items-center gap-3">
              <Switch checked={measured} onCheckedChange={setMeasured} />
              The appliance itself reports state. An infrared bridge that only remembers the last command does not.
            </Label>
          ) : null}
          {!entity.simulated ? (
            <div className="grid gap-3">
              <div className="flex gap-2">
                <Button type="button" disabled={busy} onClick={() => void sendTest()}>
                  Send one test
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!testId}
                  onClick={() => {
                    if (testId) void api.cancel(testId).then((result) => setCommand(result.command)).catch((reason: unknown) => {
                      setError(reason instanceof ApiError ? reason.message : 'The test could not be stopped.')
                    })
                  }}
                >
                  Stop
                </Button>
              </div>
              <p className="min-h-6 text-sm" role="status">{commandText(command) || 'One command at a time. Nothing is sent until you ask.'}</p>
              <Button type="button" disabled={!command || !['transmitted', 'appliance_confirmed'].includes(command.status)} onClick={() => void save(true)}>
                It worked — name it
              </Button>
              <Button type="button" variant="ghost" onClick={() => setError('This device is unsupported here until a different integration or profile passes a test.')}>
                This device isn’t supported
              </Button>
            </div>
          ) : (
            <Button type="button" disabled={busy} onClick={() => void save(false)}>
              Add the labelled preview
            </Button>
          )}
          <div className="grid gap-2">
            <Label htmlFor="device-name">Name</Label>
            <Input id="device-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="device-room">Room</Label>
            <Input id="device-room" value={room} onChange={(event) => setRoom(event.target.value)} />
          </div>
        </section>
      ) : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
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
