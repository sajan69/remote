import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { generatePairingCode, hashSecret, type Store } from '../store.ts'

export function resetData(store: Store, dataDir: string): string {
  const pairingCode = generatePairingCode()
  const pairingSalt = crypto.randomBytes(16).toString('hex')
  store.mutate((data) => {
    data.pairingSalt = pairingSalt
    data.pairingHash = hashSecret(pairingCode, pairingSalt)
    data.sessions = []
    data.devices = []
    data.commands = []
    data.profiles = []
    data.diagnostics = []
    data.discovery = []
    data.discoveryAt = null
    data.demoEnabled = false
    data.pendingLearns = []
    data.trialSequences = {}
  })
  fs.writeFileSync(path.join(dataDir, 'pairing-code.txt'), `${pairingCode}\n`, { mode: 0o600 })
  return pairingCode
}
