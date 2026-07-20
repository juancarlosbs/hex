use thiserror::Error;

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("value does not match schema at {path}")]
    ValueMismatch { path: String },
}
