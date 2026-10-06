import { useEffect, useState } from 'react';
import { Activity, Download, LogOut, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Select } from '@/components/ui/select.tsx';
import { Separator } from '@/components/ui/separator.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { api, ApiError } from '../api.ts';
import { Header } from '../components.tsx';
import { useRoute } from '../router.ts';
import { useGateway } from '../state.tsx';

export default function More() {
  const route = useRoute();
  if (route.name === 'learn') return <Learn id={route.id} />;
  if (route.name === 'gateway') return <GatewayPage />;
  if (route.name === 'diagnostics') return <Diagnostics />;
  return <Settings />;
}

function Settings() {
  const gateway = useGateway();
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  return (
    <main className="grid gap-5">
      <Header title="Settings" back settings={false} />
      <div className="grid gap-2">
        <Label htmlFor="theme">Theme</Label>
        <Select
          id="theme"
          value={gateway.prefs.theme}
          onChange={(event) =>
            void gateway.setPrefs({ theme: event.target.value as 'system' | 'light' | 'dark' })
          }
        >
          <option value="system">Match this phone</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </Select>
      </div>
      <Label className="flex min-h-11 items-center justify-between gap-3">
        Vibrate on press when the phone allows it
        <Switch
          checked={gateway.prefs.vibrate}
          onCheckedChange={(checked) => void gateway.setPrefs({ vibrate: checked })}
        />
      </Label>
      <Separator />
      <Button variant="outline" asChild>
        <a href="#/gateway">
          <Radio />
          Gateway and Home Assistant
        </a>
      </Button>
      <Button variant="outline" asChild>
        <a href="#/diagnostics">
          <Activity />
          Diagnostics
        </a>
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          void api.exportConfig().then((config) => {
            const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'remote-export.json';
            link.click();
            URL.revokeObjectURL(url);
          });
        }}
      >
        <Download />
        Export configuration
      </Button>
      <p className="text-sm text-muted-foreground">
        Exports omit pairing codes and Home Assistant tokens.
      </p>
      <Button type="button" variant="outline" onClick={() => void gateway.signOut()}>
        <LogOut />
        Sign out of this phone
      </Button>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void api
            .reset(confirm)
            .then((result) => setMessage(`Gateway reset. New pairing code: ${result.pairingCode}`))
            .catch((reason: unknown) =>
              setMessage(reason instanceof ApiError ? reason.message : 'Reset failed.'),
            );
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="reset-phrase">Reset the gateway</Label>
          <Input
            id="reset-phrase"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="reset local gateway"
          />
        </div>
        <Button type="submit" variant="destructive">
          Reset local data
        </Button>
      </form>
      <Card>
        <CardHeader>
          <CardTitle>About this build</CardTitle>
          <CardDescription>
            One lightweight remote for your supported devices, with clear setup for the hardware or
            integration each device needs. No model has been lab-verified in this build. A control
            is shown only when an integration advertises it, and a one-way infrared send is never
            described as a confirmed appliance response.
          </CardDescription>
        </CardHeader>
      </Card>
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}

function GatewayPage() {
  const gateway = useGateway();
  const [message, setMessage] = useState<string | null>(
    gateway.status?.homeAssistant.message ?? null,
  );
  useEffect(() => {
    void api
      .status()
      .then((status) => setMessage(status.homeAssistant.message))
      .catch(() => undefined);
  }, []);

  return (
    <main className="grid gap-5">
      <Header title="Gateway" back />
      <Card>
        <CardHeader>
          <CardTitle>Home Assistant</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground">
          <p>
            Set HA_BASE_URL and HA_TOKEN in the gateway environment, then restart it. The token
            stays on the gateway and is not entered in the browser.
          </p>
          <p>
            Raw infrared frames also need IR_RAW_DOMAIN, IR_RAW_SERVICE, and IR_RAW_ENTITY_ID
            pointing at a service you created for your bridge. Named remote commands use a Home
            Assistant remote entity instead.
          </p>
        </CardContent>
      </Card>
      <Button
        type="button"
        onClick={() => {
          void api
            .demo(!gateway.demoEnabled)
            .then((result) => {
              gateway.replaceDevices(result.devices, result.demoEnabled);
            })
            .catch((reason: unknown) =>
              setMessage(reason instanceof ApiError ? reason.message : 'Demo mode did not change.'),
            );
        }}
      >
        {gateway.demoEnabled ? 'Remove demo devices' : 'Add labelled demo devices'}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => void api.revokeAll().then(() => gateway.reload())}
      >
        Sign out every phone ({gateway.status?.sessions ?? 0})
      </Button>
    </main>
  );
}

function Diagnostics() {
  const [entries, setEntries] = useState<
    Array<{ id: string; at: string; code: string; message: string }>
  >([]);
  useEffect(() => {
    void api
      .diagnostics()
      .then((result) => setEntries(result.entries))
      .catch(() => undefined);
  }, []);
  return (
    <main className="grid gap-4">
      <Header title="Diagnostics" back />
      {entries.length === 0 ? <p className="text-muted-foreground">No gateway notes yet.</p> : null}
      {entries
        .slice()
        .reverse()
        .map((entry) => (
          <Card key={entry.id}>
            <CardHeader>
              <CardDescription>{new Date(entry.at).toLocaleString()}</CardDescription>
              <CardTitle className="text-base font-normal">{entry.message}</CardTitle>
            </CardHeader>
          </Card>
        ))}
    </main>
  );
}

function Learn({ id }: { id: string }) {
  const gateway = useGateway();
  const device = gateway.devices.find((item) => item.id === id);
  const [capability, setCapability] = useState('volume_up');
  const [commandName, setCommandName] = useState('volume_up');
  const [message, setMessage] = useState<string | null>(null);
  const [testId, setTestId] = useState<string | null>(null);

  if (!device)
    return (
      <main className="grid gap-4">
        <Header title="Learn" back />
        <p>That remote is gone.</p>
      </main>
    );
  if (device.category === 'ac' || !device.learnSupported) {
    return (
      <main className="grid gap-4">
        <Header title="Learn" back />
        <p>
          Button learning needs a bridge that supports it. Air-conditioner state is not learned one
          temperature at a time.
        </p>
      </main>
    );
  }

  return (
    <main className="grid gap-4">
      <Header title="Learn a button" back />
      <p className="text-sm text-muted-foreground">
        Press the original remote once when Home Assistant asks. This app does not keep a copy of
        the infrared timings; the bridge stores the command.
      </p>
      <div className="grid gap-2">
        <Label htmlFor="learn-button">Button</Label>
        <Input
          id="learn-button"
          value={capability}
          onChange={(event) => setCapability(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="learn-command">Bridge command name</Label>
        <Input
          id="learn-command"
          value={commandName}
          onChange={(event) => setCommandName(event.target.value)}
        />
      </div>
      <Button
        type="button"
        onClick={() => {
          setMessage('Waiting for the original remote…');
          void api
            .learn(device.id, { capability, commandName })
            .then(() => setMessage('Captured. Send one test before saving it.'))
            .catch((reason: unknown) =>
              setMessage(reason instanceof ApiError ? reason.message : 'Learning failed.'),
            );
        }}
      >
        Learn
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          void gateway
            .sendCommand(device, capability, {})
            .then((command) => {
              setTestId(command.id);
              setMessage('Test sent. Save it only if the appliance responded.');
            })
            .catch((reason: unknown) =>
              setMessage(reason instanceof ApiError ? reason.message : 'The test was not sent.'),
            );
        }}
      >
        Send one test
      </Button>
      <Button
        type="button"
        disabled={!testId}
        onClick={() => {
          void api
            .saveLearned(device.id, {
              capability,
              commandName,
              testCommandId: testId,
              userConfirmed: true,
            })
            .then(() => setMessage('Saved on this gateway as a learned command.'))
            .catch((reason: unknown) =>
              setMessage(reason instanceof ApiError ? reason.message : 'It was not saved.'),
            );
        }}
      >
        It worked — save
      </Button>
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
