package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/88250/gulu"
	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestRepoContractInputs(t *testing.T) {
	t.Run("setRepoIndexRetentionDays", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var days float64
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("days", &days, true, false)) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "setRepoIndexRetentionDays", `{"days":1.75}`, legacy, func(body []byte) error {
			_, err := apicontract.SetRepoIndexRetentionDays.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("setRetentionIndexesDaily", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var indexes float64
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("indexes", &indexes, true, false)) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "setRetentionIndexesDaily", `{"indexes":1.75}`, legacy, func(body []byte) error {
			_, err := apicontract.SetRetentionIndexesDaily.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getRepoFile", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {

			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var id string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "getRepoFile", `{"id":" value "}`, legacy, func(body []byte) error { _, err := apicontract.GetRepoFile.Decode(bytes.NewReader(body)); return err })
	})
	t.Run("rollbackRepoSnapshotFile", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var id string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "rollbackRepoSnapshotFile", `{"id":" value "}`, legacy, func(body []byte) error {
			_, err := apicontract.RollbackRepoSnapshotFile.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("openRepoSnapshotFile", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var id string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "openRepoSnapshotFile", `{"id":" value "}`, legacy, func(body []byte) error {
			_, err := apicontract.OpenRepoSnapshotFile.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("diffRepoSnapshots", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var left, right string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("left", &left, true, true),
				util.BindJsonArg("right", &right, true, true),
			) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "diffRepoSnapshots", `{"left":" value ","right":" value "}`, legacy, func(body []byte) error {
			_, err := apicontract.DiffRepoSnapshots.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("checkoutRepo", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var id, sessionID string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("id", &id, true, true),
				util.BindJsonArg("sessionID", &sessionID, false, false),
			) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "checkoutRepo", `{"id":" value ","sessionID":" value "}`, legacy, func(body []byte) error { _, err := apicontract.CheckoutRepo.Decode(bytes.NewReader(body)); return err })
	})
	t.Run("downloadCloudSnapshot", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var id, tag string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("id", &id, true, true),
				util.BindJsonArg("tag", &tag, true, false),
			) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "downloadCloudSnapshot", `{"id":" value ","tag":" value "}`, legacy, func(body []byte) error {
			_, err := apicontract.DownloadCloudSnapshot.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("uploadCloudSnapshot", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var id, tag string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("id", &id, true, true),
				util.BindJsonArg("tag", &tag, true, false),
			) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "uploadCloudSnapshot", `{"id":" value ","tag":" value "}`, legacy, func(body []byte) error {
			_, err := apicontract.UploadCloudSnapshot.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getRepoSnapshots", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var page float64
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("page", &page, true, false)) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "getRepoSnapshots", `{"page":1.75}`, legacy, func(body []byte) error {
			_, err := apicontract.GetRepoSnapshots.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("searchRepoFile", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			var page float64
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("keyword", &keyword, true, true),
				util.BindJsonArg("page", &page, true, false),
			) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "searchRepoFile", `{"keyword":" value ","page":1.75}`, legacy, func(body []byte) error {
			_, err := apicontract.SearchRepoFile.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getRepoDocHistory", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var id string
			var page float64
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("id", &id, true, true),
				util.BindJsonArg("page", &page, true, false),
			) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "getRepoDocHistory", `{"id":" value ","page":1.75}`, legacy, func(body []byte) error {
			_, err := apicontract.GetRepoDocHistory.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("exportRepoFile", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var id string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("id", &id, true, true),
			) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "exportRepoFile", `{"id":" value "}`, legacy, func(body []byte) error {
			_, err := apicontract.ExportRepoFile.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getCloudRepoSnapshots", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var page float64
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("page", &page, true, false)) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "getCloudRepoSnapshots", `{"page":1.75}`, legacy, func(body []byte) error {
			_, err := apicontract.GetCloudRepoSnapshots.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getCloudRepoTagSnapshots", func(t *testing.T) {
		if _, err := apicontract.GetCloudRepoTagSnapshots.Decode(strings.NewReader("invalid JSON")); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("removeCloudRepoTagSnapshot", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var tag string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("tag", &tag, true, true)) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "removeCloudRepoTagSnapshot", `{"tag":" value "}`, legacy, func(body []byte) error {
			_, err := apicontract.RemoveCloudRepoTagSnapshot.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getRepoTagSnapshots", func(t *testing.T) {
		if _, err := apicontract.GetRepoTagSnapshots.Decode(strings.NewReader("invalid JSON")); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("removeRepoTagSnapshot", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var tag string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("tag", &tag, true, true)) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "removeRepoTagSnapshot", `{"tag":" value "}`, legacy, func(body []byte) error {
			_, err := apicontract.RemoveRepoTagSnapshot.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("tagSnapshot", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var id, name string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("id", &id, true, true),
				util.BindJsonArg("name", &name, true, false),
			) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "tagSnapshot", `{"id":" value ","name":" value "}`, legacy, func(body []byte) error { _, err := apicontract.TagSnapshot.Decode(bytes.NewReader(body)); return err })
	})
	t.Run("importRepoKey", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var base64Key string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("key", &base64Key, true, false)) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "importRepoKey", `{"key":" value "}`, legacy, func(body []byte) error { _, err := apicontract.ImportRepoKey.Decode(bytes.NewReader(body)); return err })
	})
	t.Run("initRepoKeyFromPassphrase", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var pass string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("pass", &pass, true, false)) {
				return
			}
			return
		}
		checkRepoInputCompatibility(t, "initRepoKeyFromPassphrase", `{"pass":" value "}`, legacy, func(body []byte) error {
			_, err := apicontract.InitRepoKeyFromPassphrase.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("initRepoKey", func(t *testing.T) {
		if _, err := apicontract.InitRepoKey.Decode(strings.NewReader("invalid JSON")); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("resetRepo", func(t *testing.T) {
		if _, err := apicontract.ResetRepo.Decode(strings.NewReader("invalid JSON")); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("purgeRepo", func(t *testing.T) {
		if _, err := apicontract.PurgeRepo.Decode(strings.NewReader("invalid JSON")); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("purgeCloudRepo", func(t *testing.T) {
		if _, err := apicontract.PurgeCloudRepo.Decode(strings.NewReader("invalid JSON")); err != nil {
			t.Fatal(err)
		}
	})
}

func checkRepoInputCompatibility(t *testing.T, name, valid string, legacy func(*gin.Context) *gulu.Result, decode func([]byte) error) {
	t.Helper()
	base := map[string]json.RawMessage{}
	json.Unmarshal([]byte(valid), &base)
	bodies := [][]byte{[]byte(valid), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
	for key := range base {
		for _, value := range []string{"null", "false", "1", "[]", "{}", `""`, `"  "`} {
			changed := map[string]json.RawMessage{}
			for k, v := range base {
				changed[k] = v
			}
			changed[key] = json.RawMessage(value)
			data, _ := json.Marshal(changed)
			bodies = append(bodies, data)
		}
		changed := map[string]json.RawMessage{}
		for k, v := range base {
			if k != key {
				changed[k] = v
			}
		}
		data, _ := json.Marshal(changed)
		bodies = append(bodies, data)
	}
	for _, body := range bodies {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/api/repo/"+name, bytes.NewReader(body))
		expected := legacy(c)
		err := decode(body)
		message := ""
		if err != nil {
			message = err.Error()
		}
		if message != expected.Msg {
			t.Errorf("body %s: got %q want %q", body, message, expected.Msg)
		}
	}
}

func TestRepoFileWireCompatibility(t *testing.T) {
	for _, test := range []struct {
		path string
		data []byte
	}{{"file.txt", []byte("hello")}, {"file.json", []byte(`{"value":1}`)}, {"file", []byte{0, 255, 1}}, {"empty", nil}} {
		t.Run(test.path, func(t *testing.T) {
			legacy := func(c *gin.Context) {
				ret := gulu.Ret.NewResult()
				defer c.JSON(http.StatusOK, ret)
				contentType := mime.TypeByExtension(filepath.Ext(test.path))
				if contentType == "" {
					if m := mimetype.Detect(test.data); m != nil {
						contentType = m.String()
					}
				}
				if contentType == "" {
					contentType = "application/octet-stream"
				}
				c.Data(http.StatusOK, contentType, test.data)
			}
			typed := contractHandler(apicontract.GetRepoFile, func(c *gin.Context, request apicontract.GetRepoFileRequest) apicontract.Response[apicontract.BinaryContent] {
				return repoFileResponse(test.data, test.path)
			})
			engine := gin.New()
			engine.POST("/legacy", legacy)
			engine.POST("/typed", typed)
			server := httptest.NewServer(engine)
			defer server.Close()
			// 各请求独立建连，避免超出 Content-Length 的参考写入影响下一次连接复用。
			transport := &http.Transport{DisableKeepAlives: true}
			defer transport.CloseIdleConnections()
			client := &http.Client{Transport: transport}
			var payloads [][]byte
			var media []string
			for _, path := range []string{"/legacy", "/typed"} {
				response, err := client.Post(server.URL+path, "application/json", strings.NewReader(`{"id":"file"}`))
				if err != nil {
					t.Fatal(err)
				}
				body, err := io.ReadAll(response.Body)
				response.Body.Close()
				if err != nil {
					t.Fatal(err)
				}
				if response.StatusCode != 200 {
					t.Fatal(response.StatusCode)
				}
				payloads = append(payloads, body)
				media = append(media, response.Header.Get("Content-Type"))
			}
			if !bytes.Equal(payloads[0], payloads[1]) || media[0] != media[1] {
				t.Fatalf("wire mismatch: %q / %q, media %v", payloads[0], payloads[1], media)
			}
			expected := test.data
			if len(expected) == 0 {
				expected = []byte(`{"code":0,"msg":"","data":null}`)
			}
			if !bytes.Equal(payloads[1], expected) {
				t.Fatalf("unexpected file bytes: %q", payloads[1])
			}
		})
	}
}

func TestRepoContractTransport(t *testing.T) {
	log := &dejavu.Log{ID: "index", Memo: "memo", Created: 9223372036854775807, HCreated: "created", Files: []*entity.File{nil, {ID: "file", Path: "box/doc.sy", Size: 42, Updated: 2, Chunks: []string{"chunk"}}}, Count: 1, Size: 42, HSize: "42B", SystemID: "system", SystemName: "name", SystemOS: "os", Tag: "tag", HTagUpdated: "updated"}
	snapshot := &model.Snapshot{Log: log, TypesCount: []*model.TypeCount{nil, {Type: "sy", Count: 1}}, RequiresDownload: true}
	for _, pair := range [][2]interface{}{{log, repoLog(log)}, {snapshot, repoSnapshots([]*model.Snapshot{snapshot})[0]}, {[]*dejavu.Log{nil, log}, repoLogs([]*dejavu.Log{nil, log})}, {([]*dejavu.Log)(nil), repoLogs(nil)}, {[]*dejavu.Log{}, repoLogs([]*dejavu.Log{})}, {[]*model.DiffFile{nil, {FileID: "f", IndexID: "i", Title: "t", Path: "p", HPath: "h", HSize: "s", Updated: 5}}, repoDiffFiles([]*model.DiffFile{nil, {FileID: "f", IndexID: "i", Title: "t", Path: "p", HPath: "h", HSize: "s", Updated: 5}})}} {
		left, _ := json.Marshal(pair[0])
		right, _ := json.Marshal(pair[1])
		if !bytes.Equal(left, right) {
			t.Fatalf("transport mismatch: %s / %s", left, right)
		}
	}
	key := []byte{0, 1, 2, 3, 255}
	left, _ := json.Marshal(map[string][]byte{"key": key})
	right, _ := json.Marshal(apicontract.RepoKeyData{Key: base64.StdEncoding.EncodeToString(key)})
	if !bytes.Equal(left, right) {
		t.Fatalf("key encoding differs")
	}
}

func TestRepoContractHTTPFailures(t *testing.T) {
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, body string
		handler    gin.HandlerFunc
	}{{"getRepoFile", `{}`, getRepoFile}, {"checkoutRepo", `{"id":"snapshot","sessionID":"invalid"}`, checkoutRepo}, {"getRepoDocHistory", `{"id":"invalid","page":1}`, getRepoDocHistory}} {
		engine := gin.New()
		path := "/api/repo/" + test.name
		engine.POST(path, test.handler)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, strings.NewReader(test.body)))
		if recorder.Code != http.StatusOK || !strings.HasPrefix(recorder.Header().Get("Content-Type"), "application/json") {
			t.Fatalf("unexpected repository error status or media: %d %s", recorder.Code, recorder.Header().Get("Content-Type"))
		}
		if err := bundle.ValidateErrorResponse(http.MethodPost, path, recorder.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
		var response struct {
			Code int
			Data json.RawMessage
		}
		json.Unmarshal(recorder.Body.Bytes(), &response)
		if response.Code != -1 || string(response.Data) != "null" {
			t.Fatal(recorder.Body.String())
		}
	}
}

func TestRepoContractLockedFileAdmission(t *testing.T) {
	root, boxID := setupArchiveWorkspace(t)
	previousConf, previousRepo, previousTemp := model.Conf, util.RepoDir, util.TempDir
	model.Conf = model.NewAppConf()
	model.Conf.Repo = conf.NewRepo()
	model.Conf.Sync = conf.NewSync()
	model.Conf.System = &conf.System{ID: "contract-device", Name: "contract-device", OS: "test"}
	model.Conf.Repo.Key = bytes.Repeat([]byte{1}, 32)
	util.RepoDir, util.TempDir = filepath.Join(root, "repo"), filepath.Join(root, "temp")
	t.Cleanup(func() { model.Conf, util.RepoDir, util.TempDir = previousConf, previousRepo, previousTemp })
	store, err := dejavu.NewStore(util.RepoDir, model.Conf.Repo.Key)
	if err != nil {
		t.Fatal(err)
	}
	file := entity.NewFile("/"+boxID+"/20260101000000-abcdefg.sy", 10, 1000)
	if err := store.PutFile(file); err != nil {
		t.Fatal(err)
	}
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name    string
		handler gin.HandlerFunc
	}{{"getRepoFile", getRepoFile}, {"rollbackRepoSnapshotFile", rollbackRepoSnapshotFile}, {"openRepoSnapshotFile", openRepoSnapshotFile}, {"exportRepoFile", exportRepoFile}} {
		path := "/api/repo/" + test.name
		engine := gin.New()
		engine.POST(path, test.handler)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, strings.NewReader(fmt.Sprintf(`{"id":%q}`, file.ID))))
		var response struct {
			Code int
			Msg  string
		}
		json.Unmarshal(recorder.Body.Bytes(), &response)
		if response.Code != -1 || response.Msg != model.Conf.Language(314) {
			t.Fatalf("%s locked admission: %s", test.name, recorder.Body.String())
		}
		if err := bundle.ValidateErrorResponse(http.MethodPost, path, recorder.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
	}
}
