package api

import (
	archivezip "archive/zip"
	"bytes"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func syncTestConfiguration(t *testing.T) {
	t.Helper()
	previous, previousReadonly, previousTemp := model.Conf, util.ReadOnly, util.TempDir
	model.Conf = model.NewAppConf()
	model.Conf.Sync = conf.NewSync()
	model.Conf.Sync.S3 = &conf.S3{}
	model.Conf.Sync.WebDAV = &conf.WebDAV{}
	util.ReadOnly = true
	util.TempDir = t.TempDir()
	t.Cleanup(func() { model.Conf, util.ReadOnly, util.TempDir = previous, previousReadonly, previousTemp })
}

func TestAPIContractSyncScalarDecodeCompatibility(t *testing.T) {
	compareSyncDecode(t, apicontract.SetSyncEnable, "enabled", true, false, []string{`{}`, `null`, `[]`, `1`, `"text"`, ``, `{`, `{"enabled":null}`, `{"enabled":0}`, `{"enabled":true}`, `{"enabled":false}`, `{"enabled":true,"unused":1e1000}`, `{"enabled":true} {`}, func(r apicontract.SyncEnabledRequest) bool { return r.Enabled })
	compareSyncDecode(t, apicontract.SetSyncInterval, "interval", true, false, []string{`{}`, `{"interval":null}`, `{"interval":"1"}`, `{"interval":31.9}`, `{"interval":-1}`, `{"interval":1.0}`, `{"interval":1,"interval":32}`, `{"interval":1e1000}`}, func(r apicontract.SyncIntervalRequest) float64 { return r.Interval })
	compareSyncDecode(t, apicontract.SetCloudSyncDir, "name", true, true, []string{`{}`, `{"name":null}`, `{"name":1}`, `{"name":"  "}`, `{"name":"  cloud  "}`, `{"name":""}`}, func(r apicontract.SyncNameRequest) string { return r.Name })
}

func compareSyncDecode[Request, Data, Value any](t *testing.T, endpoint apicontract.Endpoint[Request, Data], key string, required, rejectEmpty bool, bodies []string, extract func(Request) Value) {
	t.Helper()
	for _, body := range bodies {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest("POST", endpoint.Definition().Path, strings.NewReader(body))
		expected := gulu.Ret.NewResult()
		var value Value
		if args, ok := util.JsonArg(context, expected); ok {
			util.ParseJsonArgs(args, expected, util.BindJsonArg(key, &value, required, rejectEmpty))
		}
		request, err := endpoint.Decode(strings.NewReader(body))
		if expected.Code != 0 {
			if err == nil || err.Error() != expected.Msg {
				t.Fatalf("%s %s: error changed: %v != %s", endpoint.Definition().Path, body, err, expected.Msg)
			}
		} else if err != nil || !reflect.DeepEqual(extract(request), value) {
			t.Fatalf("%s %s: value changed: %+v != %+v (%v)", endpoint.Definition().Path, body, extract(request), value, err)
		}
	}
}

func TestAPIContractSyncProviderConfigCompatibility(t *testing.T) {
	for _, raw := range []string{`{}`, `{"ENDPOINT":" example ","timeout":1.0,"concurrentReqs":9007199254740993}`, `{"endpoint":false}`, `{"timeout":1.5}`, `{"pathStyle":null}`, `{"endpoint":"first","endpoint":"second"}`} {
		var object map[string]interface{}
		if err := json.Unmarshal([]byte(raw), &object); err != nil {
			t.Fatal(err)
		}
		encoded, _ := gulu.JSON.MarshalJSON(object)
		expected := &conf.S3{}
		expectedErr := gulu.JSON.UnmarshalJSON(encoded, expected)
		request, err := apicontract.SetSyncProviderS3.Decode(strings.NewReader(`{"s3":` + raw + `}`))
		if err != nil {
			t.Fatal(err)
		}
		if expectedErr != nil {
			if request.ConfigError() == nil || request.ConfigError().Error() != expectedErr.Error() {
				t.Fatalf("config error changed: %v != %v", request.ConfigError(), expectedErr)
			}
		} else if request.ConfigError() != nil || !reflect.DeepEqual((*conf.S3)(&request.S3), expected) {
			t.Fatalf("config changed: %+v != %+v (%v)", request.S3, expected, request.ConfigError())
		}
	}
}

func TestAPIContractSyncHTTPResponses(t *testing.T) {
	syncTestConfiguration(t)
	model.Conf.Sync.Mode = 3
	engine := gin.New()
	for path, handler := range map[string]gin.HandlerFunc{
		"getBootSync": getBootSync, "getSyncInfo": getSyncInfo, "getSyncLANStatus": getSyncLANStatus,
		"performSync": performSync, "setSyncMode": setSyncMode, "setSyncInterval": setSyncInterval,
		"setSyncAssetDownloadMode": setSyncAssetDownloadMode, "setSyncProviderS3": setSyncProviderS3,
		"setSyncProviderWebDAV": setSyncProviderWebDAV, "setSyncProviderLocal": setSyncProviderLocal,
		"setSyncProvider": setSyncProvider,
	} {
		engine.POST("/api/sync/"+path, handler)
	}
	for _, entry := range []struct {
		path, body string
		code       int
		timeout    int
	}{
		{"getBootSync", "ignored invalid body", 0, 0}, {"getSyncInfo", "ignored invalid body", 0, 0},
		{"getSyncLANStatus", "ignored invalid body", 0, 0},
		{"performSync", `{"mobileSwitch":true,"upload":"ignored"}`, 0, 0},
		{"performSync", `{}`, -1, 0}, {"performSync", `{"upload":null}`, -1, 0},
		{"setSyncMode", `{"mode":3.9}`, 0, 0}, {"setSyncInterval", `{"interval":31.9}`, 0, 0},
		{"setSyncAssetDownloadMode", `{"mode":0.9}`, -1, 0},
		{"setSyncProvider", `{"provider":0.9}`, 0, 0},
		{"setSyncProvider", `{"provider":0,"completeAssets":true}`, 0, 0},
		{"setSyncProvider", `{"provider":2,"completeAssets":"true"}`, -1, 0},
		{"setSyncProviderS3", `{"s3":null}`, -1, 0},
		{"setSyncProviderS3", `{"s3":{"timeout":1.5}}`, -1, 5000},
		{"setSyncProviderWebDAV", `{"webdav":{"username":false}}`, -1, 5000},
		{"setSyncProviderLocal", `{"local":{"timeout":1.5}}`, -1, 5000},
		{"setSyncProviderS3", `{"s3":{"bucket":"","endpoint":" example "}}`, -1, 5000},
		{"setSyncProviderS3", `{"s3":{"bucket":"notes","endpoint":" example ","accessKey":"key","secretKey":"secret","region":"auto"}}`, 0, 0},
		{"setSyncProviderWebDAV", `{"webdav":{"endpoint":" example ","username":" user "}}`, 0, 0},
	} {
		recorder := httptest.NewRecorder()
		path := "/api/sync/" + entry.path
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int `json:"code"`
			Data struct {
				CloseTimeout int `json:"closeTimeout"`
			} `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code || response.Data.CloseTimeout != entry.timeout {
			t.Fatalf("response changed for %s: %s (%v)", path, recorder.Body.String(), err)
		}
	}
	if model.Conf.Sync.Mode != 3 || model.Conf.Sync.Interval != 31 {
		t.Fatalf("numeric truncation changed: %+v", model.Conf.Sync)
	}
}

func TestAPIContractSyncBootRole(t *testing.T) {
	syncTestConfiguration(t)
	previous := model.BootSyncSucc
	model.BootSyncSucc = 1
	t.Cleanup(func() { model.BootSyncSucc = previous })
	model.Conf.Sync.Enabled = true
	for _, role := range []model.Role{model.RoleAdministrator, model.RoleReader} {
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role) })
		engine.POST("/api/sync/getBootSync", getBootSync)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/sync/getBootSync", strings.NewReader("malformed")))
		requireAPIContract(t, "POST", "/api/sync/getBootSync", recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		expected := 0
		if role == model.RoleAdministrator {
			expected = 1
		}
		if response.Code != expected {
			t.Fatalf("boot status role changed: %s", recorder.Body.String())
		}
	}
}

func TestAPIContractSyncPermissionBeforeBody(t *testing.T) {
	syncTestConfiguration(t)
	for path, handler := range map[string]gin.HandlerFunc{
		"/api/sync/setSyncProviderS3": setSyncProviderS3,
		"/api/sync/setSyncProvider":   setSyncProvider,
	} {
		for _, role := range []model.Role{model.RoleAdministrator, model.RoleReader} {
			engine := gin.New()
			engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role) })
			engine.POST(path, model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, handler)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader("malformed body")))
			if role == model.RoleReader {
				if recorder.Code != 403 || recorder.Body.Len() != 0 {
					t.Fatalf("administrator gate changed: %d %s", recorder.Code, recorder.Body.String())
				}
				continue
			}
			requireAPIContract(t, "POST", path, recorder)
			var response struct {
				Code int    `json:"code"`
				Msg  string `json:"msg"`
				Data struct {
					CloseTimeout int `json:"closeTimeout"`
				} `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg != model.Conf.Language(34) || response.Data.CloseTimeout != 5000 {
				t.Fatalf("readonly gate changed: %s (%v)", recorder.Body.String(), err)
			}
		}
	}
}

func TestAPIContractSyncProviderMultipart(t *testing.T) {
	syncTestConfiguration(t)
	for _, entry := range []struct {
		name    string
		handler gin.HandlerFunc
	}{{"importSyncProviderS3", importSyncProviderS3}, {"importSyncProviderWebDAV", importSyncProviderWebDAV}} {
		engine := gin.New()
		path := "/api/sync/" + entry.name
		engine.POST(path, entry.handler)
		for _, count := range []int{0, 1, 2} {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			for i := 0; i < count; i++ {
				part, err := writer.CreateFormFile("file", "config.txt")
				if err != nil {
					t.Fatal(err)
				}
				_, _ = part.Write([]byte("content"))
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest("POST", path, &body)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			requireAPIContract(t, "POST", path, recorder)
			var response struct {
				Code int    `json:"code"`
				Msg  string `json:"msg"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 {
				t.Fatalf("invalid multipart accepted: %s %v", recorder.Body.String(), err)
			}
			if count != 1 && response.Msg != "invalid upload file" {
				t.Fatalf("upload cardinality changed: %s", recorder.Body.String())
			}
			if count == 1 && !strings.HasPrefix(response.Msg, "invalid ") {
				t.Fatalf("package extension error changed: %s", recorder.Body.String())
			}
		}
	}
}

func TestAPIContractSyncProviderExportContents(t *testing.T) {
	syncTestConfiguration(t)
	model.Conf.Sync.S3 = &conf.S3{Endpoint: " endpoint ", AccessKey: "key", SecretKey: " secret ", Bucket: "bucket", Region: "auto", Timeout: 35}
	model.Conf.Sync.WebDAV = &conf.WebDAV{Endpoint: " endpoint ", Password: " password ", Timeout: 36}
	for _, entry := range []struct {
		name     string
		handler  gin.HandlerFunc
		expected []byte
	}{
		{"exportSyncProviderS3", exportSyncProviderS3, syncMarshal(t, model.Conf.Sync.S3)},
		{"exportSyncProviderWebDAV", exportSyncProviderWebDAV, syncMarshal(t, model.Conf.Sync.WebDAV)},
	} {
		engine := gin.New()
		path := "/api/sync/" + entry.name
		engine.POST(path, entry.handler)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader("ignored")))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int                                `json:"code"`
			Data apicontract.SyncProviderExportData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("export failed: %s %v", recorder.Body.String(), err)
		}
		archive, err := archivezip.OpenReader(filepath.Join(util.TempDir, filepath.FromSlash(strings.TrimPrefix(response.Data.Zip, "/"))))
		if err != nil {
			t.Fatal(err)
		}
		if len(archive.File) != 1 || archive.File[0].Name != response.Data.Name {
			archive.Close()
			t.Fatal("export archive layout changed")
		}
		reader, err := archive.File[0].Open()
		if err != nil {
			archive.Close()
			t.Fatal(err)
		}
		encrypted, err := io.ReadAll(reader)
		reader.Close()
		archive.Close()
		if err != nil {
			t.Fatal(err)
		}
		plain, err := hex.DecodeString(string(util.AESDecrypt(string(encrypted))))
		if err != nil || !bytes.Equal(plain, entry.expected) {
			t.Fatalf("export encryption or JSON changed: %s != %s (%v)", plain, entry.expected, err)
		}
		archiveData, err := os.ReadFile(filepath.Join(util.TempDir, filepath.FromSlash(strings.TrimPrefix(response.Data.Zip, "/"))))
		if err != nil {
			t.Fatal(err)
		}
		importPath := strings.Replace(path, "exportSyncProvider", "importSyncProvider", 1)
		importHandler := importSyncProviderS3
		if entry.name == "exportSyncProviderWebDAV" {
			importHandler = importSyncProviderWebDAV
		}
		engine.POST(importPath, importHandler)
		for _, file := range []struct {
			name    string
			content []byte
		}{{response.Data.Name, encrypted}, {response.Data.Name + ".zip", archiveData}} {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			part, err := writer.CreateFormFile("file", file.name)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = part.Write(file.content); err != nil {
				t.Fatal(err)
			}
			if err = writer.Close(); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest("POST", importPath, &body)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			importRecorder := httptest.NewRecorder()
			engine.ServeHTTP(importRecorder, request)
			requireAPIContract(t, "POST", importPath, importRecorder)
			var imported struct {
				Code int `json:"code"`
			}
			if err = json.Unmarshal(importRecorder.Body.Bytes(), &imported); err != nil || imported.Code != 0 {
				t.Fatalf("provider package import changed: %s (%v)", importRecorder.Body.String(), err)
			}
		}
	}
}

func syncMarshal[T any](t *testing.T, value T) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
