use crate::pem::has_only_pem_blocks;

#[test]
fn pem_grammar_preserves_label_and_block_count_constraints() {
    let certificate = "-----BEGIN CERTIFICATE-----\nYWJjZA==\n-----END CERTIFICATE-----";
    let key = "-----BEGIN PRIVATE KEY-----\r\nYWJjZA==\r\n-----END PRIVATE KEY-----";
    let bundle = format!(" \t{certificate}\n\n{certificate}\r\n");
    assert!(has_only_pem_blocks(&bundle, &["CERTIFICATE"], false));
    assert!(!has_only_pem_blocks(&bundle, &["CERTIFICATE"], true));
    assert!(has_only_pem_blocks(
        key,
        &["PRIVATE KEY", "RSA PRIVATE KEY"],
        true
    ));
    assert!(!has_only_pem_blocks(key, &["CERTIFICATE"], false));
    for malformed in [
        String::new(),
        format!("{certificate}trailing"),
        certificate.replace("\nYWJjZA==\n", ""),
        certificate.replace("YWJjZA==", "YWJj!ZA=="),
        certificate.replace("END CERTIFICATE", "END PRIVATE KEY"),
        format!("{certificate}\n{key}"),
    ] {
        assert!(!has_only_pem_blocks(&malformed, &["CERTIFICATE"], false));
    }
}
