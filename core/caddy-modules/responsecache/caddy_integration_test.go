package responsecache

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func freeAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	return address
}

// This runs the actual production custom Caddy binary in an isolated container.
// No database, durable appliance state, external service or real credentials exist.
func TestCaddyRuntime(t *testing.T) {
	binary := os.Getenv("RENTNERPROXY_CADDY_TEST_BINARY")
	if binary == "" {
		t.Skip("set RENTNERPROXY_CADDY_TEST_BINARY for the real Caddy smoke")
	}
	var mu sync.Mutex
	counts := make(map[string]int)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		counts[r.Host+r.URL.Path]++
		mu.Unlock()
		body := []byte(strings.Repeat("asset-response;", 100))
		w.Header().Set("Cache-Control", "public, max-age=60")
		w.Header().Set("Content-Type", "text/css")
		w.Header().Set("Vary", "Accept-Encoding")
		w.Header().Set("Content-Length", fmt.Sprint(len(body)))
		switch r.URL.Path {
		case "/assets/private.css":
			w.Header().Set("Cache-Control", "private")
		case "/assets/cookie.css":
			w.Header().Set("Set-Cookie", "synthetic=only")
		case "/assets/vary.css":
			w.Header().Set("Vary", "Accept-Language")
		case "/assets/oversized.css":
			body = []byte(strings.Repeat("x", maxBody+1))
			w.Header().Set("Content-Length", fmt.Sprint(len(body)))
		case "/assets/stream.css":
			w.Header().Del("Content-Length")
			w.(http.Flusher).Flush()
		case "/assets/error.css":
			w.WriteHeader(503)
		}
		_, _ = w.Write(body)
	}))
	defer upstream.Close()
	address, admin := freeAddress(t), freeAddress(t)
	temp := t.TempDir()
	configPath := filepath.Join(temp, "caddy.json")
	makeConfig := func(identity string, enabled bool) []byte {
		proxy := map[string]any{"handler": "reverse_proxy", "upstreams": []any{map[string]any{"dial": strings.TrimPrefix(upstream.URL, "http://")}}}
		handlers := []any{map[string]any{"handler": "encode", "encodings": map[string]any{"gzip": map[string]any{}}, "minimum_length": 1}}
		if enabled {
			handlers = append(handlers, map[string]any{"handler": "rentnerproxy_response_cache", "configuration": strings.Repeat(identity, 64), "scheme": "http", "path_prefixes": []string{"/assets/"}, "ttl_seconds": 1})
		}
		handlers = append(handlers, proxy)
		routes := []any{
			map[string]any{"match": []any{map[string]any{"header": map[string][]string{"X-Test-Deny": []string{"yes"}}}}, "handle": []any{map[string]any{"handler": "static_response", "status_code": 403}}, "terminal": true},
			map[string]any{"match": []any{map[string]any{"host": []string{"protected.test"}}}, "handle": []any{map[string]any{"handler": "static_response", "status_code": 403}}, "terminal": true},
			map[string]any{"handle": handlers, "terminal": true},
		}
		config := map[string]any{"admin": map[string]any{"listen": admin, "config": map[string]any{"persist": false}}, "storage": map[string]any{"module": "file_system", "root": filepath.Join(temp, "state")}, "apps": map[string]any{"http": map[string]any{"servers": map[string]any{"test": map[string]any{"listen": []string{address}, "routes": routes, "automatic_https": map[string]bool{"disable": true}}}}}}
		result, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	configuration := makeConfig("a", true)
	if err := os.WriteFile(configPath, configuration, 0600); err != nil {
		t.Fatal(err)
	}
	start := func() func() {
		command := exec.Command(binary, "run", "--config", configPath)
		command.Env = append(os.Environ(), "XDG_CONFIG_HOME="+temp, "XDG_DATA_HOME="+temp, "HOME="+temp)
		log, err := os.Create(filepath.Join(temp, fmt.Sprintf("caddy-%d.log", time.Now().UnixNano())))
		if err != nil {
			t.Fatal(err)
		}
		command.Stdout = log
		command.Stderr = log
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		stop := func() { _ = command.Process.Kill(); _ = command.Wait(); _ = log.Close() }
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			response, err := (&http.Client{Timeout: 250 * time.Millisecond}).Get("http://" + admin + "/config/")
			if err == nil {
				_ = response.Body.Close()
				if response.StatusCode == 200 {
					return stop
				}
			}
			time.Sleep(20 * time.Millisecond)
		}
		stop()
		t.Fatal("custom Caddy did not become ready")
		return nil
	}
	stop := start()
	defer func() {
		if stop != nil {
			stop()
		}
	}()
	client := &http.Client{Transport: &http.Transport{DisableCompression: true}, Timeout: 5 * time.Second}
	defer client.CloseIdleConnections()
	fetch := func(host, path string, headers map[string]string) (int, []byte, http.Header) {
		req, err := http.NewRequest("GET", "http://"+address+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Host = host
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, body, response.Header
	}
	count := func(host, path string) int { mu.Lock(); defer mu.Unlock(); return counts[host+path] }
	_, body, _ := fetch("one.test", "/assets/public.css", nil)
	_, hit, header := fetch("one.test", "/assets/public.css", nil)
	if !bytes.Equal(body, hit) || count("one.test", "/assets/public.css") != 1 || header.Get("Age") == "" {
		t.Fatal("real proxy did not hit cache with equal payload")
	}
	status, _, _ := fetch("one.test", "/assets/public.css", map[string]string{"X-Test-Deny": "yes"})
	if status != 403 || count("one.test", "/assets/public.css") != 1 {
		t.Fatal("security prehandler was bypassed by a hit")
	}
	status, _, _ = fetch("protected.test", "/assets/public.css", nil)
	if status != 403 || count("protected.test", "/assets/public.css") != 0 {
		t.Fatal("protected host reached public cache")
	}
	for range 2 {
		fetch("two.test", "/assets/public.css", nil)
	}
	if count("two.test", "/assets/public.css") != 1 {
		t.Fatal("cross-host cache collision")
	}
	for range 2 {
		_, encoded, headers := fetch("one.test", "/assets/compressed.css", map[string]string{"Accept-Encoding": "gzip"})
		if headers.Get("Content-Encoding") != "gzip" {
			t.Fatal("delivery encoding missing")
		}
		reader, err := gzip.NewReader(bytes.NewReader(encoded))
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := io.ReadAll(reader)
		_ = reader.Close()
		if err != nil || !bytes.Equal(decoded, body) {
			t.Fatal("encoded hit payload corrupted")
		}
	}
	if count("one.test", "/assets/compressed.css") != 1 {
		t.Fatal("encoded delivery prevented origin cache hits")
	}
	for _, path := range []string{"/assets/private.css", "/assets/cookie.css", "/assets/vary.css", "/assets/oversized.css", "/assets/stream.css", "/assets/error.css"} {
		for range 2 {
			fetch("one.test", path, nil)
		}
		if count("one.test", path) != 2 {
			t.Fatalf("ineligible %s was cached", path)
		}
	}
	for _, headers := range []map[string]string{{"Cookie": "synthetic=only"}, {"Authorization": "Bearer synthetic"}, {"Range": "bytes=0-3"}, {"Cache-Control": "no-cache"}, {"If-None-Match": "synthetic"}} {
		before := count("one.test", "/assets/public.css")
		fetch("one.test", "/assets/public.css", headers)
		if count("one.test", "/assets/public.css") != before+1 {
			t.Fatal("credential or conditional request consumed warm hit")
		}
	}
	fetch("one.test", "/assets/public.css", nil)
	warmed := count("one.test", "/assets/public.css")
	fetch("one.test", "/assets/public.css", nil)
	if count("one.test", "/assets/public.css") != warmed {
		t.Fatal("entry was not warm before the mutation")
	}
	mutation, err := http.NewRequest("DELETE", "http://"+address+"/assets/public.css", nil)
	if err != nil {
		t.Fatal(err)
	}
	mutation.Host = "one.test"
	mutated, err := client.Do(mutation)
	if err != nil {
		t.Fatal(err)
	}
	_ = mutated.Body.Close()
	beforeMutation := count("one.test", "/assets/public.css")
	fetch("one.test", "/assets/public.css", nil)
	if count("one.test", "/assets/public.css") != beforeMutation+1 {
		t.Fatal("successful unsafe mutation left a warmed asset visible")
	}
	before := count("one.test", "/assets/public.css")
	time.Sleep(1100 * time.Millisecond)
	fetch("one.test", "/assets/public.css", nil)
	if count("one.test", "/assets/public.css") != before+1 {
		t.Fatal("TTL expired entry served")
	}
	reload := func(data []byte) {
		response, err := (&http.Client{Timeout: 5 * time.Second}).Post("http://"+admin+"/load", "application/json", bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			message, _ := io.ReadAll(response.Body)
			t.Fatalf("reload failed: %s", message)
		}
	}
	before = count("one.test", "/assets/public.css")
	reload(makeConfig("b", true))
	fetch("one.test", "/assets/public.css", nil)
	if count("one.test", "/assets/public.css") != before+1 {
		t.Fatal("reconfiguration exposed stale body")
	}
	reload(makeConfig("b", false))
	before = count("one.test", "/assets/public.css")
	for range 2 {
		fetch("one.test", "/assets/public.css", nil)
	}
	if count("one.test", "/assets/public.css") != before+2 {
		t.Fatal("disabling left cache active")
	}
	stop()
	stop = nil
	if err := os.WriteFile(configPath, configuration, 0600); err != nil {
		t.Fatal(err)
	}
	stop = start()
	before = count("one.test", "/assets/public.css")
	fetch("one.test", "/assets/public.css", nil)
	if count("one.test", "/assets/public.css") != before+1 {
		t.Fatal("restart restored ephemeral body")
	}
}
