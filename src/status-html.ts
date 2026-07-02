/** Status page HTML helpers (exported for tests). */

import type { AgentStatus } from './status';

export interface StatusPageOptions {
  tlsEnabled: boolean;
  certTrusted: boolean;
}

/** Derive panel connector settings URL from API base (api.host → site host). */
export function panelConnectorUrl(apiBase: string): string {
  try {
    const u = new URL(apiBase);
    const host = u.hostname.replace(/^api\./, '');
    return `https://${host}/panel/connector`;
  } catch {
    return 'https://ankarayazilim.org/panel/connector';
  }
}

export function panelPairUrl(apiBase: string): string {
  try {
    const u = new URL(apiBase);
    const host = u.hostname.replace(/^api\./, '');
    return `https://${host}/connector/baglan`;
  } catch {
    return 'https://ankarayazilim.org/connector/baglan';
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildStatusHtml(s: AgentStatus, opts: StatusPageOptions): string {
  const panelUrl = panelConnectorUrl(s.apiBase);
  const pairUrl = panelPairUrl(s.apiBase);
  const printerCell = s.printer
    ? `${esc(s.printer.host)}:${s.printer.port}`
    : `<a href="${esc(panelUrl)}" class="link">Panelden yapılandırın</a>`;

  const trustBanner =
    opts.tlsEnabled && !opts.certTrusted
      ? `<div class="notice">
  <strong>Yerel güvenlik sertifikası</strong>
  <p>Panelin bu bilgisayardaki yazıcı ve cihazlara güvenli bağlanması için yerel sertifikayı bir kez onaylamanız gerekir.</p>
  <a class="btn-secondary" href="/trust-cert">Yerel sertifikayı güven</a>
</div>`
      : '';

  const primaryBtn = s.paired
    ? `<a class="btn-primary" href="${esc(panelUrl)}" target="_blank" rel="noopener">Cihazları panelde yönet</a>`
    : `<a class="btn-primary" href="${esc(pairUrl)}" target="_blank" rel="noopener">Önce panelde oturum açın</a>`;

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ankara Yazılım Connector</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e6edf7;margin:0;padding:40px}
  .card{max-width:640px;margin:0 auto;border:1px solid #1f2d44;border-radius:16px;padding:32px;background:#0f172a}
  .brand{display:flex;align-items:center;gap:14px;margin-bottom:20px}
  .brand-logo{height:48px;width:48px;border-radius:10px;object-fit:contain;background:#002147;border:1px solid #1f2d44}
  h1{font-size:20px;margin:0}
  .subtitle{color:#9fb3cf;font-size:13px;margin:4px 0 0}
  .actions{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0 8px}
  .btn-primary,.btn-secondary{display:inline-block;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none}
  .btn-primary{background:#002147;color:#fff;border:1px solid #1f3a5f}
  .btn-primary:hover{background:#0a2d5c}
  .btn-secondary{background:#13203a;color:#e6edf7;border:1px solid #1f2d44}
  .btn-secondary:hover{background:#1a2840}
  .notice{margin:0 0 20px;padding:14px 16px;border-radius:12px;background:#1a1508;border:1px solid #4a3a10;font-size:13px}
  .notice p{margin:8px 0 12px;color:#d4c4a0;line-height:1.45}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #16203a;font-size:14px;gap:16px}
  .row span:last-child{color:#9fb3cf;text-align:right;max-width:65%;word-break:break-word}
  .link{color:#7eb8ff;text-decoration:none}
  .link:hover{text-decoration:underline}
  .pill{display:inline-block;padding:3px 10px;border-radius:999px;background:#13203a;border:1px solid #1f2d44;font-size:12px;margin:3px 4px 0 0}
  .ok{color:#34d399}.warn{color:#fbbf24}
</style></head><body><div class="card">
  <div class="brand"><img src="/assets/logo.png" alt="Ankara Yazılım" class="brand-logo" width="48" height="48"/>
    <div><h1>Ankara Yazılım Connector</h1><p class="subtitle">Yerel durum ve cihaz köprüsü</p></div></div>
  ${trustBanner}
  <div class="actions">${primaryBtn}</div>
  <div class="row"><span>Durum</span><span class="${s.paired ? 'ok' : 'warn'}">${s.paired ? 'Bağlı' : 'Oturum bekleniyor'}</span></div>
  <div class="row"><span>Cihaz</span><span>${esc(s.deviceId ?? '—')}</span></div>
  <div class="row"><span>Etiket</span><span>${esc(s.label ?? '—')}</span></div>
  <div class="row"><span>Sunucu</span><span>${esc(s.apiBase)}</span></div>
  <div class="row"><span>Yazıcı</span><span>${printerCell}</span></div>
  <div class="row"><span>Başlangıç</span><span>${esc(s.startedAt)}</span></div>
  <div style="margin-top:16px"><strong style="font-size:13px">Yetenekler</strong><div style="margin-top:8px">
    ${s.capabilities.map((c) => `<span class="pill">${esc(String(c))}</span>`).join('')}</div></div>
</div></body></html>`;
}

export function buildTrustCertResultHtml(ok: boolean): string {
  const title = ok ? 'Sertifika güvene eklendi' : 'Sertifika eklenemedi';
  const body = ok
    ? 'Yerel sertifika Windows kullanıcı deposuna eklendi. Panel artık bu bilgisayara güvenli bağlanabilir.'
    : 'Otomatik ekleme başarısız oldu. Windows güvenlik uyarısında Evet deyin veya yönetici izniyle tekrar deneyin.';
  const cls = ok ? 'ok' : 'warn';
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0b1220;color:#e6edf7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
  .card{max-width:440px;border:1px solid #1f2d44;border-radius:16px;padding:32px;background:#0f172a;text-align:center}
  h1{font-size:20px;margin:0 0 12px}
  p{color:#9fb3cf;font-size:15px;line-height:1.5;margin:0 0 20px}
  a{color:#7eb8ff}
  .ok{color:#34d399}.warn{color:#fbbf24}
</style></head><body><div class="card">
  <h1 class="${cls}">${title}</h1>
  <p>${body}</p>
  <p><a href="/">Durum sayfasına dön</a></p>
</div></body></html>`;
}
