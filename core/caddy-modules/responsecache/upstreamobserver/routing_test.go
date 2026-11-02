package upstreamobserver

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
)

// TestBodylessIdempotencyKeyWriteOnWarmedUpstream demonstrates the stock HTTP/1 replay
// and verifies that disabling reuse prevents it while retaining actual HTTP/2 negotiation.
func TestBodylessIdempotencyKeyWriteOnWarmedUpstream(t *testing.T) {
	type connectionKey struct{}
	for _, test := range []struct {
		name             string
		http2            bool
		disableKeepAlive bool
		wantCalls        int32
	}{
		{"http1_default", false, false, 2},
		{"http1_no_keepalive", false, true, 1},
		{"http2_default", true, false, 1},
		{"http2_no_keepalive", true, true, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			var calls atomic.Int32
			backend := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.ProtoMajor == 2 != test.http2 {
					t.Errorf("unexpected backend protocol %s", r.Proto)
				}
				if r.URL.Path == "/warm" {
					w.WriteHeader(200)
					return
				}
				calls.Add(1)
				if r.Method != http.MethodPost || r.Header.Get("Idempotency-Key") != "accepted-write" || r.ContentLength != 0 {
					t.Errorf("write changed: method=%s key=%q length=%d", r.Method, r.Header.Get("Idempotency-Key"), r.ContentLength)
				}
				// Close only after the backend accepted this write. A retry here
				// could execute an application side effect twice.
				_ = r.Context().Value(connectionKey{}).(net.Conn).Close()
			}))
			backend.Config.ConnContext = func(ctx context.Context, connection net.Conn) context.Context {
				return context.WithValue(ctx, connectionKey{}, connection)
			}
			if test.http2 {
				backend.EnableHTTP2 = true
				backend.StartTLS()
			} else {
				backend.Start()
			}
			defer backend.Close()
			address := strings.TrimPrefix(strings.TrimPrefix(backend.URL, "http://"), "https://")
			h := routingHandler(address)
			transport := map[string]any{"protocol": "http"}
			if test.http2 {
				transport["tls"] = map[string]any{"insecure_skip_verify": true}
			}
			if test.disableKeepAlive {
				transport["keep_alive"] = map[string]any{"enabled": false}
			}
			h["transport"] = transport
			url, client := startRouting(t, h)
			if status := requestStatus(t, client, http.MethodGet, url+"/warm", nil); status != 200 {
				t.Fatalf("warmup status %d", status)
			}
			request, err := http.NewRequest(http.MethodPost, url+"/write", nil)
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Idempotency-Key", "accepted-write")
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			_, _ = io.Copy(io.Discard, response.Body)
			if response.StatusCode != 502 || calls.Load() != test.wantCalls {
				t.Fatalf("status=%d backend executions=%d, want status=502 executions=%d", response.StatusCode, calls.Load(), test.wantCalls)
			}
		})
	}
}

// unusedAddress releases an ephemeral loopback listener for a subsequent Caddy
// bind or a refused-dial fixture; it does not reserve the address after returning.
func unusedAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	return address
}

// routingHandler reproduces the finite production retry policy with a shorter
// passive expiry. The always-false matcher blocks post-connect replay while
// Caddy's separate dial-error path can still retry an unsent request.
func routingHandler(addresses ...string) map[string]any {
	h := testHandler(testHost, addresses[0])
	upstreams := make([]any, 0, len(addresses))
	for _, address := range addresses {
		upstreams = append(upstreams, map[string]any{"dial": address})
	}
	h["upstreams"] = upstreams
	h["load_balancing"] = map[string]any{
		"selection_policy": map[string]any{"policy": "first"},
		"retries":          2, "try_duration": "5s", "try_interval": "250ms",
		"retry_match": []any{map[string]any{"not": []any{map[string]any{}}}},
	}
	h["health_checks"] = map[string]any{"passive": map[string]any{"fail_duration": "200ms", "max_fails": 1, "unhealthy_status": []int{502, 503, 504}}}
	return h
}

// startRouting provisions the actual registered wrapper and owns its Caddy
// lifecycle through test cleanup. Disabling client reuse isolates frontend
// connections without changing the upstream transport policy under test.
func startRouting(t *testing.T, handler map[string]any) (string, *http.Client) {
	t.Helper()
	address := unusedAddress(t)
	var config map[string]any
	if err := json.Unmarshal(observedConfig(t, handler), &config); err != nil {
		t.Fatal(err)
	}
	config["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["test"].(map[string]any)["listen"] = []string{address}
	data, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := caddy.Load(data, true); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := caddy.Stop(); err != nil {
			t.Error(err)
		}
	})
	transport := &http.Transport{DisableKeepAlives: true}
	t.Cleanup(transport.CloseIdleConnections)
	return "http://" + address, &http.Client{Transport: transport, Timeout: 2 * time.Second}
}

// requestStatus drains and closes the frontend response so subsequent assertions
// observe a completed exchange rather than an unread or abandoned response body.
func requestStatus(t *testing.T, client *http.Client, method, url string, body io.Reader) int {
	t.Helper()
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	return response.StatusCode
}

// waitMember waits on the observer's real handler-local state without probing or
// reloading Caddy itself, and reports the final observations if convergence fails.
func waitMember(t *testing.T, index int, healthy bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		result := query(t, testHost, testRevision)
		if len(result.Observations) == 1 && len(result.Observations[0].Members) > index && result.Observations[0].Members[index].Healthy == healthy {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("member %d never healthy=%t: %+v", index, healthy, result)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// TestActiveThresholdsAllDownAndRecoveryWithoutReload gates probe responses to
// distinguish one result from the configured two-result threshold. All-down
// routing must terminate, and recovery must retain the original handler token.
func TestActiveThresholdsAllDownAndRecoveryWithoutReload(t *testing.T) {
	started := make(chan struct{}, 1)
	status := make(chan int)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			w.WriteHeader(200)
			return
		}
		select {
		case started <- struct{}{}:
		case <-r.Context().Done():
			return
		}
		select {
		case code := <-status:
			w.WriteHeader(code)
		case <-r.Context().Done():
		}
	}))
	defer backend.Close()
	h := routingHandler(strings.TrimPrefix(backend.URL, "http://"))
	h["health_checks"] = map[string]any{"active": map[string]any{"uri": "/health", "interval": "20ms", "timeout": "1s", "fails": 2, "passes": 2, "expect_status": 200, "max_size": 4096}}
	url, client := startRouting(t, h)
	// A probe blocks until explicitly released. Seeing the next probe proves
	// the previous result has been processed, so threshold assertions do not race.
	awaitProbe := func() {
		t.Helper()
		select {
		case <-started:
		case <-time.After(2 * time.Second):
			t.Fatal("health probe did not arrive")
		}
	}
	advance := func(code int) {
		t.Helper()
		select {
		case status <- code:
		case <-time.After(2 * time.Second):
			t.Fatal("health probe did not accept result")
		}
		awaitProbe()
	}
	awaitProbe()
	token := query(t, testHost, testRevision).Observations[0].Instance
	advance(503)
	if !query(t, testHost, testRevision).Observations[0].Members[0].Healthy {
		t.Fatal("first failure ejected before fails=2")
	}
	advance(503)
	waitMember(t, 0, false)
	startedAt := time.Now()
	if got := requestStatus(t, client, http.MethodGet, url, nil); got != 503 {
		t.Fatalf("all-down status %d", got)
	}
	if time.Since(startedAt) > 1500*time.Millisecond {
		t.Fatal("all-down routing exceeded finite retry budget")
	}
	advance(200)
	if query(t, testHost, testRevision).Observations[0].Members[0].Healthy {
		t.Fatal("first success recovered before passes=2")
	}
	advance(200)
	waitMember(t, 0, true)
	if got := requestStatus(t, client, http.MethodGet, url, nil); got != 200 {
		t.Fatalf("recovered routing status %d", got)
	}
	if query(t, testHost, testRevision).Observations[0].Instance != token {
		t.Fatal("health recovery reloaded the handler")
	}
	// Cancel the blocked final probe before the backend is closed.
	if err := caddy.Stop(); err != nil {
		t.Fatal(err)
	}
}

// TestPassiveEjectionAndRecoveryWithoutReload verifies that a received 503 is
// returned once, ejects the primary for later requests, and expires naturally
// without replacing the handler or requiring an active health checker.
func TestPassiveEjectionAndRecoveryWithoutReload(t *testing.T) {
	var failed atomic.Bool
	failed.Store(true)
	var primaryCalls, secondaryCalls atomic.Int32
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		primaryCalls.Add(1)
		if failed.Load() {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(200)
	}))
	defer primary.Close()
	secondary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { secondaryCalls.Add(1); w.WriteHeader(200) }))
	defer secondary.Close()
	url, client := startRouting(t, routingHandler(strings.TrimPrefix(primary.URL, "http://"), strings.TrimPrefix(secondary.URL, "http://")))
	token := query(t, testHost, testRevision).Observations[0].Instance
	if got := requestStatus(t, client, http.MethodPost, url, strings.NewReader("first")); got != 503 {
		t.Fatalf("first response status %d", got)
	}
	waitMember(t, 0, false)
	if got := requestStatus(t, client, http.MethodPost, url, strings.NewReader("second")); got != 200 {
		t.Fatalf("failover response status %d", got)
	}
	if primaryCalls.Load() != 1 || secondaryCalls.Load() != 1 {
		t.Fatalf("unexpected ejection calls primary=%d secondary=%d", primaryCalls.Load(), secondaryCalls.Load())
	}
	failed.Store(false)
	waitMember(t, 0, true)
	if got := requestStatus(t, client, http.MethodPost, url, strings.NewReader("third")); got != 200 {
		t.Fatalf("recovered status %d", got)
	}
	if primaryCalls.Load() != 2 || secondaryCalls.Load() != 1 {
		t.Fatal("primary did not resume after passive failure expiry")
	}
	if query(t, testHost, testRevision).Observations[0].Instance != token {
		t.Fatal("passive recovery reloaded handler")
	}
}

// TestDialFailureCanRetryUnsentPostOnce permits failover only before a connection
// exists: a refused primary dial must leave the POST body intact and deliver it
// exactly once to the secondary despite the always-false replay matcher.
func TestDialFailureCanRetryUnsentPostOnce(t *testing.T) {
	var calls atomic.Int32
	payload := "exactly one body survives a failed connection"
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		data, _ := io.ReadAll(r.Body)
		if string(data) != payload {
			t.Errorf("body changed: %q", data)
		}
		w.WriteHeader(200)
	}))
	defer backend.Close()
	h := routingHandler(unusedAddress(t), strings.TrimPrefix(backend.URL, "http://"))
	h["health_checks"].(map[string]any)["passive"].(map[string]any)["fail_duration"] = "5s"
	url, client := startRouting(t, h)
	if got := requestStatus(t, client, http.MethodPost, url, strings.NewReader(payload)); got != 200 {
		t.Fatalf("dial failover status %d", got)
	}
	if calls.Load() != 1 {
		t.Fatalf("secondary received body %d times", calls.Load())
	}
}

// TestRoundRobinUsesBothHealthyMembers checks that observing upstream pointers
// leaves Caddy's configured selection policy and ordered pool membership intact.
func TestRoundRobinUsesBothHealthyMembers(t *testing.T) {
	var calls [2]atomic.Int32
	addresses := make([]string, 0, 2)
	for i := range calls {
		index := i
		backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls[index].Add(1); w.WriteHeader(200) }))
		defer backend.Close()
		addresses = append(addresses, strings.TrimPrefix(backend.URL, "http://"))
	}
	h := routingHandler(addresses...)
	h["load_balancing"].(map[string]any)["selection_policy"] = map[string]any{"policy": "round_robin"}
	url, client := startRouting(t, h)
	for i := 0; i < 4; i++ {
		if got := requestStatus(t, client, http.MethodGet, url, nil); got != 200 {
			t.Fatalf("round robin status %d", got)
		}
	}
	if calls[0].Load() != 2 || calls[1].Load() != 2 {
		t.Fatalf("uneven round robin calls: %d, %d", calls[0].Load(), calls[1].Load())
	}
}

// TestAcceptedRequestsAndStreamsAreNeverReplayed closes a backend after request
// acceptance or stream commitment. Writes, streamed GETs, and WebSocket upgrades
// must reach that backend once and never fall through to the healthy secondary.
func TestAcceptedRequestsAndStreamsAreNeverReplayed(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodGet, "GET_RESPONSE_STREAM", "WEBSOCKET"} {
		t.Run(method, func(t *testing.T) {
			var primaryCalls, secondaryCalls atomic.Int32
			primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				primaryCalls.Add(1)
				_, _ = io.Copy(io.Discard, r.Body)
				conn, rw, err := w.(http.Hijacker).Hijack()
				if err != nil {
					t.Error(err)
					return
				}
				defer conn.Close()
				if method == "WEBSOCKET" {
					_, _ = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nstream bytes")
					_ = rw.Flush()
				}
				if method == "GET_RESPONSE_STREAM" {
					_, _ = rw.WriteString("HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\npartial stream")
					_ = rw.Flush()
				}
				// Accept and consume the body, then close without response headers.
			}))
			defer primary.Close()
			secondary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { secondaryCalls.Add(1); w.WriteHeader(200) }))
			defer secondary.Close()
			h := routingHandler(strings.TrimPrefix(primary.URL, "http://"), strings.TrimPrefix(secondary.URL, "http://"))
			h["health_checks"].(map[string]any)["passive"].(map[string]any)["fail_duration"] = "5s"
			url, client := startRouting(t, h)
			requestMethod := method
			var body io.Reader = strings.NewReader(strings.Repeat("payload", 1024))
			if method == http.MethodGet {
				reader, writer := io.Pipe()
				body = reader
				go func() { _, _ = writer.Write([]byte("streamed body")); _ = writer.Close() }()
			}
			if method == "WEBSOCKET" || method == "GET_RESPONSE_STREAM" {
				requestMethod = http.MethodGet
				body = nil
			}
			req, err := http.NewRequest(requestMethod, url, body)
			if err != nil {
				t.Fatal(err)
			}
			if method == "WEBSOCKET" {
				req.Header.Set("Connection", "Upgrade")
				req.Header.Set("Upgrade", "websocket")
				req.Header.Set("Sec-WebSocket-Version", "13")
				var nonce [16]byte
				if _, err := rand.Read(nonce[:]); err != nil {
					t.Fatal(err)
				}
				req.Header.Set("Sec-WebSocket-Key", base64.StdEncoding.EncodeToString(nonce[:]))
			}
			response, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			data, _ := io.ReadAll(response.Body)
			if method == "WEBSOCKET" {
				if response.StatusCode != 101 || string(data) != "stream bytes" {
					t.Fatalf("stream failed: status=%d body=%q", response.StatusCode, data)
				}
			} else if method == "GET_RESPONSE_STREAM" {
				if response.StatusCode != 200 || string(data) != "partial stream" {
					t.Fatalf("partial stream failed: status=%d body=%q", response.StatusCode, data)
				}
			} else if response.StatusCode != 502 {
				t.Fatalf("accepted-aborted request status %d", response.StatusCode)
			}
			if primaryCalls.Load() != 1 || secondaryCalls.Load() != 0 {
				t.Fatalf("request replayed: primary=%d secondary=%d", primaryCalls.Load(), secondaryCalls.Load())
			}
		})
	}
}
