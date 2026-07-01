// Capability driver registrations (roadmap §34, enterprise §3 Open/Closed).
//
// Each hardware capability is a self-contained `ICapabilityDriver` registered
// into the `DriverHost`. The agent's command router never branches on
// capability names — it asks `host.handlerFor(cap)`. New hardware support is
// "add one driver + register it here". POS Wave-0 drivers (print/label/drawer/
// scan/esign) wrap the existing handlers; protocol drivers (Modbus, LLRP, RTSP,
// ONVIF, signage, pole, Wiegand, biometric, PKCS#11) are added in Phase 1.

import { parseBarcode } from '../barcode';
import { loadConfig } from '../config';
import { customerError } from '../errors';
import type { ICapabilityDriver } from '../driver-host';
import { spooledDrawerKick, spooledPrint, spooledRaw } from '../spool';
import type { CommandMessage } from '../protocol';
import type { CommandHandler } from '../status';
import { aggregateHealth, encodeHealthRequest, healthErrorKey, type PrinterHealth } from '../printer-health';
import { renderLabel, type LabelSpec } from '../label';

interface PrintPayload {
  header?: string;
  lines?: { text: string; bold?: boolean; align?: 'left' | 'center' | 'right'; size?: 'normal' | 'double' }[];
  footer?: string;
  cut?: boolean;
}

const printerConfigured = (): boolean => !!loadConfig().printer;

// --- printer.escpos ----------------------------------------------------------
const handlePrint: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'print');
  if (action === 'status' || action === 'health') return handleHealth(cmd);
  if (action !== 'print') return { error: customerError('unsupported_action', `printer.escpos.${action}`) };
  const cfg = loadConfig();
  if (!cfg.printer) return { error: customerError('not_configured') };
  const p = (cmd.payload ?? {}) as PrintPayload;
  const r = await spooledPrint(cfg.printer, {
    header: p.header,
    lines: p.lines ?? [],
    footer: p.footer,
    cut: p.cut,
    codePage: cfg.printer.codePage,
  });
  if (!r.ok) {
    const code = r.deadLettered ? 'printer_dead_letter' : 'printer_busy';
    return { error: customerError(code, r.error) };
  }
  return { payload: { bytes: r.bytes } };
};

const handleHealth: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'status');
  if (action !== 'status') return { error: customerError('unsupported_action', `printer.escpos.${action}`) };
  const cfg = loadConfig();
  if (!cfg.printer) return { error: customerError('not_configured') };
  void cmd;
  const h: PrinterHealth = aggregateHealth({});
  const errKey = healthErrorKey(h);
  return { payload: { health: h, probe: Array.from(encodeHealthRequest('paper')), error: errKey } };
};

const escposDriver: ICapabilityDriver = {
  id: 'escpos-thermal',
  capability: 'printer.escpos',
  label: 'Termal fiş yazıcı',
  isAvailable: printerConfigured,
  handle: handlePrint,
};

// --- printer.label -----------------------------------------------------------
const handleLabel: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'print');
  if (action !== 'print' && action !== 'label') {
    return { error: customerError('unsupported_action', `printer.label.${action}`) };
  }
  const cfg = loadConfig();
  if (!cfg.printer) return { error: customerError('not_configured') };
  const p = (cmd.payload ?? {}) as { text?: string; dialect?: 'zpl' | 'epl' | 'tspl'; spec?: LabelSpec };
  if (p.spec) {
    const dialect = p.dialect ?? 'zpl';
    const bytes = renderLabel(p.spec, dialect);
    const r = await spooledRaw(cfg.printer, bytes);
    if (!r.ok) return { error: customerError(r.deadLettered ? 'printer_dead_letter' : 'device_error', r.error) };
    return { payload: { bytes: r.bytes, dialect } };
  }
  const r = await spooledPrint(cfg.printer, { lines: [{ text: p.text ?? '', bold: true }] });
  if (!r.ok) return { error: customerError(r.deadLettered ? 'printer_dead_letter' : 'device_error', r.error) };
  return { payload: { bytes: r.bytes } };
};

const labelDriver: ICapabilityDriver = {
  id: 'zpl-label',
  capability: 'printer.label',
  label: 'Etiket yazıcı (ZPL/EPL/TSPL)',
  isAvailable: printerConfigured,
  handle: handleLabel,
};

// --- drawer.kick -------------------------------------------------------------
const handleDrawer: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'kick');
  if (action !== 'kick') return { error: customerError('unsupported_action', `drawer.kick.${action}`) };
  const cfg = loadConfig();
  if (!cfg.printer) return { error: customerError('not_configured') };
  const r = await spooledDrawerKick(cfg.printer, 1, 50, 50);
  if (!r.ok) return { error: customerError('device_error', r.error) };
  return { payload: { kicked: true, bytes: r.bytes } };
};

const drawerDriver: ICapabilityDriver = {
  id: 'escpos-drawer',
  capability: 'drawer.kick',
  label: 'Para çekmecesi',
  isAvailable: printerConfigured,
  handle: handleDrawer,
};

// --- scanner.barcode / scanner.qr -------------------------------------------
const handleScan: CommandHandler = async (cmd: CommandMessage) => {
  const action = String(cmd.action || 'scan');
  if (action !== 'scan' && action !== 'capture') {
    return { error: customerError('unsupported_action', `scanner.${action}`) };
  }
  const p = (cmd.payload ?? {}) as { code?: string };
  if (!p.code) return { error: customerError('scanner_empty') };
  const parsed = parseBarcode(p.code);
  return {
    payload: {
      code: parsed.code,
      symbology: parsed.symbology,
      gs1: parsed.gs1,
      fields: parsed.fields,
      capturedAt: new Date().toISOString(),
    },
  };
};

const scanBarcodeDriver: ICapabilityDriver = {
  id: 'hid-barcode',
  capability: 'scanner.barcode',
  label: 'Barkod okuyucu',
  isAvailable: () => true,
  handle: handleScan,
};

const scanQrDriver: ICapabilityDriver = {
  id: 'hid-qr',
  capability: 'scanner.qr',
  label: 'QR okuyucu',
  isAvailable: () => true,
  handle: handleScan,
};

/** POS Wave-0 drivers (always registered). The esign driver lives in
 *  drivers/esign.ts (real PKCS#11 wiring). */
export const baseDrivers: ICapabilityDriver[] = [
  scanBarcodeDriver,
  scanQrDriver,
  escposDriver,
  labelDriver,
  drawerDriver,
];
