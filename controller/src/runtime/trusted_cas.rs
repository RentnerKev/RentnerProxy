use std::{io::ErrorKind, path::PathBuf};

use crate::{
    models::TrustedCa,
    proxy::{MAX_TRUSTED_CA_PEM_BYTES, is_canonical_uuid_v7},
};

use super::state::{SafeDir, state_dir, validate_component};

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
        self.state_dir()?
            .ensure_dir(TRUSTED_CAS_DIRECTORY)
            .map(|_| ())
            .map_err(|_| ())
    }

    pub(crate) fn materialize(&self, trusted_ca: &TrustedCa) -> Result<TrustedCaMaterial, ()> {
        let validated = crate::proxy::validate_trusted_ca(trusted_ca).map_err(|_| ())?;
        if validated.pem != trusted_ca.pem {
            return Err(());
        }
        let (directory, filename) = self.material_directory(trusted_ca)?;
        match directory.read_file(&filename, MAX_TRUSTED_CA_PEM_BYTES) {
            Ok(existing) => (existing == validated.pem.as_bytes())
                .then_some(())
                .ok_or(())?,
            Err(error) if error.kind() == ErrorKind::NotFound => directory
                .atomic_write(&filename, validated.pem.as_bytes())
                .map_err(|_| ())?,
            Err(_) => return Err(()),
        }
        Ok(TrustedCaMaterial {
            pem_path: directory.child_path(&filename).map_err(|_| ())?,
        })
    }

    pub(crate) fn material_for(&self, trusted_ca: &TrustedCa) -> Result<TrustedCaMaterial, ()> {
        let filename = material_filename(trusted_ca)?;
        let pem_path = self
            .state_dir
            .join(TRUSTED_CAS_DIRECTORY)
            .join(&trusted_ca.id)
            .join(&filename);
        Ok(TrustedCaMaterial { pem_path })
    }

    fn state_dir(&self) -> Result<SafeDir, ()> {
        state_dir(&self.state_dir).map_err(|_| ())
    }

    fn material_directory(&self, trusted_ca: &TrustedCa) -> Result<(SafeDir, String), ()> {
        let filename = material_filename(trusted_ca)?;
        let trusted_cas = self
            .state_dir()?
            .open_dir(TRUSTED_CAS_DIRECTORY)
            .map_err(|_| ())?;
        let directory = trusted_cas.ensure_dir(&trusted_ca.id).map_err(|_| ())?;
        Ok((directory, filename))
    }
}

fn material_filename(trusted_ca: &TrustedCa) -> Result<String, ()> {
    if !is_canonical_uuid_v7(&trusted_ca.id) {
        return Err(());
    }
    validate_component(&trusted_ca.id).map_err(|_| ())?;
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
    let filename = format!("{fingerprint}.pem");
    validate_component(&filename).map_err(|_| ())?;
    Ok(filename)
}
