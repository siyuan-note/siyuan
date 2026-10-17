package model

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

// probeServer 是最小的 S3 兼容端点：记录写入、列举与删除，用于验证探测结论。
type probeServer struct {
	mu         sync.Mutex
	objects    map[string][]byte
	written    []string
	listKeyFn  func(prefix string) string
	listFails  bool
	bucketMiss bool
	listLag    int
}

func (server *probeServer) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	server.mu.Lock()
	defer server.mu.Unlock()
	if server.bucketMiss {
		writer.Header().Set("Content-Type", "application/xml")
		writer.WriteHeader(http.StatusNotFound)
		_, _ = writer.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>`))
		return
	}
	key := strings.TrimPrefix(request.URL.Path, "/notes/")
	switch request.Method {
	case http.MethodPut:
		data, _ := io.ReadAll(request.Body)
		server.objects[key] = data
		server.written = append(server.written, key)
		writer.WriteHeader(http.StatusOK)
	case http.MethodDelete:
		delete(server.objects, key)
		writer.WriteHeader(http.StatusNoContent)
	case http.MethodGet:
		if server.listFails {
			writer.Header().Set("Content-Type", "application/xml")
			writer.WriteHeader(http.StatusNotFound)
			_, _ = writer.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>`))
			return
		}
		// 模拟列举结果滞后于写入：前 listLag 次列举看不到已写入的对象
		visible := server.objects
		if 0 < server.listLag {
			server.listLag--
			visible = map[string][]byte{}
		}
		prefix := request.URL.Query().Get("prefix")
		var contents strings.Builder
		for objectKey := range visible {
			if !strings.HasPrefix(objectKey, prefix) {
				continue
			}
			listed := objectKey
			if nil != server.listKeyFn {
				listed = server.listKeyFn(objectKey)
			}
			contents.WriteString(fmt.Sprintf("<Contents><Key>%s</Key><Size>6</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>\"etag\"</ETag><StorageClass>STANDARD</StorageClass></Contents>", listed))
		}
		writer.Header().Set("Content-Type", "application/xml")
		_, _ = writer.Write([]byte(fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>notes</Name><Prefix>%s</Prefix><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>%s</ListBucketResult>`, prefix, contents.String())))
	default:
		writer.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func probeConfig(endpoint string) *conf.S3 {
	return &conf.S3{
		Endpoint: endpoint, AccessKey: "key", SecretKey: "secret", Bucket: "notes", Region: "auto",
		PathStyle: true, Timeout: 30, ConcurrentReqs: 4,
	}
}

func TestTestSyncProviderS3(t *testing.T) {
	originalDelay := syncProbeListRetryDelay
	syncProbeListRetryDelay = 0
	t.Cleanup(func() { syncProbeListRetryDelay = originalDelay })

	healthy := &probeServer{objects: map[string][]byte{}}
	server := httptest.NewServer(healthy)
	defer server.Close()
	if kind, msg := TestSyncProviderS3(probeConfig(server.URL)); kind != SyncProbeOK || "" != msg {
		t.Fatalf("healthy endpoint returned %q: %s", kind, msg)
	}
	if 0 != len(healthy.objects) {
		t.Fatalf("probe object was left behind: %v", healthy.objects)
	}
	// 探针位于数据分块前缀下，才能覆盖同步所需的写入与列举权限，并随未引用对象一起被清理
	if 1 != len(healthy.written) || !strings.HasPrefix(healthy.written[0], "repo/objects/.siyuan-probe-") ||
		!strings.HasSuffix(healthy.written[0], "/probe") {
		t.Fatalf("probe key is outside the object prefix: %v", healthy.written)
	}

	// 列举被路由成取对象：写入成功但按前缀列举失败
	brokenListing := &probeServer{objects: map[string][]byte{}, listFails: true}
	brokenServer := httptest.NewServer(brokenListing)
	defer brokenServer.Close()
	if kind, _ := TestSyncProviderS3(probeConfig(brokenServer.URL)); kind != SyncProbeConfig {
		t.Fatalf("failing listing returned %q", kind)
	}

	// 对象键多出一层前缀：写入与列举都成功，但列举结果与写入的键不一致
	offset := &probeServer{objects: map[string][]byte{}, listKeyFn: func(key string) string {
		return "notes/" + key
	}}
	offsetServer := httptest.NewServer(offset)
	defer offsetServer.Close()
	if kind, msg := TestSyncProviderS3(probeConfig(offsetServer.URL)); kind != SyncProbeConfig || !strings.Contains(msg, "not listed") {
		t.Fatalf("offset keys returned %q: %s", kind, msg)
	}
}

// TestTestSyncProviderS3FreshBucket 覆盖首次配置：桶中没有任何对象时，探测只依赖自己写入的探针。
func TestTestSyncProviderS3FreshBucket(t *testing.T) {
	originalDelay := syncProbeListRetryDelay
	syncProbeListRetryDelay = 0
	t.Cleanup(func() { syncProbeListRetryDelay = originalDelay })

	fresh := &probeServer{objects: map[string][]byte{}}
	server := httptest.NewServer(fresh)
	defer server.Close()
	kind, msg := TestSyncProviderS3(probeConfig(server.URL))
	if kind != SyncProbeOK || "" != msg {
		t.Fatalf("empty bucket returned %q: %s", kind, msg)
	}
	// 探测结束后桶应恢复为空，不留下会影响首次同步的对象
	if 0 != len(fresh.objects) {
		t.Fatalf("probe left objects in the empty bucket: %v", fresh.objects)
	}
}

// TestTestSyncProviderS3MissingBucket 确认桶未创建时归为可确定的配置错误，且给出可读原因。
func TestTestSyncProviderS3MissingBucket(t *testing.T) {
	originalDelay := syncProbeListRetryDelay
	syncProbeListRetryDelay = 0
	t.Cleanup(func() { syncProbeListRetryDelay = originalDelay })

	missing := &probeServer{objects: map[string][]byte{}, bucketMiss: true}
	server := httptest.NewServer(missing)
	defer server.Close()
	kind, msg := TestSyncProviderS3(probeConfig(server.URL))
	if kind != SyncProbeConfig {
		t.Fatalf("missing bucket returned %q: %s", kind, msg)
	}
	if !strings.Contains(strings.ToLower(msg), "nosuchbucket") && !strings.Contains(strings.ToLower(msg), "does not exist") {
		t.Fatalf("missing bucket reason is not diagnostic: %s", msg)
	}
}

// TestTestSyncProviderS3ListingLag 确认新写入对象尚未出现在列举结果时，重试仍能得出可用结论。
func TestTestSyncProviderS3ListingLag(t *testing.T) {
	originalDelay := syncProbeListRetryDelay
	syncProbeListRetryDelay = 0
	t.Cleanup(func() { syncProbeListRetryDelay = originalDelay })

	lagging := &probeServer{objects: map[string][]byte{}, listLag: syncProbeListAttempts - 1}
	server := httptest.NewServer(lagging)
	defer server.Close()
	if kind, msg := TestSyncProviderS3(probeConfig(server.URL)); kind != SyncProbeOK || "" != msg {
		t.Fatalf("listing lag returned %q: %s", kind, msg)
	}
	if 0 != lagging.listLag {
		t.Fatalf("listing lag was not exercised: %d", lagging.listLag)
	}
}
