pub(crate) fn has_only_pem_blocks(value: &str, labels: &[&str], exactly_one: bool) -> bool {
    let mut remainder = value.trim();
    let mut count = 0;
    while !remainder.is_empty() {
        let Some(label) = labels
            .iter()
            .find(|label| remainder.starts_with(&format!("-----BEGIN {label}-----")))
        else {
            return false;
        };
        let begin = format!("-----BEGIN {label}-----");
        let end = format!("-----END {label}-----");
        let after_begin = &remainder[begin.len()..];
        let Some(end_index) = after_begin.find(&end) else {
            return false;
        };
        let body = &after_begin[..end_index];
        if body.is_empty()
            || !body.bytes().all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(byte, b'+' | b'/' | b'=' | b'\r' | b'\n' | b' ' | b'\t')
            })
        {
            return false;
        }
        count += 1;
        remainder = after_begin[end_index + end.len()..].trim();
    }
    count > 0 && (!exactly_one || count == 1)
}
