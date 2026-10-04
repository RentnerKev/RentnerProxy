use super::bundle_fingerprint;
use rustls::pki_types::CertificateDer;

#[test]
fn bundle_fingerprint_matches_persisted_sha256_vectors() {
    let first = CertificateDer::from(vec![0x30, 0x03, 0x00, 0xff, 0x01]);
    let second = CertificateDer::from(vec![0x30, 0x02, 0x02, 0x03]);

    assert_eq!(
        bundle_fingerprint(&[first.clone(), second.clone()]),
        "sha256:009cf50fd54c356b75868f4041000b863cf534a86608c20133d059c136eeb33b"
    );
    assert_eq!(
        bundle_fingerprint(&[second, first]),
        "sha256:b07e5bfb48c4525174cc6769490cd7f5c85f88647921256a12431a9a5741c731"
    );
}
