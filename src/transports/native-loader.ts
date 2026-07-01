// Lazy native-addon loader (roadmap §7-8, enterprise §2).
//
// Serial, USB HID, and raw-USB printer access need platform-native addons
// (serialport, node-hid, usb). These do not cross-compile cleanly into the
// Bun single-binary and are not bundled by default. This helper attempts to
// dynamically import an addon at runtime; when absent, it returns a typed
// `NativeModuleUnavailable` error so capability drivers can surface a clear,
// customer-facing "sürücü modülü yüklenemedi" message instead of crashing.

export interface NativeModuleUnavailable {
  ok: false;
  module: string;
  message: string;
}

export interface NativeModuleLoaded<T> {
  ok: true;
  module: string;
  api: T;
}

export type NativeModuleResult<T> = NativeModuleLoaded<T> | NativeModuleUnavailable;

/**
 * Try to dynamically import a native addon by module name.
 * Returns the resolved API or a structured unavailable result.
 */
export async function loadNativeModule<T = unknown>(moduleName: string): Promise<NativeModuleResult<T>> {
  try {
    const mod = await import(/* @vite-ignore */ moduleName);
    return { ok: true, module: moduleName, api: mod as T };
  } catch {
    return {
      ok: false,
      module: moduleName,
      message: `${moduleName} native modülü yüklü değil. Cihaz sürücüsü kurulu değilse bu donanım kullanılamaz.`,
    };
  }
}

/** Synchronous variant for modules that must be required before first use. */
export function requireNativeModule<T = unknown>(moduleName: string): NativeModuleResult<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(moduleName);
    return { ok: true, module: moduleName, api: mod as T };
  } catch {
    return {
      ok: false,
      module: moduleName,
      message: `${moduleName} native modülü yüklü değil. Cihaz sürücüsü kurulu değilse bu donanım kullanılamaz.`,
    };
  }
}

/** True when a native addon module can be resolved without loading it. */
export function nativeModuleAvailable(moduleName: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require.resolve(moduleName);
    return true;
  } catch {
    return false;
  }
}
