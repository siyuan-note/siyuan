// SiYuan - Build Your Eternal Digital Garden
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

//go:build android || ios
// +build android ios

package filesys

import (
	"errors"
	"os"
	"sync"

	"github.com/88250/gulu"
)

var ErrUnableLockFile = errors.New("unable to lock file")

func ReleaseFileLocks(boxLocalPath string) {}

func ReleaseAllFileLocks() {}

func NoLockFileRead(filePath string) (data []byte, err error) {
	return os.ReadFile(filePath)
}

func LockFileRead(filePath string) (data []byte, err error) {
	return os.ReadFile(filePath)
}

func NoLockFileWrite(filePath string, data []byte) (err error) {
	return gulu.File.WriteFileSafer(filePath, data, 0644)
}

func LockFileWrite(filePath string, data []byte) (err error) {
	return gulu.File.WriteFileSafer(filePath, data, 0644)
}

func LockFile(filePath string) (err error) {
	return
}

func UnlockFile(filePath string) (err error) {
	return
}

var fileLocks = sync.Map{}

func IsLocked(filePath string) bool {
	return false
}

func LockFileReadWrite() {
}

func UnlockFileReadWriteLock() {
}
