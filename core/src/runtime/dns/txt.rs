pub(super) fn quote_txt(value: &str) -> String {
    value
        .as_bytes()
        .chunks(255)
        .map(|chunk| {
            let mut quoted = String::from("\"");
            for byte in chunk {
                if matches!(byte, b'"' | b'\\') {
                    quoted.push('\\');
                }
                quoted.push(char::from(*byte));
            }
            quoted.push('"');
            quoted
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// DNS presentation format permits multiple quoted character strings and escaped
// decimal octets. Compare their concatenated bytes; preserve unrelated strings
// exactly as returned by the provider when replacing the RRset.
pub(super) fn unquote_txt(value: &str) -> Option<Vec<u8>> {
    let bytes = value.as_bytes();
    let mut offset = 0;
    let mut result = Vec::new();
    let mut chunks = 0;
    while offset < bytes.len() {
        while bytes.get(offset).is_some_and(u8::is_ascii_whitespace) {
            offset += 1;
        }
        if offset == bytes.len() {
            break;
        }
        if bytes.get(offset) != Some(&b'"') {
            return None;
        }
        offset += 1;
        let start = result.len();
        loop {
            let byte = *bytes.get(offset)?;
            offset += 1;
            match byte {
                b'"' => break,
                b'\\' => {
                    let escaped = *bytes.get(offset)?;
                    if escaped.is_ascii_digit() {
                        let digits = bytes.get(offset..offset + 3)?;
                        if !digits.iter().all(u8::is_ascii_digit) {
                            return None;
                        }
                        let octet = u16::from(digits[0] - b'0') * 100
                            + u16::from(digits[1] - b'0') * 10
                            + u16::from(digits[2] - b'0');
                        result.push(u8::try_from(octet).ok()?);
                        offset += 3;
                    } else {
                        result.push(escaped);
                        offset += 1;
                    }
                }
                byte if byte.is_ascii_control() => return None,
                byte => result.push(byte),
            }
            if result.len() - start > 255 {
                return None;
            }
        }
        chunks += 1;
        if bytes
            .get(offset)
            .is_some_and(|byte| !byte.is_ascii_whitespace())
        {
            return None;
        }
    }
    (chunks > 0).then_some(result)
}
