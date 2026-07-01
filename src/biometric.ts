// Biometric SDK contract (roadmap §17).
//
// Vendor SDKs (ZKTeco, Suprema) require a paid license + native binaries, so
// the real capture path is operator-blocked. This module defines the contract
// + a mock implementation so the agent, panel, and conformance tests agree on
// shape today, and a real SDK drops in by implementing `BiometricProvider`.

export interface BiometricTemplate {
  /** Vendor-specific template format id. */
  format: 'zk' | 'suprema' | 'iso-19794';
  /** Base64 template bytes. */
  template: string;
  /** Capture quality score 0-100. */
  quality: number;
  capturedAt: string;
}

export interface BiometricMatch {
  matched: boolean;
  userId: string | null;
  score: number;
}

export interface BiometricProvider {
  readonly id: string;
  /** Capture a fingerprint/iris template from the connected reader. */
  capture(): Promise<BiometricTemplate>;
  /** Match a template against enrolled users. */
  match(template: BiometricTemplate): Promise<BiometricMatch>;
  /** Enroll a user template (admin-only). */
  enroll(userId: string, template: BiometricTemplate): Promise<boolean>;
}

/** Mock provider used until the vendor SDK is unblocked. Returns deterministic fakes. */
export class MockBiometricProvider implements BiometricProvider {
  readonly id = 'mock-biometric';
  private readonly enrolled = new Map<string, BiometricTemplate>();

  async capture(): Promise<BiometricTemplate> {
    return {
      format: 'iso-19794',
      template: btoa(`mock-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      quality: 85,
      capturedAt: new Date().toISOString(),
    };
  }

  async match(template: BiometricTemplate): Promise<BiometricMatch> {
    for (const [userId, t] of this.enrolled) {
      if (t.template === template.template) {
        return { matched: true, userId, score: 100 };
      }
    }
    return { matched: false, userId: null, score: 0 };
  }

  async enroll(userId: string, template: BiometricTemplate): Promise<boolean> {
    this.enrolled.set(userId, template);
    return true;
  }
}
