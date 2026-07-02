//! Windows e-imza token discovery (certificate store).

use std::process::Command;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EsignTokenInfo {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cert_subject: Option<String>,
    pub source: String,
}

const PS_LIST_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$items = @()
Get-ChildItem Cert:\CurrentUser\My | ForEach-Object {
  try {
    $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($_.Thumbprint)
    if (-not $cert.HasPrivateKey) { return }
    $hardware = $false
    try {
      $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
      if ($rsa -and $rsa.GetType().Name -eq 'RSACng') {
        $key = [System.Security.Cryptography.CngKey]::Open($rsa.Key.UniqueName)
        if ($key.IsHardwareDevice) { $hardware = $true }
      }
    } catch {}
    $subj = $cert.Subject
    $looksQualified = $hardware -or ($subj -match 'SERIALNUMBER=|TCKN|VKN|KAMU SM|MERSIS')
    if (-not $looksQualified) { return }
    $label = if ($subj -match 'CN=([^,]+)') { $matches[1] } else { $subj }
    $items += [PSCustomObject]@{
      id = $cert.Thumbprint
      label = $label
      certSubject = $subj
      source = 'windows-cert'
    }
  } catch {}
}
if ($items.Count -eq 0) { '[]' } else { $items | ConvertTo-Json -Compress -AsArray }
"#;

pub fn list_esign_tokens() -> Result<Vec<EsignTokenInfo>> {
    #[cfg(not(windows))]
    {
        return Ok(vec![]);
    }

    #[cfg(windows)]
    {
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                PS_LIST_SCRIPT,
            ])
            .output()?;

        if !output.status.success() {
            return Ok(vec![]);
        }

        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() || text == "[]" {
            return Ok(vec![]);
        }

        let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Array(vec![]));
        let arr = parsed.as_array().cloned().unwrap_or_default();
        Ok(arr
            .into_iter()
            .filter_map(|item| {
                let id = item.get("id")?.as_str()?.to_string();
                let label = item
                    .get("label")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&id)
                    .to_string();
                Some(EsignTokenInfo {
                    id,
                    label,
                    cert_subject: item
                        .get("certSubject")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    source: item
                        .get("source")
                        .and_then(|v| v.as_str())
                        .unwrap_or("windows-cert")
                        .to_string(),
                })
            })
            .collect())
    }
}
