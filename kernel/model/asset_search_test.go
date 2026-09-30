package model

import "testing"

func TestImageAssetMetadataHits(t *testing.T) {
	markdowns := []string{
		`![first hint](assets/first.png "Training review") ![second hint](assets/second.png "Annual summary")`,
		`![alternate hint](assets/first.png "Another caption")`,
		`![remote hint](https://example.com/remote.png "Training review")`,
		`![space &amp; percent](assets/a%20b.png "100% progress")`,
	}
	for _, tc := range []struct {
		keyword, path string
	}{
		{"TRAINING", "assets/first.png"},
		{"second hint", "assets/second.png"},
		{"alternate", "assets/first.png"},
		{"100%", "assets/a b.png"},
		{"space & percent", "assets/a b.png"},
	} {
		hits := imageAssetMetadataHits(markdowns, []string{tc.keyword})
		for path, count := range hits {
			if (count > 0) != (path == tc.path) {
				t.Fatalf("metadata search %q: %s=%d, expected %s", tc.keyword, path, count, tc.path)
			}
		}
		if hits[tc.path] == 0 {
			t.Fatalf("metadata search %q did not match %s", tc.keyword, tc.path)
		}
	}
}
