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
