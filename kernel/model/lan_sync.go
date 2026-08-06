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
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"net"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/lansync"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	lanSyncLifecycleMu  sync.Mutex
	lanSyncRetryTimer   *time.Timer
	lanSyncShuttingDown bool

	lanSyncManagerMu sync.RWMutex
	lanSyncManager   *lansync.Manager

	lanSyncHintMu       sync.Mutex
	lastLANSyncHintID   string
	lastLANSyncSchedule time.Time
)

func refreshLANSyncManager() {
	lanSyncLifecycleMu.Lock()
	defer lanSyncLifecycleMu.Unlock()
	stopLANSyncManagerLocked()
	if lanSyncShuttingDown {
		return
	}
	if nil == Conf || nil == Conf.Sync || nil == Conf.Sync.LAN || !Conf.Sync.LAN.Enabled || !Conf.Sync.Enabled ||
		1 > len(Conf.Repo.Key) || util.ContainerDocker == util.Container {
		return
	}
	ips := collectLANSyncIPs()
	nativeDiscovery := util.ContainerIOS == util.Container || util.ContainerHarmony == util.Container
	if 1 > len(ips) && !nativeDiscovery {
		logging.LogWarnf("LAN sync service not started because no private network address is available")
		scheduleLANSyncRetryLocked()
		return
	}
	manager, err := lansync.Start(lansync.Config{
		RepoPath:          util.RepoDir,
		IdentityPath:      filepath.Join(util.ConfDir, "lan-sync-identity.json"),
		RepoKey:           append([]byte(nil), Conf.Repo.Key...),
		Scope:             lanSyncScope(),
		DeviceName:        Conf.System.Name,
		DeviceOS:          Conf.System.OS,
		AppVersion:        util.Ver,
		IPs:               ips,
		IPsProvider:       collectLANSyncIPs,
		MaxConcurrentReqs: Conf.Sync.LAN.MaxConcurrentReqs,
		NativeDiscovery:   nativeDiscovery,
		OnCommitHint:      handleLANSyncCommitHint,
	})
	if nil != err {
		logging.LogWarnf("start LAN sync service failed: %s", err)
		scheduleLANSyncRetryLocked()
		return
	}
	lanSyncManagerMu.Lock()
	lanSyncManager = manager
	lanSyncManagerMu.Unlock()
}

func lanSyncScope() string {
	base := fmt.Sprintf("v1:%d:%s", Conf.Sync.Provider, Conf.Sync.CloudName)
	switch Conf.Sync.Provider {
	case conf.ProviderSiYuan:
		userID := ""
		if user := Conf.GetUser(); nil != user {
			userID = user.UserId
		}
		return fmt.Sprintf("%s:%d:%s", base, util.CurrentCloudRegion, userID)
	case conf.ProviderS3:
		if nil != Conf.Sync.S3 {
			return fmt.Sprintf("%s:%s:%s:%s", base, Conf.Sync.S3.Endpoint, Conf.Sync.S3.Bucket, Conf.Sync.S3.Region)
		}
	case conf.ProviderWebDAV:
		if nil != Conf.Sync.WebDAV {
			return fmt.Sprintf("%s:%s", base, Conf.Sync.WebDAV.Endpoint)
		}
	case conf.ProviderLocal:
		if nil != Conf.Sync.Local {
			return fmt.Sprintf("%s:%s", base, Conf.Sync.Local.Endpoint)
		}
	}
	return base
}

func GetLANSyncDiscoveryInfo() *lansync.DiscoveryInfo {
	lanSyncManagerMu.RLock()
	manager := lanSyncManager
	lanSyncManagerMu.RUnlock()
	if nil == manager {
		return nil
	}
	return manager.DiscoveryInfo()
}

func LANSyncActive() bool {
	lanSyncManagerMu.RLock()
	defer lanSyncManagerMu.RUnlock()
	return nil != lanSyncManager
}

func AddLANSyncPeer(instance, address string, port int, txt map[string]string) bool {
	lanSyncManagerMu.RLock()
	manager := lanSyncManager
	lanSyncManagerMu.RUnlock()
	return nil != manager && manager.AddDiscoveredPeer(instance, address, port, txt)
}

func RemoveLANSyncPeer(instance string) bool {
	lanSyncManagerMu.RLock()
	manager := lanSyncManager
	lanSyncManagerMu.RUnlock()
	return nil != manager && manager.RemoveDiscoveredPeer(instance)
}

func stopLANSyncManager() {
	lanSyncLifecycleMu.Lock()
	defer lanSyncLifecycleMu.Unlock()
	lanSyncShuttingDown = true
	stopLANSyncManagerLocked()
}

func suspendLANSyncManager() {
	lanSyncLifecycleMu.Lock()
	defer lanSyncLifecycleMu.Unlock()
	stopLANSyncManagerLocked()
}

func stopLANSyncManagerLocked() {
	if nil != lanSyncRetryTimer {
		lanSyncRetryTimer.Stop()
		lanSyncRetryTimer = nil
	}
	lanSyncManagerMu.Lock()
	manager := lanSyncManager
	lanSyncManager = nil
	lanSyncManagerMu.Unlock()
	if nil != manager {
		manager.Stop()
	}
}

func scheduleLANSyncRetryLocked() {
	lanSyncRetryTimer = time.AfterFunc(30*time.Second, refreshLANSyncManager)
}

func collectLANSyncIPs() (ret []net.IP) {
	added := map[string]bool{}
	for _, address := range append(util.GetPrivateIPv4s(), util.GetLocalIPs()...) {
		ipAddress := address
		if index := strings.LastIndex(ipAddress, "%"); 0 < index {
			ipAddress = ipAddress[:index]
		}
		ip := net.ParseIP(ipAddress)
		if nil == ip || added[ip.String()] || !(ip.IsPrivate() || ip.IsLinkLocalUnicast()) {
			continue
		}
		added[ip.String()] = true
		ret = append(ret, ip)
	}
	return
}

// RefreshLANSyncNetwork 在原生容器报告网络地址变化后重启局域网同步服务。
func RefreshLANSyncNetwork() {
	if nil == Conf {
		return
	}
	refreshLANSyncManager()
}

func newSyncRepository() (ret *dejavu.Repo, err error) {
	ret, err = newRepository()
	if nil != err {
		return
	}
	lanSyncManagerMu.RLock()
	manager := lanSyncManager
	lanSyncManagerMu.RUnlock()
	if nil != manager {
		ret.SetChunkSource(manager)
	}
	return
}

func notifyLANSyncCommit(repo *dejavu.Repo) {
	lanSyncManagerMu.RLock()
	manager := lanSyncManager
	lanSyncManagerMu.RUnlock()
	if nil == manager {
		return
	}
	latest, err := repo.Latest()
	if nil != err || "" == latest.ID {
		return
	}
	manager.NotifyCloudCommit(latest.ID)
}

func handleLANSyncCommitHint(latestID string) {
	if nil == Conf.Sync || nil == Conf.Sync.LAN || !Conf.Sync.LAN.Enabled || !Conf.Sync.Enabled || 1 != Conf.Sync.Mode {
		return
	}
	lanSyncHintMu.Lock()
	if latestID == lastLANSyncHintID && time.Since(lastLANSyncSchedule) < time.Minute {
		lanSyncHintMu.Unlock()
		return
	}
	lastLANSyncHintID = latestID
	lastLANSyncSchedule = time.Now()
	lanSyncHintMu.Unlock()
	hash := sha256.Sum256([]byte(Conf.System.ID + ":" + latestID))
	delay := time.Second + time.Duration(binary.BigEndian.Uint32(hash[:4])%5000)*time.Millisecond
	time.AfterFunc(delay, func() {
		if nil != Conf.Sync && nil != Conf.Sync.LAN && Conf.Sync.LAN.Enabled && Conf.Sync.Enabled && 1 == Conf.Sync.Mode {
			syncDataFromLAN(latestID)
		}
	})
}

func syncDataFromLAN(latestID string) {
	defer logging.Recover()
	if !checkSync(false, false, false) {
		return
	}
	scope := lanSyncScope()
	_, _ = syncRemoteRequests.do(scope, latestID, func() error {
		lockSync()
		defer unlockSync()
		if syncRemoteRequests.isCompleted(scope, latestID) {
			return nil
		}
		err := syncDataLocked(false, false)
		if nil == err {
			completeCurrentSyncRemoteRequest(scope)
		}
		return err
	})
}

func SetSyncLAN(enabled bool, maxConcurrentReqs int) {
	if nil == Conf.Sync {
		Conf.Sync = conf.NewSync()
	}
	if nil == Conf.Sync.LAN {
		Conf.Sync.LAN = &conf.LANSync{}
	}
	if 1 > maxConcurrentReqs {
		maxConcurrentReqs = Conf.Sync.LAN.MaxConcurrentReqs
		if 1 > maxConcurrentReqs {
			maxConcurrentReqs = 16
		}
	}
	if 128 < maxConcurrentReqs {
		maxConcurrentReqs = 128
	}
	Conf.Sync.LAN.Enabled = enabled
	Conf.Sync.LAN.MaxConcurrentReqs = maxConcurrentReqs
	if !enabled {
		Conf.Sync.Stat = removeLANSyncTrafficStat(Conf.Sync.Stat)
	}
	Conf.Save()
	refreshLANSyncManager()
}

func GetSyncLANStatus() map[string]interface{} {
	lanSyncManagerMu.RLock()
	manager := lanSyncManager
	lanSyncManagerMu.RUnlock()
	discoveredCount := 0
	connectedCount := 0
	if nil != manager {
		discoveredCount = manager.DiscoveredPeerCount()
		connectedCount = manager.ConnectedPeerCount()
	}
	enabled := false
	maxConcurrentReqs := 16
	if nil != Conf.Sync && nil != Conf.Sync.LAN {
		enabled = Conf.Sync.LAN.Enabled
		maxConcurrentReqs = Conf.Sync.LAN.MaxConcurrentReqs
	}
	return map[string]interface{}{
		"enabled":           enabled,
		"active":            nil != manager,
		"discoveredPeers":   discoveredCount,
		"connectedPeers":    connectedCount,
		"maxConcurrentReqs": maxConcurrentReqs,
	}
}
