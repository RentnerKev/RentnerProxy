pub(crate) fn version() -> &'static str {
    select_version(option_env!("RENTNERPROXY_BUILD_VERSION"))
}

fn select_version(build_version: Option<&str>) -> &str {
    build_version
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .unwrap_or(concat!(env!("CARGO_PKG_VERSION"), "-dev"))
}

#[cfg(test)]
#[path = "../tests/private/build_version.rs"]
mod tests;
