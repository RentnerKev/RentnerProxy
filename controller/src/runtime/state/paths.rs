use super::validate_component;
use std::{
    fs::{self, Metadata},
    io::ErrorKind,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) fn canonical_absolute_entry(path: &Path) -> std::io::Result<PathBuf> {
    validate_path(path)?;
    if !path.is_absolute() {
        return Err(invalid_state_path());
    }
    #[cfg(unix)]
    let requested = path;
    let parent = path
        .parent()
        .ok_or_else(invalid_state_path)?
        .canonicalize()?;
    let path = path.canonicalize()?;
    ensure_direct_child(&parent, &path)?;
    #[cfg(unix)]
    if path != requested {
        return Err(invalid_state_path());
    }
    Ok(path)
}

pub(super) fn resolve_existing_path(path: &Path) -> std::io::Result<PathBuf> {
    validate_path(path)?;
    if !path.is_absolute() {
        return Err(invalid_state_path());
    }
    let canonical = path.canonicalize()?;
    #[cfg(unix)]
    if canonical != path {
        return Err(invalid_state_path());
    }
    Ok(canonical)
}

fn validate_path(path: &Path) -> std::io::Result<()> {
    let value = path.to_string_lossy();
    if value.is_empty() || value.contains("..") || value.contains('\0') {
        return Err(invalid_state_path());
    }

    #[cfg(windows)]
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if is_link(&metadata) => return Err(invalid_state_path()),
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

pub(super) fn create_missing_state_directory(path: &Path) -> std::io::Result<PathBuf> {
    validate_path(path)?;
    if !path.is_absolute() {
        return Err(invalid_state_path());
    }
    let mut missing = Vec::<String>::new();
    let mut ancestor = path;
    let root = loop {
        match ancestor.canonicalize() {
            Ok(root) => break root,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                let component = ancestor
                    .file_name()
                    .and_then(|value| value.to_str())
                    .ok_or_else(invalid_state_path)?;
                validate_component(component)?;
                missing.push(component.to_owned());
                ancestor = ancestor.parent().ok_or_else(invalid_state_path)?;
            }
            Err(error) => return Err(error),
        }
    };
    let mut parent = root;
    let metadata = fs::symlink_metadata(&parent)?;
    if is_link(&metadata) || !metadata.file_type().is_dir() {
        return Err(invalid_state_path());
    }
    for component in missing.iter().rev() {
        let candidate = parent.join(component);
        create_private_directory(&candidate)?;
        let child = candidate.canonicalize()?;
        ensure_direct_child(&parent, &child)?;
        let metadata = fs::symlink_metadata(&child)?;
        if is_link(&metadata) || !metadata.file_type().is_dir() {
            return Err(invalid_state_path());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&child, fs::Permissions::from_mode(0o700))?;
        }
        parent = child;
    }
    Ok(parent)
}

pub(super) fn create_private_directory(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        match fs::DirBuilder::new().mode(0o700).create(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(error),
        }
    }
    #[cfg(not(unix))]
    match fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error),
    }
}

pub(super) fn ensure_direct_child(parent: &Path, path: &Path) -> std::io::Result<()> {
    if !path.starts_with(parent) || path.parent() != Some(parent) {
        return Err(invalid_state_path());
    }
    Ok(())
}

pub(super) fn ensure_regular_file_metadata(metadata: &Metadata) -> std::io::Result<()> {
    if is_link(metadata) || !metadata.file_type().is_file() {
        return Err(invalid_state_path());
    }
    Ok(())
}

pub(super) fn remove_tree_without_links(parent: &Path, path: &Path) -> std::io::Result<()> {
    let path = path.canonicalize()?;
    ensure_direct_child(parent, &path)?;
    let metadata = fs::symlink_metadata(&path)?;
    if is_link(&metadata) {
        return Err(invalid_state_path());
    }
    if metadata.file_type().is_file() {
        return fs::remove_file(&path);
    }
    if !metadata.file_type().is_dir() {
        return Err(invalid_state_path());
    }
    for entry in fs::read_dir(&path)? {
        let entry = entry?;
        let name = entry
            .file_name()
            .to_str()
            .ok_or_else(invalid_state_path)?
            .to_owned();
        validate_component(&name)?;
        let requested = path.join(&name);
        let child = requested.canonicalize()?;
        #[cfg(unix)]
        if child != requested {
            return Err(invalid_state_path());
        }
        remove_tree_without_links(&path, &child)?;
    }
    fs::remove_dir(path)
}

pub(super) fn temporary_component(component: &str) -> std::io::Result<String> {
    validate_component(component)?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(std::io::Error::other)?
        .as_nanos();
    let temporary = format!(".{component}.{}.{}.tmp", std::process::id(), nanos);
    validate_component(&temporary)?;
    Ok(temporary)
}

pub(super) fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x0000_0400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub(super) fn invalid_state_path() -> std::io::Error {
    std::io::Error::new(
        ErrorKind::InvalidInput,
        "runtime state path is not a regular entry in its state directory",
    )
}
