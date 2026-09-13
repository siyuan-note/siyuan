package treenode

import "testing"

func TestIsContainerType(t *testing.T) {
	for _, typ := range []string{"d", "b", "l", "i", "s", "callout", "tab"} {
		if !IsContainerType(typ) {
			t.Errorf("expected %q to accept child blocks", typ)
		}
	}
	for _, typ := range []string{"tabs", "h", "p", "c", "", "unknown"} {
		if IsContainerType(typ) {
			t.Errorf("expected %q to reject direct child writes", typ)
		}
	}
}
