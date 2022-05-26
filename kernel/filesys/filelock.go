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

//go:build !android && !ios

package filesys

import (
	"errors"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/88250/flock"
	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var ErrUnableLockFile = errors.New("unable to lock file")

var (
	fileLocks         = sync.Map{}
	expiration        = 5 * time.Minute
	fileReadWriteLock = sync.Mutex{}
)

type LockItem struct {
	fl      *flock.Flock
	expired int64
}

func init() {
	go func() {
		// 锁定超时自动解锁
		for range time.Tick(10 * time.Second) {
			fileReadWriteLock.Lock()

			now := time.Now().UnixNano()
			var expiredKeys []string
			fileLocks.Range(func(k, v interface{}) bool {
				lockItem := v.(*LockItem)
				if now > lockItem.expired {
					expiredKeys = append(expiredKeys, k.(string))
				}
				return true
			})

			for _, k := range expiredKeys {
				if err := unlockFile0(k); nil != err {
					util.LogErrorf("unlock file [%s] failed: %s", k, err)
					continue
				}

				//util.LogInfof("released file lock [%s]", k)
			}

			fileReadWriteLock.Unlock()
		}
	}()
}

func ReleaseFileLocks(localAbsPath string) {
	fileReadWriteLock.Lock()
	defer fileReadWriteLock.Unlock()

	fileLocks.Range(func(k, v interface{}) bool {
		if strings.HasPrefix(k.(string), localAbsPath) {
			if err := unlockFile0(k.(string)); nil != err {
				util.LogErrorf("unlock file [%s] failed: %s", k, err)
			}
		}
		return true
	})
}

func ReleaseAllFileLocks() {
	fileReadWriteLock.Lock()
	defer fileReadWriteLock.Unlock()

	fileLocks.Range(func(k, v interface{}) bool {
		if err := unlockFile0(k.(string)); nil != err {
			util.LogErrorf("unlock file [%s] failed: %s", k, err)
		}
		return true
	})
}

func NoLockFileRead(filePath string) (data []byte, err error) {
	fileReadWriteLock.Lock()
	defer fileReadWriteLock.Unlock()

	v, ok := fileLocks.Load(filePath)
	if !ok {
		return os.ReadFile(filePath)
	}
	lockItem := v.(*LockItem)
	handle := lockItem.fl.Fh()
	if _, err = handle.Seek(0, io.SeekStart); nil != err {
		return
	}
	return io.ReadAll(handle)
}

func LockFileRead(filePath string) (data []byte, err error) {
	fileReadWriteLock.Lock()
	defer fileReadWriteLock.Unlock()

	if !gulu.File.IsExist(filePath) {
		err = os.ErrNotExist
		return
	}

	lock, lockErr := lockFile0(filePath)
	if nil != lockErr {
		err = lockErr
		return
	}

	handle := lock.Fh()
	if _, err = handle.Seek(0, io.SeekStart); nil != err {
		return
	}
	return io.ReadAll(handle)
}

func NoLockFileWrite(filePath string, data []byte) (err error) {
	fileReadWriteLock.Lock()
	defer fileReadWriteLock.Unlock()

	v, ok := fileLocks.Load(filePath)
	if !ok {
		return os.WriteFile(filePath, data, 0644)
	}

	lockItem := v.(*LockItem)
	handle := lockItem.fl.Fh()
	err = gulu.File.WriteFileSaferByHandle(handle, data)
	return
}

func LockFileWrite(filePath string, data []byte) (err error) {
	fileReadWriteLock.Lock()
	defer fileReadWriteLock.Unlock()

	lock, lockErr := lockFile0(filePath)
	if nil != lockErr {
		err = lockErr
		return
	}

	handle := lock.Fh()
	err = gulu.File.WriteFileSaferByHandle(handle, data)
	return
}

func IsLocked(filePath string) bool {
	v, _ := fileLocks.Load(filePath)
	if nil == v {
		return false
	}
	return true
}

func UnlockFile(filePath string) (err error) {
	fileReadWriteLock.Lock()
	defer fileReadWriteLock.Unlock()
	return unlockFile0(filePath)
}

func unlockFile0(filePath string) (err error) {
	v, _ := fileLocks.Load(filePath)
	if nil == v {
		return
	}
	lockItem := v.(*LockItem)
	err = lockItem.fl.Unlock()
	fileLocks.Delete(filePath)
	return
}

func LockFile(filePath string) (err error) {
	fileReadWriteLock.Lock()
	defer fileReadWriteLock.Unlock()
	_, err = lockFile0(filePath)
	return
}

func lockFile0(filePath string) (lock *flock.Flock, err error) {
	lockItemVal, _ := fileLocks.Load(filePath)
	var lockItem *LockItem
	if nil == lockItemVal {
		lock = flock.New(filePath)
		var locked bool
		var lockErr error
		for i := 0; i < 7; i++ {
			locked, lockErr = lock.TryLock()
			if nil != lockErr || !locked {
				time.Sleep(100 * time.Millisecond)
				continue
			}
			break
		}

		if nil != lockErr {
			util.LogErrorf("lock file [%s] failed: %s", filePath, lockErr)
			err = ErrUnableLockFile
			return
		}

		if !locked {
			util.LogErrorf("unable to lock file [%s]", filePath)
			err = ErrUnableLockFile
			return
		}
		lockItem = &LockItem{fl: lock}
	} else {
		lockItem = lockItemVal.(*LockItem)
		lock = lockItem.fl
	}
	lockItem.expired = time.Now().Add(expiration).UnixNano()
	fileLocks.Store(filePath, lockItem)
	return
}
