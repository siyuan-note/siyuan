//go:build !linux && !darwin && !windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org

package api

import "os"

func captureReadDirMetadataReference(_ *os.File, _ string) (*readDirMetadataReference, error) {
	return nil, errReadDirMetadataReferenceUnsupported
}
