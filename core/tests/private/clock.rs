use super::*;

#[test]
fn utc_timestamps_are_second_precise_and_preserve_calendar_boundaries() {
    for (seconds, expected) in [
        (0, "1970-01-01T00:00:00Z"),
        (86_399, "1970-01-01T23:59:59Z"),
        (86_400, "1970-01-02T00:00:00Z"),
        (1_709_164_800, "2024-02-29T00:00:00Z"),
        (1_709_251_200, "2024-03-01T00:00:00Z"),
    ] {
        assert_eq!(
            format_utc_time(UNIX_EPOCH + Duration::new(seconds, 999_999_999)),
            expected
        );
    }
}

#[test]
fn utc_timestamps_fall_back_to_epoch_for_pre_epoch_or_unsupported_instants() {
    assert_eq!(
        format_utc_time(UNIX_EPOCH - Duration::from_secs(1)),
        "1970-01-01T00:00:00Z"
    );
    let unsupported = UNIX_EPOCH
        .checked_add(Duration::from_secs(253_402_300_800))
        .expect("the platform should represent the first second after year 9999");
    assert_eq!(format_utc_time(unsupported), "1970-01-01T00:00:00Z");
}
