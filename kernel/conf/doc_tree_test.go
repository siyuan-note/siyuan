package conf

import "testing"

func TestDocTreeBatchSizeNormalization(t *testing.T) {
	for _, test := range []struct{ input, want int }{{-1, 512}, {0, 512}, {1, 1}, {512, 512}, {10240, 10240}, {10241, 10240}} {
		value := NormalizeFileTree(&FileTree{DocTreeBatchSize: new(test.input), MaxListCount: 32})
		if *value.DocTreeBatchSize != test.want || value.MaxListCount != 32 {
			t.Fatalf("batch %d: %+v", test.input, value)
		}
	}
	if *NormalizeFileTree(&FileTree{MaxListCount: 32}).DocTreeBatchSize != 512 {
		t.Fatal("normalization incorrectly repeats legacy migration")
	}
}
