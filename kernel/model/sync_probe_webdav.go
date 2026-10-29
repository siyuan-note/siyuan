// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/studio-b12/gowebdav"
)

// TestSyncProviderWebDAV 仅使用草稿配置，验证集合、目录创建和探针读写，不读取或保存同步配置。
func TestSyncProviderWebDAV(draft *conf.WebDAV, cloudName string) (kind, msg string) {
	if err := validateSyncWebDAV(draft); err != nil {
		return SyncProbeConfig, err.Error()
	}
	if cloudName != "" && !cloud.IsValidCloudDirName(cloudName) {
		return SyncProbeConfig, Conf.Language(123)
	}
	candidate := *draft
	candidate.Endpoint = util.NormalizeEndpoint(strings.TrimSpace(candidate.Endpoint))
	candidate.Timeout = util.NormalizeTimeout(candidate.Timeout)
	client := gowebdav.NewClient(candidate.Endpoint, strings.TrimSpace(candidate.Username), strings.TrimSpace(candidate.Password))
	client.SetHeader("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(strings.TrimSpace(candidate.Username)+":"+strings.TrimSpace(candidate.Password))))
	client.SetHeader("User-Agent", util.UserAgent)
	client.SetTimeout(time.Duration(candidate.Timeout) * time.Second)
	client.SetTransport(httpclient.NewTransport(candidate.SkipTlsVerify))
	info, err := client.Stat("/")
	if err != nil {
		return webDAVProbeFailure(err)
	}
	file, ok := info.(*gowebdav.File)
	if !ok || file == nil || !file.IsDir() {
		return webDAVProbeFailure(cloud.ErrWebDAVInvalidResponse)
	}
	probeDir := ".siyuan-probe-" + util.RandString(16)
	removeRoot := cloudName == ""
	if cloudName == "" {
		cloudName = "siyuan-probe-" + util.RandString(16)
	}
	backend := cloud.NewWebDAV(&cloud.BaseCloud{Conf: &cloud.Conf{Dir: cloudName}}, client)
	key := probeDir + "/probe"
	// 上传也可能部分成功，清理必须在首次写入前注册，且只删除本次独占的随机目录。
	defer func() {
		var err error
		if removeRoot {
			err = client.Remove(cloudName)
		} else {
			err = backend.RemoveObject(probeDir)
		}
		if err != nil && !gowebdav.IsErrCode(err, 404) && !errors.Is(err, cloud.ErrCloudObjectNotFound) {
			logging.LogWarnf("WebDAV probe cleanup failed")
		}
	}()
	data := []byte("siyuan-probe-" + util.RandString(16))
	if _, err = backend.UploadBytes(key, data, true); err != nil {
		return webDAVProbeFailure(err)
	}
	read, err := backend.DownloadObject(key)
	if err != nil {
		return webDAVProbeFailure(err)
	}
	if !bytes.Equal(data, read) {
		return webDAVProbeFailure(cloud.ErrWebDAVInvalidResponse)
	}
	return SyncProbeOK, ""
}

func webDAVProbeFailure(err error) (kind, msg string) {
	kind = SyncProbeNetwork
	var status gowebdav.StatusError
	var syntax *xml.SyntaxError
	var record tls.RecordHeaderError
	switch {
	case errors.Is(err, cloud.ErrWebDAVInvalidResponse), errors.As(err, &syntax):
		return SyncProbeConfig, Conf.Language(430)
	case errors.As(err, &record), strings.Contains(err.Error(), "server gave HTTP response to HTTPS client"):
		return SyncProbeConfig, Conf.Language(425)
	case errors.As(err, &status):
		if status.Status == http.StatusOK {
			return SyncProbeConfig, Conf.Language(430)
		}
		if status.Status >= 400 && status.Status < 500 && status.Status != http.StatusTooManyRequests {
			kind = SyncProbeConfig
		}
	case errors.Is(err, cloud.ErrCloudObjectNotFound), errors.Is(err, os.ErrPermission), errors.Is(err, os.ErrExist):
		kind = SyncProbeConfig
	}
	msg = cloudLockErrorDetail(err, Conf.Language)
	if msg == "" {
		msg = Conf.Language(409)
	}
	return
}

// TestSyncProviderLocal 在候选端点中创建独占的临时目录并验证读写，始终清理，不修改配置。
func TestSyncProviderLocal(draft *conf.Local) (kind, msg string) {
	if err := validateSyncLocalPath(draft); err != nil {
		return SyncProbeConfig, err.Error()
	}
	endpoint := util.NormalizeLocalPath(draft.Endpoint)
	info, err := os.Stat(endpoint)
	if err != nil || !info.IsDir() {
		return SyncProbeConfig, fmt.Sprintf(Conf.Language(77), draft.Endpoint)
	}
	dir, err := os.MkdirTemp(endpoint, ".siyuan-probe-")
	if err != nil {
		return SyncProbeConfig, Conf.Language(33)
	}
	defer func() {
		if err := os.RemoveAll(dir); err != nil {
			logging.LogWarnf("local sync probe cleanup failed")
		}
	}()
	file := filepath.Join(dir, "probe")
	data := []byte("siyuan-probe-" + util.RandString(16))
	if err = os.WriteFile(file, data, 0600); err != nil {
		return SyncProbeConfig, Conf.Language(33)
	}
	read, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(read, data) {
		return SyncProbeConfig, Conf.Language(33)
	}
	return SyncProbeOK, ""
}
