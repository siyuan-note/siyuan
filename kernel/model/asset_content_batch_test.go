package model

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type batchTestAssetParser struct {
	content string
	parsed  int
}

func (parser *batchTestAssetParser) Parse(string) *AssetParseResult {
	parser.parsed++
	return &AssetParseResult{Content: parser.content}
}

func TestAssetContentFullIndexWritesBoundedBatches(t *testing.T) {
	for _, test := range []struct{ count, bytes int }{{260, 1}, {9, 2 * 1024 * 1024}, {2, 8 * 1024 * 1024}, {0, 1}} {
		t.Run(fmt.Sprintf("%d-%d", test.count, test.bytes), func(t *testing.T) {
			oldData := util.DataDir
			util.DataDir = t.TempDir()
			t.Cleanup(func() { util.DataDir = oldData })
			dir := util.GetDataAssetsAbsPath()
			if err := os.MkdirAll(dir, 0755); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < test.count; i++ {
				if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("%04d.txt", i)), []byte("file"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			parser := &batchTestAssetParser{content: strings.Repeat("x", test.bytes)}
			searcher := NewAssetsSearcher()
			searcher.parsers = map[string]AssetParser{".txt": parser}
			total, batches, firstParsed := 0, 0, 0
			searcher.fullIndex(func(batch []*sql.AssetContent) {
				if batches == 0 {
					firstParsed = parser.parsed
				}
				batches++
				total += len(batch)
				if len(batch) == 0 || len(batch) > 128 || len(batch) > 1 && len(batch)*test.bytes > 4*1024*1024 {
					t.Fatalf("unbounded batch: %d items, %d bytes", len(batch), len(batch)*test.bytes)
				}
				for _, asset := range batch {
					if asset.Size != 4 || asset.Content != parser.content || !strings.HasPrefix(asset.Path, "assets/") {
						t.Fatalf("lost asset metadata: %+v", asset)
					}
				}
			})
			if total != test.count || test.count > 2 && firstParsed >= test.count || test.count == 0 && batches != 0 {
				t.Fatalf("total=%d, first parsed=%d, batches=%d", total, firstParsed, batches)
			}
		})
	}
}
