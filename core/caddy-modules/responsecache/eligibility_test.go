package responsecache

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestMalformedResponseMetadataNeverBecomesPublic(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	cases := []struct{ name, key, value string }{
		{"negative length", "Content-Length", "-1"}, {"oversize length", "Content-Length", "1048577"},
		{"bad media", "Content-Type", "text/css; bad"}, {"missing public", "Cache-Control", "max-age=20"},
		{"public parameter", "Cache-Control", "public=yes"}, {"missing max age", "Cache-Control", "public, max-age"},
		{"negative max age", "Cache-Control", "public, max-age=-1"}, {"bad max age", "Cache-Control", "public, max-age=bad"},
		{"duplicate max age", "Cache-Control", "public, max-age=10, max-age=20"},
		{"duplicate shared age", "Cache-Control", "public, s-maxage=10, s-maxage=20"},
		{"bad age", "Age", "bad"}, {"negative age", "Age", "-1"}, {"bad date", "Date", "bad"},
		{"bad expires", "Expires", "bad"}, {"expired", "Expires", now.Add(-time.Second).Format(http.TimeFormat)},
		{"oversize headers", "X-Long", strings.Repeat("x", maxHeaders)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := http.Header{"Content-Length": {"4"}, "Content-Type": {"text/css"}, "Cache-Control": {"public"}}
			h.Set(tc.key, tc.value)
			if _, _, _, ok := eligibleResponse(h, 60, now); ok {
				t.Fatal("accepted malformed or stale response")
			}
		})
	}
}

func TestPrefixAndAssetGrammar(t *testing.T) {
	for _, prefix := range []string{"", "/", "assets/", "/assets", "/assets//", "/assets/../", "/ass ets/", "/" + strings.Repeat("a", 256) + "/"} {
		if safePrefix(prefix) {
			t.Errorf("unsafe prefix accepted: %q", prefix)
		}
	}
	for _, prefix := range []string{"/assets/", "/A_1-b/sub/"} {
		if !safePrefix(prefix) {
			t.Errorf("safe prefix rejected: %q", prefix)
		}
	}
	for _, path := range []string{"assets/x.css", "/assets//x.css", "/assets/./x.css", "/assets/a b.css", "/" + strings.Repeat("a", 2048) + ".css"} {
		if safeAssetPath(path) {
			t.Errorf("unsafe asset accepted: %q", path)
		}
	}
}
