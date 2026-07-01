// Modbus TCP barrier / relay driver (roadmap §14).
//
// Builds Modbus TCP frames for reading/writing coils — the common pattern for
// parking barrier relays (open/close via coil write). Pure binary encoder +
// decoder; the agent sends frames over TCP. Function codes 01 (read coils),
// 05 (write single coil), 0F (write multiple coils).

export type ModbusFunction = 0x01 | 0x05 | 0x0f;

export interface ModbusFrame {
  transaction: number;
  unit: number;
  function: ModbusFunction;
  data: Uint8Array;
}

const MODBUS_PORT = 502;

/** Build a "write single coil" frame (function 05) — opens/closes a relay. */
export function encodeWriteSingleCoil(transaction: number, unit: number, coil: number, on: boolean): Uint8Array {
  const pdu = new Uint8Array([0x05, (coil >> 8) & 0xff, coil & 0xff, on ? 0xff : 0x00, 0x00]);
  return wrap(transaction, unit, pdu);
}

/** Build a "read coils" frame (function 01). */
export function encodeReadCoils(transaction: number, unit: number, startCoil: number, count: number): Uint8Array {
  const pdu = new Uint8Array([0x01, (startCoil >> 8) & 0xff, startCoil & 0xff, (count >> 8) & 0xff, count & 0xff]);
  return wrap(transaction, unit, pdu);
}

/** Build a "write multiple coils" frame (function 0F). */
export function encodeWriteMultipleCoils(
  transaction: number,
  unit: number,
  startCoil: number,
  values: boolean[],
): Uint8Array {
  const byteCount = Math.ceil(values.length / 8);
  const coilBytes = new Uint8Array(byteCount);
  values.forEach((v, i) => {
    if (v) coilBytes[Math.floor(i / 8)] |= 1 << (i % 8);
  });
  const pdu = new Uint8Array(6 + byteCount);
  pdu[0] = 0x0f;
  pdu[1] = (startCoil >> 8) & 0xff;
  pdu[2] = startCoil & 0xff;
  pdu[3] = (values.length >> 8) & 0xff;
  pdu[4] = values.length & 0xff;
  pdu[5] = byteCount;
  pdu.set(coilBytes, 6);
  return wrap(transaction, unit, pdu);
}

function wrap(transaction: number, unit: number, pdu: Uint8Array): Uint8Array {
  const mbap = new Uint8Array(7);
  mbap[0] = (transaction >> 8) & 0xff;
  mbap[1] = transaction & 0xff;
  mbap[2] = 0; // protocol id
  mbap[3] = 0;
  const length = pdu.byteLength + 1;
  mbap[4] = (length >> 8) & 0xff;
  mbap[5] = length & 0xff;
  mbap[6] = unit & 0xff;
  const out = new Uint8Array(mbap.byteLength + pdu.byteLength);
  out.set(mbap, 0);
  out.set(pdu, mbap.byteLength);
  return out;
}

/** Parse a Modbus TCP response into a frame (or null when malformed). */
export function decodeModbusFrame(buf: Uint8Array): ModbusFrame | null {
  if (buf.byteLength < 8) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const transaction = view.getUint16(0);
  const unit = buf[6];
  const fn = buf[7] as ModbusFunction;
  const data = buf.slice(8);
  return { transaction, unit, function: fn, data };
}

/** Decode the coil bits from a "read coils" response (function 01). */
export function decodeCoilBits(data: Uint8Array, count: number): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < count; i += 1) {
    const byte = data[Math.floor(i / 8)] ?? 0;
    out.push(((byte >> (i % 8)) & 1) === 1);
  }
  return out;
}

/** Barrier relay helper: open (coil on) / close (coil off). */
export function barrierCommand(transaction: number, unit: number, coil: number, open: boolean): Uint8Array {
  return encodeWriteSingleCoil(transaction, unit, coil, open);
}

export const MODBUS_DEFAULT_PORT = MODBUS_PORT;
