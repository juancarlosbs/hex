use thiserror::Error;

#[derive(Debug, Error)]
pub enum WsdlError {
    #[error("failed to fetch {url}: {message}")]
    Fetch { url: String, message: String },
    #[error("invalid XML in {url}: {message}")]
    InvalidXml { url: String, message: String },
    #[error("unsupported WSDL style: rpc/encoded is not supported (only document/literal)")]
    UnsupportedStyle,
    #[error("not found in WSDL: {qname}")]
    ElementNotFound { qname: String },
    #[error("type not found in schema: {qname}")]
    TypeNotFound { qname: String },
}
