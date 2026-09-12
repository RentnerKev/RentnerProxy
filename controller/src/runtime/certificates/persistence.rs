use super::validation::{index_is_valid, write_private_file};
use super::{
    CERTIFICATE_INDEX_FILE, CertificateError, CertificateIndex, CertificateOperation,
    INTERRUPTED_OPERATION_HEADROOM_BYTES, MAX_CERTIFICATE_INDEX_BYTES, SafeDir,
};

pub(super) fn persist_index(
    directory: &SafeDir,
    index: &CertificateIndex,
) -> Result<(), CertificateError> {
    if !index_is_valid(index) {
        return Err(CertificateError::StoreUnavailable);
    }
    let bytes = serde_json::to_vec(index).map_err(|_| CertificateError::StoreUnavailable)?;
    let recovery_headroom = index
        .certificates
        .values()
        .filter(|entry| entry.metadata.operation != CertificateOperation::Idle)
        .count()
        * INTERRUPTED_OPERATION_HEADROOM_BYTES;
    if bytes.len().saturating_add(recovery_headroom) > MAX_CERTIFICATE_INDEX_BYTES {
        return Err(CertificateError::StoreUnavailable);
    }
    write_private_file(directory, CERTIFICATE_INDEX_FILE, &bytes)
}
