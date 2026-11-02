// Package upstreamobserver exposes handler-local upstream state on Caddy's private admin API.
package upstreamobserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp/reverseproxy"
)

const (
	maxInstances     = 32768
	maxObservations  = 64
	maxMembers       = 16
	maxAddressBytes  = 512
	maxResponseBytes = 1 << 20
)

var (
	hostPattern     = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	revisionPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	instances       = registry{entries: make(map[uint64]entry)}
	sequence        atomic.Uint64
)

func init() {
	caddy.RegisterModule(&Handler{})
	caddy.RegisterModule(admin{})
}

// Handler owns the stock handler in place: its upstreams must never be copied.
// Embedding preserves the stock JSON fields at the top level.
type Handler struct {
	reverseproxy.Handler
	HostID      string `json:"host_id"`
	Revision    string `json:"revision"`
	token       uint64
	started     bool
	cleanupOnce sync.Once
	cleanupErr  error
}

func (*Handler) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{ID: "http.handlers.rentnerproxy_upstream", New: func() caddy.Module { return new(Handler) }}
}

// Provision registers fully initialized stock upstream pointers with an instance-specific cleanup token.
func (h *Handler) Provision(ctx caddy.Context) error {
	if !hostPattern.MatchString(h.HostID) || !revisionPattern.MatchString(h.Revision) || len(h.Upstreams) < 1 || len(h.Upstreams) > maxMembers || h.DynamicUpstreamsRaw != nil || h.DynamicUpstreams != nil {
		return errors.New("invalid observed upstream configuration")
	}
	for _, upstream := range h.Upstreams {
		if upstream == nil || len(upstream.Dial) == 0 || len(upstream.Dial) > maxAddressBytes {
			return errors.New("invalid observed upstream member")
		}
	}
	// Stock Provision initializes its cleanup mutex immediately after obtaining events.
	// Resolve that dependency first so even an early provisioning error cleans up safely.
	if _, err := ctx.App("events"); err != nil {
		return err
	}
	h.started = true
	if err := h.Handler.Provision(ctx); err != nil {
		// Stock Cleanup releases every upstream. Only members already provisioned
		// acquired a pooled Host reference; do not release another handler's reference.
		provisioned := make(reverseproxy.UpstreamPool, 0, len(h.Upstreams))
		for _, upstream := range h.Upstreams {
			if upstream.Host != nil {
				provisioned = append(provisioned, upstream)
			}
		}
		h.Upstreams = provisioned
		_ = h.Cleanup()
		return err
	}
	token := sequence.Add(1)
	if err := instances.add(token, h); err != nil {
		_ = h.Cleanup()
		return err
	}
	h.token = token
	return nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	return h.Handler.ServeHTTP(w, r, next)
}

// Cleanup unregisters only this instance and releases stock resources once, including partial failures.
func (h *Handler) Cleanup() error {
	h.cleanupOnce.Do(func() {
		instances.remove(h.token)
		if h.started {
			h.cleanupErr = h.Handler.Cleanup()
		}
	})
	return h.cleanupErr
}

type entry struct {
	hostID, revision string
	members          reverseproxy.UpstreamPool
}
type registry struct {
	sync.RWMutex
	entries map[uint64]entry
}

// add retains the handler's own upstream pointers without copying live state or exceeding capacity.
func (s *registry) add(token uint64, h *Handler) error {
	s.Lock()
	defer s.Unlock()
	if len(s.entries) >= maxInstances {
		return errors.New("upstream observer registry capacity exceeded")
	}
	// Copy the pointer slice, never the Upstream values.
	s.entries[token] = entry{h.HostID, h.Revision, append(reverseproxy.UpstreamPool(nil), h.Upstreams...)}
	return nil
}
func (s *registry) remove(token uint64) { s.Lock(); defer s.Unlock(); delete(s.entries, token) }

type member struct {
	Index     int    `json:"index"`
	Address   string `json:"address"`
	Healthy   bool   `json:"healthy"`
	Available bool   `json:"available"`
}
type observation struct {
	Instance string   `json:"instance"`
	Members  []member `json:"members"`
}
type response struct {
	Revision     string        `json:"revision"`
	HostID       string        `json:"host_id"`
	Observations []observation `json:"observations"`
}

// snapshot samples only the requested revision and preserves separate route instances for honest aggregation.
func (s *registry) snapshot(hostID, revision string) (response, error) {
	s.RLock()
	defer s.RUnlock()
	result := response{Revision: revision, HostID: hostID, Observations: []observation{}}
	for token, entry := range s.entries {
		if entry.hostID != hostID || entry.revision != revision {
			continue
		}
		if len(result.Observations) >= maxObservations {
			return response{}, errors.New("too many upstream observer instances")
		}
		item := observation{Instance: strconv.FormatUint(token, 16), Members: make([]member, 0, len(entry.members))}
		for index, upstream := range entry.members {
			healthy := upstream.Healthy()
			item.Members = append(item.Members, member{index, upstream.Dial, healthy, healthy && !upstream.Full()})
		}
		result.Observations = append(result.Observations, item)
	}
	sort.Slice(result.Observations, func(i, j int) bool { return result.Observations[i].Instance < result.Observations[j].Instance })
	return result, nil
}

type admin struct{}

func (admin) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{ID: "admin.api.rentnerproxy", New: func() caddy.Module { return new(admin) }}
}
func (a admin) Routes() []caddy.AdminRoute {
	return []caddy.AdminRoute{{Pattern: "/rentnerproxy/upstreams", Handler: caddy.AdminHandlerFunc(a.handle)}}
}

// handle serves bounded, non-cacheable observations exclusively on Caddy's private admin API.
func (admin) handle(w http.ResponseWriter, r *http.Request) error {
	apiError := func(status int, message string) error {
		return caddy.APIError{HTTPStatus: status, Err: errors.New(message)}
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		return apiError(http.StatusMethodNotAllowed, "method not allowed")
	}
	if r.URL.Path != "/rentnerproxy/upstreams" || len(r.URL.RawQuery) > 256 {
		return apiError(http.StatusBadRequest, "invalid upstream observation query")
	}
	query, err := parseQuery(r)
	if err != nil {
		return apiError(http.StatusBadRequest, "invalid upstream observation query")
	}
	result, err := instances.snapshot(query[0], query[1])
	if err != nil {
		return apiError(http.StatusServiceUnavailable, err.Error())
	}
	data, err := json.Marshal(result)
	if err != nil || len(data) > maxResponseBytes {
		return apiError(http.StatusServiceUnavailable, "upstream observer response capacity exceeded")
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, err = w.Write(data)
	return err
}

// parseQuery requires exactly one canonical host ID and revision, rejecting extra or ambiguous parameters.
func parseQuery(r *http.Request) ([2]string, error) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return [2]string{}, err
	}
	host, revision := query["host_id"], query["revision"]
	if len(query) != 2 || len(host) != 1 || len(revision) != 1 || !hostPattern.MatchString(host[0]) || !revisionPattern.MatchString(revision[0]) {
		return [2]string{}, errors.New("invalid query")
	}
	return [2]string{host[0], revision[0]}, nil
}

var (
	_ caddy.Provisioner           = (*Handler)(nil)
	_ caddy.CleanerUpper          = (*Handler)(nil)
	_ caddyhttp.MiddlewareHandler = (*Handler)(nil)
	_ caddy.AdminRouter           = admin{}
)
