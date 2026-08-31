use std::{io::Write, path::Path};

pub(super) const ACTIVE_CONFIG_FILE: &str = "active.conf";
pub(super) const CANDIDATE_CONFIG_FILE: &str = "candidate.conf";
pub(super) const LAST_GOOD_CONFIG_FILE: &str = "last-good.conf";
pub(super) const LAST_APPLY_FILE: &str = "last-apply-at";
pub(super) fn prepare_state_dir(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub(super) fn atomic_write(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let temporary = path.with_extension("tmp");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)?;
    file.write_all(contents)?;
    file.sync_all()?;
    drop(file);
    replace_file(&temporary, path)
}

pub(super) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    if destination.exists() {
        std::fs::remove_file(destination)?;
    }
    std::fs::rename(source, destination)?;
    #[cfg(unix)]
    sync_parent_directory(destination)?;
    Ok(())
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "runtime file has no parent directory",
        )
    })?;
    std::fs::File::open(parent)?.sync_all()
}

pub(super) fn read_trimmed(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}
