//go:build windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package plugin

import "os"

func openStorageFileForRead(parent *os.Root, name string) (*os.File, error) {
	return parent.OpenFile(name, os.O_RDONLY, 0)
}
