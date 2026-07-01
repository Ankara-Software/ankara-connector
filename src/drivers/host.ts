// Driver host builder — single registration point for all capability drivers.
//
// `buildDriverHost()` constructs a fresh `DriverHost` and registers every
// available driver (POS Wave-0 base drivers + protocol drivers from Phase 1).
// Kept in one place so the agent, pairing, heartbeat, and status server all
// agree on the same capability surface. Protocol drivers register themselves
// only when their config/native addon is present, so an agent without a
// configured RFID reader never advertises `rfid.uhf`.

import { DriverHost, type ICapabilityDriver } from '../driver-host';
import { baseDrivers } from './base';
import { protocolDrivers } from './protocol';

/**
 * Build a DriverHost with every driver the agent currently supports. Fresh
 * per call so config changes (printer set, RFID reader configured) are picked
 * up without restarting the agent.
 */
export function buildDriverHost(): DriverHost {
  const host = new DriverHost();
  for (const d of baseDrivers) host.register(d);
  for (const d of protocolDrivers) host.register(d);
  return host;
}

/** All registered drivers (for diagnostics / selftest listing). */
export function allDrivers(): ICapabilityDriver[] {
  return [...baseDrivers, ...protocolDrivers];
}

export type { ICapabilityDriver };
