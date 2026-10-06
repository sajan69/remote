import type { Category, DeviceRecord } from '@remote/protocol'
import { AirVent, ChevronDown, ChevronUp, Fan, Lightbulb, Plus, Projector, Speaker, Star, Tv, TvMinimal, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { api } from '../api.ts'
import { DemoBanner, Header, confidenceLabel } from '../components.tsx'
import { useGateway } from '../state.tsx'

const LABELS: Record<Category, string> = {
  tv: 'Television',
  ac: 'Air conditioner',
  fan: 'Fan',
  soundbar: 'Soundbar',
  projector: 'Projector',
  set_top_box: 'Set-top box',
  light: 'Light',
  generic: 'Other',
}

const ICONS: Record<Category, LucideIcon> = {
  tv: Tv,
  ac: AirVent,
  fan: Fan,
  soundbar: Speaker,
  projector: Projector,
  set_top_box: TvMinimal,
  light: Lightbulb,
  generic: Plus,
}

export function Library() {
  const gateway = useGateway()
  const last = gateway.devices.find((device) => device.id === gateway.prefs.lastDeviceId) ?? gateway.devices[0]
  const rest = gateway.devices.filter((device) => device.id !== last?.id)
  const ordered = [...rest].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.sortIndex - b.sortIndex)

  return (
    <main className="grid gap-5">
      <Header title="Remote" />
      {gateway.demoEnabled ? <DemoBanner>Demo devices are in this library. They do not control a real appliance.</DemoBanner> : null}
      {gateway.notice ? <p className="rounded-2xl border bg-card p-4 text-sm">{gateway.notice}</p> : null}
      {gateway.devices.length === 0 ? (
        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">No remotes yet</h2>
          <p className="text-muted-foreground">Add one when the gateway can see it, or open a labelled preview if you only want to try the layout.</p>
          <a className="rounded-2xl border bg-card p-5" href="#/setup">
            <strong className="flex items-center gap-2 text-lg">
              <Plus className="size-5" />
              Add a device
            </strong>
            <span className="mt-1 block text-sm text-muted-foreground">The phone does not scan the room by itself.</span>
          </a>
        </section>
      ) : (
        <section className="grid gap-4">
          {last ? <DeviceLink device={last} hero /> : null}
          {ordered.map((device) => (
            <DeviceLink key={device.id} device={device} />
          ))}
          <Button variant="outline" asChild>
            <a href="#/setup">
              <Plus />
              Add a device
            </a>
          </Button>
        </section>
      )}
    </main>
  )
}

function seen(device: DeviceRecord): string {
  if (!device.state.observedAt) return 'No reading yet'
  const date = new Date(device.state.observedAt)
  if (Number.isNaN(date.getTime())) return 'No reading yet'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function DeviceLink({ device, hero = false }: { device: DeviceRecord; hero?: boolean }) {
  const Icon = ICONS[device.category]
  return (
    <article className="grid gap-2">
      <a href={`#/remote/${device.id}`}>
        <Card className={hero ? 'border-primary/50 bg-primary/5' : undefined}>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Icon className="size-4" />
              {hero ? 'Continue' : device.room}
              {device.favorite ? <Star className="size-3.5 fill-primary text-primary" /> : null}
            </CardDescription>
            <CardTitle className={hero ? 'text-2xl' : undefined}>{device.name}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              <span>{LABELS[device.category]}</span>
              <Badge variant={device.simulated ? 'warn' : 'secondary'}>{device.simulated ? 'Preview' : 'Gateway'}</Badge>
              <Badge variant="outline">{confidenceLabel(device.state)}</Badge>
              <span>{seen(device)}</span>
            </CardDescription>
          </CardHeader>
        </Card>
      </a>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="icon" aria-label="Move up" onClick={() => void api.patchDevice(device.id, { move: 'up' })}>
          <ChevronUp />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Move down" onClick={() => void api.patchDevice(device.id, { move: 'down' })}>
          <ChevronDown />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label={device.favorite ? 'Unfavourite' : 'Favourite'} onClick={() => void api.patchDevice(device.id, { favorite: !device.favorite })}>
          <Star className={device.favorite ? 'fill-primary text-primary' : undefined} />
        </Button>
      </div>
    </article>
  )
}
