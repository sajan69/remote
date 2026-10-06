import { useEffect, useState } from 'react'
import type { DeviceRecord } from '@remote/protocol'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet.tsx'
import { api } from '../../api.ts'

export function DeviceDetails({ device, onSaved }: { device: DeviceRecord; onSaved: (device: DeviceRecord) => void }) {
  const [name, setName] = useState(device.name)
  const [room, setRoom] = useState(device.room)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    setName(device.name)
    setRoom(device.room)
  }, [device.name, device.room])
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline">Name and room</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Name and room</SheetTitle>
          <SheetDescription>This only changes the label in the app.</SheetDescription>
        </SheetHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void api
              .patchDevice(device.id, { name, room })
              .then((result) => {
                onSaved(result.device)
                setMessage('Saved.')
              })
              .catch(() => setMessage('The name was not saved.'))
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="remote-name">Name</Label>
            <Input id="remote-name" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="remote-room">Room</Label>
            <Input id="remote-room" value={room} maxLength={40} onChange={(event) => setRoom(event.target.value)} />
          </div>
          <Button type="submit">Save name and room</Button>
          {message ? <p className="text-sm" role="status">{message}</p> : null}
        </form>
      </SheetContent>
    </Sheet>
  )
}
