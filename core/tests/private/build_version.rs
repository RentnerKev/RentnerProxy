use super::select_version;

#[test]
fn release_build_version_is_preserved() {
    assert_eq!(
        select_version(Some("1.2.3-rc.1+build.42")),
        "1.2.3-rc.1+build.42"
    );
    assert_eq!(select_version(Some("  1.2.3\n")), "1.2.3");
}

#[test]
fn missing_or_empty_build_version_is_marked_as_development() {
    for build_version in [None, Some(""), Some(" \t\n")] {
        assert_eq!(
            select_version(build_version),
            concat!(env!("CARGO_PKG_VERSION"), "-dev")
        );
    }
}
