mod paths;
use paths::{
    canonical_absolute_entry, create_missing_state_directory, create_private_directory,
    ensure_direct_child, ensure_regular_file_metadata, invalid_state_path, is_link,
    remove_tree_without_links, resolve_existing_path, temporary_component,
};
use std::{
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Read, Write},
    path::{Component, Path, PathBuf},
};

pub(super) const LAST_APPLY_FILE: &str = "last-apply-at";

#[derive(Clone, Debug)]
pub(super) struct SafeDir {
    path: PathBuf,
}

impl SafeDir {
    pub(super) fn open(path: &Path) -> std::io::Result<Self> {
        let path = resolve_existing_path(path)?;
        let metadata = fs::symlink_metadata(&path)?;
        if is_link(&metadata) || !metadata.file_type().is_dir() {
            return Err(invalid_state_path());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
        }
        Ok(Self { path })
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn open_dir(&self, component: &str) -> std::io::Result<Self> {
        let candidate = self.child(component)?;
        let path = candidate.canonicalize()?;
        ensure_direct_child(&self.path, &path)?;
        #[cfg(unix)]
        if path != candidate {
            return Err(invalid_state_path());
        }
        let metadata = fs::symlink_metadata(&path)?;
        if is_link(&metadata) || !metadata.file_type().is_dir() {
            return Err(invalid_state_path());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
        }
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
                let metadata = fs::symlink_metadata(&path)?;
                if is_link(&metadata) || !metadata.file_type().is_dir() {
                    return Err(invalid_state_path());
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
                }
                Ok(Self { path })
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                create_private_directory(&candidate)?;
                let path = candidate.canonicalize()?;
                ensure_direct_child(&self.path, &path)?;
                let metadata = fs::symlink_metadata(&path)?;
                if is_link(&metadata) || !metadata.file_type().is_dir() {
                    return Err(invalid_state_path());
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
                }
                Ok(Self { path })
            }
            Err(error) => Err(error),
        }
    }

    pub(super) fn open_file(&self, component: &str) -> std::io::Result<File> {
        let candidate = self.child(component)?;
        let path = candidate.canonicalize()?;
        ensure_direct_child(&self.path, &path)?;
        #[cfg(unix)]
        if path != candidate {
            return Err(invalid_state_path());
        }
        let metadata = fs::symlink_metadata(&path)?;
        ensure_regular_file_metadata(&metadata)?;
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
        let file = options.open(&path)?;
        ensure_regular_file_metadata(&file.metadata()?)?;
        Ok(file)
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
                let metadata = fs::symlink_metadata(&path)?;
                ensure_regular_file_metadata(&metadata)?;
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }

        let temporary_name = temporary_component(component)?;
        let temporary = self.child(&temporary_name)?;
        let mut options = OpenOptions::new();

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
        let candidate = self.child(component)?;
        let path = candidate.canonicalize()?;
        ensure_direct_child(&self.path, &path)?;
        #[cfg(unix)]
        if path != candidate {
            return Err(invalid_state_path());
        }
        let metadata = fs::symlink_metadata(&path)?;
        ensure_regular_file_metadata(&metadata)?;
        Ok(path)
    }

    fn child(&self, component: &str) -> std::io::Result<PathBuf> {
        if resolve_existing_path(&self.path)? != self.path {
            return Err(invalid_state_path());
        }
        validate_component(component)?;
        let path = self.path.join(component);
        if let Ok(metadata) = fs::symlink_metadata(&path)
            && is_link(&metadata)
        {
            return Err(invalid_state_path());
        }
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
    let metadata = fs::symlink_metadata(&path)?;
    ensure_regular_file_metadata(&metadata)?;
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
    let file = options.open(&path)?;
    ensure_regular_file_metadata(&file.metadata()?)?;
    Ok(file)
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
