package responsecache

import (
	"bufio"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

func init() { caddy.RegisterModule(&Handler{}) }

var sequence atomic.Uint64

// Handler is intentionally JSON-only; the typed Rust controller owns configuration.
type Handler struct {
	Configuration string   `json:"configuration"`
	Scheme        string   `json:"scheme"`
	PathPrefixes  []string `json:"path_prefixes"`
	TTLSeconds    int      `json:"ttl_seconds"`
	namespace     uint64
	epoch         atomic.Uint64
	mu            sync.RWMutex
	stopped       bool
	cache         *store
}

func (*Handler) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{ID: "http.handlers.rentnerproxy_response_cache", New: func() caddy.Module { return new(Handler) }}
}
func (h *Handler) Provision(_ caddy.Context) error {
	if len(h.Configuration) != 64 || h.Scheme != "http" && h.Scheme != "https" || h.TTLSeconds < 1 || h.TTLSeconds > 3600 || len(h.PathPrefixes) < 1 || len(h.PathPrefixes) > 16 {
		return errors.New("invalid public asset response cache configuration")
	}
	for _, prefix := range h.PathPrefixes {
		if !safePrefix(prefix) {
			return errors.New("invalid public asset path prefix")
		}
	}
	h.namespace = sequence.Add(1)
	h.cache = shared
	return nil
}
func (h *Handler) Cleanup() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.stopped = true
	if h.cache != nil {
		h.cache.invalidate(h.namespace)
	}
	return nil
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions && r.Method != http.MethodTrace {
		h.invalidate()
		defer h.invalidate()
		return next.ServeHTTP(w, r)
	}
	epoch := h.epoch.Load()
	key, ok := h.requestKeyAt(r, epoch)
	if !ok {
		return next.ServeHTTP(w, r)
	}
	h.mu.RLock()
	if h.stopped || h.cache == nil {
		h.mu.RUnlock()
		return next.ServeHTTP(w, r)
	}
	cached := h.cache.get(key, time.Now())
	h.mu.RUnlock()
	if cached != nil {
		defer h.cache.release(cached)
		for name, values := range cached.header {
			w.Header()[name] = append([]string(nil), values...)
		}
		w.Header().Set("Age", strconv.FormatInt(cached.age+int64(time.Since(cached.stored)/time.Second), 10))
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodHead {
			return nil
		}
		_, err := w.Write(cached.body)
		return err
	}
	if r.Method == http.MethodHead {
		return next.ServeHTTP(w, r)
	}
	writer := &captureWriter{ResponseWriter: w, handler: h, key: key, epoch: epoch, started: time.Now()}
	defer writer.finish()
	err := next.ServeHTTP(writer, r)
	writer.complete = err == nil && r.Context().Err() == nil
	return err
}

type captureWriter struct {
	epoch uint64
	http.ResponseWriter
	handler                             *Handler
	key                                 string
	started                             time.Time
	wrote, reserved, rejected, complete bool
	expected                            int
	body                                []byte
	header                              http.Header
	ttl                                 time.Duration
	age                                 int64
}

func (w *captureWriter) WriteHeader(status int) {
	if status >= 100 && status < 200 {
		w.reject()
		w.ResponseWriter.WriteHeader(status)
		return
	}
	if w.wrote {
		return
	}
	w.wrote = true
	if status == http.StatusOK && !w.rejected {
		length, ttl, age, ok := eligibleResponse(w.Header(), w.handler.TTLSeconds, w.started)
		if ok {
			w.handler.mu.RLock()
			if !w.handler.stopped && w.handler.cache.reserve(time.Now()) {
				w.reserved = true
				w.expected = length
				w.ttl = ttl
				w.age = age
				w.header = w.Header().Clone()
				if w.header.Get("Date") == "" {
					w.header.Set("Date", w.started.UTC().Format(http.TimeFormat))
				}
				w.body = make([]byte, 0, length)
			}
			w.handler.mu.RUnlock()
		}
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *captureWriter) Write(p []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(p)
	if w.reserved {
		if err != nil || n != len(p) || len(p) > w.expected-len(w.body) {
			w.reject()
		} else {
			w.body = append(w.body, p...)
		}
	}
	return n, err
}
func (w *captureWriter) ReadFrom(r io.Reader) (int64, error) {
	// Hide ReaderFrom from io.Copy to keep every byte on the bounded Write path.
	return io.Copy(struct{ io.Writer }{w}, r)
}
func (w *captureWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *captureWriter) FlushError() error {
	w.reject()
	return http.NewResponseController(w.ResponseWriter).Flush()
}
func (w *captureWriter) Flush() { _ = w.FlushError() }
func (w *captureWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	w.reject()
	return http.NewResponseController(w.ResponseWriter).Hijack()
}
func (w *captureWriter) reject() {
	w.rejected = true
	if w.reserved {
		w.handler.cache.finish(nil)
		w.reserved = false
	}
	w.body = nil
	w.header = nil
}
func (w *captureWriter) finish() {
	if !w.reserved {
		return
	}
	var cached *entry
	w.handler.mu.RLock()
	defer w.handler.mu.RUnlock()
	// Origin freshness starts when headers arrive; a slow body cannot extend it.
	expires := w.started.Add(w.ttl)
	if w.complete && !w.rejected && !w.handler.stopped && w.epoch == w.handler.epoch.Load() && len(w.body) == w.expected && time.Now().Before(expires) {
		// Trailers can appear only after the body; no late security headers survive.
		finalHeader := w.Header()
		if headerSize(finalHeader) <= maxHeaders {
			finalHeader = finalHeader.Clone()
			// A delivery encoder may remove the origin representation length.
			finalHeader.Set("Content-Length", strconv.Itoa(w.expected))
		}
		if _, _, _, ok := eligibleResponse(finalHeader, w.handler.TTLSeconds, w.started); ok {
			cached = &entry{namespace: w.handler.namespace, key: w.key, header: w.header, body: w.body, expires: expires, stored: w.started, age: w.age, cost: len(w.body) + headerSize(w.header) + len(w.key) + overhead}
		}
	}
	w.handler.cache.finish(cached)
	w.reserved = false
}

var (
	_ caddy.Provisioner           = (*Handler)(nil)
	_ caddy.CleanerUpper          = (*Handler)(nil)
	_ caddyhttp.MiddlewareHandler = (*Handler)(nil)
	_ io.ReaderFrom               = (*captureWriter)(nil)
)

// Conservative unsafe-method invalidation fences old fills and fills admitted
// while the mutation was in flight. The eviction scan has a fixed entry bound.
func (h *Handler) invalidate() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.epoch.Add(1)
	if h.cache != nil {
		h.cache.invalidate(h.namespace)
	}
}
