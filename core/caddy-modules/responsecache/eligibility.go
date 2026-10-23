package responsecache

import (
	"crypto/sha256"
	"encoding/hex"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

func reservedPath(value string) bool {
	segment := strings.ToLower(strings.SplitN(strings.TrimPrefix(value, "/"), "/", 2)[0])
	switch segment {
	case "api", "auth", "admin", "login", "logout", "oauth", "session":
		return true
	}
	return false
}
func safePrefix(prefix string) bool {
	if len(prefix) < 2 || len(prefix) > 256 || reservedPath(prefix) || !strings.HasPrefix(prefix, "/") || !strings.HasSuffix(prefix, "/") {
		return false
	}
	for _, part := range strings.Split(prefix[1:len(prefix)-1], "/") {
		if part == "" {
			return false
		}
		for _, c := range part {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
				return false
			}
		}
	}
	return true
}
func safeAssetPath(value string) bool {
	if len(value) > 2048 || reservedPath(value) || !strings.HasPrefix(value, "/") || strings.Contains(value, "//") {
		return false
	}
	for _, part := range strings.Split(value, "/") {
		if part == "." || part == ".." {
			return false
		}
		for _, c := range part {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("_.-", c)) {
				return false
			}
		}
	}
	switch path.Ext(value) {
	case ".css", ".js", ".mjs", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".svg", ".woff", ".woff2", ".ttf", ".otf":
		return true
	}
	return false
}
func (h *Handler) requestKey(r *http.Request) (string, bool) {
	return h.requestKeyAt(r, h.epoch.Load())
}
func (h *Handler) requestKeyAt(r *http.Request, epoch uint64) (string, bool) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead || r.URL.RawQuery != "" || r.URL.ForceQuery || r.URL.RawPath != "" || r.ContentLength != 0 || len(r.Trailer) != 0 || !safeAssetPath(r.URL.Path) || len(r.Host) > 259 {
		return "", false
	}
	matched := false
	for _, prefix := range h.PathPrefixes {
		if strings.HasPrefix(r.URL.Path, prefix) {
			matched = true
			break
		}
	}
	if !matched {
		return "", false
	}
	for name := range r.Header {
		lower := strings.ToLower(name)
		if lower == "cookie" || lower == "authorization" || lower == "proxy-authorization" || lower == "range" || strings.HasPrefix(lower, "if-") || lower == "upgrade" || lower == "trailer" || lower == "pragma" || lower == "cache-control" || strings.HasPrefix(lower, "remote-") || strings.HasPrefix(lower, "x-auth") || strings.HasPrefix(lower, "x-forwarded-user") || lower == "x-user" || lower == "x-email" || lower == "x-forwarded-email" {
			return "", false
		}
	}
	for _, value := range r.Header.Values("Connection") {
		for _, token := range strings.Split(value, ",") {
			token = strings.ToLower(strings.TrimSpace(token))
			if token != "keep-alive" && token != "close" {
				return "", false
			}
		}
	}
	parts := []string{strconv.FormatUint(h.namespace, 10), strconv.FormatUint(epoch, 10), h.Configuration, h.Scheme, r.Host, r.URL.Path}
	size := 0
	for _, name := range []string{"Accept-Encoding", "Accept", "Accept-Language", "Origin"} {
		values := r.Header.Values(name)
		if len(values) > 16 {
			return "", false
		}
		parts = append(parts, strconv.Itoa(len(values)))
		for _, value := range values {
			size += len(value) + 32
			if size > 4096 {
				return "", false
			}
			parts = append(parts, value)
		}
	}
	digest := sha256.New()
	for _, part := range parts {
		digest.Write([]byte(strconv.Itoa(len(part)) + ":" + part))
	}
	return hex.EncodeToString(digest.Sum(nil)), true
}
func headerSize(header http.Header) int {
	size := 0
	for key, values := range header {
		size += len(key) + 64
		for _, value := range values {
			size += len(value) + 32 + 32
		}
		if size > maxHeaders {
			return size
		}
	}
	return size
}
func eligibleResponse(header http.Header, ttl int, now time.Time) (int, time.Duration, int64, bool) {
	length, err := strconv.ParseInt(header.Get("Content-Length"), 10, 64)
	if err != nil || length < 0 || length > maxBody || headerSize(header) > maxHeaders {
		return 0, 0, 0, false
	}
	for _, name := range []string{"Set-Cookie", "Pragma", "Content-Range", "Trailer", "Transfer-Encoding", "Upgrade", "Connection", "WWW-Authenticate", "Proxy-Authenticate"} {
		if _, exists := header[name]; exists || header.Get(name) != "" {
			return 0, 0, 0, false
		}
	}
	media, _, err := mime.ParseMediaType(header.Get("Content-Type"))
	if err != nil {
		return 0, 0, 0, false
	}
	switch media {
	case "text/css", "text/javascript", "application/javascript", "application/x-javascript", "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml", "font/woff", "font/woff2", "font/ttf", "font/otf", "application/font-woff":
	default:
		return 0, 0, 0, false
	}
	for _, value := range header.Values("Vary") {
		for _, name := range strings.Split(value, ",") {
			if !strings.EqualFold(strings.TrimSpace(name), "Accept-Encoding") {
				return 0, 0, 0, false
			}
		}
	}
	public := false
	freshness := int64(ttl)
	maxAge, sharedAge := int64(-1), int64(-1)
	for _, value := range header.Values("Cache-Control") {
		for _, directive := range strings.Split(value, ",") {
			pair := strings.SplitN(strings.ToLower(strings.TrimSpace(directive)), "=", 2)
			switch pair[0] {
			case "private", "no-store", "no-cache", "must-understand":
				return 0, 0, 0, false
			case "public":
				if len(pair) != 1 {
					return 0, 0, 0, false
				}
				public = true
			case "max-age", "s-maxage":
				if len(pair) != 2 {
					return 0, 0, 0, false
				}
				age, err := strconv.ParseInt(pair[1], 10, 32)
				if err != nil || age < 0 {
					return 0, 0, 0, false
				}
				if pair[0] == "s-maxage" {
					if sharedAge != -1 {
						return 0, 0, 0, false
					}
					sharedAge = age
				} else {
					if maxAge != -1 {
						return 0, 0, 0, false
					}
					maxAge = age
				}
			}
		}
	}
	if !public {
		return 0, 0, 0, false
	}
	if sharedAge >= 0 {
		freshness = min(freshness, sharedAge)
	} else if maxAge >= 0 {
		freshness = min(freshness, maxAge)
	}
	age := int64(0)
	if value := header.Get("Age"); value != "" {
		age, err = strconv.ParseInt(value, 10, 32)
		if err != nil || age < 0 {
			return 0, 0, 0, false
		}
	}
	if value := header.Get("Date"); value != "" {
		date, err := http.ParseTime(value)
		if err != nil {
			return 0, 0, 0, false
		}
		age = max(age, int64(now.Sub(date)/time.Second))
	}
	duration := time.Duration(freshness-age) * time.Second
	if sharedAge < 0 && maxAge < 0 && header.Get("Expires") != "" {
		expires, err := http.ParseTime(header.Get("Expires"))
		if err != nil {
			return 0, 0, 0, false
		}
		duration = min(duration, expires.Sub(now))
	}
	if duration <= 0 {
		return 0, 0, 0, false
	}
	return int(length), duration, age, true
}
