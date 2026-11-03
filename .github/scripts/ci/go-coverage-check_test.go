package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCanonicalSource(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{modulePath + "/cache.go", caddyPath + "/cache.go"},
		{caddyPath + "/upstreamobserver/observer.go", caddyPath + "/upstreamobserver/observer.go"},
		{"/workspace/docker/tooling/buildinfo/verify.go", buildinfoPath + "/verify.go"},
		{`C:\repo\docker\tooling\buildinfo\verify.go`, buildinfoPath + "/verify.go"},
		{buildinfoPath + "/verify.go", buildinfoPath + "/verify.go"},
		{"/workspace/.github/scripts/ci/go-coverage-check.go", checkerPath + "/go-coverage-check.go"},
	} {
		t.Run(test.input, func(t *testing.T) {
			got, err := canonicalSource(test.input)
			if err != nil || got != test.want {
				t.Fatalf("canonicalSource = %q, %v; want %q", got, err, test.want)
			}
		})
	}
	for _, invalid := range []string{
		"/other/verify.go", modulePath + "/cache_test.go", caddyPath + "/../outside.go",
		"/workspace/../docker/tooling/buildinfo/verify.go", modulePath + "//cache.go",
	} {
		if _, err := canonicalSource(invalid); err == nil {
			t.Errorf("accepted invalid source %q", invalid)
		}
	}
}

func TestProfileUnionsCanonicalBlocksAndAcceptsAllGoModes(t *testing.T) {
	for _, mode := range []string{"set", "count", "atomic"} {
		input := "mode: " + mode + "\n" + modulePath + "/cache.go:1.1,2.1 9 0\n" +
			caddyPath + "/cache.go:1.1,2.1 9 1\n" + modulePath + "/cache.go:2.1,3.1 1 0\n"
		blocks, err := parseProfile(strings.NewReader(input))
		if err != nil || len(blocks) != 2 {
			t.Fatalf("parseProfile = %v, %v", blocks, err)
		}
		block := blocks[caddyPath+"/cache.go:1.1,2.1"]
		if !block.Covered || block.Statements != 9 {
			t.Fatalf("lost canonical block union: %+v", block)
		}
	}
}

func TestProfilePreservesRealGoEmptyBlocksWithoutInventingStatements(t *testing.T) {
	blocks, err := parseProfile(strings.NewReader("mode: atomic\n" + modulePath + "/cache.go:139.296,139.296 0 2194\n"))
	if err != nil || len(blocks) != 1 {
		t.Fatalf("valid empty Go block rejected: %v, %v", blocks, err)
	}
	for _, block := range blocks {
		if block.Statements != 0 {
			t.Fatalf("invented executable statements: %+v", block)
		}
	}
}

func TestProfileRejectsMalformedUnsafeAndInconsistentRecords(t *testing.T) {
	for _, input := range []string{
		"", "mode: unknown\n", "mode: atomic\n", "mode: atomic\n\n", "mode: atomic\nnot a record\n",
		"mode: atomic\n" + modulePath + "/cache.go:0.1,2.1 1 1\n",
		"mode: atomic\n" + modulePath + "/cache.go:1.0,2.1 1 1\n",
		"mode: atomic\n" + modulePath + "/cache.go:2.1,1.1 1 1\n",
		"mode: atomic\n" + modulePath + "/cache.go:1.2,1.2 1 1\n",
		"mode: atomic\n" + modulePath + "/cache.go:1.1,2.0 1 1\n",
		"mode: set\n" + modulePath + "/cache.go:1.1,2.1 1 2\n",
		"mode: atomic\n" + modulePath + "/cache.go:1.1,2.1 -1 1\n",
		"mode: atomic\n" + modulePath + "/cache.go:1.1,2.1 1 9007199254740992\n",
		"mode: atomic\n" + modulePath + "/cache.go:18446744073709551616.1,2.1 1 1\n",
		"mode: atomic\n" + modulePath + "/cache.go:1.1,2.1 1 0\n" + modulePath + "/cache.go:1.1,2.1 2 1\n",
		"mode: atomic\n" + strings.Repeat("x", 100_000),
		"mode: atomic\nforeign/package.go:1.1,2.1 1 1\n",
	} {
		if _, err := parseProfile(strings.NewReader(input)); err == nil {
			t.Errorf("accepted invalid profile %.120q", input)
		}
	}
}

func TestInventoryRequiresOwnPackagesAndRejectsDuplicates(t *testing.T) {
	valid := modulePath + "\n" + modulePath + "/upstreamobserver\n"
	packages, err := packageInventory(strings.NewReader(valid))
	if err != nil || len(packages) != 2 {
		t.Fatalf("inventory = %v, %v", packages, err)
	}
	for _, input := range []string{
		"", modulePath + "\n", valid + modulePath + "\n", valid + "foreign/package\n",
		valid + modulePath + "/nested/../other\n", strings.Repeat("x", 100_000),
	} {
		if _, err := packageInventory(strings.NewReader(input)); err == nil {
			t.Errorf("accepted invalid inventory %.120q", input)
		}
	}
}

func profile(file string, covered, missed uint64) string {
	return fmt.Sprintf("mode: atomic\n%s:1.1,2.1 %d 1\n%s:2.1,3.1 %d 0\n", file, covered, file, missed)
}

func reportFixture(t *testing.T) string {
	t.Helper()
	directory := t.TempDir()
	for name, content := range map[string]string{
		"caddy-packages.txt": modulePath + "\n" + modulePath + "/upstreamobserver\n",
		"caddy.out": profile(modulePath+"/cache.go", 9, 1) +
			strings.TrimPrefix(profile(modulePath+"/upstreamobserver/observer.go", 9, 1), "mode: atomic\n"),
		"buildinfo.out": profile("/workspace/"+buildinfoPath+"/verify.go", 9, 1),
		"checker.out":   profile("/workspace/"+checkerPath+"/go-coverage-check.go", 9, 1),
	} {
		writeFixture(t, directory, name, content)
	}
	return directory
}

func writeFixture(t *testing.T, directory, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestReportUsesWeightedStatementsForEveryOwnPackageAndOverall(t *testing.T) {
	directory := reportFixture(t)
	file := filepath.Join(directory, "caddy.out")
	if err := os.WriteFile(file, []byte(profile(modulePath+"/cache.go", 9, 1)+
		modulePath+"/cache.go:1.1,2.1 9 0\n"+
		strings.TrimPrefix(profile(modulePath+"/upstreamobserver/observer.go", 99, 1), "mode: atomic\n")), 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := makeReport(directory, 90)
	if err != nil || len(report.Groups) != 5 || report.Version != 1 || report.Minimum != 90 {
		t.Fatalf("report = %+v, %v", report, err)
	}
	for _, group := range report.Groups {
		if group.Name == "all" && (group.Statements.Covered != 126 || group.Statements.Total != 130) {
			t.Fatalf("overall statements incorrectly averaged or duplicated: %+v", group)
		}
	}
}

func TestReportRejectsMissingMalformedOrMisplacedOwnPackages(t *testing.T) {
	for _, scenario := range []string{"inventory", "bad-inventory", "caddy.out", "buildinfo.out", "checker.out", "malformed", "unlisted", "missing-listed", "misplaced", "zero", "overflow"} {
		t.Run(scenario, func(t *testing.T) {
			directory := reportFixture(t)
			switch scenario {
			case "inventory":
				os.Remove(filepath.Join(directory, "caddy-packages.txt"))
			case "bad-inventory":
				writeFixture(t, directory, "caddy-packages.txt", "foreign/package\n")
			case "caddy.out", "buildinfo.out", "checker.out":
				os.Remove(filepath.Join(directory, scenario))
			case "malformed":
				writeFixture(t, directory, "caddy.out", "mode: atomic\nmalformed\n")
			case "unlisted":
				writeFixture(t, directory, "caddy.out", profile(modulePath+"/unexpected/source.go", 9, 1))
			case "missing-listed":
				writeFixture(t, directory, "caddy-packages.txt", modulePath+"\n"+modulePath+"/upstreamobserver\n"+modulePath+"/newpackage\n")
			case "misplaced":
				writeFixture(t, directory, "buildinfo.out", profile(modulePath+"/cache.go", 9, 1))
			case "zero":
				writeFixture(t, directory, "buildinfo.out", profile(buildinfoPath+"/verify.go", 0, 0))
			case "overflow":
				writeFixture(t, directory, "buildinfo.out", profile(buildinfoPath+"/verify.go", maximumExactInteger, 1))
			}
			if _, err := makeReport(directory, 90); err == nil {
				t.Fatal("accepted incomplete or inconsistent report")
			}
		})
	}
	for _, minimum := range []uint64{0, 89, 101} {
		if _, err := makeReport(reportFixture(t), minimum); err == nil {
			t.Errorf("accepted invalid minimum %d", minimum)
		}
	}
}

func TestCLIEmitsStableJSONAndUsesExactFractionsInsteadOfRoundedPercentages(t *testing.T) {
	directory := reportFixture(t)
	var stdout, stderr bytes.Buffer
	if code := run([]string{directory}, &stdout, &stderr); code != 0 {
		t.Fatalf("run = %d, %s", code, &stderr)
	}
	data, err := os.ReadFile(filepath.Join(directory, "summary.json"))
	if err != nil {
		t.Fatal(err)
	}
	var report coverageReport
	if err := json.Unmarshal(data, &report); err != nil || report.Version != 1 || len(report.Groups) != 5 {
		t.Fatalf("invalid JSON report: %s, %v", data, err)
	}
	writeFixture(t, directory, "checker.out", profile(checkerPath+"/go-coverage-check.go", 899999, 100001))
	stdout.Reset()
	stderr.Reset()
	if code := run([]string{"--minimum", "90", directory}, &stdout, &stderr); code != 1 || !strings.Contains(stderr.String(), "below 90%") {
		t.Fatalf("rounded sub-threshold report passed: %d, %s", code, &stderr)
	}
	if !strings.Contains(stdout.String(), "90.00%") {
		t.Fatal("fixture did not exercise rounded display boundary")
	}
	writeFixture(t, directory, "checker.out", profile(checkerPath+"/go-coverage-check.go", 1000, 0))
	writeFixture(t, directory, "buildinfo.out", profile(buildinfoPath+"/verify.go", 8, 2))
	if code := run([]string{directory}, io.Discard, io.Discard); code != 1 {
		t.Fatal("an under-covered own package was hidden by a high overall percentage")
	}
}

type failedWriter struct{}

func (failedWriter) Write([]byte) (int, error) { return 0, errors.New("closed output") }

func TestCLIFailsClosedOnArgumentsStaleReportsAndOutputFailures(t *testing.T) {
	for _, arguments := range [][]string{nil, {"--unknown"}, {"--minimum", "90.5"}, {"a", "b"}} {
		if code := run(arguments, io.Discard, io.Discard); code != 2 {
			t.Fatalf("invalid arguments %v returned %d", arguments, code)
		}
	}
	directory := reportFixture(t)
	if code := run([]string{"--minimum", "89", directory}, io.Discard, io.Discard); code != 1 {
		t.Fatal("accepted weaker minimum")
	}
	if code := run([]string{directory}, failedWriter{}, io.Discard); code != 1 {
		t.Fatal("ignored output failure")
	}
	writeFixture(t, directory, "caddy.out", "invalid")
	if code := run([]string{directory}, io.Discard, io.Discard); code != 1 {
		t.Fatal("accepted malformed report")
	}
	if _, err := os.Stat(filepath.Join(directory, "summary.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale successful summary retained after failure: %v", err)
	}
	if err := os.Mkdir(filepath.Join(directory, "summary.json"), 0o700); err != nil {
		t.Fatal(err)
	}
	writeFixture(t, filepath.Join(directory, "summary.json"), "keep", "obstacle")
	if code := run([]string{directory}, io.Discard, io.Discard); code != 1 {
		t.Fatal("ignored unremovable summary destination")
	}
}
