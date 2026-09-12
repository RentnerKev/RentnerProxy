use std::{env, fs, io::Read, path::PathBuf};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};

use crate::runtime::certificates::CertificateError;

use super::{
    config::DnsProviderConfig, models::EncryptedDnsConfig, validation::is_safe_certificate_id,
};

const APP_ENCRYPTION_KEY_ENV: &str = "APP_ENCRYPTION_KEY";
const APP_ENCRYPTION_KEY_FILE_ENV: &str = "APP_ENCRYPTION_KEY_FILE";
const MAX_ENCRYPTED_CIPHERTEXT_BYTES: usize = 8 * 1024;
const AES_GCM_NONCE_BYTES: usize = 12;
const ENCRYPTED_DNS_CONFIG_VERSION: u8 = 1;
const MAX_KEY_FILE_BYTES: u64 = 4 * 1024;

pub(crate) fn encrypt(
    config: &DnsProviderConfig,
    certificate_id: &str,
) -> Result<EncryptedDnsConfig, CertificateError> {
    config.validate()?;
    validate_aad(certificate_id)?;
    let key = encryption_key_from_environment()?;
    encrypt_with_key(config, certificate_id, &key)
}

pub(crate) fn decrypt(
    encrypted: &EncryptedDnsConfig,
    certificate_id: &str,
) -> Result<DnsProviderConfig, CertificateError> {
    validate_aad(certificate_id)?;
    validate_encrypted_config(encrypted)?;
    let key = encryption_key_from_environment()?;
    decrypt_with_key(encrypted, certificate_id, &key)
}

fn encryption_key_from_environment() -> Result<[u8; 32], CertificateError> {
    let direct = env::var_os(APP_ENCRYPTION_KEY_ENV);
    let file = env::var_os(APP_ENCRYPTION_KEY_FILE_ENV);
    if direct.is_some() && file.is_some() {
        return Err(CertificateError::DnsCredentialsUnavailable);
    }
    let value = if let Some(value) = direct {
        value
            .into_string()
            .map_err(|_| CertificateError::DnsCredentialsUnavailable)?
    } else if let Some(path) = file {
        let path = path
            .into_string()
            .map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
        read_key_file(PathBuf::from(path))?
    } else {
        return Err(CertificateError::DnsCredentialsUnavailable);
    };
    decode_encryption_key(value.trim())
}

fn read_key_file(path: PathBuf) -> Result<String, CertificateError> {
    if !path.is_absolute() {
        return Err(CertificateError::DnsCredentialsUnavailable);
    }
    let metadata =
        fs::symlink_metadata(&path).map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(CertificateError::DnsCredentialsUnavailable);
    }
    let file = fs::File::open(path).map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    let mut bytes = Vec::with_capacity((MAX_KEY_FILE_BYTES + 1) as usize);
    file.take(MAX_KEY_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    if bytes.len() as u64 > MAX_KEY_FILE_BYTES || bytes.contains(&0) {
        return Err(CertificateError::DnsCredentialsUnavailable);
    }
    String::from_utf8(bytes).map_err(|_| CertificateError::DnsCredentialsUnavailable)
}

fn decode_encryption_key(value: &str) -> Result<[u8; 32], CertificateError> {
    let decoded = STANDARD
        .decode(value.as_bytes())
        .map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    if decoded.len() != 32 || STANDARD.encode(&decoded) != value {
        return Err(CertificateError::DnsCredentialsUnavailable);
    }
    let mut key = [0_u8; 32];
    key.copy_from_slice(&decoded);
    Ok(key)
}

pub(super) fn encrypt_with_key(
    config: &DnsProviderConfig,
    certificate_id: &str,
    key_bytes: &[u8; 32],
) -> Result<EncryptedDnsConfig, CertificateError> {
    let plaintext = serde_json::to_vec(config).map_err(|_| CertificateError::DnsProviderInvalid)?;
    let mut ciphertext = plaintext;
    let mut nonce_bytes = [0_u8; AES_GCM_NONCE_BYTES];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, key_bytes)
            .map_err(|_| CertificateError::DnsCredentialsUnavailable)?,
    );
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce_bytes),
        aead::Aad::from(certificate_id.as_bytes()),
        &mut ciphertext,
    )
    .map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    if ciphertext.len() > MAX_ENCRYPTED_CIPHERTEXT_BYTES {
        return Err(CertificateError::DnsProviderInvalid);
    }
    Ok(EncryptedDnsConfig {
        version: ENCRYPTED_DNS_CONFIG_VERSION,
        nonce: nonce_bytes.to_vec(),
        ciphertext,
    })
}

pub(super) fn decrypt_with_key(
    encrypted: &EncryptedDnsConfig,
    certificate_id: &str,
    key_bytes: &[u8; 32],
) -> Result<DnsProviderConfig, CertificateError> {
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, key_bytes)
            .map_err(|_| CertificateError::DnsCredentialsUnavailable)?,
    );
    let mut ciphertext = encrypted.ciphertext.clone();
    let plaintext = key
        .open_in_place(
            aead::Nonce::try_assume_unique_for_key(&encrypted.nonce)
                .map_err(|_| CertificateError::DnsProviderInvalid)?,
            aead::Aad::from(certificate_id.as_bytes()),
            &mut ciphertext,
        )
        .map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    serde_json::from_slice(plaintext).map_err(|_| CertificateError::DnsProviderInvalid)
}

fn validate_aad(certificate_id: &str) -> Result<(), CertificateError> {
    is_safe_certificate_id(certificate_id)
        .then_some(())
        .ok_or(CertificateError::DnsProviderInvalid)
}

fn validate_encrypted_config(encrypted: &EncryptedDnsConfig) -> Result<(), CertificateError> {
    if encrypted.version != ENCRYPTED_DNS_CONFIG_VERSION
        || encrypted.nonce.len() != AES_GCM_NONCE_BYTES
        || encrypted.ciphertext.len() < 16
        || encrypted.ciphertext.len() > MAX_ENCRYPTED_CIPHERTEXT_BYTES
    {
        return Err(CertificateError::DnsProviderInvalid);
    }
    Ok(())
}
