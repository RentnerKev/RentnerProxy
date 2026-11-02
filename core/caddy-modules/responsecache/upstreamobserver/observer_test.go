package upstreamobserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp/reverseproxy"
)

const testHost = "01234567-89ab-cdef-0123-456789abcdef"

var testRevision = "sha256:" + strings.Repeat("a", 64)

func observedConfig(t *testing.T, handlers ...map[string]any) []byte {
	t.Helper()
	routes := make([]any, 0, len(handlers))
	for _, handler := range handlers {
		routes = append(routes, map[string]any{"handle": []any{handler}})
	}
	config := map[string]any{"admin": map[string]any{"disabled": true, "config": map[string]any{"persist": false}}, "apps": map[string]any{"http": map[string]any{"servers": map[string]any{"test": map[string]any{"listen": []string{"127.0.0.1:0"}, "routes": routes}}}}}
	data, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func testHandler(host, address string) map[string]any {
	return map[string]any{"handler": "rentnerproxy_upstream", "host_id": host, "revision": testRevision, "upstreams": []any{map[string]any{"dial": address}}}
}

func query(t *testing.T, host, revision string) response {
	t.Helper()
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/rentnerproxy/upstreams?host_id="+host+"&revision="+revision, nil)
	if err := (admin{}).handle(w, r); err != nil {
		t.Fatal(err)
	}
	var result response
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestActualHandlerLifecycleAndHealthIsolation(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/bad" {
			w.WriteHeader(503)
		}
	}))
	defer backend.Close()
	address := strings.TrimPrefix(backend.URL, "http://")
	secondHost := "11234567-89ab-cdef-0123-456789abcdef"
	first := testHandler(testHost, address)
	second := testHandler(secondHost, address)
	for _, item := range []struct {
		h    map[string]any
		path string
	}{{first, "/good"}, {second, "/bad"}} {
		item.h["health_checks"] = map[string]any{"active": map[string]any{"uri": item.path, "interval": "10ms", "timeout": "1s", "fails": 1, "passes": 1}}
	}
	if err := caddy.Load(observedConfig(t, first, second, testHandler(testHost, address)), true); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := caddy.Stop(); err != nil {
			t.Error(err)
		}
	})
	deadline := time.Now().Add(3 * time.Second)
	for {
		result := query(t, secondHost, testRevision)
		if len(result.Observations) == 1 && !result.Observations[0].Members[0].Healthy {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("active health checker did not mark /bad unhealthy: %+v", result)
		}
		time.Sleep(10 * time.Millisecond)
	}
	result := query(t, testHost, testRevision)
	if len(result.Observations) != 2 {
		t.Fatalf("same host route instances collapsed: %+v", result)
	}
	for _, observation := range result.Observations {
		if len(observation.Members) != 1 || !observation.Members[0].Healthy || !observation.Members[0].Available || observation.Members[0].Index != 0 || observation.Members[0].Address != address {
			t.Fatalf("incorrect per-handler state: %+v", observation)
		}
	}
	oldTokens := make([]string, 0, 2)
	for _, o := range result.Observations {
		oldTokens = append(oldTokens, o.Instance)
	}
	if err := caddy.Load(observedConfig(t, testHandler(testHost, address)), true); err != nil {
		t.Fatal(err)
	}
	result = query(t, testHost, testRevision)
	if len(result.Observations) != 1 {
		t.Fatalf("reload cleanup removed new handler: %+v", result)
	}
	for _, token := range oldTokens {
		if result.Observations[0].Instance == token {
			t.Fatal("reload reused instance token")
		}
	}
	broken := testHandler(testHost, address)
	broken["trusted_proxies"] = []string{"invalid CIDR"}
	if err := caddy.Load(observedConfig(t, broken), true); err == nil {
		t.Fatal("expected provisioning failure")
	}
	if got := query(t, testHost, testRevision); len(got.Observations) != 1 || got.Observations[0].Instance != result.Observations[0].Instance {
		t.Fatalf("failed provisioning changed active registry: %+v", got)
	}
	// This fails after stock Provision acquired upstream Host references.
	broken = testHandler(testHost, address)
	broken["health_checks"] = map[string]any{"active": map[string]any{"uri": "/", "expect_body": "["}}
	if err := caddy.Load(observedConfig(t, broken), true); err == nil {
		t.Fatal("expected late provisioning failure")
	}
	if got := query(t, testHost, testRevision); len(got.Observations) != 1 || got.Observations[0].Instance != result.Observations[0].Instance {
		t.Fatalf("late provisioning failure changed active registry: %+v", got)
	}
	if err := caddy.Stop(); err != nil {
		t.Fatal(err)
	}
	if got := query(t, testHost, testRevision); len(got.Observations) != 0 {
		t.Fatalf("cleanup leaked instances: %+v", got)
	}
}

func TestAdminQueryValidation(t *testing.T) {
	valid := "/rentnerproxy/upstreams?host_id=" + testHost + "&revision=" + testRevision
	for _, target := range []string{"/rentnerproxy/upstreams", valid + "&host_id=" + testHost, valid + "&extra=x", strings.Replace(valid, "sha256:", "SHA256:", 1), valid + "&x=%zz", strings.Replace(valid, testHost, strings.ToUpper(testHost), 1), "/rentnerproxy/upstreams/other?host_id=" + testHost + "&revision=" + testRevision} {
		err := (admin{}).handle(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, target, nil))
		if api, ok := err.(caddy.APIError); !ok || api.HTTPStatus != 400 {
			t.Errorf("query %s: %v", target, err)
		}
	}
	err := (admin{}).handle(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, valid, nil))
	if api, ok := err.(caddy.APIError); !ok || api.HTTPStatus != 405 {
		t.Errorf("method: %v", err)
	}
	if got := query(t, testHost, "sha256:"+strings.Repeat("b", 64)); len(got.Observations) != 0 {
		t.Fatalf("mismatched revision: %+v", got)
	}
}

func TestMetadataAndFlattenedStockConfiguration(t *testing.T) {
	var handler Handler
	data := []byte(`{"host_id":"` + testHost + `","revision":"` + testRevision + `","upstreams":[{"dial":"127.0.0.1:80"}],"flush_interval":-1,"load_balancing":{"retries":2}}`)
	if err := json.Unmarshal(data, &handler); err != nil {
		t.Fatal(err)
	}
	if handler.FlushInterval != -1 || handler.LoadBalancing.Retries != 2 || handler.Upstreams[0].Dial != "127.0.0.1:80" {
		t.Fatal("stock configuration was not flattened")
	}
	encoded, err := json.Marshal(&handler)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if fields["upstreams"] == nil || fields["host_id"] == nil || fields["revision"] == nil || fields["Handler"] != nil {
		t.Fatalf("unexpected encoding: %s", encoded)
	}
	for _, invalid := range []string{
		strings.Replace(string(data), testHost, strings.ToUpper(testHost), 1),
		strings.Replace(string(data), testRevision, "sha256:abc", 1),
		strings.Replace(string(data), `[{"dial":"127.0.0.1:80"}]`, `[]`, 1),
		strings.Replace(string(data), `[{"dial":"127.0.0.1:80"}]`, `[null]`, 1),
		strings.Replace(string(data), `[{"dial":"127.0.0.1:80"}]`, `[{"dial":""}]`, 1),
	} {
		var bad Handler
		if err := json.Unmarshal([]byte(invalid), &bad); err != nil {
			t.Fatal(err)
		}
		if err := bad.Provision(caddy.Context{}); err == nil {
			t.Fatalf("accepted invalid configuration: %s", invalid)
		}
		if err := bad.Cleanup(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAdminResponseByteLimit(t *testing.T) {
	h := &Handler{HostID: testHost, Revision: testRevision}
	for i := 0; i < maxMembers; i++ {
		h.Upstreams = append(h.Upstreams, &reverseproxy.Upstream{Host: new(reverseproxy.Host), Dial: strings.Repeat("\x00", maxAddressBytes)})
	}
	for i := 0; i < maxObservations; i++ {
		token := sequence.Add(1)
		if err := instances.add(token, h); err != nil {
			t.Fatal(err)
		}
		defer instances.remove(token)
	}
	err := (admin{}).handle(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/rentnerproxy/upstreams?host_id="+testHost+"&revision="+testRevision, nil))
	if api, ok := err.(caddy.APIError); !ok || api.HTTPStatus != http.StatusServiceUnavailable {
		t.Fatalf("oversized response: %v", err)
	}
}

func TestRegistryBoundsAndConcurrentCleanup(t *testing.T) {
	s := registry{entries: make(map[uint64]entry)}
	h := &Handler{HostID: testHost, Revision: testRevision, Handler: reverseproxy.Handler{Upstreams: reverseproxy.UpstreamPool{&reverseproxy.Upstream{Host: new(reverseproxy.Host), Dial: "127.0.0.1:80"}}}}
	for i := 1; i <= maxInstances; i++ {
		if err := s.add(uint64(i), h); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.add(maxInstances+1, h); err == nil {
		t.Fatal("unbounded registry")
	}
	if _, err := s.snapshot(testHost, testRevision); err == nil {
		t.Fatal("unbounded response")
	}
	for i := 2; i <= maxInstances; i++ {
		s.remove(uint64(i))
	}
	var wg sync.WaitGroup
	for n := 0; n < 8; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				token := uint64(n + 2)
				_ = s.add(token, h)
				if _, err := s.snapshot(testHost, testRevision); err != nil {
					t.Error(err)
				}
				s.remove(token)
			}
		}(n)
	}
	wg.Wait()
	s.remove(1)
	s.remove(1)
	if got, err := s.snapshot(testHost, testRevision); err != nil || len(got.Observations) != 0 {
		t.Fatal(fmt.Sprint(got, err))
	}
	// Repeated cleanup before provisioning must be safe too.
	if err := new(Handler).Cleanup(); err != nil {
		t.Fatal(err)
	}
}
