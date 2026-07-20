use thiserror::Error;

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("value does not match schema at {path}")]
    #[allow(dead_code)]
    ValueMismatch { path: String }, // serializer (Task 3) consumes this
}
