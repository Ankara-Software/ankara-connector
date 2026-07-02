/** About dialog HTML (served at GET /about). */

export interface AboutRuntime {
  bun?: string;
  platform: string;
  arch: string;
  build?: string;
}

export interface AboutPageInfo {
  version: string;
  trayVersion?: string | null;
  trayBuild?: string | null;
  runtime: AboutRuntime;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildAboutHtml(info: AboutPageInfo): string {
  const rows: string[] = [
    `<div class="row"><span>Connector</span><span>${esc(info.version)}</span></div>`,
  ];
  if (info.trayVersion) {
    rows.push(
      `<div class="row"><span>Tray (Go)</span><span>${esc(info.trayVersion)}${info.trayBuild ? ` (${esc(info.trayBuild)})` : ''}</span></div>`,
    );
  }
  if (info.runtime.bun) {
    rows.push(`<div class="row"><span>Çekirdek (Bun)</span><span>${esc(info.runtime.bun)}</span></div>`);
  }
  rows.push(
    `<div class="row"><span>İşletim sistemi</span><span>${esc(info.runtime.platform)} / ${esc(info.runtime.arch)}</span></div>`,
  );
  if (info.runtime.build) {
    rows.push(`<div class="row"><span>Derleme</span><span>${esc(info.runtime.build)}</span></div>`);
  }

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Hakkında — Ankara Yazılım Connector</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e6edf7;margin:0;padding:40px}
  .card{max-width:520px;margin:0 auto;border:1px solid #1f2d44;border-radius:16px;padding:32px;background:#0f172a}
  h1{font-size:20px;margin:0 0 8px}
  .subtitle{color:#9fb3cf;font-size:13px;margin:0 0 20px;line-height:1.5}
  .section-title{font-size:13px;font-weight:600;color:#9fb3cf;margin:20px 0 8px;text-transform:uppercase;letter-spacing:.04em}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #16203a;font-size:14px;gap:16px}
  .row span:last-child{color:#9fb3cf;text-align:right;max-width:60%;word-break:break-word}
  .legal a{display:block;color:#7eb8ff;text-decoration:none;padding:8px 0;font-size:14px}
  .legal a:hover{text-decoration:underline}
  .back{margin-top:24px;font-size:14px}
  .back a{color:#7eb8ff}
</style></head><body><div class="card">
  <h1>Ankara Yazılım Connector</h1>
  <p class="subtitle">Fiziksel donanımı Ankara Yazılım paneli ile köprüler. Tüm ayarlar web panelden yapılır.</p>
  <div class="section-title">Sürümler</div>
  ${rows.join('\n  ')}
  <div class="section-title">Yasal</div>
  <div class="legal">
    <a href="https://ankarayazilim.org/gizlilik/" target="_blank" rel="noopener">Gizlilik politikası</a>
    <a href="https://ankarayazilim.org/kvkk/" target="_blank" rel="noopener">KVKK aydınlatma metni</a>
    <a href="https://ankarayazilim.org/indir" target="_blank" rel="noopener">İndirme ve güncelleme</a>
  </div>
  <p class="back"><a href="/">← Durum sayfasına dön</a></p>
</div></body></html>`;
}
