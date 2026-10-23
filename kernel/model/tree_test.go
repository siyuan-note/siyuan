package model

import (
	"errors"
	"testing"
)

func TestLoadTreeByBlockTreeMissing(t *testing.T) {
	tree, err := loadTreeByBlockTree(nil)
	if tree != nil || !errors.Is(err, ErrTreeNotFound) {
		t.Fatalf("missing block tree returned %v, %v", tree, err)
	}
}
