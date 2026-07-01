import { describe, expect, test } from 'bun:test';

import { barrierCommand, decodeCoilBits, decodeModbusFrame, encodeReadCoils, encodeWriteMultipleCoils, encodeWriteSingleCoil } from './modbus';

describe('modbus', () => {
  test('write single coil builds MBAP + PDU', () => {
    const f = encodeWriteSingleCoil(7, 1, 2, true);
    expect(f.byteLength).toBe(12);
    expect(f[0]).toBe(0); // tx hi
    expect(f[1]).toBe(7); // tx lo
    expect(f[2]).toBe(0); // protocol
    expect(f[6]).toBe(1); // unit
    expect(f[7]).toBe(0x05); // function
    // coil 2 = 0x0002, ON = 0xFF00
    expect(f[8]).toBe(0); expect(f[9]).toBe(2);
    expect(f[10]).toBe(0xff); expect(f[11]).toBe(0x00);
  });

  test('read coils encodes start + count', () => {
    const f = encodeReadCoils(1, 1, 0, 8);
    expect(f[7]).toBe(0x01);
    expect(f[11]).toBe(8);
  });

  test('write multiple coils packs bits', () => {
    const f = encodeWriteMultipleCoils(1, 1, 0, [true, false, true, true, false, false, false, true]);
    expect(f[7]).toBe(0x0f);
    // MBAP(7) + fn + startHi + startLo + countHi + countLo + byteCount + coilByte
    // => coil byte at index 7 + 6 = 13.
    expect(f[13]).toBe(0b10001101); // bit0..bit7
  });

  test('decodeModbusFrame round-trips a write response', () => {
    const resp = encodeWriteSingleCoil(9, 1, 3, false); // echo-style frame
    const frame = decodeModbusFrame(resp);
    expect(frame).not.toBeNull();
    if (frame) {
      expect(frame.transaction).toBe(9);
      expect(frame.unit).toBe(1);
      expect(frame.function).toBe(0x05);
    }
  });

  test('decodeCoilBits unpacks bits', () => {
    const bits = decodeCoilBits(new Uint8Array([0b00000101]), 4);
    expect(bits).toEqual([true, false, true, false]);
  });

  test('barrierCommand open = coil ON', () => {
    const f = barrierCommand(1, 1, 0, true);
    expect(f[10]).toBe(0xff);
  });

  test('decodeModbusFrame returns null on short buffer', () => {
    expect(decodeModbusFrame(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
