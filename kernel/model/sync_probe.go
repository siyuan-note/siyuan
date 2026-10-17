package model

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/aws/smithy-go"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	// SyncProbeOK 表示写入与列举指向同一个对象键
	SyncProbeOK = "ok"
	// SyncProbeConfig 表示可以确定的配置错误
	SyncProbeConfig = "config"
	// SyncProbeNetwork 表示网络或服务端不可达，无法判定配置
	SyncProbeNetwork = "network"
)

// syncProbeListAttempts 与 syncProbeListRetryDelay 在「刚写入却列不到」时重试，兼容列举结果短暂滞后于写入的服务端实现。
var (
	syncProbeListAttempts   = 3
	syncProbeListRetryDelay = 300 * time.Millisecond
)

// TestSyncProviderS3 用候选配置写入、列举并删除探针对象，确认读写与列举落在同一个对象键上。
// 只访问云端，不读取或保存用户配置；云端为空（首次配置）时同样适用，写入先于列举，不依赖任何已有对象。
func TestSyncProviderS3(s3 *conf.S3) (kind, msg string) {
	if err := validateSyncS3(s3); nil != err {
		return SyncProbeConfig, err.Error()
	}

	candidate := &conf.S3{
		Endpoint:       util.NormalizeEndpoint(strings.TrimSpace(s3.Endpoint)),
		AccessKey:      strings.TrimSpace(s3.AccessKey),
		SecretKey:      strings.TrimSpace(s3.SecretKey),
		Bucket:         strings.TrimSpace(s3.Bucket),
		Region:         strings.TrimSpace(s3.Region),
		PathStyle:      s3.PathStyle,
		SkipTlsVerify:  s3.SkipTlsVerify,
		Timeout:        util.NormalizeTimeout(s3.Timeout),
		ConcurrentReqs: util.NormalizeConcurrentReqs(s3.ConcurrentReqs, conf.ProviderS3),
	}

	client := newS3ProbeClient(candidate)
	// 探针放在数据分块前缀下：同步每次都会写入与列举该前缀，权限判定更有代表性；
	// .s 不是十六进制对象前缀，并遵循清理流程按对象 ID 前两字符拆分目录的规则。
	probePrefix := "objects/.s/siyuan-probe-" + util.RandString(16) + "-"
	probeKey := probePrefix + "probe"
	if _, err := client.UploadBytes(probeKey, []byte("siyuan"), true); nil != err {
		return syncProbeFailure(err)
	}
	defer func() {
		// 探针删除失败只会留下一个可忽略的小对象，不作为探测结论
		_ = client.RemoveObject(probeKey)
	}()

	objects, err := client.ListObjects(probePrefix)
	if nil != err {
		return syncProbeFailure(err)
	}
	if _, listed := objects["probe"]; listed {
		return SyncProbeOK, ""
	}
	// 部分兼容实现在写入后短时间内列不到新对象，重试后再判定，避免把可用配置报成错误
	for attempt := 1; attempt < syncProbeListAttempts; attempt++ {
		time.Sleep(syncProbeListRetryDelay)
		objects, err = client.ListObjects(probePrefix)
		if nil != err {
			return syncProbeFailure(err)
		}
		if _, listed := objects["probe"]; listed {
			return SyncProbeOK, ""
		}
	}
	return SyncProbeConfig, fmt.Sprintf("probe object [repo/%s] was not listed by its own prefix", probeKey)
}

// newS3ProbeClient 使用候选配置构造独立客户端，复用同步路径的 SDK 选项与 HTTP 传输。
func newS3ProbeClient(s3 *conf.S3) cloud.Cloud {
	httpClient := httpclient.NewUserAgentClient(httpclient.NewTransport(s3.SkipTlsVerify))
	httpClient.Timeout = time.Duration(s3.Timeout) * time.Second
	return cloud.NewS3(&cloud.BaseCloud{Conf: &cloud.Conf{S3: &cloud.ConfS3{
		Endpoint:       s3.Endpoint,
		AccessKey:      s3.AccessKey,
		SecretKey:      s3.SecretKey,
		Region:         s3.Region,
		Bucket:         s3.Bucket,
		PathStyle:      s3.PathStyle,
		SkipTlsVerify:  s3.SkipTlsVerify,
		Timeout:        s3.Timeout,
		ConcurrentReqs: s3.ConcurrentReqs,
	}}}, httpClient)
}

// syncProbeFailure 区分可确定的配置错误与网络、服务端不可达，无法判定时归为后者以免误报配置问题。
func syncProbeFailure(err error) (kind, msg string) {
	if errors.Is(err, cloud.ErrCloudAuthFailed) || errors.Is(err, cloud.ErrCloudForbidden) ||
		errors.Is(err, cloud.ErrCloudObjectNotFound) {
		return SyncProbeConfig, err.Error()
	}
	var responseErr interface{ HTTPStatusCode() int }
	if errors.As(err, &responseErr) && (responseErr.HTTPStatusCode() >= 500 ||
		responseErr.HTTPStatusCode() == http.StatusTooManyRequests) {
		return SyncProbeNetwork, err.Error()
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		if apiErr.ErrorFault() == smithy.FaultServer {
			return SyncProbeNetwork, err.Error()
		}
		switch apiErr.ErrorCode() {
		case "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "NoSuchBucket", "NoSuchKey", "NotFound",
			"InvalidBucketName", "InvalidRegion", "AuthorizationHeaderMalformed", "PermanentRedirect":
			return SyncProbeConfig, err.Error()
		}
	}
	if responseErr != nil {
		switch responseErr.HTTPStatusCode() {
		case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound:
			return SyncProbeConfig, err.Error()
		}
	}
	return SyncProbeNetwork, err.Error()
}
