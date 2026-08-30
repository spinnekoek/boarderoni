import type { DcsBiosCommandCatalogEntry, DcsBiosFieldCatalogEntry, DcsBiosStatus, DcsBiosWorkerStats } from '../../shared/dcsBiosTypes'

// Passed as workerData on every (re)spawn of the DCS-BIOS worker.
export interface DcsBiosWorkerData {
  docsDir: string
  multicastAddress: string
  multicastPort: number
  // Port "Send DCS command" actions broadcast to — see connectionManager.ts's
  // sendCommand and worker.ts's sendDcsBiosCommand.
  sendPort: number
}

export type DcsBiosWorkerRequest =
  | { type: 'listAircraft' }
  | { type: 'getFieldCatalog'; aircraft: string }
  | { type: 'getCommandCatalog'; aircraft: string }
  | { type: 'registerAircraft'; aircraft: string }
  | { type: 'unregisterAircraft'; aircraft: string }
  | { type: 'sendCommand'; identifier: string; argument: string }

export type DcsBiosWorkerResponse =
  | { type: 'aircraftList'; aircraft: { id: string; name: string }[] }
  | { type: 'fieldCatalog'; fields: DcsBiosFieldCatalogEntry[] }
  | { type: 'commandCatalog'; commands: DcsBiosCommandCatalogEntry[] }
  | { type: 'ack' }

// Unsolicited, pushed from the worker at its own cadence — fields at a
// ~20Hz ceiling (only while something changed), status on change, stats at
// ~1Hz (a live meter, always). See connectionManager.ts for how these get
// demuxed to individual Plugin-instance subscribers.
export type DcsBiosWorkerPush =
  | { kind: 'fields'; activeAircraft: string; updates: Record<string, unknown> }
  | { kind: 'status'; status: DcsBiosStatus }
  | { kind: 'stats'; stats: DcsBiosWorkerStats }
