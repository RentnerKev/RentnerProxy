use super::{CertificateImportRequest, material_id};

#[test]
fn material_id_matches_persisted_sha256_vectors() {
    for (certificate, chain, private_key, expected) in [
        (
            "certificate",
            Some("chain"),
            "private-key",
            "8ee25bedd40f55ce9196fa7e8590f09357ea4e88906e4cfc0be6570eac0e15ee",
        ),
        (
            "certificate",
            None,
            "private-key",
            "80f6c212ef010624972a7a7d28e181d2c3654659d1a52f33307151071e289d06",
        ),
        (
            "certificate",
            Some(""),
            "private-key",
            "80f6c212ef010624972a7a7d28e181d2c3654659d1a52f33307151071e289d06",
        ),
        (
            "ab",
            Some("c"),
            "d",
            "1e8937e355807742dbbfefeaad0aef5637d7f50d5cd6840ee582e006efba2510",
        ),
        (
            "a",
            Some("bc"),
            "d",
            "702f90638317c6b719064288228a8f775295013b1d77e1712ea3f3b653c45339",
        ),
    ] {
        let request = CertificateImportRequest {
            certificate_pem: certificate.to_owned(),
            private_key_pem: private_key.to_owned(),
            chain_pem: chain.map(str::to_owned),
            required_domains: None,
        };
        assert_eq!(material_id(&request), expected);
    }
}
