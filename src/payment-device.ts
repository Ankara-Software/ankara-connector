// Payment device (ÖKC / PF) contract (roadmap §12, blocked).
//
// Ödeme Kayıt Cihazı (ÖKC) / Payment Function integration requires the GİB-
// certified vendor SDK (Innova, Paycore, Desfin) + bank credentials. This is
// operator-blocked (roadmap p298-connector-code-signing + GİB credentials).
// The contract is defined here so the panel + agent agree on the E-İrsaliye/
// ÖKC flow shape; a real SDK drops in by implementing `PaymentDeviceProvider`.

export interface PaymentReceipt {
  /** Z-Report / daily closure id. */
  zReportId: string;
  /** Total amount in kuruş. */
  totalKurus: number;
  /** Receipt items. */
  items: { name: string; qty: number; unitKurus: number; vatRate: number }[];
  /** GİB approval code. */
  gibApprovalCode: string | null;
  issuedAt: string;
}

export interface PaymentDeviceProvider {
  readonly id: string;
  /** Open a fiscal session. */
  openSession(operatorPin: string): Promise<{ sessionId: string }>;
  /** Issue a fiscal receipt. */
  issueReceipt(sessionId: string, items: PaymentReceipt['items']): Promise<PaymentReceipt>;
  /** Z-Report (daily closure). */
  closeSession(sessionId: string): Promise<{ zReportId: string; totalKurus: number }>;
}

/** Mock ÖKC provider — operator unblock bekliyor. */
export class MockPaymentDeviceProvider implements PaymentDeviceProvider {
  readonly id = 'mock-okc';

  async openSession(_pin: string): Promise<{ sessionId: string }> {
    return { sessionId: `sess-${Date.now()}` };
  }

  async issueReceipt(sessionId: string, items: PaymentReceipt['items']): Promise<PaymentReceipt> {
    const total = items.reduce((n, i) => n + i.qty * i.unitKurus, 0);
    return {
      zReportId: sessionId,
      totalKurus: total,
      items,
      gibApprovalCode: null,
      issuedAt: new Date().toISOString(),
    };
  }

  async closeSession(sessionId: string): Promise<{ zReportId: string; totalKurus: number }> {
    return { zReportId: `Z-${sessionId}`, totalKurus: 0 };
  }
}
