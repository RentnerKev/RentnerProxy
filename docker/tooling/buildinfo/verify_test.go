package main

import (
	"debug/buildinfo"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/debug"
	"testing"
)

func fixture(profile string) *debug.BuildInfo {
	info := &debug.BuildInfo{GoVersion: "go1.27.3"}
	if profile == "caddy" {
		info.Deps = []*debug.Module{
			{Path: "golang.org/x/net", Version: "v0.59.0", Replace: &debug.Module{Path: "golang.org/x/net", Version: "v0.62.0"}},
			{Path: "github.com/crowdsecurity/crowdsec", Version: "v1.8.2"},
			{Path: "github.com/hslatman/caddy-crowdsec-bouncer", Version: "v0.14.2-0.20261030164527-4a6ce1d3094d"},
			{Path: "github.com/mholt/caddy-l4", Version: "v0.1.3-0.20261029145729-f607ccea1b7d"},
			{Path: caddyModule, Version: "v2.11.7", Replace: &debug.Module{Path: caddySource}},
			{Path: responseCache, Replace: &debug.Module{Path: "/opt/rentnerproxy-responsecache", Version: "(devel)"}},
			{Path: "github.com/go-jose/go-jose/v4", Version: "v4.1.9"},
		}
		info.Settings = []debug.BuildSetting{{Key: "CGO_ENABLED", Value: "0"}}
	} else {
		info.Deps = []*debug.Module{
			{Path: "google.golang.org/grpc", Version: "v1.85.0"},
			{Path: "golang.org/x/crypto", Version: "v0.58.0"},
			{Path: "golang.org/x/net", Version: "v0.62.0"},
			{Path: "golang.org/x/time", Version: "v0.16.0", Replace: &debug.Module{Path: "github.com/crowdsecurity/time", Version: "v0.13.0-crowdsec.20250912"}},
			{Path: "github.com/corazawaf/coraza/v3", Version: "v3.8.1", Replace: &debug.Module{Path: "github.com/crowdsecurity/coraza/v3", Version: "v3.8.0-crowdsec.20261002"}},
		}
		info.Settings = []debug.BuildSetting{{Key: "CGO_ENABLED", Value: "1"}, {Key: "-tags", Value: crowdsecTags}}
	}
	return info
}

func TestPolicies(t *testing.T) {
	for _, profile := range []string{"caddy", "crowdsec"} {
		t.Run(profile, func(t *testing.T) {
			if err := validate(profile, fixture(profile)); err != nil {
				t.Fatal(err)
			}
			cases := map[string]func(*debug.BuildInfo){
				"compiler":             func(i *debug.BuildInfo) { i.GoVersion = "go1.27.1" },
				"missing dependency":   func(i *debug.BuildInfo) { i.Deps = i.Deps[1:] },
				"duplicate dependency": func(i *debug.BuildInfo) { i.Deps = append(i.Deps, i.Deps[0]) },
				"missing CGO":          func(i *debug.BuildInfo) { i.Settings = i.Settings[1:] },
				"wrong CGO":            func(i *debug.BuildInfo) { i.Settings[0].Value = "unexpected" },
				"duplicate CGO":        func(i *debug.BuildInfo) { i.Settings = append(i.Settings, i.Settings[0]) },
				"foreign local source": func(i *debug.BuildInfo) {
					i.Deps = append(i.Deps, &debug.Module{Path: "foreign/module", Replace: &debug.Module{Path: "/tmp/source"}})
				},
				"foreign fork": func(i *debug.BuildInfo) {
					i.Deps = append(i.Deps, &debug.Module{Path: "foreign/module", Replace: &debug.Module{Path: "foreign/fork", Version: "v1.0.0"}})
				},
				"nested replacement": func(i *debug.BuildInfo) {
					for _, dep := range i.Deps {
						if dep.Replace != nil {
							dep.Replace.Replace = &debug.Module{Path: "foreign/fork"}
							return
						}
					}
					t.Fatal("fixture has no dependency replacement")
				},
			}
			for name, mutate := range cases {
				t.Run(name, func(t *testing.T) {
					info := fixture(profile)
					mutate(info)
					if err := validate(profile, info); err == nil {
						t.Fatal("accepted invalid metadata")
					}
				})
			}
			// Exercise every pinned version, including effective Caddy replacements.
			for index := 0; index < len(fixture(profile).Deps); index++ {
				info := fixture(profile)
				dep := info.Deps[index]
				if dep.Replace != nil {
					dep.Replace.Version = "v0.0.0"
				} else {
					dep.Version = "v0.0.0"
				}
				if err := validate(profile, info); err == nil {
					t.Fatalf("accepted changed version for %s", dep.Path)
				}
			}
		})
	}
}

func TestCaddyJOSEPolicy(t *testing.T) {
	for _, replacement := range []*debug.Module{
		nil,
		{Path: "github.com/go-jose/go-jose/v4", Version: "v4.1.9"},
	} {
		info := fixture("caddy")
		info.Deps = append(info.Deps, &debug.Module{
			Path: "github.com/go-jose/go-jose/v3", Version: "v3.0.5", Replace: replacement,
		})
		if err := validate("caddy", info); err == nil || err.Error() != "obsolete JOSE dependency github.com/go-jose/go-jose/v3" {
			t.Fatalf("accepted legacy JOSE alongside patched v4: %v", err)
		}
	}
	info := fixture("caddy")
	info.Deps = info.Deps[:len(info.Deps)-1]
	if err := validate("caddy", info); err == nil {
		t.Fatal("accepted Caddy without patched JOSE v4")
	}
	for _, version := range []string{"v4.1.5", "v4.1.7", ""} {
		for _, replaced := range []bool{false, true} {
			info = fixture("caddy")
			dep := info.Deps[len(info.Deps)-1]
			if replaced {
				dep.Replace = &debug.Module{Path: dep.Path, Version: version}
			} else {
				dep.Version = version
			}
			if err := validate("caddy", info); err == nil {
				t.Fatalf("accepted unreviewed JOSE version %q (replacement=%v)", version, replaced)
			}
		}
	}
}

func TestCaddyReplacementPolicy(t *testing.T) {
	info := fixture("caddy")
	info.Deps[0].Version = "v0.62.0"
	info.Deps[0].Replace = nil
	info.Deps = append(info.Deps, &debug.Module{Path: "foreign/module", Replace: &debug.Module{Path: "foreign/module", Version: "v1.0.0"}})
	if err := validate("caddy", info); err != nil {
		t.Fatal(err)
	}
	for _, replacement := range []*debug.Module{
		{Path: "local/fork", Version: "v0.62.0"},
		{Path: "golang.org/x/net", Version: "(devel)"},
		{Path: "/tmp/wrong-cache-source"},
	} {
		info := fixture("caddy")
		info.Deps[0].Replace = replacement
		if err := validate("caddy", info); err == nil {
			t.Fatal("accepted wrong replacement")
		}
	}
	for _, version := range []string{"", "(devel)"} {
		info = fixture("caddy")
		info.Deps[5].Replace.Version = version
		if err := validate("caddy", info); err != nil {
			t.Fatalf("rejected local cache version %q: %v", version, err)
		}
		for _, path := range []string{"/tmp/wrong-cache-source", "/opt/rentnerproxy-responsecache/other", "github.com/foreign/cache"} {
			info.Deps[5].Replace.Path = path
			if err := validate("caddy", info); err == nil {
				t.Fatalf("accepted wrong cache source %s with version %q", path, version)
			}
		}
	}
}

func TestCrowdsecPostgresAndTags(t *testing.T) {
	for _, path := range []string{"github.com/jackc/pgx/v4", "github.com/jackc/pgproto3/v2", "github.com/jackc/pgconn", "github.com/jackc/pgtype"} {
		info := fixture("crowdsec")
		info.Deps = append(info.Deps, &debug.Module{Path: path, Version: "v1.0.0"})
		if err := validate("crowdsec", info); err == nil {
			t.Fatalf("accepted %s", path)
		}
	}
	for _, tags := range []string{"", "netgo,osusergo", crowdsecTags + ",extra"} {
		info := fixture("crowdsec")
		info.Settings[1].Value = tags
		if err := validate("crowdsec", info); err == nil {
			t.Fatal("accepted wrong tags")
		}
	}
	info := fixture("crowdsec")
	info.Settings = info.Settings[:1]
	if err := validate("crowdsec", info); err == nil {
		t.Fatal("accepted missing tags")
	}
}

func TestReadBinaryAndCLI(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "main.go")
	if err := os.WriteFile(source, []byte("package main\nfunc main() {}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "fixture.exe")
	cmd := exec.Command("go", "build", "-o", binary, source)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build fixture: %s: %v", output, err)
	}
	info, err := buildinfo.ReadFile(binary)
	if err != nil || info.GoVersion == "" {
		t.Fatalf("read actual Go binary: %v", err)
	}
	if err := run([]string{"caddy", binary}); err == nil {
		t.Fatal("accepted binary without pinned dependencies")
	}
	for _, args := range [][]string{nil, {"unknown", binary}, {"crowdsec", source}, {"caddy", filepath.Join(dir, "missing")}} {
		if err := run(args); err == nil {
			t.Fatalf("accepted invalid arguments or artifact: %v", args)
		}
	}
	if err := validate("unknown", info); err == nil {
		t.Fatal("accepted unknown profile")
	}
	if err := validate("caddy", nil); err == nil {
		t.Fatal("accepted missing metadata")
	}
}

func TestCaddyPatchedSourcePolicy(t *testing.T) {
	for _, version := range []string{"", "(devel)"} {
		info := fixture("caddy")
		info.Deps[4].Replace.Version = version
		if err := validate("caddy", info); err != nil {
			t.Fatalf("rejected reviewed Caddy source %q: %v", version, err)
		}
	}
	cases := map[string]func(*debug.BuildInfo){
		"unpatched release":        func(i *debug.BuildInfo) { i.Deps[4].Replace = nil },
		"wrong original version":   func(i *debug.BuildInfo) { i.Deps[4].Version = "v2.11.8" },
		"missing original version": func(i *debug.BuildInfo) { i.Deps[4].Version = "" },
		"wrong source":             func(i *debug.BuildInfo) { i.Deps[4].Replace.Path = "/tmp/caddy-source" },
		"nested source path":       func(i *debug.BuildInfo) { i.Deps[4].Replace.Path = caddySource + "/other" },
		"unclean source path":      func(i *debug.BuildInfo) { i.Deps[4].Replace.Path = caddySource + "/../rentnerproxy-caddy-source" },
		"versioned local source":   func(i *debug.BuildInfo) { i.Deps[4].Replace.Version = "v2.11.7" },
		"unreviewed fork":          func(i *debug.BuildInfo) { i.Deps[4].Replace.Path = "github.com/foreign/caddy/v2" },
		"same module replacement":  func(i *debug.BuildInfo) { i.Deps[4].Replace = &debug.Module{Path: caddyModule, Version: "v2.11.7"} },
		"nested replacement":       func(i *debug.BuildInfo) { i.Deps[4].Replace.Replace = &debug.Module{Path: caddySource} },
		"missing Caddy":            func(i *debug.BuildInfo) { i.Deps = append(i.Deps[:4], i.Deps[5:]...) },
		"duplicate Caddy":          func(i *debug.BuildInfo) { i.Deps = append(i.Deps, i.Deps[4]) },
		"nil dependency":           func(i *debug.BuildInfo) { i.Deps = append(i.Deps, nil) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			info := fixture("caddy")
			mutate(info)
			if err := validate("caddy", info); err == nil {
				t.Fatal("accepted unreviewed Caddy build metadata")
			}
		})
	}
}
