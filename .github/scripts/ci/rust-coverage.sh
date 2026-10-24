#!/usr/bin/env bash
set -euo pipefail

report_directory=core/target/coverage
mkdir -p "$report_directory"

cargo llvm-cov report --manifest-path core/Cargo.toml --html --output-dir "$report_directory"
cargo llvm-cov report --manifest-path core/Cargo.toml --lcov --output-path "$report_directory/lcov.info"
cargo llvm-cov report --manifest-path core/Cargo.toml --json --summary-only --output-path "$report_directory/summary.json"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
        printf '### Rust coverage (Linux)\n\n'
        printf '| Metric | Covered | Total | Coverage |\n| --- | ---: | ---: | ---: |\n'
        jq -r '.data[0].totals | to_entries[] | select(.key == "lines" or .key == "functions" or .key == "regions") | "| \(.key) | \(.value.covered) | \(.value.count) | \((.value.percent * 100 | round) / 100)% |"' "$report_directory/summary.json"
        printf '\nRequired line coverage: **90%%**. HTML and LCOV reports are available in the **rust-coverage-linux** artifact.\n'
    } >> "$GITHUB_STEP_SUMMARY"
fi

cargo llvm-cov report --manifest-path core/Cargo.toml --fail-under-lines 90
