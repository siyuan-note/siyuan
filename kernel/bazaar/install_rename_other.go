//go:build !windows

package bazaar

func isPackageRenameBusy(error) bool {
	return false
}
