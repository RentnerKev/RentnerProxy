use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};

use crate::{
    models::TrustedCa,
    proxy::{MAX_TRUSTED_CA_PEM_BYTES, is_canonical_uuid_v7},
};

const TRUSTED_CAS_DIRECTORY: &str = "trusted-cas";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TrustedCaMaterial {
    pub(crate) pem_path: PathBuf,
}

pub(crate) struct TrustedCaStore {
    state_dir: PathBuf,
}

impl TrustedCaStore {
    pub(crate) fn new(state_dir: PathBuf) -> Self {
        Self { state_dir }
    }

    pub(crate) fn initialize(&self) -> Result<(), ()> {
        ensure_existing_secure_directory(&self.state_dir)?;
        ensure_secure_directory(&self.trusted_cas_dir())
    }

    pub(crate) fn materialize(&self, trusted_ca: &TrustedCa) -> Result<TrustedCaMaterial, ()> {
        let validated = crate::proxy::validate_trusted_ca(trusted_ca).map_err(|_| ())?;
        if validated.pem != trusted_ca.pem {
            return Err(());
        }
        let material = self.material_for(trusted_ca)?;
        let parent = material.pem_path.parent().ok_or(())?;
        ensure_existing_secure_directory(&self.state_dir)?;
        ensure_secure_directory(&self.trusted_cas_dir())?;
        ensure_secure_directory(parent)?;
        write_or_verify_public_file(&material.pem_path, validated.pem.as_bytes())?;
        Ok(material)
    }

    pub(crate) fn material_for(&self, trusted_ca: &TrustedCa) -> Result<TrustedCaMaterial, ()> {
        if !is_canonical_uuid_v7(&trusted_ca.id) {
            return Err(());
        }
        let fingerprint = trusted_ca
            .fingerprint_sha256
            .strip_prefix("sha256:")
            .filter(|fingerprint| {
                fingerprint.len() == 64
                    && fingerprint
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
            })
            .ok_or(())?;
        Ok(TrustedCaMaterial {
            pem_path: self
                .trusted_cas_dir()
                .join(&trusted_ca.id)
                .join(format!("{fingerprint}.pem")),
        })
    }

    fn trusted_cas_dir(&self) -> PathBuf {
        self.state_dir.join(TRUSTED_CAS_DIRECTORY)
    }
}

fn ensure_secure_directory(path: &Path) -> Result<(), ()> {
    match fs::symlink_metadata(path) {
        Ok(_) => ensure_existing_secure_directory(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            create_private_directory(path)
        }
        Err(_) => Err(()),
    }
}

fn create_private_directory(path: &Path) -> Result<(), ()> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            #[cfg(unix)]
            {
                fs::DirBuilder::new()
                    .mode(0o700)
                    .create(path)
                    .map_err(|_| ())?;
            }
            #[cfg(not(unix))]
            {
                fs::create_dir(path).map_err(|_| ())?;
            }
        }
        _ => return Err(()),
    }
    ensure_existing_secure_directory(path)
}

fn ensure_existing_secure_directory(path: &Path) -> Result<(), ()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ())?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() {
        return Err(());
    }
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| ())?;
    Ok(())
}

fn write_or_verify_public_file(path: &Path, bytes: &[u8]) -> Result<(), ()> {
    let parent = path.parent().ok_or(())?;
    ensure_existing_secure_directory(parent)?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() && !metadata.file_type().is_symlink() => {
            let existing = read_regular_file(path)?;
            return (existing == bytes).then_some(()).ok_or(());
        }
        Ok(_) => return Err(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(()),
    }

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ())?
        .as_nanos();
    let temporary = path.with_extension(format!("{}.{}.tmp", std::process::id(), nanos));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&temporary).map_err(|_| ())?;
    #[cfg(unix)]
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|_| ())?;
    let result = file.write_all(bytes).and_then(|_| file.sync_all());
    drop(file);
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(());
    }
    if fs::rename(&temporary, path).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(());
    }
    #[cfg(unix)]
    {
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| ())?;
    }
    Ok(())
}

fn read_regular_file(path: &Path) -> Result<Vec<u8>, ()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ())?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(());
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    let mut file = options.open(path).map_err(|_| ())?;
    let opened_metadata = file.metadata().map_err(|_| ())?;
    if !opened_metadata.file_type().is_file() {
        return Err(());
    }
    let mut contents = Vec::new();
    Read::by_ref(&mut file)
        .take((MAX_TRUSTED_CA_PEM_BYTES as u64) + 1)
        .read_to_end(&mut contents)
        .map_err(|_| ())?;
    (contents.len() <= MAX_TRUSTED_CA_PEM_BYTES)
        .then_some(contents)
        .ok_or(())
}
