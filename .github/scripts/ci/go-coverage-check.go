package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const modulePath = "github.com/RentnerProxy/platform/core/caddy-modules/responsecache"
const caddyPath = "core/caddy-modules/responsecache"
const buildinfoPath = "docker/tooling/buildinfo"
const checkerPath = ".github/scripts/ci"
const maximumExactInteger = uint64(1<<53 - 1)

var profileRecord = regexp.MustCompile(`^(.+\.go):([0-9]+)\.([0-9]+),([0-9]+)\.([0-9]+) ([0-9]+) ([0-9]+)$`)

type statementCoverage struct {
	Covered uint64  `json:"covered"`
	Total   uint64  `json:"total"`
	Percent float64 `json:"percent"`
}

type coverageGroup struct {
	Name       string            `json:"name"`
	Statements statementCoverage `json:"statements"`
}

type coverageReport struct {
	Version int             `json:"version"`
	Minimum uint64          `json:"minimum"`
	Groups  []coverageGroup `json:"groups"`
}

type coverageBlock struct {
	File       string
	Range      string
	Statements uint64
	Covered    bool
}

func canonicalSource(filename string) (string, error) {
	filename = strings.ReplaceAll(filename, `\`, "/")
	if path.Clean(filename) != filename {
		return "", errors.New("non-canonical raw coverage source")
	}
	if strings.HasPrefix(filename, modulePath+"/") {
		filename = caddyPath + strings.TrimPrefix(filename, modulePath)
	} else {
		for _, source := range []string{buildinfoPath + "/verify.go", checkerPath + "/go-coverage-check.go"} {
			if filename == source || strings.HasSuffix(filename, "/"+source) {
				filename = source
				break
			}
		}
	}
	if path.Clean(filename) != filename || strings.Contains(filename, "/../") || strings.HasSuffix(filename, "_test.go") {
		return "", fmt.Errorf("non-canonical coverage source %q", filename)
	}
	if strings.HasPrefix(filename, caddyPath+"/") || filename == buildinfoPath+"/verify.go" || filename == checkerPath+"/go-coverage-check.go" {
		return filename, nil
	}
	return "", fmt.Errorf("unknown coverage source %q", filename)
}

func exactInteger(value string) (uint64, error) {
	number, err := strconv.ParseUint(value, 10, 64)
	if err != nil || number > maximumExactInteger {
		return 0, fmt.Errorf("invalid or unsafe coverage integer %q", value)
	}
	return number, nil
}

func parseProfile(reader io.Reader) (map[string]coverageBlock, error) {
	scanner := bufio.NewScanner(reader)
	if !scanner.Scan() {
		return nil, errors.New("missing coverage mode")
	}
	mode := scanner.Text()
	if mode != "mode: set" && mode != "mode: count" && mode != "mode: atomic" {
		return nil, errors.New("invalid coverage mode")
	}
	blocks := make(map[string]coverageBlock)
	for scanner.Scan() {
		fields := profileRecord.FindStringSubmatch(scanner.Text())
		if fields == nil {
			return nil, errors.New("malformed coverage record")
		}
		filename, err := canonicalSource(fields[1])
		if err != nil {
			return nil, err
		}
		var numbers [6]uint64
		for index, text := range fields[2:] {
			numbers[index], err = exactInteger(text)
			if err != nil {
				return nil, err
			}
		}
		if numbers[0] == 0 || numbers[1] == 0 || numbers[2] < numbers[0] || numbers[3] == 0 ||
			(numbers[0] == numbers[2] && (numbers[3] < numbers[1] || (numbers[3] == numbers[1] && numbers[4] != 0))) || (mode == "mode: set" && numbers[5] > 1) {
			return nil, errors.New("invalid coverage range or set count")
		}
		rangeID := fmt.Sprintf("%d.%d,%d.%d", numbers[0], numbers[1], numbers[2], numbers[3])
		key := filename + ":" + rangeID
		block, exists := blocks[key]
		if exists && block.Statements != numbers[4] {
			return nil, errors.New("inconsistent statement counts for the same coverage block")
		}
		blocks[key] = coverageBlock{filename, rangeID, numbers[4], block.Covered || numbers[5] > 0}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read coverage profile: %w", err)
	}
	if len(blocks) == 0 {
		return nil, errors.New("empty coverage profile")
	}
	return blocks, nil
}

func packageInventory(reader io.Reader) (map[string]bool, error) {
	packages := map[string]bool{}
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		name := scanner.Text()
		if name != modulePath && !strings.HasPrefix(name, modulePath+"/") {
			return nil, fmt.Errorf("unrecognized package in Go inventory: %q", name)
		}
		canonical := caddyPath + strings.TrimPrefix(name, modulePath)
		if path.Clean(canonical) != canonical || packages[canonical] {
			return nil, errors.New("duplicate or non-canonical Go package inventory entry")
		}
		packages[canonical] = true
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if !packages[caddyPath] || !packages[caddyPath+"/upstreamobserver"] {
		return nil, errors.New("missing own Go packages in inventory")
	}
	return packages, nil
}

func readProfile(filename string) (map[string]coverageBlock, error) {
	file, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return parseProfile(file)
}

func makeReport(directory string, minimum uint64) (coverageReport, error) {
	if minimum < 90 || minimum > 100 {
		return coverageReport{}, errors.New("minimum coverage must be an integer from 90 to 100")
	}
	inventory, err := os.ReadFile(filepath.Join(directory, "caddy-packages.txt"))
	if err != nil {
		return coverageReport{}, err
	}
	packages, err := packageInventory(strings.NewReader(string(inventory)))
	if err != nil {
		return coverageReport{}, err
	}
	packages[buildinfoPath], packages[checkerPath] = true, true
	allBlocks := make(map[string]coverageBlock)
	for _, profile := range []string{"caddy.out", "buildinfo.out", "checker.out"} {
		blocks, err := readProfile(filepath.Join(directory, profile))
		if err != nil {
			return coverageReport{}, fmt.Errorf("%s: %w", profile, err)
		}
		for key, block := range blocks {
			group := path.Dir(block.File)
			if !packages[group] ||
				(profile == "caddy.out" && (group == buildinfoPath || group == checkerPath)) ||
				(profile == "buildinfo.out" && group != buildinfoPath) ||
				(profile == "checker.out" && group != checkerPath) {
				return coverageReport{}, fmt.Errorf("unlisted or misplaced own Go package %q", group)
			}
			previous, exists := allBlocks[key]
			if exists && previous.Statements != block.Statements {
				return coverageReport{}, errors.New("inconsistent coverage across profiles")
			}
			block.Covered = block.Covered || previous.Covered
			allBlocks[key] = block
		}
	}
	totals := make(map[string]statementCoverage)
	for _, block := range allBlocks {
		for _, group := range []string{path.Dir(block.File), "all"} {
			value := totals[group]
			if block.Statements > maximumExactInteger-value.Total {
				return coverageReport{}, errors.New("unsafe total statement count")
			}
			value.Total += block.Statements
			if block.Covered {
				value.Covered += block.Statements
			}
			totals[group] = value
		}
	}
	packages["all"] = true
	names := make([]string, 0, len(packages))
	for name := range packages {
		names = append(names, name)
	}
	sort.Strings(names)
	report := coverageReport{Version: 1, Minimum: minimum}
	for _, name := range names {
		value := totals[name]
		if value.Total == 0 {
			return coverageReport{}, fmt.Errorf("missing statement coverage for own Go package %q", name)
		}
		value.Percent = float64(value.Covered) * 100 / float64(value.Total)
		report.Groups = append(report.Groups, coverageGroup{name, value})
	}
	return report, nil
}

func run(arguments []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("go-coverage-check", flag.ContinueOnError)
	flags.SetOutput(stderr)
	minimum := flags.Uint64("minimum", 90, "minimum statement coverage (90 to 100)")
	if err := flags.Parse(arguments); err != nil {
		return 2
	}
	if flags.NArg() != 1 {
		fmt.Fprintln(stderr, "usage: go-coverage-check [--minimum 90] REPORT_DIRECTORY")
		return 2
	}
	directory := flags.Arg(0)
	summaryPath := filepath.Join(directory, "summary.json")
	if err := os.Remove(summaryPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		fmt.Fprintln(stderr, err)
		return 1
	}
	report, err := makeReport(directory, *minimum)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if err := os.WriteFile(summaryPath, append(encoded, '\n'), 0o644); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	failed := false
	for _, group := range report.Groups {
		if _, err := fmt.Fprintf(stdout, "%s: %d/%d statements (%.2f%%)\n", group.Name, group.Statements.Covered, group.Statements.Total, group.Statements.Percent); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if group.Statements.Covered*100 < report.Minimum*group.Statements.Total {
			failed = true
		}
	}
	if failed {
		fmt.Fprintf(stderr, "Go statement coverage is below %d%%\n", report.Minimum)
		return 1
	}
	return 0
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
