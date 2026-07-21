use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("DNS: {0}")]
    Dns(String),
    #[error("connect: {0}")]
    Connect(String),
    #[error("TLS: {0}")]
    Tls(String),
    #[error("send: {0}")]
    Send(String),
    #[error("request timed out")]
    Timeout,
    #[error("body read: {0}")]
    BodyRead(String),
}
