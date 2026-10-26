//go:build !windows

package testutil

import "testing"

// ShortPath 仅在 Windows 上提供短文件名夹具。
func ShortPath(t testing.TB, path string) string {
	t.Helper()
	t.Skip("short filenames require Windows")
	return ""
}
