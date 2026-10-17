package model

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/gofrs/flock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func sharedInstallPackageDir() string {
	return filepath.Join(util.HomeDir, ".config", "siyuan", "install")
}

var errInstallPackageDownloadBusy = errors.New("another workspace is downloading an install package")

// tryInstallPackageDownloadLock 协调跨工作空间下载和清理，锁文件不随安装包清理而删除。
func tryInstallPackageDownloadLock(installDir string) (*flock.Flock, error) {
	if err := os.MkdirAll(installDir, 0700); err != nil {
		return nil, err
	}
	lock := flock.New(installDir + ".download.lock")
	locked, err := lock.TryLock()
	if err != nil || !locked {
		lock.Close()
		if err == nil {
			err = errInstallPackageDownloadBusy
		}
		return nil, err
	}
	return lock, nil
}

// lockInstallPackageFiles 只保护本地文件操作，就绪检查不等待网络下载。
func lockInstallPackageFiles(installDir string) (*flock.Flock, error) {
	if err := os.MkdirAll(installDir, 0700); err != nil {
		return nil, err
	}
	lock := flock.New(installDir + ".files.lock")
	if err := lock.Lock(); err != nil {
		lock.Close()
		return nil, err
	}
	return lock, nil
}

// reserveSharedInstallPackage 跨进程保留退出时交付的包，覆盖内核退出到宿主启动安装器的间隔。
// 保留一天后可由常规清理回收，避免安装失败或进程崩溃永久占用安装包。
func reserveSharedInstallPackage(path string) error {
	return gulu.File.WriteFileSafer(path+".preserve", []byte(time.Now().Format(time.RFC3339Nano)), 0600)
}

func sharedInstallPackageReserved(path string) bool {
	info, err := os.Lstat(path + ".preserve")
	if os.IsNotExist(err) {
		return false
	}
	return err != nil || !info.Mode().IsRegular() || time.Since(info.ModTime()) < 24*time.Hour
}

func initSharedInstallPackages() {
	if currentInstallPackageSuffix() == "" || util.ContainerStd != util.Container || util.ISMicrosoftStore {
		return
	}
	installDir := sharedInstallPackageDir()
	if err := os.MkdirAll(installDir, 0700); err != nil {
		logging.LogWarnf("create shared install directory failed: %s", err)
		return
	}
	// 保留工作空间的旧目录，链接使用独立名称，不覆盖原始文件或用户已有链接。
	link := filepath.Join(util.TempDir, "install-shared")
	if _, err := os.Lstat(link); os.IsNotExist(err) {
		if err = createInstallPackageDirectoryLink(installDir, link); err != nil {
			logging.LogWarnf("create shared install directory link failed: %s", err)
		}
	}
	if err := migrateLegacyInstallPackages(filepath.Join(util.TempDir, "install"), installDir, Conf.CookieKey); err != nil &&
		!errors.Is(err, errInstallPackageDownloadBusy) {
		logging.LogWarnf("migrate legacy install packages failed: %s", err)
	}
}

// migrateLegacyInstallPackages 只复制认证且完整的旧包，迁移失败或中断时原文件仍可使用。
func migrateLegacyInstallPackages(legacyDir, installDir, key string) error {
	entries, err := os.ReadDir(legacyDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	lock, err := tryInstallPackageDownloadLock(installDir)
	if err != nil {
		return err
	}
	defer lock.Close()
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		metadata, err := readInstallPackageMetadata(filepath.Join(legacyDir, entry.Name()), key)
		if err != nil || entry.Name() != metadata.FileName+".json" {
			continue
		}
		if err = copyLegacyInstallPackage(legacyDir, installDir, metadata, key); err != nil {
			return err
		}
	}
	return nil
}

// copyLegacyInstallPackage 在共享下载锁内复用旧包，线上校验信息也可用于无认证记录的旧下载。
func copyLegacyInstallPackage(legacyDir, installDir string, metadata *installPackageMetadata, key string) error {
	if source := verifiedInstallPackagePath(legacyDir, metadata); source != "" {
		if existing, err := reuseInstallPackage(installDir, metadata, key); err != nil || existing != "" {
			return err
		}
		input, err := os.Open(source)
		if err != nil {
			return err
		}
		defer input.Close()
		output, err := os.CreateTemp(installDir, metadata.FileName+".*.part")
		if err != nil {
			return err
		}
		defer os.Remove(output.Name())
		_, copyErr := io.Copy(output, input)
		closeErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		checksum, err := sha256Hash(output.Name())
		if err != nil {
			return err
		}
		if checksum != metadata.Checksum {
			return errors.New("legacy install package changed during migration")
		}
		return publishInstallPackage(output.Name(), installDir, metadata, key)
	}
	return nil
}
