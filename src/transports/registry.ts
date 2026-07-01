// Transport registry — maps a TransportAddress.kind to a factory.
//
// Drivers ask for a transport by address; the registry instantiates the right
// class (TCP, UDP, serial, HID, raw-USB, mock). This is the single place that
// knows how to build a transport, so adding a new bus is one entry here and
// zero changes in capability drivers (Open/Closed).

import { LoopbackTransport, StubTransport } from './mock';
import { SerialTransport } from './serial';
import { TcpTransport } from './tcp';
import { UdpTransport } from './udp';
import type { Transport, TransportAddress, TransportFactory, TransportHealth } from './types';
import { UsbHidTransport } from './usb-hid';
import { UsbRawTransport } from './usb-raw';

const factories = new Map<string, TransportFactory>();

export function registerTransportFactory(kind: string, factory: TransportFactory): void {
  factories.set(kind, factory);
}

/** Resolve a transport for an address; throws nothing, returns a transport that
 *  will report offline when its bus/native addon is unavailable. Registered
 *  factories take precedence over built-ins so tests can override a kind with a
 *  loopback/stub without touching driver code. */
export function createTransport(address: TransportAddress): Transport {
  const override = factories.get(address.kind);
  if (override) return override.create(address);
  switch (address.kind) {
    case 'tcp':
      return new TcpTransport(address);
    case 'udp':
      return new UdpTransport(address);
    case 'serial':
      return new SerialTransport(address);
    case 'usb-hid':
      return new UsbHidTransport(address);
    case 'usb-raw':
      return new UsbRawTransport(address);
    case 'http':
      // HTTP is handled at the driver level via fetch; expose a stub transport.
      return new StubTransport(address, { online: true, error: false, label: 'Hazır' });
    default: {
      const f = factories.get(address.kind);
      if (f) return f.create(address);
      return new StubTransport(address, { online: false, error: true, label: 'Bilinmeyen taşıyıcı' });
    }
  }
}

/** Test helper: build a linked loopback pair for two addresses. */
export function createLoopbackPair(
  a: TransportAddress,
  b: TransportAddress,
): [LoopbackTransport, LoopbackTransport] {
  return LoopbackTransport.pair(a, b);
}

/** Test helper: clear all registered factory overrides. */
export function clearTransportOverrides(): void {
  factories.clear();
}

export type { Transport, TransportAddress, TransportHealth };
