//! Ankara Connector wire protocol (v1) — shared between cloud relay and agent.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub name: String,
    pub version: String,
    pub os: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ConnectorMessage {
    Hello {
        v: u32,
        agent: AgentInfo,
        capabilities: Vec<String>,
    },
    Command {
        v: u32,
        id: String,
        cap: String,
        action: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        payload: Option<serde_json::Value>,
    },
    Ack {
        v: u32,
        id: String,
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<ProtocolError>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        payload: Option<serde_json::Value>,
    },
    Event {
        v: u32,
        cap: String,
        event: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        payload: Option<serde_json::Value>,
    },
    Ping {
        v: u32,
    },
    Pong {
        v: u32,
    },
}

impl ConnectorMessage {
    pub fn command(cap: &str, action: &str, payload: Option<serde_json::Value>) -> Self {
        Self::Command {
            v: PROTOCOL_VERSION,
            id: Uuid::new_v4().to_string(),
            cap: cap.to_string(),
            action: action.to_string(),
            payload,
        }
    }

    pub fn ack_ok(id: &str, payload: Option<serde_json::Value>) -> Self {
        Self::Ack {
            v: PROTOCOL_VERSION,
            id: id.to_string(),
            ok: true,
            error: None,
            payload,
        }
    }

    pub fn ack_err(id: &str, code: &str, message: &str) -> Self {
        Self::Ack {
            v: PROTOCOL_VERSION,
            id: id.to_string(),
            ok: false,
            error: Some(ProtocolError {
                code: code.to_string(),
                message: message.to_string(),
            }),
            payload: None,
        }
    }

    pub fn event(cap: &str, event: &str, payload: Option<serde_json::Value>) -> Self {
        Self::Event {
            v: PROTOCOL_VERSION,
            cap: cap.to_string(),
            event: event.to_string(),
            id: Some(Uuid::new_v4().to_string()),
            payload,
        }
    }
}

pub fn encode(msg: &ConnectorMessage) -> anyhow::Result<String> {
    Ok(serde_json::to_string(msg)?)
}

pub fn decode(text: &str) -> anyhow::Result<ConnectorMessage> {
    Ok(serde_json::from_str::<ConnectorMessage>(text)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_command_ack() {
        let cmd = ConnectorMessage::command("printer.escpos", "print", None);
        let text = encode(&cmd).unwrap();
        let decoded = decode(&text).unwrap();
        match decoded {
            ConnectorMessage::Command { cap, action, .. } => {
                assert_eq!(cap, "printer.escpos");
                assert_eq!(action, "print");
            }
            _ => panic!("expected command"),
        }

        let ack = ConnectorMessage::ack_ok("test-id", None);
        let ack_text = encode(&ack).unwrap();
        let ack_decoded = decode(&ack_text).unwrap();
        match ack_decoded {
            ConnectorMessage::Ack { id, ok, .. } => {
                assert_eq!(id, "test-id");
                assert!(ok);
            }
            _ => panic!("expected ack"),
        }
    }
}
