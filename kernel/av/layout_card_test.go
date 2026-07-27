package av

import "testing"

func TestCardLayoutIsValid(t *testing.T) {
	tests := []struct {
		layout CardLayout
		valid  bool
	}{
		{layout: CardLayoutList, valid: true},
		{layout: CardLayoutCompact, valid: true},
		{layout: CardLayout(-1), valid: false},
		{layout: CardLayout(2), valid: false},
	}
	for _, test := range tests {
		if got := test.layout.IsValid(); got != test.valid {
			t.Fatalf("unexpected card layout validity [layout=%d, got=%t, want=%t]",
				test.layout, got, test.valid)
		}
	}
}
