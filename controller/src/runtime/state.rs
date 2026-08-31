use std::{
    fs::{File, Metadata, OpenOptions},
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) const ACTIVE_CONFIG_FILE: &str = "active.conf";
pub(super) const CANDIDATE_CONFIG_FILE: &str = "candidate.conf";
pub(super) const LAST_GOOD_CONFIG_FILE: &str = "last-good.conf";
pub(super) const LAST_APPLY_FILE: &str = "last-apply-at";

pub(super) fn prepare_state_dir(path: &Path) -> std::io::Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() && !is_link(&metadata) => {}
        Ok(_) => return Err(invalid_state_path()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(path)?
        }
        Err(error) => return Err(error),
    }
    check_state_directory(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub(super) fn open_state_file(directory: &Path, path: &Path) -> std::io::Result<File> {
    check_state_directory(directory)?;
    let directory = directory.canonicalize()?;
    let metadata = std::fs::symlink_metadata(path)?;
    if is_link(&metadata) || !metadata.file_type().is_file() {
        return Err(invalid_state_path());
    }

    // Resolve before checking containment so parent components and links cannot escape.
    let path = path.canonicalize()?;
    if !path.starts_with(&directory) || path.parent() != Some(directory.as_path()) {
        return Err(invalid_state_path());
    }

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_FLAG_OPEN_REPARSE_POINT: open the link itself if the leaf was replaced.
        options.custom_flags(0x0020_0000);
    }
    let file = options.open(&path)?;
    let metadata = file.metadata()?;
    if is_link(&metadata) || !metadata.file_type().is_file() {
        return Err(invalid_state_path());
    }
    Ok(file)
}

fn check_state_directory(path: &Path) -> std::io::Result<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    if !path.is_absolute() || is_link(&metadata) || !metadata.file_type().is_dir() {
        return Err(invalid_state_path());
    }
    Ok(())
}

fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // FILE_ATTRIBUTE_REPARSE_POINT also covers junctions, not just symbolic links.
        metadata.file_attributes() & 0x0000_0400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn invalid_state_path() -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "runtime state path is not a regular entry in its state directory",
    )
}

pub(super) fn atomic_write(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(invalid_state_path)?;
    check_state_directory(parent)?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(std::io::Error::other)?
        .as_nanos();
    let temporary = path.with_extension(format!("{}.{}.tmp", std::process::id(), nanos));
    let mut options = OpenOptions::new();
    // Never truncate an existing file or follow a planted temporary-file link.
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    let result = file.write_all(contents).and_then(|()| file.sync_all());
    drop(file);
    let result = result.and_then(|()| replace_file(&temporary, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

pub(super) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
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
