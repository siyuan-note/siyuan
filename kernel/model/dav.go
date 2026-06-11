// SiYuan - Refactor your thinking
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
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"time"

	"github.com/88250/gulu"
	"github.com/emersion/go-webdav/caldav"
	"github.com/emersion/go-webdav/carddav"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// PathJoinWithSlash joins the elements to a path with slash ('/') character
func PathJoinWithSlash(elems ...string) string {
	return filepath.ToSlash(filepath.Join(elems...))
}

// PathCleanWithSlash cleans the path
func PathCleanWithSlash(p string) string {
	return filepath.ToSlash(filepath.Clean(p))
}

// DavPath2DirectoryPath converts CalDAV/CardDAV path to absolute path of the file system
func DavPath2DirectoryPath(davPath string) string {
	return PathJoinWithSlash(util.DataDir, "storage", davPath)
}

func SaveMetaData[T []*caldav.Calendar | []*carddav.AddressBook](metaData T, metaDataFilePath string) error {
	data, err := gulu.JSON.MarshalIndentJSON(metaData, "", "  ")
	if err != nil {
		logging.LogErrorf("marshal address books meta data failed: %s", err)
		return err
	}

	dirPath := path.Dir(metaDataFilePath)
	if err := os.MkdirAll(dirPath, 0755); err != nil {
		logging.LogErrorf("create directory [%s] failed: %s", dirPath, err)
		return err
	}

	if err := os.WriteFile(metaDataFilePath, data, 0755); err != nil {
		logging.LogErrorf("write file [%s] failed: %s", metaDataFilePath, err)
		return err
	}

	return nil
}

// FileETag generates an ETag for a file
func FileETag(fileInfo fs.FileInfo) string {
	return fmt.Sprintf(
		"%s-%x",
		fileInfo.ModTime().Format(time.RFC3339),
		fileInfo.Size(),
	)
}
