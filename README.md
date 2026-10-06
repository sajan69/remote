# Remote

A mobile-first remote for devices a local gateway can actually reach. The phone shows a remote built with Tailwind CSS, shadcn/ui, and Lucide icons. The gateway sends the command through Home Assistant, or through a raw infrared service you configure. Buttons that an integration does not advertise stay unavailable, with a reason.

No television, air conditioner, or bridge has been lab-verified in this build. A preview device is labelled and never reports a real appliance success.

## What you need

- Node.js 22 or newer for local development. `npm run check` uses TypeScript 7. ESLint uses the TypeScript 6 compiler API, because TypeScript 7 does not ship one yet.
- Docker, if you want the one-container install.
- Home Assistant on the same network for real devices.
- An infrared transmitter, such as an ESPHome `remote_transmitter` exposed through Home Assistant, for appliances that only understand infrared.

A browser cannot add an infrared emitter to a phone. Web Bluetooth, WebUSB, and Web Serial are not required.

## Local development

```bash
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. The gateway listens on port 8787 and prints a pairing code. Enter that code in the app. Dev mode uses `COOKIE_SECURE=false` because the page is plain HTTP on localhost.

`npm test` covers encoders, Home Assistant capability mapping, command ordering, and the pairing API. `npm run check` typechecks the app. `npm run build` writes `web/dist` and `gateway/dist/server.js`.

## Docker

```bash
docker compose up --build
```

The container serves the app and the gateway on port 8787. Its data volume keeps the pairing code, sessions, and device list. There is no external database.

On a phone, do not browse past a certificate warning. Put a reverse proxy you trust in front of the container, set `COOKIE_SECURE=true`, and set `PUBLIC_ORIGINS` to that HTTPS origin. Caddy’s internal CA is one option once each phone trusts it:

```
remote.home.arpa {
  tls internal
  reverse_proxy remote:8787
}
```

To upgrade, build the new image, stop the container, and start it again. The volume keeps configuration. To roll back, start the previous image tag with the same volume. If `gateway.json` is ever an unknown schema version, the process exits and leaves the file unchanged.

Health check: `GET /api/health` returns `{ "status": "ok" }` without device names or tokens.

## Home Assistant

Set these on the gateway and restart:

```
HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=your-long-lived-token
```

The token is read from the environment. The browser cannot change it, and exports do not include it. The gateway only calls Home Assistant services for entities it discovered or that you already saved. It is not an open proxy.

Climate and remote entities are treated as one-way until you explicitly say the appliance reports its own state. Home Assistant’s stored state is not treated as proof that an infrared unit moved.

For a raw infrared bridge, also set `IR_RAW_DOMAIN`, `IR_RAW_SERVICE`, and `IR_RAW_ENTITY_ID` to a service you wrote that accepts `timings` and `carrier_frequency`. Named buttons can instead use a Home Assistant `remote` entity and `remote.send_command` / `remote.learn_command`.

`examples/experimental-named-commands.json` is an empty example. It is not a brand code set. Imported profiles are marked experimental. Air-conditioner learning stores a whole validated state with the built-in `ac_state_v1` encoder, not one captured temperature button for every combination.

## Demo mode

Gateway settings can add Demo TV, Demo air conditioner, and Demo fan. A banner stays visible. Those commands finish as “Demo preview” and are never shown as a confirmed appliance response.

## Compatibility

| Model    | Bridge | Browser | Result                              |
| -------- | ------ | ------- | ----------------------------------- |
| None yet | —      | —       | No lab-verified model in this build |

Record the exact television, air conditioner, bridge firmware, browser versions, and which commands passed before calling a model supported.

## Security

- Pairing uses a short code printed on the gateway. Sessions are HttpOnly cookies.
- Mutations require a client header, and browser origins must match the gateway host or `PUBLIC_ORIGINS`.
- Failed pairing is rate limited.
- Commands for one device run in order. An unclear result is not automatically retried.
- Logs redact bearer tokens. Diagnostics keep a short local history.

## Still to decide on real hardware

The first release still needs a specific television, a specific air conditioner, a bridge that can transmit and receive, and a trusted HTTPS name for the phones. Until those are tested, treat every real device as unproven even after a successful button press in the app.
