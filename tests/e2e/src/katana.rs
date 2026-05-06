//! Katana child-process management.
//!
//! Spawns a Katana node, waits for the JSON-RPC port to start serving, and
//! exposes a `Drop` impl that kills the process and removes its temp data
//! dir on test teardown (even on panic).

use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use tokio::process::{Child, Command};
use tracing::{info, warn};

use crate::constants::{
    APPCHAIN_CHAIN_ID_STR, APPCHAIN_PORT, CARTRIDGE_MAINNET_RPC, SETTLEMENT_CHAIN_ID_STR,
    SETTLEMENT_PORT,
};

/// A live Katana child process.
pub struct KatanaNode {
    pub label: &'static str,
    pub rpc_port: u16,
    pub http_url: String,
    pub data_dir: tempfile::TempDir,
    child: Option<Child>,
}

impl KatanaNode {
    pub fn rpc_url(&self) -> String {
        self.http_url.clone()
    }

    fn binary() -> PathBuf {
        if let Ok(p) = std::env::var("KATANA_BIN") {
            return PathBuf::from(p);
        }
        // Default: assume `katana` on PATH. The user has it at
        // `/Users/kerry/.cargo/bin/katana` per their environment.
        PathBuf::from("katana")
    }

    pub async fn start_settlement(messaging_config_path: Option<&PathBuf>) -> Result<Self> {
        // Fork-from-latest by default. Set NUMS_E2E_NO_FORK=1 to disable
        // forking (e.g. for harness-only smoke tests).
        let fork = std::env::var("NUMS_E2E_NO_FORK").is_err();
        Self::start(
            "settlement",
            SETTLEMENT_PORT,
            SETTLEMENT_CHAIN_ID_STR,
            fork,
            messaging_config_path,
        )
        .await
    }

    pub async fn start_appchain(messaging_config_path: Option<&PathBuf>) -> Result<Self> {
        Self::start(
            "appchain",
            APPCHAIN_PORT,
            APPCHAIN_CHAIN_ID_STR,
            false,
            messaging_config_path,
        )
        .await
    }

    async fn start(
        label: &'static str,
        rpc_port: u16,
        chain_id: &str,
        fork_mainnet: bool,
        messaging_config_path: Option<&PathBuf>,
    ) -> Result<Self> {
        let data_dir = tempfile::tempdir().context("create katana data dir")?;
        let bin = Self::binary();

        let mut cmd = Command::new(&bin);
        cmd.arg("--dev")
            .arg("--dev.no-fee")
            .arg("--dev.no-account-validation")
            .arg("--http.port")
            .arg(rpc_port.to_string())
            .arg("--http.addr")
            .arg("127.0.0.1")
            .arg("--silent")
            .arg("--data-dir")
            .arg(data_dir.path())
            .arg("--db.auto-migrate")
            // Make sure we always have headroom for big Dojo-deploy txs.
            .arg("--invoke-max-steps")
            .arg("100000000")
            .arg("--validate-max-steps")
            .arg("10000000");

        if fork_mainnet {
            // Fork from latest. Do NOT pass --fork.block — empirical
            // experience is that the Cartridge RPC reliably serves storage
            // proofs only for the current tip; older blocks fail with
            // "failed to update class trie".
            //
            // Forking inherits the chain_id from the upstream (SN_MAIN), so
            // we don't pass --chain-id when forking.
            cmd.arg("--fork.provider").arg(CARTRIDGE_MAINNET_RPC);
        } else {
            cmd.arg("--chain-id").arg(chain_id);
        }

        if let Some(p) = messaging_config_path {
            cmd.arg("--messaging").arg(p);
        }

        cmd.stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        info!(
            "Starting Katana ({label}) on http://127.0.0.1:{rpc_port} (fork={fork_mainnet})"
        );

        let child = cmd.spawn().with_context(|| {
            format!(
                "spawn katana ({label}); is `{}` on PATH? Override via KATANA_BIN env var.",
                bin.display()
            )
        })?;

        let mut node = Self {
            label,
            rpc_port,
            http_url: format!("http://127.0.0.1:{rpc_port}"),
            data_dir,
            child: Some(child),
        };

        node.wait_until_ready().await?;
        Ok(node)
    }

    async fn wait_until_ready(&mut self) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(30);
        let client = reqwest_like_client();
        loop {
            if let Some(child) = self.child.as_mut() {
                if let Some(status) = child.try_wait().context("try_wait katana")? {
                    let mut buf = String::new();
                    if let Some(err) = child.stderr.take() {
                        let _ = read_to_string(err, &mut buf).await;
                    }
                    bail!(
                        "katana ({}) exited early with {:?}\nstderr:\n{buf}",
                        self.label,
                        status,
                    );
                }
            }

            // Probe via JSON-RPC.
            let payload = json!({
                "jsonrpc":"2.0","id":1,"method":"starknet_chainId","params":[]
            });
            let res = client
                .post(&self.http_url)
                .header("content-type", "application/json")
                .body(payload.to_string())
                .send()
                .await;
            if let Ok(r) = res {
                if let Ok(text) = r.text().await {
                    if let Ok(v) = serde_json::from_str::<Value>(&text) {
                        if v.get("result").is_some() {
                            info!("Katana ({}) ready at {}", self.label, self.http_url);
                            return Ok(());
                        }
                    }
                }
            }
            if Instant::now() > deadline {
                bail!(
                    "katana ({}) did not become ready within 30s",
                    self.label
                );
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
}

impl Drop for KatanaNode {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            warn!("Killing Katana ({}) on drop", self.label);
            let _ = child.start_kill();
        }
    }
}

// Tiny shim — we'd rather not pull `reqwest` into the dep tree because of
// build-time cost; this uses `reqwest`-style abstraction over hyper. Actually
// the simplest path: use the `starknet` crate's `JsonRpcClient` for probing.
// But the `chain_id` probe is faster with a raw POST. Use a hand-rolled
// client based on hyper instead — fewer deps means faster build.

mod minimal_http {
    use std::io;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;
    use url::Url;

    pub struct Response {
        pub body: String,
    }

    impl Response {
        pub async fn text(self) -> io::Result<String> {
            Ok(self.body)
        }
    }

    pub struct Client;

    impl Client {
        pub fn new() -> Self {
            Self
        }
        pub fn post<'a>(&'a self, url: &'a str) -> Builder<'a> {
            Builder { url, headers: vec![], body: None }
        }
    }

    pub struct Builder<'a> {
        url: &'a str,
        headers: Vec<(&'a str, &'a str)>,
        body: Option<String>,
    }

    impl<'a> Builder<'a> {
        pub fn header(mut self, k: &'a str, v: &'a str) -> Self {
            self.headers.push((k, v));
            self
        }
        pub fn body<S: Into<String>>(mut self, body: S) -> Self {
            self.body = Some(body.into());
            self
        }
        pub async fn send(self) -> io::Result<Response> {
            let parsed = Url::parse(self.url).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
            let host = parsed.host_str().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no host"))?.to_string();
            let port = parsed.port().unwrap_or(80);
            let path = parsed.path();
            let body = self.body.clone().unwrap_or_default();

            let mut stream = TcpStream::connect((host.as_str(), port)).await?;
            let mut req = String::new();
            req.push_str(&format!("POST {path} HTTP/1.1\r\n"));
            req.push_str(&format!("Host: {host}:{port}\r\n"));
            for (k, v) in &self.headers {
                req.push_str(&format!("{k}: {v}\r\n"));
            }
            req.push_str(&format!("Content-Length: {}\r\n", body.len()));
            req.push_str("Connection: close\r\n\r\n");
            req.push_str(&body);
            stream.write_all(req.as_bytes()).await?;
            stream.flush().await?;
            let mut buf = Vec::new();
            stream.read_to_end(&mut buf).await?;
            let s = String::from_utf8_lossy(&buf).to_string();
            // Crude: split on first \r\n\r\n
            let body = if let Some(idx) = s.find("\r\n\r\n") {
                s[idx + 4..].to_string()
            } else {
                s
            };
            // If chunked transfer encoding, just keep what's after first chunk size header
            // For RPC short responses this naive parser is adequate.
            let body = strip_chunked(body);
            Ok(Response { body })
        }
    }

    fn strip_chunked(s: String) -> String {
        // Detect first hex line followed by \r\n; if present, treat as chunked.
        if let Some(idx) = s.find("\r\n") {
            let head = &s[..idx];
            if head.chars().all(|c| c.is_ascii_hexdigit()) && !head.is_empty() {
                let rest = &s[idx + 2..];
                if let Some(end) = rest.find("\r\n") {
                    return rest[..end].to_string();
                }
            }
        }
        s
    }
}

fn reqwest_like_client() -> minimal_http::Client {
    minimal_http::Client::new()
}

async fn read_to_string<R: tokio::io::AsyncRead + Unpin>(
    mut r: R,
    out: &mut String,
) -> std::io::Result<()> {
    use tokio::io::AsyncReadExt;
    let mut buf = Vec::new();
    let _ = r.read_to_end(&mut buf).await?;
    out.push_str(&String::from_utf8_lossy(&buf));
    Ok(())
}

/// Convenience: kill a node that's already been Dropped. Used for explicit
/// teardown ordering.
pub fn kill_silently(_node: KatanaNode) {
    // dropping `node` runs its Drop impl
}

/// Helper used by the harness to assert at least one of the expected dev
/// accounts matches what the running Katana currently exposes. If this fires
/// we want a loud failure rather than silently signing with the wrong key.
pub async fn assert_dev_account_matches(rpc_url: &str, expected: starknet::core::types::Felt) -> Result<()> {
    use serde_json::Value;
    let payload = serde_json::json!({
        "jsonrpc":"2.0","id":1,"method":"dev_predeployedAccounts","params":[]
    });
    let client = reqwest_like_client();
    let resp = client
        .post(rpc_url)
        .header("content-type", "application/json")
        .body(payload.to_string())
        .send()
        .await
        .context("dev_predeployedAccounts call")?;
    let text = resp.text().await?;
    let v: Value = serde_json::from_str(&text).with_context(|| format!("parse: {text}"))?;
    let arr = v
        .get("result")
        .and_then(|r| r.as_array())
        .ok_or_else(|| anyhow!("no result array: {v}"))?;
    for a in arr {
        if let Some(addr) = a.get("address").and_then(|s| s.as_str()) {
            if let Ok(felt) = starknet::core::types::Felt::from_hex(addr) {
                if felt == expected {
                    return Ok(());
                }
            }
        }
    }
    Err(anyhow!(
        "expected dev account {expected:#x} not found in {arr:?}"
    ))
}
