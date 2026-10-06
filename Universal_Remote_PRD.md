# Universal Remote PWA — Product Requirements Document

Version: 1.0 | Date: 6 October 2026 | Status: Proposed implementation baseline

## 1. Product objective

Create a lightweight, mobile-first universal remote PWA that controls televisions, air conditioners, and other supported remote-operated household devices. Users should open a saved remote and operate it as naturally as its physical counterpart. React, TypeScript, and Vite form the frontend; a small local gateway connects the interface to actual devices when browser APIs are insufficient.

“Universal” means an extensible interface spanning device categories and protocols. It does not mean every appliance is automatically compatible. A device is supported only when its model, connection method, and advertised commands have passed real hardware validation. Every visible production control must issue a real command or explain why it is unavailable.

## 2. Feasibility and product boundary

A PWA cannot add an infrared emitter to a phone or provide general-purpose access to every Bluetooth, RF, or proprietary remote protocol. Legacy infrared devices require an IR transmitter bridge. Learning codes requires a compatible receiver and usually the original remote. RF requires appropriate radio hardware and a supported protocol; rolling-code or encrypted protocols cannot be treated as simple replay codes.

Browser Bluetooth support varies and targets supported BLE GATT services rather than arbitrary Bluetooth remotes. LAN discovery and vendor protocols often require a gateway because browsers do not provide general raw TCP/UDP sockets or unrestricted multicast discovery. A public HTTPS frontend also cannot assume it can access arbitrary HTTP endpoints on a home network; TLS, CORS, local-network permission, and browser behaviour must be validated.

The recommended first release is therefore a PWA plus a local gateway, with Home Assistant as the first integration backend and an ESPHome-compatible IR transmitter/receiver as a reference hardware route. This is an architecture proposal, not a claim that any specific appliance has already been tested.

## 3. Users and main scenarios

- A household member wants TV power, volume, navigation, input, and playback from one screen.
- A user wants AC temperature, mode, fan, swing, and power without locating the original remote.
- A household has several rooms and needs recognisable names, favourites, and fast switching.
- A user has an older fan, projector, soundbar, receiver, or set-top box and needs a compatible code profile or learning workflow.
- A developer wants a reproducible frontend build and a single-command gateway deployment without a mandatory cloud account.

## 4. Goals and measurable targets

These are acceptance targets to measure during implementation, not current results.

| Goal                           | Target                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Lightweight initial load       | Initial route JavaScript ≤150 KB gzip; complete initial app assets ≤300 KB gzip, excluding optional adapter/profile downloads |
| Fast cached startup            | Usable remote within 1 second on the declared reference mid-range phone                                                       |
| Immediate interaction feedback | Visual press feedback within 100 ms                                                                                           |
| Command responsiveness         | Gateway acknowledgement p95 ≤300 ms on the reference LAN; separately measure physical appliance response                      |
| Transport reliability          | ≥99% gateway acknowledgements over 500 commands per supported adapter on a stable reference LAN                               |
| Physical operation             | ≥98% observed intended responses in a documented 100-command test per supported model, with IR placement recorded             |
| Easy access                    | Last-used remote available within two taps from launch                                                                        |
| Easy deployment                | Static frontend build plus one documented gateway container; no required external database                                    |
| Accessibility                  | WCAG 2.2 AA target; primary touch targets ≥44×44 CSS px                                                                       |

## 5. Release scope

### P0 — first functional release

1. Installable PWA, responsive remote screens, cached app shell, and local preferences.
2. Secure gateway pairing, connection diagnostics, and reconnect handling.
3. Home Assistant adapter for selected supported entities and commands.
4. IR TV and AC control through a documented reference bridge integration.
5. Device setup, rooms, favourites, rename, remove, and model/capability validation.
6. TV and AC layouts driven by actual device capabilities.
7. Command lifecycle, honest state confidence, timeouts, and duplicate protection.
8. IR learning for ordinary button commands when the reference hardware supports reception; protocol-aware AC support rather than a promise of arbitrary AC learning.
9. Explicitly isolated demo mode for preview/testing.
10. Hardware-backed verification and reproducible deployment documentation.

First-release hardware gate: validate at least one TV and one AC model through the reference path and one further category, such as a fan or soundbar. Publish exact tested models, bridge firmware, browser versions, and command coverage. A narrower verified list is acceptable; untested brands must not appear as confirmed compatible.

### P1 — expansion

Additional vendor adapters, custom layouts, more verified code profiles, multi-user permissions, simple scenes, and gateway-managed timers. Add a direct BLE adapter only after a specific protocol and browser/device matrix are proven.

### Out of first release

Guaranteed all-brand support, arbitrary RF replay, voice assistants, cloud accounts, billing, background PWA scheduling, and internet-wide device control. Security-sensitive devices such as locks and garage doors require a separate supported integration and product review before inclusion. TV keyboard entry, wake commands, and app launch are optional capabilities, not baseline guarantees.

## 6. Functional requirements

### FR-01: Setup and compatibility

Choose category → connect/pair gateway → discover gateway-visible devices or select model/profile → test commands → name and assign room → save. QR/manual pairing must work when discovery is unavailable. The browser must not pretend to scan every household device itself.

Before setup completes, show required hardware, integration, network conditions, supported controls, and unsupported features. Mark profiles as verified, experimental, learned, or unsupported. Require a successful device-specific test and user confirmation before applying a verified profile to a new device.

For code search, send one user-approved test at a time with a stop option. Do not blast commands across a room automatically. Failure offers another profile, learning where possible, or an explicit unsupported outcome.

### FR-02: Device library

Show device name, category, room, favourite flag, bridge connection, and last known state with timestamp. Support reorder, edit, remove, and remembering the last remote. Device removal must delete app configuration without silently removing vendor integrations or resetting hardware.

### FR-03: Television remote

Support power or power toggle, volume ±, mute, directional pad, OK, back, home, menu, input, channel ±, numeric keypad, and playback controls when exposed by the adapter. Optional app shortcuts and text input appear only if supported.

Hold volume/channel/navigation buttons to repeat at a profile-defined rate. Distinguish the protocol's repeat frame from repeating an initial frame. Stop on pointer release, pointer cancellation, loss of focus, hidden document, disconnect, or bounded hold timeout. Unsupported controls are hidden or disabled with a reason.

### FR-04: Air-conditioner remote

Support power, target temperature, mode, fan speed, and swing according to the exact profile. Respect allowed temperature ranges, increments, units, and mode-dependent restrictions. Separate room temperature from setpoint; never fabricate sensor readings.

AC changes must be sent as a validated complete desired-state command when the protocol requires it. Coalesce rapid temperature taps for roughly 150–250 ms before transmission. Include protocol checksums and required fields through a tested encoder. A captured temperature button cannot be assumed to implement every temperature/mode combination.

Show “last sent settings” for unconfirmed IR state. Reconcile with authoritative device state when available and offer explicit resynchronisation after use of the original remote. Turning a toggle-only appliance “off” cannot be guaranteed from unknown state.

### FR-05: Other device categories

Use capability-based templates: fan (power/speed/oscillation), soundbar/receiver (power/volume/input), projector (power/input/navigation), set-top box (navigation/channel/playback), lights (power/brightness/colour when available), and generic custom buttons. Categories share an interface but require their own verified transport and profile.

### FR-06: Learning and profiles

For supported bridges, capture a button signal, display capture status, test it on the intended device, and save only after confirmation. Store encoding or raw timing, carrier frequency where available, repeat behaviour, source, version, and compatibility metadata. Reject malformed/oversized profiles. Define licensing and provenance before bundling any external code database.

Allow profile export/import without credentials. Learning encrypted/rolling-code RF is unsupported. Learning arbitrary AC state spaces is unsupported unless a complete protocol-aware encoder is provided.

### FR-07: Command and state lifecycle

Each action carries a unique command ID, device ID, capability, arguments, creation time, expiry, and sequence. Distinguish queued locally, gateway accepted, transmitted, appliance confirmed, failed, and outcome unknown. “Transmitted” must never be shown as confirmed appliance success for one-way IR.

Serialise commands per device while allowing independent devices to operate concurrently. Expire ordinary pending commands after a short configurable deadline, default 2 seconds. Deduplicate IDs within the gateway. Never automatically replay power toggles or other non-idempotent commands after an ambiguous timeout; the first transmission may already have succeeded. Persist no offline action queue that can execute unexpectedly on reconnect.

### FR-08: Offline and reconnection

The cached interface and saved remotes remain available without internet after initial loading. Actual control requires a reachable gateway/transport. With WAN unavailable but LAN intact, verified local adapters must still operate. With the gateway unavailable, show disconnected and disable command submission. Reconnect with bounded exponential backoff and refresh capabilities/state before enabling controls. Cloud-dependent adapters display their internet requirement.

### FR-09: Diagnostics and demo

Explain gateway unreachable, pairing rejected, permissions denied, model mismatch, unsupported capability, transmission timeout, and unknown appliance outcome. Maintain a bounded diagnostic log without tokens or unnecessary household details. Demo mode must have a persistent visible label and cannot report simulated appliance operation as real success.

## 7. UX specification

Screens: onboarding, device library, add device, remote, learning/profile setup, gateway management, diagnostics, and settings. Provide a thumb-friendly layout, clear power separation, stable button locations, high contrast, accessible labels, keyboard operation, light/dark themes, and optional vibration only where supported.

The TV directional pad is central; volume and channel controls are distinct. The AC screen emphasises setpoint and mode. On every screen, connection and state confidence are visible without obstructing frequent actions. Technical details belong in setup/diagnostics; normal remote operation should use familiar appliance language.

## 8. Technical architecture

Use React + TypeScript + Vite, Shadcn UI libraries, tailwindcss, IndexedDB for structured configuration, and a small service worker implementation or narrowly configured PWA plugin. Prefer React's built-in state primitives initially; avoid a large component suite, global state framework, or full icon/font bundle. Lazy-load uncommon screens and adapters.

Data path: PWA → same-origin authenticated gateway API → adapter → integration/bridge → appliance. State subscriptions return through the gateway to the PWA. The gateway hosts or reverse-proxies the frontend for the default local deployment, keeping browser-facing communication on one origin.

Use a small Node.js/TypeScript gateway with a REST command/config API and WebSocket events, plus local SQLite or a durable configuration file. Store vendor credentials server-side. Home Assistant's REST/WebSocket APIs are integration interfaces; its state records alone must not be treated as proof that a one-way IR appliance responded. ESPHome native API is not assumed to be a browser HTTP API.

Adapters implement discover, pair, listCapabilities, execute, subscribeState, health, and optional learnSignal. Capability descriptors include allowed values/ranges, toggle vs discrete action, repeat semantics, feedback support, and confirmation semantics. Keep protocol details out of UI components.

### Core data objects

- Device: id, name, room, category, adapterId, connectionId, profileId/version, capability descriptors.
- State: values, source, confidence (confirmed/assumed/unknown), observedAt, lastCommandId.
- Command: id, deviceId, capability, arguments, sequence, expiresAt, lifecycle status, error.
- Profile: category, brand/model claims, provenance/licence, protocol, commands or encoder reference, tested capabilities.
- Gateway connection: endpoint, pairing/session reference, health, protocol version; no exported credentials.

### Proposed gateway endpoints

`POST /api/pair`, `GET /api/devices`, `POST /api/devices`, `PATCH /api/devices/:id`, `DELETE /api/devices/:id`, `GET /api/devices/:id/capabilities`, `POST /api/devices/:id/commands`, `GET /api/commands/:id`, `POST /api/devices/:id/learn`, `GET /api/health`, and `/api/events` for WebSocket updates. These are proposed application APIs, not existing vendor APIs. Return a command receipt followed by lifecycle events rather than a misleading immediate “device succeeded” response.

## 9. Deployment and security

Frontend: reproducible `npm ci`, type checks, and `npm run build` producing static assets. Gateway: one container with persistent config and an environment template. Pin compatible runtime/dependency versions during implementation and include health checks and upgrade/rollback instructions.

Default functional deployment serves frontend and gateway through a trusted HTTPS origin on the local network. Document how phones trust/reach that origin; do not require users to bypass certificate errors. Test service-worker installation and control on actual iOS/Android devices. A hosted static preview is simple, but functional control still needs a secure route to the household gateway. Remote access is optional and requires an authenticated secure access path; never expose an unauthenticated LAN bridge publicly.

Pair via short-lived code/QR, physically initiated or approved on the gateway. Use scoped revocable sessions, HttpOnly/Secure cookies where appropriate, CSRF protection, strict origin checks including WebSocket upgrades, input validation, rate limits, and protected server-side credentials. Avoid embedding vendor tokens in builds or QR URLs. Browser-facing endpoints must not become an arbitrary network proxy: allowlist configured devices and integrations.

Cache versioned shell assets and public profiles; never cache pairing/session responses or command mutations. Prompt before applying a service-worker update during active operation. No analytics by default. Export configuration without secrets and support local reset/session revocation.

## 10. Acceptance tests and release gates

| Scenario                          | Required result                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Real TV buttons                   | Advertised commands visibly operate the tested TV; command evidence is recorded                     |
| Held volume/navigation            | Correct repeat behaviour; stops on release, cancellation, tab hiding, and disconnect                |
| AC settings                       | Supported mode/temperature/fan/swing combinations encode correctly and operate the test AC          |
| Original remote changes appliance | Feedback reconciles where available; otherwise UI preserves assumed/unknown state                   |
| One-way IR                        | UI reports transmission without claiming observed appliance state                                   |
| Bridge unplugged                  | Controls cannot report success; clear recovery path appears                                         |
| Ambiguous toggle timeout          | No automatic retry or delayed replay occurs                                                         |
| Rapid commands                    | Per-device order preserved; AC taps coalesced; duplicates suppressed                                |
| Internet disconnected             | Cached app loads and local control works when LAN/gateway remain reachable                          |
| Phone network lost                | No stale command queue executes when connectivity returns                                           |
| Profile import                    | Invalid data rejected; valid profile can be tested before activation                                |
| Permissions/browser limitations   | Explicit guidance or supported gateway fallback; no fake connection                                 |
| Deployment                        | New machine can deploy from README and pass health/pairing/control smoke test                       |
| Security                          | Unpaired clients rejected; tokens excluded from exports/logs; disallowed origins/endpoints rejected |
| Performance/accessibility         | Bundle budgets and reference-device targets met; keyboard/screen-reader checks pass                 |

Browser matrix: current stable Chrome on Android, Safari on iOS, and desktop Chrome, Safari, Firefox, and Edge, with exact tested versions recorded. Verify installed and browser modes independently on mobile. Core gateway control must not depend on Web Bluetooth, WebUSB, or Web Serial support. Test pairing persistence, background/foreground return, gateway restart, and state refresh across two clients.

Use unit tests for encoders, capability validation, ordering/deduplication, and state confidence; integration tests for real adapter contracts; browser tests for setup and remote interaction; hardware-in-the-loop tests for physical behaviour. A mock-only demonstration does not satisfy release acceptance.

## 11. Delivery sequence

1. Feasibility spike: identify the exact TV, AC, bridge, and integrations; prove one actual command from each through the intended secure browser/gateway route. This gates further implementation.
2. Foundation: repository, adapter contract, secure pairing, device configuration, PWA shell, and local deployment.
3. Functional remotes: TV/AC layouts, actual adapters, state lifecycle, holds, repeats, diagnostics, and offline behaviour.
4. Generic category and learning: one additional tested category, ordinary IR learning, versioned profiles, import/export.
5. Release hardening: browser/hardware matrix, accessibility, performance, security, deployment rehearsal, compatibility documentation.

Do not set a delivery date until the feasibility spike identifies hardware availability, protocol complexity, and verified integration coverage.

## 12. Decisions to resolve before implementation

- Which exact TV and AC models will be first-release reference devices?
- Is an always-on Home Assistant host available, or must the deployment supply the entire local integration stack?
- Which IR bridge provides both transmission and reception, and in how many rooms?
- Is local-only operation sufficient, or is authenticated away-from-home control required?
- Which distribution route provides trusted HTTPS on the target household phones?
- Which code/profile sources have acceptable licences and provenance?

Until resolved, assume local-first operation, optional dedicated IR hardware, Home Assistant as the first backend, no mandatory cloud account, and explicit per-model compatibility.

## 13. Definition of done

A deployable PWA and gateway; real operation of the declared TV, AC, and additional category; verified compatibility and browser matrices; passing command/state/offline acceptance tests; documented hardware/pairing/HTTPS setup; no simulated production controls; reproducible builds and rollback instructions. The user-facing promise is: “One lightweight remote for your supported devices, with clear setup for the hardware or integration each device needs.”

## 14. Technical references

Checked 6 October 2026. These establish platform/integration constraints; they do not certify any appliance model.

- MDN — Web Bluetooth API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
- Chrome — Local Network Access: https://developer.chrome.com/blog/local-network-access
- ESPHome — Remote Transmitter: https://esphome.io/components/remote_transmitter/
- ESPHome — IR Remote Climate: https://esphome.io/components/climate/climate_ir/
- Home Assistant — REST API: https://developers.home-assistant.io/docs/api/rest/
- Home Assistant — WebSocket API: https://developers.home-assistant.io/docs/api/websocket/
