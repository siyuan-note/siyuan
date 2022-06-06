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

package model

import (
	"bytes"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/dustin/go-humanize"
	"github.com/siyuan-note/encryption"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Backup struct {
	Size    int64  `json:"size"`
	HSize   string `json:"hSize"`
	Updated string `json:"updated"`
	SaveDir string `json:"saveDir"` // 本地备份数据存放目录路径
}

type Sync struct {
	Size      int64  `json:"size"`
	HSize     string `json:"hSize"`
	Updated   string `json:"updated"`
	CloudName string `json:"cloudName"` // 云端同步数据存放目录名
	SaveDir   string `json:"saveDir"`   // 本地同步数据存放目录路径
}

func RemoveCloudBackup() (err error) {
	err = removeCloudDirPath("backup")
	return
}

func getCloudAvailableBackupSize() (size int64, err error) {
	var sync map[string]interface{}
	var assetSize int64
	sync, _, assetSize, err = getCloudSpaceOSS()
	if nil != err {
		return
	}

	var syncSize int64
	if nil != sync {
		syncSize = int64(sync["size"].(float64))
	}
	size = int64(Conf.User.UserSiYuanRepoSize) - syncSize - assetSize
	return
}

func GetCloudSpace() (s *Sync, b *Backup, hSize, hAssetSize, hTotalSize string, err error) {
	var sync, backup map[string]interface{}
	var assetSize int64
	sync, backup, assetSize, err = getCloudSpaceOSS()
	if nil != err {
		return nil, nil, "", "", "", errors.New(Conf.Language(30) + " " + err.Error())
	}

	var totalSize, syncSize, backupSize int64
	var syncUpdated, backupUpdated string
	if nil != sync {
		syncSize = int64(sync["size"].(float64))
		syncUpdated = sync["updated"].(string)
	}
	s = &Sync{
		Size:    syncSize,
		HSize:   humanize.Bytes(uint64(syncSize)),
		Updated: syncUpdated,
	}

	if nil != backup {
		backupSize = int64(backup["size"].(float64))
		backupUpdated = backup["updated"].(string)
	}
	b = &Backup{
		Size:    backupSize,
		HSize:   humanize.Bytes(uint64(backupSize)),
		Updated: backupUpdated,
	}
	totalSize = syncSize + backupSize + assetSize
	hAssetSize = humanize.Bytes(uint64(assetSize))
	hSize = humanize.Bytes(uint64(totalSize))
	hTotalSize = byteCountSI(int64(Conf.User.UserSiYuanRepoSize))
	return
}

func byteCountSI(b int64) string {
	const unit = 1000
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "kMGTPE"[exp])
}

func GetLocalBackup() (ret *Backup, err error) {
	backupDir := Conf.Backup.GetSaveDir()
	if err = os.MkdirAll(backupDir, 0755); nil != err {
		return
	}

	backup, err := os.Stat(backupDir)
	ret = &Backup{
		Updated: backup.ModTime().Format("2006-01-02 15:04:05"),
		SaveDir: Conf.Backup.GetSaveDir(),
	}
	return
}

func RecoverLocalBackup() (err error) {
	if "" == Conf.E2EEPasswd {
		return errors.New(Conf.Language(11))
	}

	data := util.AESDecrypt(Conf.E2EEPasswd)
	data, _ = hex.DecodeString(string(data))
	passwd := string(data)

	CloseWatchAssets()
	defer WatchAssets()

	// 使用备份恢复时自动暂停同步，避免刚刚恢复后的数据又被同步覆盖 https://github.com/siyuan-note/siyuan/issues/4773
	syncEnabled := Conf.Sync.Enabled
	Conf.Sync.Enabled = false
	Conf.Save()

	filesys.ReleaseAllFileLocks()

	util.PushEndlessProgress(Conf.Language(63))
	util.LogInfof("starting recovery...")
	start := time.Now()

	decryptedDataDir, err := decryptDataDir(passwd)
	if nil != err {
		return
	}

	newDataDir := filepath.Join(util.WorkspaceDir, "data.new")
	os.RemoveAll(newDataDir)
	if err = os.MkdirAll(newDataDir, 0755); nil != err {
		util.ClearPushProgress(100)
		return
	}

	if err = stableCopy(decryptedDataDir, newDataDir); nil != err {
		util.ClearPushProgress(100)
		return
	}

	oldDataDir := filepath.Join(util.WorkspaceDir, "data.old")
	if err = os.RemoveAll(oldDataDir); nil != err {
		util.ClearPushProgress(100)
		return
	}

	// 备份恢复时生成历史 https://github.com/siyuan-note/siyuan/issues/4752
	if gulu.File.IsExist(util.DataDir) {
		var historyDir string
		historyDir, err = util.GetHistoryDir("backup")
		if nil != err {
			util.LogErrorf("get history dir failed: %s", err)
			util.ClearPushProgress(100)
			return
		}

		var dirs []os.DirEntry
		dirs, err = os.ReadDir(util.DataDir)
		if nil != err {
			util.LogErrorf("read dir [%s] failed: %s", util.DataDir, err)
			util.ClearPushProgress(100)
			return
		}
		for _, dir := range dirs {
			from := filepath.Join(util.DataDir, dir.Name())
			to := filepath.Join(historyDir, dir.Name())
			if err = os.Rename(from, to); nil != err {
				util.LogErrorf("rename [%s] to [%s] failed: %s", from, to, err)
				util.ClearPushProgress(100)
				return
			}
		}
	}

	if gulu.File.IsExist(util.DataDir) {
		if err = os.RemoveAll(util.DataDir); nil != err {
			util.LogErrorf("remove [%s] failed: %s", util.DataDir, err)
			util.ClearPushProgress(100)
			return
		}
	}

	if err = os.Rename(newDataDir, util.DataDir); nil != err {
		util.ClearPushProgress(100)
		util.LogErrorf("rename data dir from [%s] to [%s] failed: %s", newDataDir, util.DataDir, err)
		return
	}

	elapsed := time.Now().Sub(start).Seconds()
	size, _ := util.SizeOfDirectory(util.DataDir, false)
	sizeStr := humanize.Bytes(uint64(size))
	util.LogInfof("recovered backup [size=%s] in [%.2fs]", sizeStr, elapsed)

	util.PushEndlessProgress(Conf.Language(62))
	time.Sleep(2 * time.Second)
	RefreshFileTree()
	if syncEnabled {
		func() {
			time.Sleep(5 * time.Second)
			util.PushMsg(Conf.Language(134), 0)
		}()
	}
	return
}

func CreateLocalBackup() (err error) {
	if "" == Conf.E2EEPasswd {
		return errors.New(Conf.Language(11))
	}

	defer util.ClearPushProgress(100)
	util.PushEndlessProgress(Conf.Language(22))

	WaitForWritingFiles()

	filesys.ReleaseAllFileLocks()

	util.LogInfof("creating backup...")
	start := time.Now()
	data := util.AESDecrypt(Conf.E2EEPasswd)
	data, _ = hex.DecodeString(string(data))
	passwd := string(data)
	encryptedDataDir, err := encryptDataDir(passwd)
	if nil != err {
		util.LogErrorf("encrypt data dir failed: %s", err)
		err = errors.New(fmt.Sprintf(Conf.Language(23), formatErrorMsg(err)))
		return
	}

	newBackupDir := Conf.Backup.GetSaveDir() + ".new"
	os.RemoveAll(newBackupDir)
	if err = os.MkdirAll(newBackupDir, 0755); nil != err {
		err = errors.New(fmt.Sprintf(Conf.Language(23), formatErrorMsg(err)))
		return
	}

	if err = stableCopy(encryptedDataDir, newBackupDir); nil != err {
		util.LogErrorf("copy encrypted data dir from [%s] to [%s] failed: %s", encryptedDataDir, newBackupDir, err)
		err = errors.New(fmt.Sprintf(Conf.Language(23), formatErrorMsg(err)))
		return
	}

	_, err = genCloudIndex(newBackupDir, map[string]bool{}, true)
	if nil != err {
		return
	}

	conf := map[string]interface{}{"updated": time.Now().UnixMilli()}
	data, err = gulu.JSON.MarshalJSON(conf)
	if nil != err {
		util.LogErrorf("marshal backup conf.json failed: %s", err)
	} else {
		confPath := filepath.Join(newBackupDir, "conf.json")
		if err = os.WriteFile(confPath, data, 0644); nil != err {
			util.LogErrorf("write backup conf.json [%s] failed: %s", confPath, err)
		}
	}

	oldBackupDir := Conf.Backup.GetSaveDir() + ".old"
	os.RemoveAll(oldBackupDir)

	backupDir := Conf.Backup.GetSaveDir()
	if gulu.File.IsExist(backupDir) {
		if err = os.Rename(backupDir, oldBackupDir); nil != err {
			util.LogErrorf("rename backup dir from [%s] to [%s] failed: %s", backupDir, oldBackupDir, err)
			err = errors.New(fmt.Sprintf(Conf.Language(23), formatErrorMsg(err)))
			return
		}
	}
	if err = os.Rename(newBackupDir, backupDir); nil != err {
		util.LogErrorf("rename backup dir from [%s] to [%s] failed: %s", newBackupDir, backupDir, err)
		err = errors.New(fmt.Sprintf(Conf.Language(23), formatErrorMsg(err)))
		return
	}
	os.RemoveAll(oldBackupDir)
	elapsed := time.Now().Sub(start).Seconds()
	size, _ := util.SizeOfDirectory(backupDir, false)
	sizeStr := humanize.Bytes(uint64(size))
	util.LogInfof("created backup [size=%s] in [%.2fs]", sizeStr, elapsed)

	util.PushEndlessProgress(Conf.Language(21))
	time.Sleep(2 * time.Second)
	return
}

func DownloadBackup() (err error) {
	// 使用路径映射文件进行解密验证 https://github.com/siyuan-note/siyuan/issues/3789
	var tmpFetchedFiles int
	var tmpTransferSize uint64
	err = ossDownload0(util.TempDir+"/backup", "backup", "/"+pathJSON, &tmpFetchedFiles, &tmpTransferSize, false)
	if nil != err {
		return
	}
	data, err := os.ReadFile(filepath.Join(util.TempDir, "/backup/"+pathJSON))
	if nil != err {
		return
	}
	passwdData, _ := hex.DecodeString(string(util.AESDecrypt(Conf.E2EEPasswd)))
	passwd := string(passwdData)
	data, err = encryption.AESGCMDecryptBinBytes(data, passwd)
	if nil != err {
		err = errors.New(Conf.Language(28))
		return
	}

	localDirPath := Conf.Backup.GetSaveDir()
	util.PushEndlessProgress(Conf.Language(68))
	start := time.Now()
	fetchedFilesCount, transferSize, _, err := ossDownload(localDirPath, "backup", false)
	if nil == err {
		elapsed := time.Now().Sub(start).Seconds()
		util.LogInfof("downloaded backup [fetchedFiles=%d, transferSize=%s] in [%.2fs]", fetchedFilesCount, humanize.Bytes(transferSize), elapsed)
		util.PushEndlessProgress(Conf.Language(69))
	}
	return
}

func UploadBackup() (err error) {
	defer util.ClearPushProgress(100)

	if err = checkUploadBackup(); nil != err {
		return
	}

	localDirPath := Conf.Backup.GetSaveDir()
	util.PushEndlessProgress(Conf.Language(61))
	util.LogInfof("uploading backup...")
	start := time.Now()
	wroteFiles, transferSize, err := ossUpload(true, localDirPath, "backup", "not exist", false)
	if nil == err {
		elapsed := time.Now().Sub(start).Seconds()
		util.LogInfof("uploaded backup [wroteFiles=%d, transferSize=%s] in [%.2fs]", wroteFiles, humanize.Bytes(transferSize), elapsed)
		util.PushEndlessProgress(Conf.Language(41))
		time.Sleep(2 * time.Second)
		return
	}
	err = errors.New(formatErrorMsg(err))
	return
}

var pathJSON = fmt.Sprintf("%x", md5.Sum([]byte("paths.json"))) // 6952277a5a37c17aa6a7c6d86cd507b1

func encryptDataDir(passwd string) (encryptedDataDir string, err error) {
	encryptedDataDir = filepath.Join(util.WorkspaceDir, "incremental", "backup-encrypt")
	if err = os.RemoveAll(encryptedDataDir); nil != err {
		return
	}
	if err = os.MkdirAll(encryptedDataDir, 0755); nil != err {
		return
	}

	ctime := map[string]time.Time{}
	metaJSON := map[string]string{}
	filepath.Walk(util.DataDir, func(path string, info fs.FileInfo, _ error) error {
		if util.DataDir == path {
			return nil
		}

		if isCloudSkipFile(path, info) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		plainP := strings.TrimPrefix(path, util.DataDir+string(os.PathSeparator))
		p := plainP
		parts := strings.Split(p, string(os.PathSeparator))
		buf := bytes.Buffer{}
		for i, part := range parts {
			buf.WriteString(fmt.Sprintf("%x", sha256.Sum256([]byte(part)))[:7])
			if i < len(parts)-1 {
				buf.WriteString(string(os.PathSeparator))
			}
		}
		p = buf.String()
		metaJSON[filepath.ToSlash(p)] = filepath.ToSlash(plainP)
		p = encryptedDataDir + string(os.PathSeparator) + p

		if info.IsDir() {
			if err = os.MkdirAll(p, 0755); nil != err {
				return io.EOF
			}
			if fi, err0 := os.Stat(path); nil == err0 {
				ctime[p] = fi.ModTime()
			}
		} else {
			if err = os.MkdirAll(filepath.Dir(p), 0755); nil != err {
				return io.EOF
			}

			f, err0 := os.Create(p)
			if nil != err0 {
				util.LogErrorf("create file [%s] failed: %s", p, err0)
				err = err0
				return io.EOF
			}
			data, err0 := os.ReadFile(path)
			if nil != err0 {
				util.LogErrorf("read file [%s] failed: %s", path, err0)
				err = err0
				return io.EOF
			}
			data, err0 = encryption.AESGCMEncryptBinBytes(data, passwd)
			if nil != err0 {
				util.LogErrorf("encrypt file [%s] failed: %s", path, err0)
				err = errors.New("encrypt file failed")
				return io.EOF
			}
			if _, err0 = f.Write(data); nil != err0 {
				util.LogErrorf("write file [%s] failed: %s", p, err0)
				err = err0
				return io.EOF
			}
			if err0 = f.Close(); nil != err0 {
				util.LogErrorf("close file [%s] failed: %s", p, err0)
				err = err0
				return io.EOF
			}

			fi, err0 := os.Stat(path)
			if nil != err0 {
				util.LogErrorf("stat file [%s] failed: %s", path, err0)
				err = err0
				return io.EOF
			}
			ctime[p] = fi.ModTime()
		}
		return nil
	})
	if nil != err {
		return
	}

	for p, t := range ctime {
		if err = os.Chtimes(p, t, t); nil != err {
			return
		}
	}

	// 检查文件是否全部已经编入索引
	err = filepath.Walk(encryptedDataDir, func(path string, info fs.FileInfo, _ error) error {
		if encryptedDataDir == path {
			return nil
		}

		path = strings.TrimPrefix(path, encryptedDataDir+string(os.PathSeparator))
		path = filepath.ToSlash(path)
		if _, ok := metaJSON[path]; !ok {
			util.LogErrorf("not found backup path in meta [%s]", path)
			return errors.New(Conf.Language(27))
		}
		return nil
	})

	if nil != err {
		return
	}

	data, err := gulu.JSON.MarshalJSON(metaJSON)
	if nil != err {
		return
	}
	data, err = encryption.AESGCMEncryptBinBytes(data, passwd)
	if nil != err {
		return "", errors.New("encrypt file failed")
	}
	meta := filepath.Join(encryptedDataDir, pathJSON)
	if err = gulu.File.WriteFileSafer(meta, data, 0644); nil != err {
		return
	}
	return
}

func decryptDataDir(passwd string) (decryptedDataDir string, err error) {
	decryptedDataDir = filepath.Join(util.WorkspaceDir, "incremental", "backup-decrypt")
	if err = os.RemoveAll(decryptedDataDir); nil != err {
		return
	}

	backupDir := Conf.Backup.GetSaveDir()
	meta := filepath.Join(util.TempDir, "backup", pathJSON)
	data, err := os.ReadFile(meta)
	if nil != err {
		return
	}
	data, err = encryption.AESGCMDecryptBinBytes(data, passwd)
	if nil != err {
		return "", errors.New(Conf.Language(40))
	}
	metaJSON := map[string]string{}
	if err = gulu.JSON.UnmarshalJSON(data, &metaJSON); nil != err {
		return
	}

	index := map[string]*CloudIndex{}
	data, err = os.ReadFile(filepath.Join(backupDir, "index.json"))
	if nil != err {
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &index); nil != err {
		return
	}

	err = filepath.Walk(backupDir, func(path string, info fs.FileInfo, _ error) error {
		if backupDir == path || pathJSON == info.Name() || strings.HasSuffix(info.Name(), ".json") {
			return nil
		}

		encryptedP := strings.TrimPrefix(path, backupDir+string(os.PathSeparator))
		encryptedP = filepath.ToSlash(encryptedP)
		decryptedP := metaJSON[encryptedP]
		if "" == decryptedP {
			if gulu.File.IsDir(path) {
				return filepath.SkipDir
			}
			return nil
		}
		plainP := filepath.Join(decryptedDataDir, decryptedP)
		plainP = filepath.FromSlash(plainP)

		if info.IsDir() {
			if err = os.MkdirAll(plainP, 0755); nil != err {
				return io.EOF
			}
		} else {
			if err = os.MkdirAll(filepath.Dir(plainP), 0755); nil != err {
				return io.EOF
			}

			var err0 error
			data, err0 = os.ReadFile(path)
			if nil != err0 {
				util.LogErrorf("read file [%s] failed: %s", path, err0)
				err = err0
				return io.EOF
			}
			data, err0 = encryption.AESGCMDecryptBinBytes(data, passwd)
			if nil != err0 {
				util.LogErrorf("decrypt file [%s] failed: %s", path, err0)
				err = errors.New(Conf.Language(40))
				return io.EOF
			}
			if err0 = os.WriteFile(plainP, data, 0644); nil != err0 {
				util.LogErrorf("write file [%s] failed: %s", plainP, err0)
				err = err0
				return io.EOF
			}

			var modTime int64
			idx := index["/"+encryptedP]
			if nil == idx {
				util.LogErrorf("index file [%s] not found", encryptedP)
				modTime = info.ModTime().Unix()
			} else {
				modTime = idx.Updated
			}
			if err0 = os.Chtimes(plainP, time.Unix(modTime, 0), time.Unix(modTime, 0)); nil != err0 {
				util.LogErrorf("change file [%s] time failed: %s", plainP, err0)
			}
		}
		return nil
	})
	return
}
