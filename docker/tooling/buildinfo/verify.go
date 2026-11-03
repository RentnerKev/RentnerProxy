// Command buildinfo verifies the metadata embedded in the shipped Go binaries.
package main

import (
	"debug/buildinfo"
	"fmt"
	"os"
	"runtime/debug"
)

const crowdsecTags = "netgo,osusergo,expr_debug,nomsgpack,sqlite_omit_load_extension,re2_cgo,no_db_postgres"
const responseCache = "github.com/RentnerKev/RentnerProxy/core/caddy-modules/responsecache"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 2 || (args[0] != "caddy" && args[0] != "crowdsec") {
		return fmt.Errorf("usage: buildinfo caddy|crowdsec BINARY")
	}
	info, err := buildinfo.ReadFile(args[1])
	if err != nil {
		return fmt.Errorf("read binary build metadata: %w", err)
	}
	return validate(args[0], info)
}

func validate(profile string, info *debug.BuildInfo) error {
	var expected map[string]string
	settings := map[string]string{"CGO_ENABLED": "0"}
	switch profile {
	case "caddy":
		expected = map[string]string{
			"golang.org/x/net":                           "v0.62.0",
			"github.com/crowdsecurity/crowdsec":          "v1.8.2",
			"github.com/hslatman/caddy-crowdsec-bouncer": "v0.14.2-0.20261030164527-4a6ce1d3094d",
			"github.com/mholt/caddy-l4":                  "v0.1.3-0.20261029145729-f607ccea1b7d",
		}
	case "crowdsec":
		expected = map[string]string{
			"google.golang.org/grpc": "v1.85.0",
			"golang.org/x/crypto":    "v0.58.0",
			"golang.org/x/net":       "v0.62.0",
		}
		settings = map[string]string{"CGO_ENABLED": "1", "-tags": crowdsecTags}
	default:
		return fmt.Errorf("unknown build profile %q", profile)
	}
	if info == nil || info.GoVersion != "go1.27.3" {
		return fmt.Errorf("expected compiler go1.27.3")
	}
	counts := make(map[string]int)
	for _, dep := range info.Deps {
		if dep == nil {
			return fmt.Errorf("missing dependency metadata")
		}
		version := dep.Version
		if profile == "crowdsec" {
			switch dep.Path {
			case "github.com/jackc/pgx/v4", "github.com/jackc/pgproto3/v2", "github.com/jackc/pgconn", "github.com/jackc/pgtype":
				return fmt.Errorf("obsolete PostgreSQL dependency %s", dep.Path)
			}
		}
		if replacement := dep.Replace; replacement != nil {
			if replacement.Replace != nil || !allowedReplacement(profile, dep.Path, replacement) {
				return fmt.Errorf("unapproved replacement for %s: %s %s", dep.Path, replacement.Path, replacement.Version)
			}
			// Caddy pins the effective version. CrowdSec pins the original
			// dependency versions and permits only its two reviewed forks.
			if profile == "caddy" {
				version = replacement.Version
			}
		}
		if want, required := expected[dep.Path]; required {
			counts[dep.Path]++
			if version != want {
				return fmt.Errorf("%s: expected %s, got %s", dep.Path, want, version)
			}
		}
	}
	for path := range expected {
		if counts[path] != 1 {
			return fmt.Errorf("expected exactly one dependency %s, got %d", path, counts[path])
		}
	}
	for key, want := range settings {
		count := 0
		for _, setting := range info.Settings {
			if setting.Key == key {
				count++
				if setting.Value != want {
					return fmt.Errorf("%s: expected %s, got %s", key, want, setting.Value)
				}
			}
		}
		if count != 1 {
			return fmt.Errorf("expected exactly one build setting %s, got %d", key, count)
		}
	}
	return nil
}

func allowedReplacement(profile, path string, replacement *debug.Module) bool {
	if profile == "caddy" {
		if path == responseCache {
			return replacement.Path == "/opt/rentnerproxy-responsecache" && (replacement.Version == "" || replacement.Version == "(devel)")
		}
		version := replacement.Version
		return replacement.Path == path && len(version) >= 2 && version[0] == 'v' && version[1] >= '0' && version[1] <= '9'
	}
	switch path {
	case "golang.org/x/time":
		return replacement.Path == "github.com/crowdsecurity/time" && replacement.Version == "v0.13.0-crowdsec.20250912"
	case "github.com/corazawaf/coraza/v3":
		return replacement.Path == "github.com/crowdsecurity/coraza/v3" && replacement.Version == "v3.8.0-crowdsec.20261002"
	}
	return false
}
