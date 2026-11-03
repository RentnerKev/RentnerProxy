package responsecache

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

type brokenWriter struct {
	http.ResponseWriter
	short bool
}

func (w brokenWriter) Write(p []byte) (int, error) {
	if w.short {
		return len(p) - 1, nil
	}
	return 0, io.ErrClosedPipe
}

func TestCaptureRejectsDeliveryErrorsAndUnsupportedUpgrades(t *testing.T) {
	for _, short := range []bool{false, true} {
		h := testHandler(t)
		req := httptest.NewRequest("GET", "/assets/site.css", nil)
		err := h.ServeHTTP(brokenWriter{httptest.NewRecorder(), short}, req, caddyhttp.HandlerFunc(asset))
		if !short && !errors.Is(err, io.ErrClosedPipe) {
			t.Fatalf("delivery error lost: %v", err)
		}
		if h.cache.count != 0 || h.cache.bytes != 0 {
			t.Fatal("failed delivery retained cache reservation")
		}
	}
	h := testHandler(t)
	rec := httptest.NewRecorder()
	w := &captureWriter{ResponseWriter: rec, handler: h, started: time.Now()}
	if w.Unwrap() != rec {
		t.Fatal("response controller unwrap changed writer")
	}
	if _, _, err := w.Hijack(); !errors.Is(err, http.ErrNotSupported) {
		t.Fatalf("unsupported hijack: %v", err)
	}
	if !w.rejected {
		t.Fatal("upgrade failed to disable capture")
	}
	n, err := w.ReadFrom(strings.NewReader("body"))
	if err != nil || n != 4 || rec.Body.String() != "body" {
		t.Fatalf("bounded ReaderFrom delivery: n=%d err=%v", n, err)
	}
	w.Flush()
	w.WriteHeader(http.StatusNotFound)
	if rec.Code != http.StatusOK {
		t.Fatal("duplicate headers changed committed status")
	}
}

func TestReaderFromPreservesDeliveryAndRejectsOverlongOriginBody(t *testing.T) {
	for _, body := range []string{"test", "longer"} {
		h := testHandler(t)
		rec := httptest.NewRecorder()
		rec.Header().Set("Content-Length", "4")
		rec.Header().Set("Content-Type", "text/css")
		rec.Header().Set("Cache-Control", "public")
		w := &captureWriter{ResponseWriter: rec, handler: h, key: "asset", started: time.Now()}
		n, err := w.ReadFrom(strings.NewReader(body))
		w.complete = err == nil
		w.finish()
		if err != nil || n != int64(len(body)) || rec.Body.String() != body {
			t.Fatalf("origin delivery changed: %d %v %q", n, err, rec.Body.String())
		}
		cached := h.cache.get("asset", time.Now())
		if body == "test" {
			if cached == nil || string(cached.body) != body {
				t.Fatal("complete ReaderFrom response was not captured")
			}
			h.cache.release(cached)
		} else if cached != nil || h.cache.bytes != 0 || h.cache.count != 0 {
			t.Fatal("overlong ReaderFrom body was cached or leaked a reservation")
		}
	}
}
