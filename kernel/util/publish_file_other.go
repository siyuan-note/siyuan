//go:build !windows

package util

import "os"

// checkPublishReaderFile 非 Windows 平台无短文件名别名，使用打开前的路径检查。
func checkPublishReaderFile(_ *os.File) error {
	return nil
}
