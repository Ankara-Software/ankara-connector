// Biometric native-plugin loader (roadmap §17).
//
// Vendor biometric SDKs (ZKTeco, Suprema) ship proprietary native libraries
// (.node/.dll/.so) that cannot be vendored here. This module implements the
// *loading mechanism* for them: a plugin directory + manifest maps a plugin id
// to a native module path, and the loader dynamically imports it. A real ZKTeco
// or Suprema SDK drops in by placing its `.node` plugin in the directory and
// implementing the `BiometricProvider` contract — zero agent code changes. When
// no plugin is configured, the mock provider is used so the contract stays
// testable. Biometric templates never leave the reader/host (KVKK item 26).

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { BiometricProvider } from './biometric';
import { MockBiometricProvider } from './biometric';
import { configPath } from './config';
import { loadNativeModule } from './transports/native-loader';

export interface BiometricPluginManifest {
  id: string;
  /** Native module path (relative to the plugins dir or absolute). */
  lib: string;
}

function pluginsDir(): string {
  return join(require('node:path').dirname(configPath()), 'biometric-plugins');
}

/** Load the manifest of installed biometric plugins. */
export function listBiometricPlugins(): BiometricPluginManifest[] {
  const dir = pluginsDir();
  if (!existsSync(dir)) return [];
  const out: BiometricPluginManifest[] = [];
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.json')) {
      try {
        const m = JSON.parse(require('node:fs').readFileSync(join(dir, file), 'utf8')) as BiometricPluginManifest;
        if (m.id && m.lib) out.push(m);
      } catch {
        // skip malformed manifest
      }
    }
  }
  return out;
}

/** Resolve a provider by plugin id, falling back to mock when unavailable. */
export async function loadBiometricProvider(pluginId: string, explicitLib?: string): Promise<BiometricProvider> {
  if (pluginId === 'mock' || !pluginId) return new MockBiometricProvider();
  const lib = explicitLib ?? resolvePluginLib(pluginId);
  if (!lib) return new MockBiometricProvider();
  const mod = await loadNativeModule<{ default?: BiometricProvider; create?: (lib: string) => BiometricProvider }>(lib);
  if (!mod.ok) return new MockBiometricProvider();
  const api = mod.api as { default?: BiometricProvider; create?: (lib: string) => BiometricProvider };
  if (api.create) return api.create(lib);
  if (api.default) return api.default;
  return new MockBiometricProvider();
}

function resolvePluginLib(pluginId: string): string | null {
  const plugins = listBiometricPlugins();
  const found = plugins.find((p) => p.id === pluginId);
  if (!found) return null;
  if (existsSync(found.lib)) return found.lib;
  const inDir = join(pluginsDir(), found.lib);
  return existsSync(inDir) ? inDir : null;
}
