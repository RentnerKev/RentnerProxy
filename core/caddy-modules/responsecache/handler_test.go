package responsecache

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

func testHandler(t *testing.T) *Handler {
	t.Helper()
	h := &Handler{Configuration: strings.Repeat("a", 64), Scheme: "http", PathPrefixes: []string{"/assets/"}, TTLSeconds: 60}
	if err := h.Provision(caddy.Context{}); err != nil {
		t.Fatal(err)
	}
	h.cache = newStore()
	t.Cleanup(func() { _ = h.Cleanup() })
	return h
}
func asset(w http.ResponseWriter, _ *http.Request) error {
	w.Header().Set("Cache-Control", "public, max-age=60")
	w.Header().Set("Content-Type", "text/css")
	w.Header().Set("Content-Length", "4")
	_, err := io.WriteString(w, "test")
	return err
}
func request(t *testing.T, h *Handler, method, uri string, next caddyhttp.HandlerFunc, change func(*http.Request)) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, uri, nil)
	if change != nil {
		change(req)
	}
	rec := httptest.NewRecorder()
	if err := h.ServeHTTP(rec, req, next); err != nil {
		t.Fatal(err)
	}
	return rec
}
func TestHitHeadExpiryAndOriginFailure(t *testing.T) {
	h := testHandler(t)
	var calls int
	next := func(w http.ResponseWriter, r *http.Request) error { calls++; return asset(w, r) }
	first := request(t, h, "GET", "http://one.test/assets/site.css", next, nil)
	second := request(t, h, "GET", "http://one.test/assets/site.css", next, nil)
	if calls != 1 || first.Body.String() != "test" || !bytes.Equal(first.Body.Bytes(), second.Body.Bytes()) || second.Header().Get("Age") == "" {
		t.Fatalf("calls=%d, payload=%q", calls, second.Body.String())
	}
	head := request(t, h, "HEAD", "http://one.test/assets/site.css", next, nil)
	if calls != 1 || head.Body.Len() != 0 || head.Header().Get("Content-Length") != "4" {
		t.Fatal("HEAD must use GET metadata only")
	}
	h.cache.Lock()
	for _, e := range h.cache.entries {
		e.expires = time.Now().Add(-time.Second)
	}
	h.cache.Unlock()
	request(t, h, "GET", "http://one.test/assets/site.css", next, nil)
	if calls != 2 {
		t.Fatal("expired entry was served")
	}
	_ = h.Cleanup()
	request(t, h, "GET", "http://one.test/assets/site.css", next, nil)
	if calls != 3 {
		t.Fatal("cleanup must fall back to origin")
	}
	fresh := testHandler(t)
	request(t, fresh, "HEAD", "http://one.test/assets/site.css", func(w http.ResponseWriter, _ *http.Request) error { w.Header().Set("Content-Length", "4"); return nil }, nil)
	if fresh.cache.count != 0 {
		t.Fatal("HEAD cannot populate a GET entry")
	}
}
func TestHostSchemeConfigAndNegotiationIsolation(t *testing.T) {
	h := testHandler(t)
	var calls int
	next := func(w http.ResponseWriter, r *http.Request) error {
		calls++
		w.Header().Set("Vary", "Accept-Encoding")
		return asset(w, r)
	}
	for _, hostname := range []string{"one.test", "two.test"} {
		for _, encoding := range []string{"gzip", "br"} {
			for range 2 {
				request(t, h, "GET", "http://"+hostname+"/assets/site.css", next, func(r *http.Request) { r.Header.Set("Accept-Encoding", encoding) })
			}
		}
	}
	if calls != 4 {
		t.Fatalf("variant calls=%d", calls)
	}
	other := testHandler(t)
	other.cache = h.cache
	other.Scheme = "https"
	request(t, other, "GET", "https://one.test/assets/site.css", next, nil)
	if calls != 5 {
		t.Fatal("new config reused old namespace")
	}
}
func TestCredentialQueryRangeAndUnsafeRequestsAlwaysBypassHits(t *testing.T) {
	cases := []struct{ name, uri, header, value string }{
		{"cookie", "/assets/site.css", "Cookie", "id=secret"}, {"auth", "/assets/site.css", "Authorization", "Bearer secret"},
		{"empty cookie", "/assets/site.css", "Cookie", ""}, {"range", "/assets/site.css", "Range", "bytes=0-1"},
		{"conditional", "/assets/site.css", "If-None-Match", "tag"}, {"request no cache", "/assets/site.css", "Cache-Control", "no-cache"},
		{"query", "/assets/site.css?v=1", "", ""}, {"empty query", "/assets/site.css?", "", ""},
		{"traversal", "/assets/../site.css", "", ""}, {"encoded", "/assets/%73ite.css", "", ""},
		{"html", "/assets/index.html", "", ""}, {"api", "/api/site.css", "", ""},
		{"upgrade", "/assets/site.css", "Upgrade", "websocket"}, {"identity", "/assets/site.css", "X-Auth-Request-User", "private"},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			h := testHandler(t)
			calls := 0
			next := func(w http.ResponseWriter, r *http.Request) error { calls++; return asset(w, r) }
			request(t, h, "GET", "http://one.test/assets/site.css", next, nil)
			for range 2 {
				request(t, h, "GET", "http://one.test"+item.uri, next, func(r *http.Request) {
					if item.header != "" {
						r.Header[item.header] = []string{item.value}
					}
				})
			}
			if calls != 3 {
				t.Fatalf("unsafe request used cache: calls=%d", calls)
			}
		})
	}
}
func TestPrivateUnsupportedAndStreamingResponsesBypass(t *testing.T) {
	cases := []struct {
		name   string
		change func(http.ResponseWriter)
	}{
		{"private", func(w http.ResponseWriter) { w.Header().Set("Cache-Control", "private, max-age=60") }},
		{"no cache", func(w http.ResponseWriter) { w.Header().Set("Cache-Control", "public, no-cache") }},
		{"no store", func(w http.ResponseWriter) { w.Header().Set("Cache-Control", "public, no-store") }},
		{"cookie", func(w http.ResponseWriter) { w.Header().Set("Set-Cookie", "id=private") }},
		{"html", func(w http.ResponseWriter) { w.Header().Set("Content-Type", "text/html") }},
		{"vary", func(w http.ResponseWriter) { w.Header().Set("Vary", "Accept-Language") }},
		{"vary star", func(w http.ResponseWriter) { w.Header().Set("Vary", "*") }},
		{"unknown length", func(w http.ResponseWriter) { w.Header().Del("Content-Length") }},
		{"oversized", func(w http.ResponseWriter) { w.Header().Set("Content-Length", fmt.Sprint(maxBody+1)) }},
		{"trailer", func(w http.ResponseWriter) { w.Header().Set("Trailer", "Private") }},
		{"expired", func(w http.ResponseWriter) { w.Header().Set("Age", "60") }},
		{"status", func(w http.ResponseWriter) { w.WriteHeader(404) }},
		{"flush", func(w http.ResponseWriter) { _ = http.NewResponseController(w).Flush() }},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			h := testHandler(t)
			calls := 0
			next := func(w http.ResponseWriter, r *http.Request) error {
				calls++
				w.Header().Set("Cache-Control", "public, max-age=60")
				w.Header().Set("Content-Type", "text/css")
				w.Header().Set("Content-Length", "4")
				item.change(w)
				_, err := io.WriteString(w, "test")
				return err
			}
			for range 2 {
				request(t, h, "GET", "http://one.test/assets/site.css", next, nil)
			}
			if calls != 2 || h.cache.count != 0 || h.cache.bytes != 0 {
				t.Fatalf("cached ineligible response: calls=%d count=%d bytes=%d", calls, h.cache.count, h.cache.bytes)
			}
		})
	}
}
func TestFreshnessCeilingAndAge(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	header := http.Header{"Cache-Control": []string{"public, max-age=50, s-maxage=30"}, "Content-Type": []string{"text/css"}, "Content-Length": []string{"4"}, "Date": []string{now.Add(-10 * time.Second).Format(http.TimeFormat)}, "Age": []string{"5"}}
	_, ttl, age, ok := eligibleResponse(header, 60, now)
	if !ok || ttl != 20*time.Second || age != 10 {
		t.Fatalf("ttl=%v age=%d ok=%v", ttl, age, ok)
	}
	header.Set("Cache-Control", "public, max-age=500")
	_, ttl, _, ok = eligibleResponse(header, 60, now)
	if !ok || ttl != 50*time.Second {
		t.Fatal("configured lifetime exceeded")
	}
	header.Set("Cache-Control", "public")
	header.Set("Expires", now.Add(3*time.Second).Format(http.TimeFormat))
	_, ttl, _, ok = eligibleResponse(header, 60, now)
	if !ok || ttl != 3*time.Second {
		t.Fatal("Expires not honored")
	}
}
func TestIncompleteErrorAndOversizedWriteNeverStore(t *testing.T) {
	for _, body := range []string{"te", "toolong"} {
		h := testHandler(t)
		request(t, h, "GET", "http://one.test/assets/site.css", func(w http.ResponseWriter, _ *http.Request) error {
			w.Header().Set("Cache-Control", "public")
			w.Header().Set("Content-Type", "text/css")
			w.Header().Set("Content-Length", "4")
			_, err := io.WriteString(w, body)
			return err
		}, nil)
		if h.cache.count != 0 || h.cache.bytes != 0 {
			t.Fatal("partial or oversized body stored")
		}
	}
	h := testHandler(t)
	err := h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/assets/site.css", nil), caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		_ = asset(w, r)
		return errors.New("origin failed")
	}))
	if err == nil || h.cache.count != 0 || h.cache.bytes != 0 {
		t.Fatal("origin error must pass through without storage")
	}
}
func TestProcessBoundsEvictionPinsAndConcurrentCleanup(t *testing.T) {
	h := testHandler(t)
	for i := range maxEntries + 20 {
		request(t, h, "GET", fmt.Sprintf("http://one.test/assets/%d.css", i), asset, nil)
	}
	if h.cache.count > maxEntries || h.cache.bytes > maxBytes {
		t.Fatal("entry bounds exceeded")
	}
	var wg sync.WaitGroup
	var calls atomic.Int64
	next := func(w http.ResponseWriter, r *http.Request) error { calls.Add(1); return asset(w, r) }
	for range 48 {
		wg.Go(func() {
			for range 40 {
				request(t, h, "GET", "http://one.test/assets/site.css", next, nil)
			}
		})
	}
	wg.Go(func() { _ = h.Cleanup() })
	wg.Wait()
	if h.cache.bytes != 0 || h.cache.count != 0 || h.cache.fills != 0 || h.cache.readers != 0 {
		t.Fatalf("cleanup leaked bounds: %+v", h.cache)
	}
	s := newStore()
	for range maxFills {
		if !s.reserve(time.Now()) {
			t.Fatal("reservation unexpectedly rejected")
		}
	}
	if s.reserve(time.Now()) {
		t.Fatal("unbounded fill admission")
	}
	for range maxFills {
		s.finish(nil)
	}
	if s.bytes != 0 || s.count != 0 {
		t.Fatal("reservation leak")
	}
}
func TestStreamingPayloadNeverBuffersAndReaderFromIsBounded(t *testing.T) {
	h := testHandler(t)
	payload := strings.Repeat("x", maxBody*2)
	recorder := request(t, h, "GET", "http://one.test/assets/site.css", func(w http.ResponseWriter, _ *http.Request) error {
		w.Header().Set("Cache-Control", "public")
		w.Header().Set("Content-Type", "text/css")
		_, err := io.Copy(w, strings.NewReader(payload))
		return err
	}, nil)
	if recorder.Body.Len() != len(payload) || h.cache.bytes != 0 {
		t.Fatal("stream was buffered or altered")
	}
}

func TestOrdinaryConnectionTokensCanHit(t *testing.T) {
	for _, token := range []string{"keep-alive", "close", "keep-alive, close"} {
		h := testHandler(t)
		calls := 0
		next := func(w http.ResponseWriter, r *http.Request) error { calls++; return asset(w, r) }
		for range 2 {
			request(t, h, "GET", "http://one.test/assets/site.css", next, func(r *http.Request) { r.Header.Set("Connection", token) })
		}
		if calls != 1 {
			t.Fatalf("ordinary connection %s bypassed cache", token)
		}
	}
	h := testHandler(t)
	if _, ok := h.requestKey(httptest.NewRequest("GET", "http://one.test/assets/site.css", nil)); !ok {
		t.Fatal("eligible request rejected")
	}
	r := httptest.NewRequest("GET", "http://one.test/assets/site.css", nil)
	r.Header.Set("Connection", "X-Identity")
	if _, ok := h.requestKey(r); ok {
		t.Fatal("nominated hop header accepted")
	}
}

func TestUnsafeMutationInvalidatesAllVariantsAndFencesOldFill(t *testing.T) {
	h := testHandler(t)
	request(t, h, "GET", "http://one.test/assets/site.css", asset, nil)
	request(t, h, "GET", "http://one.test/assets/site.css", asset, func(r *http.Request) { r.Header.Set("Accept-Encoding", "gzip") })
	entered, release := make(chan struct{}), make(chan struct{})
	var wg sync.WaitGroup
	wg.Go(func() {
		request(t, h, "GET", "http://one.test/assets/slow.css", func(w http.ResponseWriter, r *http.Request) error {
			_ = asset(w, r)
			close(entered)
			<-release
			return nil
		}, nil)
	})
	<-entered
	request(t, h, "DELETE", "http://one.test/assets/site.css", func(w http.ResponseWriter, _ *http.Request) error { w.WriteHeader(204); return nil }, nil)
	close(release)
	wg.Wait()
	if h.cache.count != 0 || h.cache.bytes != 0 {
		t.Fatal("old fill restored an invalidated response")
	}
	calls := 0
	next := func(w http.ResponseWriter, r *http.Request) error { calls++; return asset(w, r) }
	request(t, h, "GET", "http://one.test/assets/site.css", next, nil)
	request(t, h, "GET", "http://one.test/assets/site.css", next, func(r *http.Request) { r.Header.Set("Accept-Encoding", "gzip") })
	if calls != 2 {
		t.Fatal("unsafe mutation did not invalidate every variant")
	}
}
func TestForwardedIdentityCannotConsumeOrPopulateAnonymousCache(t *testing.T) {
	for _, name := range []string{"Remote-User", "X-Authentik-Email", "X-Auth-Request-User", "X-Forwarded-User", "X-Forwarded-Email", "X-User", "X-Email"} {
		h := testHandler(t)
		calls := 0
		next := func(w http.ResponseWriter, r *http.Request) error { calls++; return asset(w, r) }
		request(t, h, "GET", "http://one.test/assets/site.css", next, func(r *http.Request) { r.Header.Set(name, "synthetic") })
		request(t, h, "GET", "http://one.test/assets/site.css", next, nil)
		request(t, h, "GET", "http://one.test/assets/site.css", next, func(r *http.Request) { r.Header.Set(name, "synthetic") })
		if calls != 3 {
			t.Fatalf("identity header %s shared anonymous cache", name)
		}
	}
}

func TestNegotiationMetadataIsBoundedEvenForEmptyValues(t *testing.T) {
	h := testHandler(t)
	r := httptest.NewRequest("GET", "http://one.test/assets/site.css", nil)
	r.Header["Accept-Encoding"] = make([]string, 10000)
	if _, ok := h.requestKey(r); ok {
		t.Fatal("unbounded empty negotiation values accepted")
	}
}

func TestAuthenticationAndAPIPathsAreNeverPublicRules(t *testing.T) {
	for _, prefix := range []string{"/api/", "/AUTH/", "/admin/", "/login/", "/logout/", "/oauth/", "/session/"} {
		if safePrefix(prefix) || safeAssetPath(prefix+"public.css") {
			t.Fatalf("reserved path accepted: %s", prefix)
		}
	}
}

func TestPayloadBudgetEvictsAndAccountsPinnedReaders(t *testing.T) {
	s := newStore()
	now := time.Now()
	for i := range 100 {
		if !s.reserve(now) {
			t.Fatal("LRU should release unpinned payloads for a bounded fill")
		}
		key := fmt.Sprint(i)
		s.finish(&entry{namespace: 1, key: key, body: make([]byte, maxBody), cost: maxBody + overhead, expires: now.Add(time.Minute)})
		if s.bytes > maxBytes || s.count > maxEntries || s.fills != 0 {
			t.Fatal("payload accounting cap exceeded")
		}
	}
	pinned := s.get("99", now)
	if pinned == nil {
		t.Fatal("new entry missing")
	}
	s.invalidate(1)
	if s.count != 1 || s.bytes != pinned.cost+maxHeaders+overhead {
		t.Fatal("retired reader body was released before delivery ended")
	}
	s.release(pinned)
	if s.bytes != 0 || s.count != 0 || s.readers != 0 {
		t.Fatal("pinned reader accounting leaked")
	}
}
