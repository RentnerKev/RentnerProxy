use super::SafeDir;
use std::{
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    time::{SystemTime, UNIX_EPOCH},
};

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
