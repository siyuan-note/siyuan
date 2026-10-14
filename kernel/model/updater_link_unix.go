//go:build !windows

package model

import "os"

func createInstallPackageDirectoryLink(target, link string) error {
	return os.Symlink(target, link)
}
