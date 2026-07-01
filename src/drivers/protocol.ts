// Protocol capability drivers (roadmap §12-17) — Phase 1 wiring.
//
// Each driver wires an existing protocol library to a real transport and
// exposes it through the DriverHost. Drivers register unconditionally; their
// `isAvailable()` gates advertisement so an agent without e.g. a configured
// RFID reader never advertises `rfid.uhf` to the panel.

import type { ICapabilityDriver } from '../driver-host';
import { alprDriver } from './alpr';
import { barrierDriver } from './barrier';
import { biometricDriver } from './biometric';
import { displayDriver } from './display';
import { esignDriver } from './esign';
import { onvifDriver } from './onvif';
import { oposDriver } from './opos';
import { rfidDriver } from './rfid';
import { signageDriver } from './signage';
import { wiegandDriver } from './wiegand';

export const protocolDrivers: ICapabilityDriver[] = [
  barrierDriver, // barrier.relay (Modbus)
  rfidDriver, // rfid.uhf (LLRP)
  alprDriver, // alpr.camera (RTSP + edge OCR)
  onvifDriver, // camera.onvif (discovery + info)
  signageDriver, // signage.led
  displayDriver, // display.pole
  wiegandDriver, // rfid.gate
  biometricDriver, // biometric.fingerprint
  esignDriver, // signature.esign (PKCS#11)
  oposDriver, // payment.device (UPOS-compatible bridge)
];
