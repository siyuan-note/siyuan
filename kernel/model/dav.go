// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/emersion/go-webdav"
	"github.com/emersion/go-webdav/caldav"
	"github.com/emersion/go-webdav/carddav"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var writeDAVFile = gulu.File.WriteFileSafer

// Reload only caches that have been used, after synchronization has updated disk.
// Holding the same locks as DAV operations prevents publishing an old loaded
// cache after this refresh. Unused services remain lazy and do not create files.
func reloadSyncedDAV(result *dejavu.MergeResult, calendarStore *Calendars, contactStore *Contacts) {
	var reloadCalendar, reloadContacts bool
	for _, files := range [][]*entity.File{result.Upserts, result.Removes} {
		for _, file := range files {
			reloadCalendar = reloadCalendar || strings.HasPrefix(file.Path, "/storage/caldav/")
			reloadContacts = reloadContacts || strings.HasPrefix(file.Path, "/storage/carddav/")
		}
	}
	if reloadCalendar {
		calendarStore.lock.Lock()
		if calendarStore.loaded {
			calendarStore.loaded = false
			if err := calendarStore.load(); err != nil {
				logging.LogErrorf("reload synchronized calendars failed: %s", err)
			}
		}
		calendarStore.lock.Unlock()
	}
	if reloadContacts {
		contactStore.lock.Lock()
		if contactStore.loaded {
			contactStore.loaded = false
			if err := contactStore.load(); err != nil {
				logging.LogErrorf("reload synchronized contacts failed: %s", err)
			}
		}
		contactStore.lock.Unlock()
	}
}

// Check preconditions while holding the collection lock, before any mutation.
func checkDAVConditions(etag string, ifMatch, ifNoneMatch webdav.ConditionalMatch) error {
	if ifMatch.IsSet() {
		matched, err := ifMatch.MatchETag(etag)
		if err != nil {
			return webdav.NewHTTPError(http.StatusBadRequest, err)
		}
		if !matched {
			return webdav.NewHTTPError(http.StatusPreconditionFailed, errors.New("If-Match condition failed"))
		}
	}
	if ifNoneMatch.IsSet() {
		matched, err := ifNoneMatch.MatchETag(etag)
		if err != nil {
			return webdav.NewHTTPError(http.StatusBadRequest, err)
		}
		if matched {
			return webdav.NewHTTPError(http.StatusPreconditionFailed, errors.New("If-None-Match condition failed"))
		}
	}
	return nil
}

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

// FileETag identifies the persisted representation, including equal-size changes
// whose timestamps may be identical after synchronization.
func FileETag(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}
