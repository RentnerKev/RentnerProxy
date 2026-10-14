/// Install the preferred provider for constructors that can run independently.
/// A provider already selected by the process is intentionally left unchanged.
pub(super) fn ensure_crypto_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        // A concurrent constructor may win installation; its provider is retained.
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    }
}
