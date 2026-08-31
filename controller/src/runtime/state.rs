use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::{ErrorKind, Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) const ACTIVE_CONFIG_FILE: &str = "active.conf";
pub(super) const CANDIDATE_CONFIG_FILE: &str = "candidate.conf";
pub(super) const LAST_GOOD_CONFIG_FILE: &str = "last-good.conf";
pub(super) const LAST_APPLY_FILE: &str = "last-apply-at";

/// A canonical directory whose children are addressed by one checked component.
///
/// The `..` check is deliberately adjacent to every state-path construction: it is the
/// path-injection boundary understood by CodeQL as well as a runtime safety check.
#[derive(Clone, Debug)]
pub(super) struct SafeDir {
    path: PathBuf,
}

impl SafeDir {
    pub(super) fn open(path: &Path) -> std::io::Result<Self> {
        let path = resolve_existing_path(path)?;
        ensure_directory(&path)?;
        Ok(Self { path })
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn open_dir(&self, component: &str) -> std::io::Result<Self> {
        let path = self.existing_child(component)?;
        ensure_directory(&path)?;
        Ok(Self { path })
    }

    pub(super) fn ensure_dir(&self, component: &str) -> std::io::Result<Self> {
        let candidate = self.child(component)?;
        match candidate.canonicalize() {
            Ok(path) => {
                ensure_direct_child(&self.path, &path)?;
                #[cfg(unix)]
                if path != candidate {
                    return Err(invalid_state_path());
                }
                ensure_directory(&path)?;
                Ok(Self { path })
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                // `candidate` is made solely from a canonical SafeDir and one validated
                // component, so this creation sink cannot escape the state root.
                create_private_directory(&candidate)?;
                let path = candidate.canonicalize()?;
                ensure_direct_child(&self.path, &path)?;
                ensure_directory(&path)?;
                Ok(Self { path })
            }
            Err(error) => Err(error),
        }
    }

    pub(super) fn open_file(&self, component: &str) -> std::io::Result<File> {
        let path = self.existing_regular_file(component)?;
        open_regular_file(&path)
    }

    pub(super) fn read_file(&self, component: &str, maximum: usize) -> std::io::Result<Vec<u8>> {
        let mut file = self.open_file(component)?.take((maximum as u64) + 1);
        let mut contents = Vec::new();
        file.read_to_end(&mut contents)?;
        if contents.len() > maximum {
            return Err(std::io::Error::new(
                ErrorKind::InvalidData,
                "runtime state file exceeds its maximum size",
            ));
        }
        Ok(contents)
    }

    pub(super) fn file_path(&self, component: &str) -> std::io::Result<PathBuf> {
        self.existing_regular_file(component)
    }

    pub(super) fn child_path(&self, component: &str) -> std::io::Result<PathBuf> {
        self.child(component)
    }

    pub(super) fn atomic_write(&self, component: &str, contents: &[u8]) -> std::io::Result<()> {
        let destination = self.child(component)?;
        match destination.canonicalize() {
            Ok(path) => {
                ensure_direct_child(&self.path, &path)?;
                ensure_regular_file_path(&path)?;
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }

        let temporary_name = temporary_component(component)?;
        let temporary = self.child(&temporary_name)?;
        let mut options = OpenOptions::new();
        // `temporary` is an internal, one-component name. create_new prevents truncation of a
        // planted file and the randomized name prevents collision with a known temporary path.
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW);
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        let result = file.write_all(contents).and_then(|()| file.sync_all());
        drop(file);
        let result = result.and_then(|()| self.replace_paths(&temporary, &destination));
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    pub(super) fn replace_file(&self, source: &str, destination: &str) -> std::io::Result<()> {
        let source = self.existing_regular_file(source)?;
        let destination = self.child(destination)?;
        self.replace_paths(&source, &destination)
    }

    pub(super) fn rename_dir(&self, source: &str, destination: &str) -> std::io::Result<Self> {
        let source = self.open_dir(source)?.path;
        let destination = self.child(destination)?;
        match destination.canonicalize() {
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Ok(_) => return Err(invalid_state_path()),
            Err(error) => return Err(error),
        }
        fs::rename(&source, &destination)?;
        #[cfg(unix)]
        self.sync()?;
        self.open_dir(
            destination
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(invalid_state_path)?,
        )
    }

    pub(super) fn remove_dir_tree(&self, component: &str) -> std::io::Result<()> {
        let directory = self.open_dir(component)?;
        remove_tree_without_links(&self.path, directory.path())?;
        #[cfg(unix)]
        self.sync()?;
        Ok(())
    }

    #[cfg(unix)]
    pub(super) fn sync(&self) -> std::io::Result<()> {
        File::open(&self.path)?.sync_all()
    }

    fn existing_regular_file(&self, component: &str) -> std::io::Result<PathBuf> {
        let path = self.existing_child(component)?;
        ensure_regular_file_path(&path)?;
        Ok(path)
    }

    fn existing_child(&self, component: &str) -> std::io::Result<PathBuf> {
        let candidate = self.child(component)?;
        let path = candidate.canonicalize()?;
        ensure_direct_child(&self.path, &path)?;
        #[cfg(unix)]
        if path != candidate {
            return Err(invalid_state_path());
        }
        Ok(path)
    }

    fn child(&self, component: &str) -> std::io::Result<PathBuf> {
        validate_component(component)?;
        let path = self.path.join(component);
        if path.parent() != Some(self.path.as_path()) {
            return Err(invalid_state_path());
        }
        Ok(path)
    }

    fn replace_paths(&self, source: &Path, destination: &Path) -> std::io::Result<()> {
        fs::rename(source, destination)?;
        #[cfg(unix)]
        self.sync()?;
        Ok(())
    }
}

pub(super) fn open_absolute_regular_file(path: &Path) -> std::io::Result<File> {
    let path = canonical_absolute_entry(path)?;
    ensure_regular_file_path(&path)?;
    open_regular_file(&path)
}

pub(super) fn prepare_state_dir(path: &Path) -> std::io::Result<()> {
    let directory = match SafeDir::open(path) {
        Ok(directory) => directory,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let path = create_missing_state_directory(path)?;
            SafeDir::open(&path)?
        }
        Err(error) => return Err(error),
    };
    #[cfg(not(unix))]
    let _ = &directory;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub(super) fn state_dir(path: &Path) -> std::io::Result<SafeDir> {
    SafeDir::open(path)
}

pub(super) fn atomic_write(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(invalid_state_path)?;
    let directory = SafeDir::open(parent)?;
    let component = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(invalid_state_path)?;
    directory.atomic_write(component, contents)
}

pub(super) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    let parent = source.parent().ok_or_else(invalid_state_path)?;
    if destination.parent() != Some(parent) {
        return Err(invalid_state_path());
    }
    let directory = SafeDir::open(parent)?;
    let source = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(invalid_state_path)?;
    let destination = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(invalid_state_path)?;
    directory.replace_file(source, destination)
}

pub(super) fn read_trimmed(path: &Path) -> Option<String> {
    let parent = path.parent()?;
    let component = path.file_name()?.to_str()?;
    let bytes = SafeDir::open(parent)
        .ok()?
        .read_file(component, 64 * 1024)
        .ok()?;
    String::from_utf8(bytes)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

pub(super) fn validate_component(component: &str) -> std::io::Result<()> {
    if component.is_empty()
        || component.contains("..")
        || component.contains('/')
        || component.contains('\\')
        || Path::new(component).is_absolute()
        || !matches!(
            Path::new(component).components().next(),
            Some(Component::Normal(_))
        )
        || Path::new(component).components().count() != 1
    {
        return Err(invalid_state_path());
    }
    Ok(())
}

fn canonical_absolute_entry(path: &Path) -> std::io::Result<PathBuf> {
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

fn resolve_existing_path(path: &Path) -> std::io::Result<PathBuf> {
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
    Ok(())
}

fn create_missing_state_directory(path: &Path) -> std::io::Result<PathBuf> {
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
    ensure_directory(&parent)?;
    for component in missing.iter().rev() {
        let candidate = parent.join(component);
        create_private_directory(&candidate)?;
        let child = candidate.canonicalize()?;
        ensure_direct_child(&parent, &child)?;
        ensure_directory(&child)?;
        parent = child;
    }
    Ok(parent)
}

fn create_private_directory(path: &Path) -> std::io::Result<()> {
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

fn open_regular_file(path: &Path) -> std::io::Result<File> {
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
        options.custom_flags(0x0020_0000);
    }
    let file = options.open(path)?;
    ensure_regular_file_metadata(&file.metadata()?)?;
    Ok(file)
}

fn ensure_direct_child(parent: &Path, path: &Path) -> std::io::Result<()> {
    if !path.starts_with(parent) || path.parent() != Some(parent) {
        return Err(invalid_state_path());
    }
    Ok(())
}

fn ensure_directory(path: &Path) -> std::io::Result<()> {
    let path = path.canonicalize()?;
    let metadata = fs::symlink_metadata(&path)?;
    if is_link(&metadata) || !metadata.file_type().is_dir() {
        return Err(invalid_state_path());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn ensure_regular_file_path(path: &Path) -> std::io::Result<()> {
    let path = path.canonicalize()?;
    let metadata = fs::symlink_metadata(&path)?;
    ensure_regular_file_metadata(&metadata)
}

fn ensure_regular_file_metadata(metadata: &Metadata) -> std::io::Result<()> {
    if is_link(metadata) || !metadata.file_type().is_file() {
        return Err(invalid_state_path());
    }
    Ok(())
}

fn remove_tree_without_links(parent: &Path, path: &Path) -> std::io::Result<()> {
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

fn temporary_component(component: &str) -> std::io::Result<String> {
    validate_component(component)?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(std::io::Error::other)?
        .as_nanos();
    let temporary = format!(".{component}.{}.{}.tmp", std::process::id(), nanos);
    validate_component(&temporary)?;
    Ok(temporary)
}

fn is_link(metadata: &Metadata) -> bool {
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

fn invalid_state_path() -> std::io::Error {
    std::io::Error::new(
        ErrorKind::InvalidInput,
        "runtime state path is not a regular entry in its state directory",
    )
}
