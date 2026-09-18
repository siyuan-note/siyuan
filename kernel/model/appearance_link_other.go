//go:build !windows

package model

import (
	"os"
	"path/filepath"
)

func resolveAppearanceDirectoryLink(link string) (string, error) {
	resolved, err := filepath.EvalSymlinks(link)
	if err != nil {
		return "", err
	}
	return filepath.Abs(resolved)
}

func createAppearanceDirectoryLink(target, link string) error {
	return os.Symlink(target, link)
}
