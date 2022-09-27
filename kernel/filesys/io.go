package filesys

import (
	"io"
	"os"
	"sync"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
)

var writingFileLock = sync.Mutex{}

func LockWriteFile() {
	writingFileLock.Lock()
}

func UnlockWriteFile() {
	writingFileLock.Unlock()
}

func WriteFileSaferByReader(writePath string, reader io.Reader) (err error) {
	writingFileLock.Lock()
	defer writingFileLock.Unlock()

	if err = gulu.File.WriteFileSaferByReader(writePath, reader, 0644); nil != err {
		logging.LogErrorf("write file [%s] failed: %s", writePath, err)
		return
	}
	return
}

func WriteFileSafer(writePath string, data []byte) (err error) {
	writingFileLock.Lock()
	defer writingFileLock.Unlock()

	if err = gulu.File.WriteFileSafer(writePath, data, 0644); nil != err {
		logging.LogErrorf("write file [%s] failed: %s", writePath, err)
		return
	}
	return
}

func Copy(source, dest string) (err error) {
	writingFileLock.Lock()
	defer writingFileLock.Unlock()

	filelock.ReleaseFileLocks(source)
	if err = gulu.File.Copy(source, dest); nil != err {
		logging.LogErrorf("copy [%s] to [%s] failed: %s", source, dest, err)
		return
	}
	return
}

func RemoveAll(p string) (err error) {
	writingFileLock.Lock()
	defer writingFileLock.Unlock()

	filelock.ReleaseFileLocks(p)
	if err = os.RemoveAll(p); nil != err {
		logging.LogErrorf("remove all [%s] failed: %s", p, err)
		return
	}
	return
}
