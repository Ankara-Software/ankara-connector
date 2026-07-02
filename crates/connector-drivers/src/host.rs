use std::time::Duration;

use anyhow::{anyhow, Result};
use connector_config::{load_config, save_config, ConnectorConfig, PrinterConfig};
use connector_protocol::{ConnectorMessage, ProtocolError};
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;

use crate::escpos::{encode_drawer_kick, encode_job, Align, PrintJob, PrintLine, Size};
use crate::esign::list_esign_tokens;

pub struct DriverHost;

pub fn advertised_capabilities(_cfg: &ConnectorConfig) -> Vec<String> {
    vec![
        "printer.escpos".into(),
        "scanner.barcode".into(),
        "scanner.qr".into(),
        "drawer.kick".into(),
        "signature.esign".into(),
    ]
}

async fn tcp_write(host: &str, port: u16, data: &[u8]) -> Result<()> {
    let addr = format!("{host}:{port}");
    let mut stream = tokio::time::timeout(Duration::from_secs(8), TcpStream::connect(&addr))
        .await
        .map_err(|_| anyhow!("Yazıcı bağlantı zaman aşımı"))??;
    stream.write_all(data).await?;
    stream.flush().await?;
    Ok(())
}

fn printer(cfg: &ConnectorConfig) -> Result<&PrinterConfig> {
    cfg.printer
        .as_ref()
        .ok_or_else(|| anyhow!("Yazıcı yapılandırılmamış"))
}

fn parse_print_payload(payload: &Option<Value>) -> PrintJob {
    let obj = payload.as_ref().and_then(|v| v.as_object());
    let lines = obj
        .and_then(|o| o.get("lines"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let text = item.get("text")?.as_str()?.to_string();
                    Some(PrintLine {
                        text,
                        bold: item.get("bold").and_then(|v| v.as_bool()).unwrap_or(false),
                        align: match item.get("align").and_then(|v| v.as_str()) {
                            Some("center") => Align::Center,
                            Some("right") => Align::Right,
                            _ => Align::Left,
                        },
                        size: if item.get("size").and_then(|v| v.as_str()) == Some("double") {
                            Size::Double
                        } else {
                            Size::Normal
                        },
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    PrintJob {
        header: obj
            .and_then(|o| o.get("header"))
            .and_then(|v| v.as_str())
            .map(String::from),
        footer: obj
            .and_then(|o| o.get("footer"))
            .and_then(|v| v.as_str())
            .map(String::from),
        lines,
        cut: obj.and_then(|o| o.get("cut")).and_then(|v| v.as_bool()).unwrap_or(true),
        code_page: obj
            .and_then(|o| o.get("codePage"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u8,
    }
}

pub async fn dispatch_command(
    cfg: &ConnectorConfig,
    cap: &str,
    action: &str,
    payload: Option<Value>,
) -> Result<ConnectorMessage, ProtocolError> {
    let id = "unknown".to_string();
    match (cap, action) {
        ("printer.escpos", "configure") => {
            let obj = payload.as_ref().and_then(|v| v.as_object()).ok_or_else(|| ProtocolError {
                code: "bad_message".into(),
                message: "Yapılandırma verisi gerekli".into(),
            })?;
            let host = obj
                .get("host")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| ProtocolError {
                    code: "bad_message".into(),
                    message: "Yazıcı host gerekli".into(),
                })?;
            let port = obj
                .get("port")
                .and_then(|v| v.as_u64())
                .unwrap_or(9100) as u16;
            let mut disk = load_config();
            disk.printer = Some(PrinterConfig {
                host: host.to_string(),
                port,
                code_page: None,
            });
            save_config(&disk).map_err(|e| ProtocolError {
                code: "device_error".into(),
                message: e.to_string(),
            })?;
            Ok(ConnectorMessage::ack_ok(
                &id,
                Some(json!({ "configured": true, "printer": { "host": host, "port": port } })),
            ))
        }
        ("printer.escpos", "health") => {
            let printer = cfg.printer.as_ref().map(|p| json!({ "host": p.host, "port": p.port }));
            Ok(ConnectorMessage::ack_ok(
                &id,
                Some(json!({
                    "online": cfg.printer.is_some(),
                    "printer": printer,
                })),
            ))
        }
        ("printer.escpos", "print") => {
            let p = printer(cfg).map_err(|e| ProtocolError {
                code: "device_error".into(),
                message: e.to_string(),
            })?;
            let job = parse_print_payload(&payload);
            let bytes = encode_job(&job);
            tcp_write(&p.host, p.port, &bytes)
                .await
                .map_err(|e| ProtocolError {
                    code: "device_error".into(),
                    message: e.to_string(),
                })?;
            Ok(ConnectorMessage::ack_ok(&id, Some(serde_json::json!({ "printed": true }))))
        }
        ("drawer.kick", "pulse" | "open" | "kick") => {
            let p = printer(cfg).map_err(|e| ProtocolError {
                code: "device_error".into(),
                message: e.to_string(),
            })?;
            let bytes = encode_drawer_kick();
            tcp_write(&p.host, p.port, &bytes)
                .await
                .map_err(|e| ProtocolError {
                    code: "device_error".into(),
                    message: e.to_string(),
                })?;
            Ok(ConnectorMessage::ack_ok(&id, None))
        }
        ("scanner.barcode" | "scanner.qr", "health") => Ok(ConnectorMessage::ack_ok(
            &id,
            Some(serde_json::json!({ "online": true })),
        )),
        ("scanner.barcode" | "scanner.qr", "inject") => {
            // Test/dev: payload { code: "..." } emits event upstream separately
            Ok(ConnectorMessage::ack_ok(&id, Some(payload.unwrap_or(Value::Null))))
        }
        ("signature.esign", "list" | "health") => {
            let tokens = list_esign_tokens().map_err(|e| ProtocolError {
                code: "device_error".into(),
                message: e.to_string(),
            })?;
            Ok(ConnectorMessage::ack_ok(
                &id,
                Some(json!({ "tokens": tokens, "count": tokens.len() })),
            ))
        }
        _ => Err(ProtocolError {
            code: "unsupported_action".into(),
            message: format!("Desteklenmeyen komut: {cap}.{action}"),
        }),
    }
}

pub async fn dispatch_command_with_id(
    cfg: &ConnectorConfig,
    id: &str,
    cap: &str,
    action: &str,
    payload: Option<Value>,
) -> ConnectorMessage {
    match dispatch_command(cfg, cap, action, payload).await {
        Ok(mut msg) => {
            if let ConnectorMessage::Ack { id: ref mut ack_id, .. } = msg {
                *ack_id = id.to_string();
            }
            msg
        }
        Err(err) => ConnectorMessage::ack_err(id, &err.code, &err.message),
    }
}

#[allow(dead_code)]
async fn read_scanner_loop(_cfg: ConnectorConfig) {
    // HID/serial scanner integration deferred; cloud events posted on inject command.
}
