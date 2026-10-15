package av

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func normalizedRichCacheFixture(t testing.TB) (string, []byte) {
	t.Helper()
	const id = "20261010120000-cacheav"
	oldData := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { cache.RemoveAVData(id); util.DataDir = oldData })
	view := &AttributeView{ID: id, Spec: RichTextSpec, Name: "Original", KeyValues: []*KeyValues{{
		Key: &Key{ID: "text", Type: KeyTypeText},
	}}}
	for i := 0; i < 100; i++ {
		view.KeyValues[0].Values = append(view.KeyValues[0].Values, &Value{Type: KeyTypeText, Text: &ValueText{
			Content: "incorrect projection",
			Rich:    &ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: "**bold**\n"},
		}})
	}
	data, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	file := GetAttributeViewDataPath(id)
	if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, data, 0644); err != nil {
		t.Fatal(err)
	}
	return file, data
}

func TestNormalizedAttributeViewCachePreservesIsolationAndValidation(t *testing.T) {
	file, source := normalizedRichCacheFixture(t)
	const id = "20261010120000-cacheav"
	first, err := parseAttributeViewByPathInBoxWithOptions(file, "", false)
	if err != nil || first.KeyValues[0].Values[0].Text.Content != "bold" {
		t.Fatalf("first load failed: %+v, %v", first, err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		_, version, ok := cache.GetAVDataWithVersionInBox(id, "")
		if _, normalized := cache.GetAVNormalizedDataInBox(id, "", version); ok && normalized {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("normalized cache was not populated")
		}
		time.Sleep(time.Millisecond)
	}
	first.Name = "Mutated"
	first.KeyValues[0].Values[0].Text.Content = "mutated"
	first.KeyValues[0].Values[0].Text.Rich.Content = "mutated"
	second, err := parseAttributeViewByPathInBoxWithOptions(file, "", false)
	if err != nil || second.Name != "Original" || second.KeyValues[0].Values[0].Text.Content != "bold" {
		t.Fatalf("render mutations escaped into the cache: %+v, %v", second, err)
	}
	if data, ok := cache.GetAVDataInBox(id, ""); !ok || !bytes.Equal(data, source) {
		t.Fatal("normalization overwrote source cache bytes")
	}
	if data, err := os.ReadFile(file); err != nil || !bytes.Equal(data, source) {
		t.Fatal("read normalization wrote source data")
	}
	second.KeyValues[0].Values[0].Text.Rich.Spec = 999
	invalid, err := json.Marshal(second)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, invalid, 0644); err != nil {
		t.Fatal(err)
	}
	cache.RemoveAVData(id)
	if _, err := parseAttributeViewByPathInBoxWithOptions(file, "", false); err == nil {
		t.Fatal("invalidated data bypassed rich text validation")
	}
}

func BenchmarkAttributeViewNormalizationCache(b *testing.B) {
	file, data := normalizedRichCacheFixture(b)
	if _, err := parseAttributeViewByPathInBoxWithOptions(file, "", false); err != nil {
		b.Fatal(err)
	}
	b.Run("uncached", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			if _, err := ParseAttributeViewData("20261010120000-cacheav", data); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("cached", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			if _, err := parseAttributeViewByPathInBoxWithOptions(file, "", false); err != nil {
				b.Fatal(err)
			}
		}
	})
}
