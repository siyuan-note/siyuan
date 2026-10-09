package cache

import (
	"strings"
	"testing"

	"github.com/dgraph-io/ristretto"
)

func TestIALCacheChargesAttributePayload(t *testing.T) {
	for _, document := range []bool{false, true} {
		name := "block"
		if document {
			name = "document"
		}
		t.Run(name, func(t *testing.T) {
			controlled, err := ristretto.NewCache(&ristretto.Config{
				NumCounters: 100, MaxCost: 1024, BufferItems: 64,
			})
			if err != nil {
				t.Fatal(err)
			}
			var put func(string, string, map[string]string)
			var get func(string, string) map[string]string
			if document {
				original := docIALCache
				docIALCache = controlled
				put, get = PutDocIALInBox, GetDocIALInBox
				t.Cleanup(func() {
					ClearDocsIAL()
					controlled.Close()
					docIALCache = original
				})
			} else {
				original := blockIALCache
				blockIALCache = controlled
				put, get = PutBlockIALInBox, GetBlockIALInBox
				t.Cleanup(func() {
					ClearBlocksIAL()
					controlled.Close()
					blockIALCache = original
				})
			}
			attributes := map[string]string{"id": "small"}
			put("small", "box", attributes)
			controlled.Wait()
			attributes["id"] = "changed"
			if got := get("small", "box"); got["id"] != "small" {
				t.Fatal("small attributes should fit in the cache")
			}
			get("small", "box")["id"] = "changed"
			if got := get("small", "box"); got["id"] != "small" {
				t.Fatal("caller mutation changed the accounted cache snapshot")
			}
			put("large", "box", map[string]string{"custom-value": strings.Repeat("x", 2048)})
			controlled.Wait()
			if got := get("large", "box"); got != nil {
				t.Fatal("attributes exceeding the entire byte budget were admitted")
			}
			many := map[string]string{}
			for i := range 20 {
				many[strings.Repeat("x", i+1)] = "value"
			}
			put("many", "box", many)
			controlled.Wait()
			if got := get("many", "box"); got != nil {
				t.Fatal("map entry overhead was not charged to the byte budget")
			}
			if got := get("small", "other-box"); got != nil {
				t.Fatal("attributes leaked across notebook cache keys")
			}
			put("small", "box", map[string]string{"custom-value": strings.Repeat("x", 2048)})
			controlled.Wait()
			if got := get("small", "box"); got != nil {
				t.Fatal("an oversized update kept stale or over-budget attributes")
			}
		})
	}
}
