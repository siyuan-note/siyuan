package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
)

func TestDocumentAddressingRawPathJunctions(t *testing.T) {
	documentAddressingRawPathAliases(t, func(link, target string) {
		testutil.Junction(t, link, target)
	})
}
