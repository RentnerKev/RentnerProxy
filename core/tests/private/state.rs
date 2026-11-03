use super::SafeDir;
use std::{
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    time::{SystemTime, UNIX_EPOCH},
};

struct Directory(std::path::PathBuf);
impl Directory {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "rentnerproxy-state-boundaries-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn safe_state_operations_reject_special_entries_and_keep_existing_bytes() {
    let directory = Directory::new();
    let safe = SafeDir::open(&directory.0).unwrap();
    safe.atomic_write("active", b"original").unwrap();
    safe.ensure_dir("occupied").unwrap();
    assert!(safe.atomic_write("occupied", b"replacement").is_err());
    assert!(safe.rename_dir("occupied", "active").is_err());
    assert!(safe.rename_dir("occupied", "occupied").is_err());
    assert!(matches!(
        safe.remove_file_with_outcome("occupied"),
        Err(super::FileRemovalError::BeforeUnlink(_))
    ));
    assert_eq!(safe.read_file("active", 8).unwrap(), b"original");
    assert!(safe.read_file("active", 7).is_err());
    safe.remove_file("missing").unwrap();
    assert!(safe.open_dir("active").is_err());
    assert!(safe.file_path("occupied").is_err());
    for component in ["", "..", "parent/child", "parent\\child", "/absolute", "."] {
        assert!(safe.child_path(component).is_err(), "{component}");
    }
    assert!(super::prepare_state_dir(std::path::Path::new("relative")).is_err());
    assert!(super::prepare_state_dir(&directory.0.join("active/child")).is_err());
    assert!(super::open_absolute_regular_file(std::path::Path::new("/")).is_err());
    assert!(super::open_absolute_regular_file(&directory.0.join("active/../active")).is_err());
    assert!(SafeDir::open(std::path::Path::new("")).is_err());
    assert!(SafeDir::open(std::path::Path::new("bad\0path")).is_err());
}

#[test]
fn replaced_state_root_and_symlink_loops_fail_closed() {
    use std::os::unix::fs::symlink;
    let directory = Directory::new();
    let root = directory.0.join("root");
    fs::create_dir(&root).unwrap();
    let safe = SafeDir::open(&root).unwrap();
    safe.atomic_write("active", b"original").unwrap();
    symlink("loop", root.join("loop")).unwrap();
    assert!(safe.atomic_write("loop", b"replacement").is_err());
    assert!(safe.rename_dir("missing", "loop").is_err());
    let moved = directory.0.join("moved");
    fs::rename(&root, &moved).unwrap();
    symlink(&moved, &root).unwrap();
    assert!(safe.child_path("active").is_err());
    assert!(safe.remove_file("active").is_err());
    assert!(super::open_absolute_regular_file(&root.join("active")).is_err());
    assert_eq!(fs::read(moved.join("active")).unwrap(), b"original");
    fs::remove_file(root).unwrap();
}

#[test]
fn directory_tree_removal_rejects_links_and_non_unicode_names() {
    use std::{
        ffi::OsString,
        os::unix::{ffi::OsStringExt, fs::symlink},
    };
    let directory = Directory::new();
    let safe = SafeDir::open(&directory.0).unwrap();
    let tree = safe.ensure_dir("tree").unwrap();
    safe.atomic_write("outside", b"retain").unwrap();
    symlink(directory.0.join("outside"), tree.path().join("link")).unwrap();
    assert!(safe.remove_dir_tree("tree").is_err());
    assert_eq!(safe.read_file("outside", 6).unwrap(), b"retain");
    fs::remove_file(tree.path().join("link")).unwrap();
    let malformed = tree.path().join(OsString::from_vec(vec![255]));
    fs::write(&malformed, b"retain").unwrap();
    assert!(safe.remove_dir_tree("tree").is_err());
    assert_eq!(fs::read(&malformed).unwrap(), b"retain");
    assert!(super::read_trimmed(&malformed).is_none());
    fs::remove_file(malformed).unwrap();
    safe.remove_dir_tree("tree").unwrap();
    assert!(!directory.0.join("tree").exists());
}

#[test]
fn shared_access_logs_preserve_only_the_approved_directory_permissions() {
    let root = std::env::temp_dir().join(format!(
        "rentnerproxy-shared-logs-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let logs = root.join("logs");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&logs).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o710)).unwrap();
    fs::set_permissions(&logs, fs::Permissions::from_mode(0o2750)).unwrap();
    let owner = fs::metadata(&root).unwrap().uid();
    let group = fs::metadata(&root).unwrap().gid();

    let shared = SafeDir::open_shared_logs(&root, owner, group).unwrap();
    shared.open_dir("logs").unwrap();
    shared.ensure_dir("logs").unwrap();
    SafeDir::open_shared_logs(&root, owner, group).unwrap();
    assert_eq!(fs::metadata(&root).unwrap().mode() & 0o7777, 0o710);
    assert_eq!(fs::metadata(&logs).unwrap().mode() & 0o7777, 0o2750);

    let private = shared.ensure_dir("certificates").unwrap();
    assert_eq!(fs::metadata(private.path()).unwrap().mode() & 0o7777, 0o700);
    assert!(SafeDir::open_shared_logs(&root, owner, group + 1).is_err());
    fs::set_permissions(&logs, fs::Permissions::from_mode(0o2700)).unwrap();
    assert!(shared.open_dir("logs").is_err());
    fs::set_permissions(&logs, fs::Permissions::from_mode(0o2750)).unwrap();
    shared.open_dir("logs").unwrap();

    fs::remove_dir_all(root).unwrap();
}
