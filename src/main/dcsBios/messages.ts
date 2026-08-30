import type { DcsBiosCommandCatalogEntry, DcsBiosFieldCatalogEntry, DcsBiosStatus, DcsBiosWorkerStats } from '../../shared/dcsBiosTypes'

// CommonData.json's own aircraft id — shared between worker.ts (which
// special-cases it in listAircraft()/handleWrite()'s decode loop, since it's
// exposed as a pickable "aircraft" despite not being one — see
// listAircraft()'s own comment) and connectionManager.ts (which has to
// special-case it too, in its own push-routing — see subscribeAircraft's own
// comment). Lives here, not in either file, so the two special-cases can't
// drift apart from each other.
export const COMMON_DATA_AIRCRAFT_ID = 'CommonData'

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
