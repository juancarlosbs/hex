use crate::engine::error::EngineError;
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use std::net::IpAddr;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::{ClientConfig, RootCertStore};
use tokio_rustls::TlsConnector;

/// Per-phase timing of a single request (differentiator #3 — the waterfall).
/// MVP: one new connection per request, so every phase is always measured.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingBreakdown {
    pub dns_ms: Option<u64>,
    pub tcp_ms: Option<u64>,
    pub tls_ms: Option<u64>,
    pub ttfb_ms: u64,
    pub download_ms: u64,
    pub total_ms: u64,
}

pub struct RawResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub timing: TimingBreakdown,
}

static TLS_CONFIG: OnceLock<Arc<ClientConfig>> = OnceLock::new();

fn tls_config() -> Result<Arc<ClientConfig>, EngineError> {
    if let Some(cfg) = TLS_CONFIG.get() {
        return Ok(cfg.clone());
    }
    let mut roots = RootCertStore::empty();
    let loaded = rustls_native_certs::load_native_certs();
    for cert in loaded.certs {
        roots
            .add(cert)
            .map_err(|e| EngineError::Tls(e.to_string()))?;
    }
    let config = Arc::new(
        ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth(),
    );
    Ok(TLS_CONFIG.get_or_init(|| config).clone())
}

async fn resolve(host: &str) -> Result<IpAddr, EngineError> {
    let resolver = hickory_resolver::TokioAsyncResolver::tokio_from_system_conf()
        .map_err(|e| EngineError::Dns(e.to_string()))?;
    let response = resolver
        .lookup_ip(host)
        .await
        .map_err(|e| EngineError::Dns(e.to_string()))?;
    response
        .iter()
        .next()
        .ok_or_else(|| EngineError::Dns(format!("no records for {host}")))
}

/// Drives the hyper http1 handshake, sends the request, and collects the body
/// over an already-established (and, for https, already TLS-wrapped) stream.
async fn handshake_and_send<T>(
    io: T,
    req: http::Request<Full<Bytes>>,
) -> Result<(http::response::Parts, Bytes, u64, u64), EngineError>
where
    T: hyper::rt::Read + hyper::rt::Write + Unpin + Send + 'static,
{
    let (mut sender, conn) = hyper::client::conn::http1::handshake(io)
        .await
        .map_err(|e| EngineError::Connect(e.to_string()))?;
    tokio::spawn(async move {
        let _ = conn.await;
    });

    let ttfb_start = Instant::now();
    let resp = sender
        .send_request(req)
        .await
        .map_err(|e| EngineError::Send(e.to_string()))?;
    let ttfb_ms = ttfb_start.elapsed().as_millis() as u64;

    let (parts, body) = resp.into_parts();
    let dl_start = Instant::now();
    let collected = body
        .collect()
        .await
        .map_err(|e| EngineError::BodyRead(e.to_string()))?;
    let download_ms = dl_start.elapsed().as_millis() as u64;

    Ok((parts, collected.to_bytes(), ttfb_ms, download_ms))
}

fn build_request(
    method: &str,
    url: &url::Url,
    host_header: &str,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
) -> Result<http::Request<Full<Bytes>>, EngineError> {
    let target = &url[url::Position::AfterPort..];
    let target = if target.is_empty() { "/" } else { target };

    let mut builder = http::Request::builder()
        .method(
            http::Method::from_bytes(method.as_bytes())
                .map_err(|e| EngineError::Send(e.to_string()))?,
        )
        .uri(target)
        .header("Host", host_header);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    builder
        .body(Full::new(Bytes::from(body)))
        .map_err(|e| EngineError::Send(e.to_string()))
}

/// Low-level: opens one new connection and stamps every phase (DNS/TCP/TLS/TTFB/download).
pub async fn execute(
    method: &str,
    url: &url::Url,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
) -> Result<RawResponse, EngineError> {
    tokio::time::timeout(
        Duration::from_secs(30),
        execute_inner(method, url, headers, body),
    )
    .await
    .map_err(|_| EngineError::Timeout)?
}

async fn execute_inner(
    method: &str,
    url: &url::Url,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
) -> Result<RawResponse, EngineError> {
    let t0 = Instant::now();
    let https = url.scheme() == "https";
    let host = url
        .host_str()
        .ok_or_else(|| EngineError::Connect("missing host".to_string()))?;
    let port = url
        .port_or_known_default()
        .unwrap_or(if https { 443 } else { 80 });
    let host_header = match url.port() {
        Some(p) => format!("{host}:{p}"),
        None => host.to_string(),
    };

    // 1. DNS
    let dns_start = Instant::now();
    let ip = resolve(host).await?;
    let dns_ms = dns_start.elapsed().as_millis() as u64;

    // 2. TCP
    let tcp_start = Instant::now();
    let stream = TcpStream::connect((ip, port))
        .await
        .map_err(|e| EngineError::Connect(e.to_string()))?;
    let tcp_ms = tcp_start.elapsed().as_millis() as u64;

    let req = build_request(method, url, &host_header, headers, body)?;

    let (parts, bytes, ttfb_ms, download_ms, tls_ms) = if https {
        let cfg = tls_config()?;
        let tls_start = Instant::now();
        let connector = TlsConnector::from(cfg);
        let server_name =
            ServerName::try_from(host.to_string()).map_err(|e| EngineError::Tls(e.to_string()))?;
        let tls_stream = connector
            .connect(server_name, stream)
            .await
            .map_err(|e| EngineError::Tls(e.to_string()))?;
        let tls_ms = tls_start.elapsed().as_millis() as u64;
        let (parts, bytes, ttfb_ms, download_ms) =
            handshake_and_send(TokioIo::new(tls_stream), req).await?;
        (parts, bytes, ttfb_ms, download_ms, Some(tls_ms))
    } else {
        let (parts, bytes, ttfb_ms, download_ms) =
            handshake_and_send(TokioIo::new(stream), req).await?;
        (parts, bytes, ttfb_ms, download_ms, None)
    };

    let headers = parts
        .headers
        .iter()
        .map(|(name, value)| {
            (
                name.to_string(),
                value.to_str().unwrap_or("<binary>").to_string(),
            )
        })
        .collect();

    Ok(RawResponse {
        status: parts.status.as_u16(),
        headers,
        body: String::from_utf8_lossy(&bytes).to_string(),
        timing: TimingBreakdown {
            dns_ms: Some(dns_ms),
            tcp_ms: Some(tcp_ms),
            tls_ms,
            ttfb_ms,
            download_ms,
            total_ms: t0.elapsed().as_millis() as u64,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal one-shot HTTP server on a random port; replies with a canned 200 and closes.
    async fn spawn_canned_200() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                use tokio::io::AsyncWriteExt;
                let _ = stream
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                    .await;
            }
        });
        format!("http://127.0.0.1:{}/", addr.port())
    }

    #[tokio::test]
    async fn execute_stamps_all_http_phases() {
        let addr = spawn_canned_200().await;
        let url = url::Url::parse(&addr).unwrap();
        let r = execute("GET", &url, vec![], vec![]).await.unwrap();
        assert_eq!(r.status, 200);
        assert!(r.timing.dns_ms.is_some());
        assert!(r.timing.tcp_ms.is_some());
        assert!(r.timing.tls_ms.is_none());
        assert!(r.timing.total_ms >= r.timing.ttfb_ms);
    }
}
