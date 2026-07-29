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

package bazaar

import (
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRecordPackageOperationTime(t *testing.T) {
	oldDataDir := util.DataDir
	bazaarInfoCacheLock.Lock()
	oldCache := bazaarInfoCache
	oldModTime := bazaarInfoModTime
	bazaarInfoCache = nil
	bazaarInfoModTime = time.Time{}
	bazaarInfoCacheLock.Unlock()
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
		bazaarInfoCacheLock.Lock()
		bazaarInfoCache = oldCache
		bazaarInfoModTime = oldModTime
		bazaarInfoCacheLock.Unlock()
	})

	installTime := time.UnixMilli(1000)
	updateTime := time.UnixMilli(2000)
	recordPackageOperationTime("plugins", "test-package", installTime, time.Time{}, false)
	recordPackageOperationTime("plugins", "test-package", updateTime, time.Time{}, true)

	info := bazaarInfoCache.Packages["plugins"]["test-package"]
	if info.InstallTime != installTime.UnixMilli() {
		t.Fatalf("install time changed after update: %d", info.InstallTime)
	}
	if info.UpdateTime != updateTime.UnixMilli() {
		t.Fatalf("unexpected update time: %d", info.UpdateTime)
	}

	gotInstallTime, gotUpdateTime := ensurePackageInstallTime("plugins", "test-package", time.UnixMilli(3000))
	if gotInstallTime != installTime.UnixMilli() || gotUpdateTime != updateTime.UnixMilli() {
		t.Fatalf("initialization overwrote recorded times: install=%d, update=%d", gotInstallTime, gotUpdateTime)
	}

	reinstallTime := time.UnixMilli(4000)
	recordPackageOperationTime("plugins", "test-package", reinstallTime, time.Time{}, false)
	info = bazaarInfoCache.Packages["plugins"]["test-package"]
	if info.InstallTime != reinstallTime.UnixMilli() {
		t.Fatalf("unexpected reinstall time: %d", info.InstallTime)
	}
	if info.UpdateTime != 0 {
		t.Fatalf("update time was not cleared after reinstall: %d", info.UpdateTime)
	}
}
