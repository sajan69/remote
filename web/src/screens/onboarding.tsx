import { Smartphone } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { ApiError } from '../api.ts'
import { useGateway } from '../state.tsx'

export default function Onboarding() {
  const gateway = useGateway()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <main className="grid gap-6">
      <div className="grid gap-2 pt-6">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Smartphone className="size-4" />
          Local gateway
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">Remote</h1>
        <p className="text-muted-foreground">One lightweight remote for the devices this gateway can reach, with the hardware or integration each one needs.</p>
      </div>
      <Alert>
        <AlertTitle>What a phone cannot do</AlertTitle>
        <AlertDescription>
          A browser cannot add an infrared emitter, speak every radio remote, or discover every appliance on the network. Legacy infrared devices need a transmitter bridge. This app sends commands only through the paired gateway.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Pair this phone</CardTitle>
          <CardDescription>The code is printed by the gateway when it starts. It is kept on that computer, not in this page’s address.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
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
            <div className="grid gap-2">
              <Label htmlFor="pairing-code">Pairing code</Label>
              <Input
                id="pairing-code"
                value={code}
                autoComplete="one-time-code"
                inputMode="text"
                spellCheck={false}
                placeholder="ABCD-EFGH"
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
            </div>
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            <Button type="submit" disabled={pending || code.trim().length < 8}>
              {pending ? 'Checking…' : 'Pair this phone'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
