// Driver host — plugin architecture + per-device isolation (roadmap §34,
// enterprise §3 Open/Closed + §5 thread isolation).
//
// Ports the @ankara/connector-driver-sdk contract from the fullstack monorepo
// into the native agent and adds an agent-facing `ICapabilityDriver` layer that
// maps a panel `CommandMessage` to a driver handler. The agent owns one
// `DriverHost`; new hardware support is "register one driver class" — the core
// command router never changes. Each bound device runs on its own
// serialized queue so a slow/hung device never blocks another (enterprise §5).

import type { Capability, CommandMessage } from './protocol';
import type { CommandHandler } from './status';
import type { TransportAddress } from './transports/types';

export interface DiscoveredDevice {
  id: string;
  label: string;
  capability: Capability;
  address: TransportAddress;
}

export interface DeviceHealth {
  online: boolean;
  error: boolean;
  label: string;
  detail?: Record<string, unknown>;
}

/**
 * Agent-facing capability driver. One per capability class (printer.escpos,
 * barrier.relay, rfid.uhf, ...). Implements Open/Closed: add a new driver,
 * register it with `DriverHost.register`, and the panel immediately sees the
 * new capability — no edits to the command router.
 */
export interface ICapabilityDriver {
  readonly id: string;
  readonly capability: Capability;
  readonly label: string;
  /** True when the hardware/config for this driver is currently available. */
  isAvailable(): boolean;
  /** Handle a panel command for this capability. */
  handle: CommandHandler;
  /** Optional LAN/USB discovery (mDNS/ONVIF/serial enumeration). */
  discover?(): Promise<DiscoveredDevice[]>;
  /** Optional aggregate health for all bound devices of this driver. */
  health?(): Promise<DeviceHealth[]>;
}

/**
 * Low-level device worker contract (mirrors @ankara/connector-driver-sdk).
 * One worker per bound physical device; commands are serialized per worker so
 * each device has its own FIFO queue (enterprise §5).
 */
export interface IDeviceWorker {
  readonly address: TransportAddress;
  open(): Promise<boolean>;
  execute(cmd: { id: string; action: string; payload?: unknown }): Promise<{ ok: boolean; payload?: unknown; error?: { code: string; message: string } }>;
  health(): Promise<DeviceHealth>;
  close(): Promise<void>;
}

export type DriverRegistry = ReadonlyMap<Capability, ICapabilityDriver>;

/**
 * The agent's driver registry + command router. The status server asks
 * `host.handlerFor(cap)` for each incoming command; the host resolves the
 * registered driver and returns its handler (or null when unavailable).
 */
export class DriverHost {
  private readonly drivers = new Map<Capability, ICapabilityDriver>();

  register(driver: ICapabilityDriver): void {
    this.drivers.set(driver.capability, driver);
  }

  registry(): DriverRegistry {
    return this.drivers;
  }

  driverFor(cap: Capability): ICapabilityDriver | null {
    return this.drivers.get(cap) ?? null;
  }

  list(): ICapabilityDriver[] {
    return [...this.drivers.values()];
  }

  /** Capabilities advertised to the panel = available drivers, in registration order. */
  advertisedCapabilities(): Capability[] {
    return this.list().filter((d) => d.isAvailable()).map((d) => d.capability);
  }

  /** Resolve a command handler for a capability (null when no available driver). */
  handlerFor(cap: Capability): CommandHandler | null {
    const d = this.driverFor(cap);
    if (!d || !d.isAvailable()) return null;
    return d.handle;
  }

  /** Run discovery across all registered drivers that support it. */
  async discoverAll(): Promise<DiscoveredDevice[]> {
    const out: DiscoveredDevice[] = [];
    for (const d of this.list()) {
      if (d.discover) out.push(...(await d.discover().catch(() => [])));
    }
    return out;
  }

  /** Aggregate health across all drivers (for the status page / heartbeat). */
  async healthAll(): Promise<{ capability: Capability; devices: DeviceHealth[] }[]> {
    const out: { capability: Capability; devices: DeviceHealth[] }[] = [];
    for (const d of this.list()) {
      if (d.health) out.push({ capability: d.capability, devices: await d.health().catch(() => []) });
    }
    return out;
  }
}

/** Build a command-handler-compatible error result from a raw error code. */
export function driverError(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

/** Convenience: wrap an async handler that may throw into a CommandHandler. */
export function safeHandler(
  fn: (cmd: CommandMessage) => Promise<{ payload?: unknown; error?: { code: string; message: string } }>,
): CommandHandler {
  return async (cmd) => {
    try {
      return await fn(cmd);
    } catch (e) {
      return { error: { code: 'device_error', message: (e as Error).message } };
    }
  };
}
