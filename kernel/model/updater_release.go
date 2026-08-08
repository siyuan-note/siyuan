// SiYuan - From thought to insight, with agents
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
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"path"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
	"golang.org/x/sync/singleflight"
)

const (
	githubReleasesURL            = "https://api.github.com/repos/siyuan-note/siyuan/releases?per_page=100"
	githubReleaseURLPrefix       = "https://github.com/siyuan-note/siyuan/releases/tag/v"
	githubAPIReleaseCacheSeconds = int64(6 * 60 * 60)
	maxChecksumManifestSize      = int64(1024 * 1024)
)

type updateRelease struct {
	Version    string
	ReleaseURL string
	Packages   map[string]*updatePackage
}

type updatePackage struct {
	URLs     []string
	Checksum string
}

type githubRelease struct {
	TagName string                `json:"tag_name"`
	HTMLURL string                `json:"html_url"`
	Draft   bool                  `json:"draft"`
	Assets  []*githubReleaseAsset `json:"assets"`
}

type githubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Digest             string `json:"digest"`
	State              string `json:"state"`
}

var (
	cachedGitHubReleases    []*githubRelease
	githubReleasesCacheTime int64
	githubReleasesLock      sync.RWMutex
	githubReleasesFlight    singleflight.Group
	githubManifestCache     sync.Map
)

func getUpdateRelease(force bool) (*updateRelease, error) {
	channel := Conf.System.UpdateChannel
	if conf.UpdateChannelStable == channel {
		return getStableUpdateRelease(force)
	}
	if !isValidUpdateChannel(channel) {
		return nil, errors.New("update channel is invalid")
	}
	return getGitHubUpdateRelease(channel, force)
}

func getStableUpdateRelease(force bool) (*updateRelease, error) {
	result, err := util.GetRhyResult(context.TODO(), force)
	if err != nil {
		return nil, err
	}
	version, ok := result["ver"].(string)
	normalizedVersion := normalizeReleaseVersion(version)
	if !ok || !semver.IsValid(normalizedVersion) || "" != semver.Prerelease(normalizedVersion) {
		return nil, errors.New("stable release version is invalid")
	}
	version = strings.TrimPrefix(normalizedVersion, "v")

	release := &updateRelease{
		Version:    version,
		ReleaseURL: getStableReleaseURL(result, version),
		Packages:   map[string]*updatePackage{},
	}
	pkgName := currentInstallPackageName(release.Version)
	if "" == pkgName {
		return release, nil
	}
	checksum := getStablePackageChecksum(result, pkgName)
	if "" == checksum {
		return release, nil
	}
	release.Packages[pkgName] = &updatePackage{
		URLs:     getStablePackageURLs(release.Version, pkgName),
		Checksum: checksum,
	}
	return release, nil
}

func getStableReleaseURL(result map[string]any, version string) string {
	releaseURL, _ := result["release"].(string)
	if localized, ok := result["release_"+Conf.Lang].(string); ok && "" != localized {
		releaseURL = localized
	} else if localized, ok = result["release_"+util.LangToLegacy(Conf.Lang)].(string); ok && "" != localized {
		// 兼容云端 JSON 数据中历史下划线 key（release_zh_CN 等）。
		releaseURL = localized
	}
	if "" == releaseURL {
		releaseURL = githubReleaseURLPrefix + strings.TrimPrefix(version, "v")
	}
	return releaseURL
}

func getStablePackageChecksum(result map[string]any, pkgName string) string {
	checksums, ok := result["checksums"].(map[string]any)
	if !ok {
		return ""
	}
	checksum, ok := checksums[pkgName].(string)
	if !ok {
		return ""
	}
	return normalizeSHA256(checksum)
}

func getStablePackageURLs(version, pkgName string) []string {
	b3logURL := "https://release.b3log.org/siyuan/" + pkgName
	liuyunURL := "https://release.liuyun.io/siyuan/" + pkgName
	githubURL := "https://github.com/siyuan-note/siyuan/releases/download/v" + strings.TrimPrefix(version, "v") + "/" + pkgName
	ghproxyURL := "https://ghfast.top/" + githubURL
	if util.IsChinaCloud() {
		return []string{b3logURL, liuyunURL, ghproxyURL, githubURL}
	}
	return []string{b3logURL, liuyunURL, githubURL, ghproxyURL}
}

func getGitHubUpdateRelease(channel string, force bool) (*updateRelease, error) {
	releases, err := getGitHubReleases(context.TODO(), force)
	if err != nil {
		return nil, err
	}
	selected := selectGitHubRelease(releases, channel)
	if nil == selected {
		return nil, errors.New("no release is available for the update channel")
	}

	version := strings.TrimPrefix(normalizeReleaseVersion(selected.TagName), "v")
	release := &updateRelease{
		Version:    version,
		ReleaseURL: selected.HTMLURL,
		Packages:   map[string]*updatePackage{},
	}
	if "" == release.ReleaseURL {
		release.ReleaseURL = githubReleaseURLPrefix + version
	}

	pkgName := currentInstallPackageName(version)
	if "" == pkgName {
		return release, nil
	}
	asset := findGitHubReleaseAsset(selected, pkgName)
	if nil == asset || "uploaded" != asset.State || "" == asset.BrowserDownloadURL {
		return release, nil
	}

	checksum := normalizeSHA256(asset.Digest)
	if "" == checksum {
		checksum, err = getGitHubManifestChecksum(context.TODO(), selected, pkgName)
		if err != nil {
			logging.LogWarnf("get release package [%s] checksum failed: %s", pkgName, err)
			return release, nil
		}
	}
	release.Packages[pkgName] = &updatePackage{
		URLs:     []string{asset.BrowserDownloadURL},
		Checksum: checksum,
	}
	return release, nil
}

func getGitHubReleases(ctx context.Context, force bool) ([]*githubRelease, error) {
	if !force {
		githubReleasesLock.RLock()
		if githubAPIReleaseCacheSeconds >= time.Now().Unix()-githubReleasesCacheTime && 0 < len(cachedGitHubReleases) {
			ret := cachedGitHubReleases
			githubReleasesLock.RUnlock()
			return ret, nil
		}
		githubReleasesLock.RUnlock()
	}

	value, err, _ := githubReleasesFlight.Do("github-releases", func() (any, error) {
		if !force {
			githubReleasesLock.RLock()
			if githubAPIReleaseCacheSeconds >= time.Now().Unix()-githubReleasesCacheTime && 0 < len(cachedGitHubReleases) {
				ret := cachedGitHubReleases
				githubReleasesLock.RUnlock()
				return ret, nil
			}
			githubReleasesLock.RUnlock()
		}
		return fetchGitHubReleases(ctx)
	})
	if err != nil {
		return nil, err
	}
	return value.([]*githubRelease), nil
}

func fetchGitHubReleases(ctx context.Context) ([]*githubRelease, error) {
	releases := []*githubRelease{}
	request := httpclient.NewCloudRequest30s().
		SetContext(ctx).
		SetHeader("Accept", "application/vnd.github+json").
		SetHeader("X-GitHub-Api-Version", "2022-11-28").
		SetSuccessResult(&releases)
	response, err := request.Get(githubReleasesURL)
	if err != nil {
		logging.LogErrorf("get GitHub releases failed: %s", err)
		return nil, err
	}
	if 200 != response.StatusCode {
		err = fmt.Errorf("get GitHub releases failed: %d", response.StatusCode)
		logging.LogError(err.Error())
		return nil, err
	}
	if 0 == len(releases) {
		return nil, errors.New("GitHub releases are empty")
	}

	githubReleasesLock.Lock()
	cachedGitHubReleases = releases
	githubReleasesCacheTime = time.Now().Unix()
	githubReleasesLock.Unlock()
	return releases, nil
}

func selectGitHubRelease(releases []*githubRelease, channel string) *githubRelease {
	var selected *githubRelease
	for _, release := range releases {
		if nil == release || release.Draft || !isReleaseAllowed(channel, release.TagName) {
			continue
		}
		if nil == selected || 0 < semver.Compare(normalizeReleaseVersion(release.TagName), normalizeReleaseVersion(selected.TagName)) {
			selected = release
		}
	}
	return selected
}

func isReleaseAllowed(channel, version string) bool {
	normalized := normalizeReleaseVersion(version)
	if !semver.IsValid(normalized) {
		return false
	}
	prerelease := strings.TrimPrefix(semver.Prerelease(normalized), "-")
	label := prereleaseChannelLabel(prerelease)
	switch channel {
	case conf.UpdateChannelStable:
		return "" == prerelease
	case conf.UpdateChannelBeta:
		return "" == prerelease || "beta" == label || "rc" == label
	case conf.UpdateChannelAlpha:
		return "" == prerelease || "alpha" == label || "beta" == label || "rc" == label
	default:
		return false
	}
}

func prereleaseChannelLabel(prerelease string) string {
	identifier := strings.SplitN(prerelease, ".", 2)[0]
	for _, channel := range []string{"alpha", "beta", "rc"} {
		if channel == identifier {
			return channel
		}
		suffix := strings.TrimPrefix(identifier, channel)
		if suffix == identifier || "" == suffix {
			continue
		}
		allDigits := true
		for _, r := range suffix {
			if '0' > r || '9' < r {
				allDigits = false
				break
			}
		}
		if allDigits {
			return channel
		}
	}
	return ""
}

func normalizeReleaseVersion(version string) string {
	return "v" + strings.TrimPrefix(strings.TrimSpace(version), "v")
}

func currentInstallPackageName(version string) string {
	suffix := currentInstallPackageSuffix()
	if "" == suffix {
		return ""
	}
	return "siyuan-" + strings.TrimPrefix(version, "v") + "-" + suffix
}

func currentInstallPackageSuffix() string {
	if gulu.OS.IsWindows() {
		switch runtime.GOARCH {
		case "amd64":
			return "win.exe"
		case "arm64":
			return "win-arm64.exe"
		default:
			return ""
		}
	}
	if gulu.OS.IsDarwin() {
		switch runtime.GOARCH {
		case "amd64":
			return "mac.dmg"
		case "arm64":
			return "mac-arm64.dmg"
		default:
			return ""
		}
	}
	return ""
}

func findGitHubReleaseAsset(release *githubRelease, name string) *githubReleaseAsset {
	for _, asset := range release.Assets {
		if nil != asset && name == asset.Name {
			return asset
		}
	}
	return nil
}

func getGitHubManifestChecksum(ctx context.Context, release *githubRelease, pkgName string) (string, error) {
	manifestAsset := findGitHubReleaseAsset(release, "SHA256SUMS.txt")
	if nil == manifestAsset || "uploaded" != manifestAsset.State || "" == manifestAsset.BrowserDownloadURL {
		return "", errors.New("checksum manifest is unavailable")
	}
	manifestDigest := normalizeSHA256(manifestAsset.Digest)
	manifestCacheKey := ""
	if "" != manifestDigest {
		manifestCacheKey = manifestAsset.BrowserDownloadURL + "#" + manifestDigest
	}
	if "" != manifestCacheKey {
		cached, ok := githubManifestCache.Load(manifestCacheKey)
		if ok {
			if checksum := parseChecksumManifest(cached.(string), pkgName); "" != checksum {
				return checksum, nil
			}
			return "", errors.New("package checksum is unavailable")
		}
	}

	response, err := httpclient.NewCloudRequest30s().SetContext(ctx).Get(manifestAsset.BrowserDownloadURL)
	if err != nil {
		return "", err
	}
	if nil == response || nil == response.Response {
		return "", errors.New("checksum manifest response is empty")
	}
	defer response.Body.Close()
	if 200 != response.StatusCode {
		return "", fmt.Errorf("get checksum manifest failed: %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxChecksumManifestSize+1))
	if err != nil {
		return "", err
	}
	if maxChecksumManifestSize < int64(len(data)) {
		return "", errors.New("checksum manifest is too large")
	}
	if "" != manifestDigest {
		actualDigest := fmt.Sprintf("%x", sha256.Sum256(data))
		if manifestDigest != actualDigest {
			return "", errors.New("checksum manifest digest mismatch")
		}
	}
	manifest := string(data)
	if "" != manifestCacheKey {
		githubManifestCache.Store(manifestCacheKey, manifest)
	}
	checksum := parseChecksumManifest(manifest, pkgName)
	if "" == checksum {
		return "", errors.New("package checksum is unavailable")
	}
	return checksum, nil
}

func parseChecksumManifest(manifest, pkgName string) string {
	for _, line := range strings.Split(manifest, "\n") {
		fields := strings.Fields(line)
		if 2 > len(fields) {
			continue
		}
		name := strings.TrimPrefix(fields[1], "*")
		name = path.Base(strings.ReplaceAll(name, "\\", "/"))
		if pkgName == name {
			return normalizeSHA256(fields[0])
		}
	}
	return ""
}

func normalizeSHA256(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimPrefix(value, "sha256:")
	if 64 != len(value) {
		return ""
	}
	if _, err := hex.DecodeString(value); err != nil {
		return ""
	}
	return value
}
