package model

import (
	"testing"

	"github.com/sabhiram/go-gitignore"
)

func TestResetEmbeddingIgnoreMatcher(t *testing.T) {
	embeddingIgnoreLock.Lock()
	oldLoaded := embeddingIgnoreLoaded
	oldMatcher := embeddingIgnoreMatcher
	embeddingIgnoreLoaded = true
	embeddingIgnoreMatcher = ignore.CompileIgnoreLines("/notebook/**/*")
	embeddingIgnoreLock.Unlock()
	defer func() {
		embeddingIgnoreLock.Lock()
		embeddingIgnoreLoaded = oldLoaded
		embeddingIgnoreMatcher = oldMatcher
		embeddingIgnoreLock.Unlock()
	}()

	resetEmbeddingIgnoreMatcher()
	if embeddingIgnoreLoaded {
		t.Fatal("embedding ignore matcher should be marked as not loaded")
	}
	if embeddingIgnoreMatcher != nil {
		t.Fatal("embedding ignore matcher should be cleared")
	}
}
