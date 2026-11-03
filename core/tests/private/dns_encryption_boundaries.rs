use super::*;

struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let path = env::temp_dir().join(format!(
            "rentnerproxy-key-boundaries-{}-{}",
            std::process::id(),
            time::OffsetDateTime::now_utc().unix_timestamp_nanos()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn key_environment_child() {
    let Ok(expected) = env::var("RENTNERPROXY_KEY_TEST_CASE") else {
        return;
    };
    let result = encryption_key_from_environment();
    if expected == "valid" {
        assert_eq!(result.unwrap(), [9; 32]);
    } else {
        assert!(matches!(
            result,
            Err(CertificateError::DnsCredentialsUnavailable)
        ));
    }
}

#[test]
fn encryption_key_environment_sources_are_exclusive_and_fail_closed() {
    let directory = Directory::new();
    let path = directory.0.join("key");
    let encoded = STANDARD.encode([9; 32]);
    fs::write(&path, format!(" {encoded}\n")).unwrap();
    let cases = [
        (Some(encoded.clone().into()), None, "valid"),
        (None, Some(path.into_os_string()), "valid"),
        (Some(encoded.into()), Some("ignored-file".into()), "invalid"),
        (None, None, "invalid"),
        (Some("malformed-base64".into()), None, "invalid"),
        (None, Some("relative".into()), "invalid"),
    ];
    let run =
        |direct: Option<std::ffi::OsString>, file: Option<std::ffi::OsString>, expected: &str| {
            let mut command = std::process::Command::new(env::current_exe().unwrap());
            command
                .env_clear()
                .args([
                    "--exact",
                    "runtime::dns::encryption::boundary_tests::key_environment_child",
                ])
                .env("RENTNERPROXY_KEY_TEST_CASE", expected);
            for variable in ["SystemRoot", "LLVM_PROFILE_FILE"] {
                if let Some(value) = env::var_os(variable) {
                    command.env(variable, value);
                }
            }
            if let Some(value) = direct {
                command.env(APP_ENCRYPTION_KEY_ENV, value);
            }
            if let Some(value) = file {
                command.env(APP_ENCRYPTION_KEY_FILE_ENV, value);
            }
            let output = command.output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
        };
    for (direct, file, expected) in cases {
        run(direct, file, expected);
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        run(
            Some(std::ffi::OsString::from_vec(vec![255])),
            None,
            "invalid",
        );
        run(
            None,
            Some(std::ffi::OsString::from_vec(vec![255])),
            "invalid",
        );
    }
}

#[test]
fn encryption_key_files_reject_nonregular_oversized_and_malformed_content() {
    let directory = Directory::new();
    let path = directory.0.join("key");
    assert!(matches!(
        read_key_file(PathBuf::from("relative")),
        Err(CertificateError::DnsCredentialsUnavailable)
    ));
    assert!(read_key_file(path.clone()).is_err());
    assert!(read_key_file(directory.0.clone()).is_err());
    for bytes in [vec![b'a'; 4097], vec![0], vec![255]] {
        fs::write(&path, bytes).unwrap();
        assert!(matches!(
            read_key_file(path.clone()),
            Err(CertificateError::DnsCredentialsUnavailable)
        ));
    }
    let encoded = STANDARD.encode([9_u8; 32]);
    fs::write(&path, format!(" {encoded}\n")).unwrap();
    assert_eq!(
        decode_encryption_key(read_key_file(path.clone()).unwrap().trim()).unwrap(),
        [9; 32]
    );
    #[cfg(unix)]
    {
        let link = directory.0.join("link");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        assert!(read_key_file(link).is_err());
    }
    for invalid in [
        "".to_owned(),
        "!".to_owned(),
        STANDARD.encode([9_u8; 31]),
        STANDARD.encode([9_u8; 33]),
        encoded.trim_end_matches('=').to_owned(),
    ] {
        assert!(decode_encryption_key(&invalid).is_err());
    }
}

#[test]
fn ciphertext_limits_and_authentication_prevent_credential_substitution() {
    let key = [7; 32];
    let encrypted = encrypt_bytes(b"not json", "certificate-a", &key).unwrap();
    assert_eq!(
        decrypt_bytes(&encrypted, "certificate-a", &key).unwrap(),
        b"not json"
    );
    assert!(decrypt_with_key(&encrypted, "certificate-a", &key).is_err());
    assert!(decrypt_bytes(&encrypted, "certificate-b", &key).is_err());
    assert!(decrypt_bytes(&encrypted, "certificate-a", &[8; 32]).is_err());
    let mut tampered = encrypted.clone();
    tampered.ciphertext[0] ^= 1;
    assert!(decrypt_bytes(&tampered, "certificate-a", &key).is_err());
    for (version, nonce, ciphertext) in [(2, 12, 16), (1, 11, 16), (1, 12, 15), (1, 12, 8193)] {
        let malformed = EncryptedDnsConfig {
            version,
            nonce: vec![0; nonce],
            ciphertext: vec![0; ciphertext],
        };
        assert!(matches!(
            decrypt_bytes(&malformed, "certificate-a", &key),
            Err(CertificateError::DnsProviderInvalid)
        ));
        assert!(matches!(
            decrypt(&malformed, "certificate-a"),
            Err(CertificateError::DnsProviderInvalid)
        ));
    }
    let boundary = vec![0; MAX_ENCRYPTED_CIPHERTEXT_BYTES - 16];
    let encrypted = encrypt_bytes(&boundary, "certificate-a", &key).unwrap();
    assert_eq!(encrypted.ciphertext.len(), MAX_ENCRYPTED_CIPHERTEXT_BYTES);
    assert_eq!(
        decrypt_bytes(&encrypted, "certificate-a", &key).unwrap(),
        boundary
    );
    assert!(matches!(
        encrypt_bytes(
            &vec![0; MAX_ENCRYPTED_CIPHERTEXT_BYTES - 15],
            "certificate-a",
            &key
        ),
        Err(CertificateError::DnsProviderInvalid)
    ));
    assert!(matches!(
        decrypt(&encrypted, "../other"),
        Err(CertificateError::DnsProviderInvalid)
    ));
}
