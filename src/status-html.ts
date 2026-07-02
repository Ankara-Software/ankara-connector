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

function formatPairedAt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('tr-TR');
  } catch {
    return iso;
  }
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
  <button type="button" class="btn-secondary" onclick="trustCert()">Yerel sertifikayı güven</button>
  <p id="trust-msg" class="msg" style="margin-top:10px"></p>
</div>`
      : '';

  const primaryBtn = s.paired
    ? `<a class="btn-primary" href="${esc(panelUrl)}" target="_blank" rel="noopener">Cihazları panelde yönet</a>`
    : `<button type="button" class="btn-primary" onclick="sessionAction('login')">Oturum aç</button>`;

  const sessionActionBtn = s.paired
    ? `<button type="button" class="btn-secondary" onclick="sessionAction('logout')">Oturumu kapat</button>`
    : '';

  const sessionStatus = s.paired
    ? `<span class="ok">Bağlı</span>`
    : s.sessionPaused
      ? `<span class="warn">Oturum kapalı</span>`
      : `<span class="warn">Oturum bekleniyor</span>`;

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ankara Yazılım Connector</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e6edf7;margin:0;padding:40px}
  .card{max-width:640px;margin:0 auto;border:1px solid #1f2d44;border-radius:16px;padding:32px;background:#0f172a}
  .brand{display:flex;align-items:center;gap:14px;margin-bottom:20px}
  .brand-logo{height:44px;width:auto;max-width:180px;border-radius:8px;object-fit:contain;background:#fff;padding:6px 10px;border:1px solid #1f2d44}
  h1{font-size:20px;margin:0}
  .subtitle{color:#9fb3cf;font-size:13px;margin:4px 0 0}
  .section-title{font-size:13px;font-weight:600;color:#9fb3cf;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.04em}
  .actions{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0 8px}
  .btn-primary,.btn-secondary{display:inline-block;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none;border:none;cursor:pointer;font-family:inherit}
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
  .msg{margin-top:12px;font-size:13px;color:#fbbf24;display:none}
</style></head><body><div class="card">
  <div class="brand"><img src="/assets/logo.png" alt="Ankara Yazılım" class="brand-logo" width="180" height="44"/>
    <div><h1>Ankara Yazılım Connector</h1><p class="subtitle">Yerel durum ve cihaz köprüsü · sürüm ${esc(s.version)}</p></div></div>
  ${trustBanner}
  <div class="section-title">Oturum</div>
  <div class="row"><span>Durum</span><span>${sessionStatus}</span></div>
  <div class="row"><span>Firma</span><span>${esc(s.tenantName ?? '—')}</span></div>
  <div class="row"><span>Eşleşme</span><span>${esc(formatPairedAt(s.pairedAt))}</span></div>
  <div class="actions">${primaryBtn}${sessionActionBtn}</div>
  <p id="session-msg" class="msg"></p>
  <div class="section-title">Cihaz</div>
  <div class="row"><span>Cihaz kimliği</span><span>${esc(s.deviceId ?? '—')}</span></div>
  <div class="row"><span>Etiket</span><span>${esc(s.label ?? '—')}</span></div>
  <div class="row"><span>Sunucu</span><span>${esc(s.apiBase)}</span></div>
  <div class="row"><span>Yazıcı</span><span>${printerCell}</span></div>
  <div class="row"><span>Başlangıç</span><span>${esc(s.startedAt)}</span></div>
  <div style="margin-top:16px"><strong style="font-size:13px">Yetenekler</strong><div style="margin-top:8px">
    ${s.capabilities.map((c) => `<span class="pill">${esc(String(c))}</span>`).join('')}</div></div>
</div>
<script>
let pollTimer = null;

async function sessionAction(action) {
  const msg = document.getElementById('session-msg');
  msg.style.display = 'none';
  try {
    const r = await fetch('/session/' + action, { method: 'POST' });
    const j = await r.json();
    if (action === 'login' && j.ok && j.started) {
      msg.textContent = 'Tarayıcıda oturum açın. Tamamlandığında sayfa otomatik yenilenecek.';
      msg.style.display = 'block';
      startPairedPoll();
      return;
    }
    if (j.ok) { location.reload(); return; }
    msg.textContent = j.error || 'İşlem başarısız.';
    msg.style.display = 'block';
  } catch (e) {
    msg.textContent = 'Bağlantı hatası.';
    msg.style.display = 'block';
  }
}

function startPairedPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const r = await fetch('/health');
      const h = await r.json();
      if (h.paired) {
        clearInterval(pollTimer);
        pollTimer = null;
        location.reload();
      }
    } catch {}
  }, 2000);
}

async function trustCert() {
  const msg = document.getElementById('trust-msg');
  if (!msg) return;
  msg.style.display = 'none';
  try {
    const r = await fetch('/trust-cert', { method: 'POST' });
    const j = await r.json();
    if (j.ok) {
      msg.textContent = 'Sertifika güvene eklendi. Sayfa yenileniyor…';
      msg.style.display = 'block';
      setTimeout(() => location.reload(), 1200);
      return;
    }
    msg.textContent = j.error || 'Sertifika eklenemedi. Yönetici izni gerekebilir.';
    msg.style.display = 'block';
  } catch (e) {
    msg.textContent = 'Bağlantı hatası.';
    msg.style.display = 'block';
  }
}
</script>
</body></html>`;
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
