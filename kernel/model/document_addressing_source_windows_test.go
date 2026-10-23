package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
)

func TestDocumentAddressingRawSourceJunctions(t *testing.T) {
	documentAddressingRawSourceAliases(t, func(link, target string) {
		testutil.Junction(t, link, target)
	})
}
