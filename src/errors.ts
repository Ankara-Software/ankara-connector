// Connector error code encyclopedia (roadmap §47).
//
// Protocol errors (from PROTOCOL_ERROR_CODES) plus device-class errors are
// surfaced to the panel as stable, customer-facing Turkish codes (E0xx) so
// users see "E04: Yazıcı Kağıdı Bitti" instead of a raw exception string.
// Pure registry — used by the agent ack builder and the panel toast layer.

export interface ErrorEntry {
  /** Stable customer-facing code. */
  code: string;
  /** Short Turkish headline. */
  title: string;
  /** Actionable remediation hint. */
  hint: string;
}

export const ERROR_ENCYCLOPEDIA: Readonly<Record<string, ErrorEntry>> = {
  // Protocol-level (mirror packages/connector-protocol PROTOCOL_ERROR_CODES)
  bad_message: { code: 'E01', title: 'Geçersiz komut', hint: 'Panel sürümü Connector ile uyumsuz. Paneli yenileyin.' },
  unknown_capability: { code: 'E02', title: 'Yetenek desteklenmiyor', hint: 'Bu cihaz bu donanımı tanımıyor. Cihaz uyumluluk matrisini kontrol edin.' },
  unsupported_action: { code: 'E03', title: 'İşlem desteklenmiyor', hint: 'Bu donanım için geçerli bir işlem değil.' },
  device_error: { code: 'E10', title: 'Donanım hatası', hint: 'Cihaz yanıt vermedi. Kabloyu ve gücü kontrol edin.' },
  timeout: { code: 'E20', title: 'Zaman aşımı', hint: 'Cihaz çok uzun yanıt vermedi. Ağ bağlantısını kontrol edin.' },
  unauthorized: { code: 'E30', title: 'Yetkisiz', hint: 'Connector oturumu kapatılmış. Panelden yeniden bağlayın.' },
  version_mismatch: { code: 'E40', title: 'Sürüm uyumsuz', hint: 'Connector güncel değil. Güncellemeyi uygulayın.' },

  // Device-class specific
  printer_offline: { code: 'E04', title: 'Yazıcı çevrimdışı', hint: 'Yazıcı açık ve aynı ağda mı? IP/portu panelden kontrol edin.' },
  printer_paper_out: { code: 'E05', title: 'Yazıcı kağıdı bitti', hint: 'Termal rulo kağıdı doldurun ve kapağı kapatın.' },
  printer_cover_open: { code: 'E06', title: 'Yazıcı kapağı açık', hint: 'Yazıcı kapağını kapatın.' },
  printer_busy: { code: 'E07', title: 'Yazıcı meşgul', hint: 'Önceki baskı bitiyor. Komut kuyrukta bekliyor.' },
  printer_dead_letter: { code: 'E08', title: 'Baskı başarısız', hint: 'Yazıcı art arda yanıt vermedi. Komut iptal edildi.' },
  scanner_empty: { code: 'E11', title: 'Tarama verisi boş', hint: 'Barkod okuyucu veri göndermedi. Tekrar deneyin.' },
  not_configured: { code: 'E12', title: 'Cihaz yapılandırılmamış', hint: 'Bu donanımı panelden tanımlayın.' },

  // Transport / native-addon (roadmap §7-8, enterprise §2)
  driver_module_missing: { code: 'E13', title: 'Sürücü modülü yok', hint: 'Bu cihaz için yerel sürücü kurulu değil. Ankara Yazılım destekinden sürücüyü isteyin.' },
  transport_offline: { code: 'E14', title: 'Bağlantı kurulamadı', hint: 'Cihaza ulaşılamıyor. Kabloyu, IP adresini ve gücü kontrol edin.' },
  serial_error: { code: 'E15', title: 'Seri port hatası', hint: 'COM portu kullanılamıyor. Başka uygulama açık değilse tekrar deneyin.' },
  usb_error: { code: 'E16', title: 'USB hatası', hint: 'USB cihazı tanınmadı. Kabloyu değiştirin veya portu değiştirin.' },

  // Hardware protocol modules (roadmap §12-17)
  barrier_error: { code: 'E21', title: 'Bariyer hatası', hint: 'Röle/Modbus cihazı yanıt vermedi. Ağ ve kablo bağlantısını kontrol edin.' },
  rfid_error: { code: 'E22', title: 'RFIF okuyucu hatası', hint: 'LLRP okuyucu yanıt vermedi. IP ve antena gücünü kontrol edin.' },
  camera_error: { code: 'E23', title: 'Kamera hatası', hint: 'RTSP/ONVIF akışı alınamadı. Kamera IP ve kimlik bilgilerini kontrol edin.' },
  ocr_error: { code: 'E24', title: 'Plaka tanınamadı', hint: 'Görüntü çok karanlık veya bulanık. Kamera açısını düzeltin.' },
  esign_error: { code: 'E25', title: 'E-imza hatası', hint: 'Akıllı kart/takılı değil veya PIN hatalı. Tokenı takıp tekrar deneyin.' },
  biometric_error: { code: 'E26', title: 'Biyometrik hatası', hint: 'Parmak izi okuyucu yanıt vermedi. Sensörü temizleyin ve tekrar deneyin.' },
  signage_error: { code: 'E27', title: 'Tabela hatası', hint: 'LED tabela yanıt vermedi. Bağlantı ve ekran kimliğini kontrol edin.' },
  display_error: { code: 'E28', title: 'Müşteri ekranı hatası', hint: 'Pole display yanıt vermedi. Seri/USB bağlantısını kontrol edin.' },
};

/** Map a raw protocol/device error code to a customer-facing ErrorEntry. */
export function describeError(code: string): ErrorEntry {
  return (
    ERROR_ENCYCLOPEDIA[code] ?? {
      code: 'E99',
      title: 'Beklenmeyen hata',
      hint: 'Sorun sürerse Ankara Yazılım destekle iletişime geçin.',
    }
  );
}

/** Build a customer-facing ack error payload from a raw error code + message. */
export function customerError(code: string, _rawMessage?: string): { code: string; message: string } {
  const e = describeError(code);
  return { code: e.code, message: `${e.code}: ${e.title} — ${e.hint}` };
}
