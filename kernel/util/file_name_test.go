package util

import "testing"

func TestFilterFileNamePortableUnicode(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{"\u03a2\u01f0\ufffd\ufffd-report.pdf", "\u01f0__-report.pdf"},
		{"\ufffe\U0001ffff.pdf", ".pdf"},
		{"\ue000\U000f0000.pdf", "\ue000\U000f0000.pdf"},
		{"\u5fae\u524d\u7aef.pdf", "\u5fae\u524d\u7aef.pdf"},
		{"bad\xff.pdf", "bad_.pdf"},
		{"a/b:c.pdf", "a_b_c.pdf"},
	} {
		if got := FilterFileName(tc.input); got != tc.want {
			t.Errorf("FilterFileName(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}
