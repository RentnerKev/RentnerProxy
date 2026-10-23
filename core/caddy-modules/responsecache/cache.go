package responsecache

import (
	"container/list"
	"net/http"
	"sync"
	"time"
)

// These are process-wide payload/metadata accounting limits, not a Go RSS limit.
// In-flight reservations and retired entries still being sent to clients count.
const (
	maxBytes    = 64 << 20
	maxEntries  = 1024
	maxBody     = 1 << 20
	maxHeaders  = 16 << 10
	maxKey      = 8 << 10
	maxFills    = 16
	maxReaders  = 64
	overhead    = 1024
	reservation = maxBody + 2*maxHeaders + maxKey + overhead
)

type entry struct {
	namespace       uint64
	key             string
	header          http.Header
	body            []byte
	expires, stored time.Time
	age             int64
	cost            int
	refs            int
	visible         bool
	element         *list.Element
}

type store struct {
	sync.Mutex
	entries                      map[string]*entry
	lru                          list.List
	bytes, count, fills, readers int
}

var shared = newStore()

func newStore() *store { return &store{entries: make(map[string]*entry)} }
func (s *store) retire(e *entry) {
	if !e.visible {
		return
	}
	delete(s.entries, e.key)
	s.lru.Remove(e.element)
	e.visible = false
	if e.refs == 0 {
		s.bytes -= e.cost
		s.count--
	}
}
func (s *store) get(key string, now time.Time) *entry {
	s.Lock()
	defer s.Unlock()
	e := s.entries[key]
	if e == nil {
		return nil
	}
	if !now.Before(e.expires) {
		s.retire(e)
		return nil
	}
	if s.readers >= maxReaders || s.bytes+maxHeaders+overhead > maxBytes {
		return nil
	}
	s.readers++
	s.bytes += maxHeaders + overhead
	e.refs++
	s.lru.MoveToFront(e.element)
	return e
}
func (s *store) release(e *entry) {
	s.Lock()
	defer s.Unlock()
	s.readers--
	s.bytes -= maxHeaders + overhead
	e.refs--
	if !e.visible && e.refs == 0 {
		s.bytes -= e.cost
		s.count--
	}
}
func (s *store) reserve(now time.Time) bool {
	s.Lock()
	defer s.Unlock()
	if s.fills >= maxFills {
		return false
	}
	// Scan at most the fixed entry cap; expired entries disappear opportunistically.
	for element := s.lru.Back(); element != nil; {
		previous := element.Prev()
		e := element.Value.(*entry)
		if !now.Before(e.expires) {
			s.retire(e)
		}
		element = previous
	}
	for s.bytes+reservation > maxBytes || s.count >= maxEntries {
		element := s.lru.Back()
		if element == nil {
			return false
		}
		s.retire(element.Value.(*entry))
	}
	s.bytes += reservation
	s.count++
	s.fills++
	return true
}
func (s *store) finish(e *entry) {
	s.Lock()
	defer s.Unlock()
	s.bytes -= reservation
	s.count--
	s.fills--
	if e == nil {
		return
	}
	if old := s.entries[e.key]; old != nil {
		s.retire(old)
	}
	// Readers can keep old entries pinned, so recheck the actual insertion cost.
	if s.bytes+e.cost > maxBytes || s.count >= maxEntries {
		return
	}
	e.visible = true
	e.element = s.lru.PushFront(e)
	s.entries[e.key] = e
	s.bytes += e.cost
	s.count++
}
func (s *store) invalidate(namespace uint64) {
	s.Lock()
	defer s.Unlock()
	for _, e := range s.entries {
		if e.namespace == namespace {
			s.retire(e)
		}
	}
}
