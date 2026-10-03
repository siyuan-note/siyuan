package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/heif"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/image/bmp"
	"golang.org/x/image/tiff"
)

const aiOCRSuccess = `{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"first  column\r\nsecond line"}}]}`

func setupAIOCRContract(t *testing.T, handler http.HandlerFunc) *gin.Engine {
	t.Helper()
	assets := setupAssetContractWorkspace(t)
	previousWorking := util.WorkingDir
	util.WorkingDir = filepath.Join("..", "..", "app")
	t.Cleanup(func() { util.WorkingDir = previousWorking })
	model.Conf.Lang = "en"
	model.Conf.FileTree = conf.NewFileTree()
	model.Conf.AI = conf.NewAI()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	model.Conf.AI.Providers = []*conf.Provider{{ID: "provider", Enabled: true, APIKey: "test-key", BaseURL: server.URL + "/v1",
		Headers: map[string]string{"X-OCR-Test": "custom"}, Models: []*conf.Model{{ID: "vision", Enabled: true, Name: "vision-test"}}}}
	model.Conf.AI.Agent.ModelID = "vision"
	writeAIOCRImage(t, filepath.Join(assets, "ai-ocr.png"), 1)
	engine := gin.New()
	engine.POST("/api/ai/ocr", aiOCR)
	return engine
}

func writeAIOCRImage(t *testing.T, filename string, shade uint8) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 16, 16))
	img.Set(0, 0, color.RGBA{R: shade, A: 255})
	var data bytes.Buffer
	if err := png.Encode(&data, img); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filename, data.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

type aiOCRContractResponse struct {
	Code int                       `json:"code"`
	Data apicontract.AssetTextData `json:"data"`
}

func requestAIOCR(t *testing.T, engine *gin.Engine, path string) aiOCRContractResponse {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"path": path})
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/ai/ocr", bytes.NewReader(body)))
	requireAPIContract(t, "POST", "/api/ai/ocr", recorder)
	var response aiOCRContractResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response
}

func TestAPIContractAIOCRProtocols(t *testing.T) {
	for _, test := range []struct{ protocol, path, imageType, body string }{
		{"", "/v1/chat/completions", "image_url", aiOCRSuccess},
		{"openai-responses", "/v1/responses", "input_image", `{"id":"resp_1","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"first  column\nsecond line"}]}]}`},
		{"anthropic-messages", "/v1/messages", "image", `{"id":"msg_1","type":"message","role":"assistant","model":"vision-test","content":[{"type":"text","text":"first  column\nsecond line"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":2}}`},
	} {
		t.Run(test.path, func(t *testing.T) {
			calls := 0
			engine := setupAIOCRContract(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				body, _ := io.ReadAll(r.Body)
				if r.URL.Path != test.path || r.Header.Get("X-OCR-Test") != "custom" ||
					!bytes.Contains(body, []byte(test.imageType)) || !bytes.Contains(body, []byte("vision-test")) ||
					bytes.Contains(body, []byte(`"tools"`)) || bytes.Contains(body, []byte(`"stream":true`)) {
					t.Errorf("unexpected model request: %s %s", r.URL.Path, body)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, test.body)
			})
			model.Conf.AI.Providers[0].Protocol = test.protocol
			const path = "assets/ai-ocr.png"
			t.Cleanup(func() { util.RemoveAssetText(path) })
			response := requestAIOCR(t, engine, path+"#preview")
			if response.Code != 0 || response.Data.Text != "first  column\nsecond line" || util.GetAssetText(path) != response.Data.Text || calls != 1 {
				t.Fatalf("OCR result: %+v, calls=%d", response, calls)
			}
		})
	}
}

func TestAPIContractAIOCRFailures(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		body   string
	}{
		{"unsupported image", 400, `{"error":{"message":"model does not support image input","type":"invalid_request_error"}}`},
		{"provider failure", 500, `{"error":{"message":"unavailable","type":"server_error"}}`},
		{"missing choices", 200, `{"choices":[]}`},
		{"truncated", 200, `{"choices":[{"finish_reason":"length","message":{"content":"partial"}}]}`},
		{"refusal", 200, `{"choices":[{"finish_reason":"stop","message":{"content":"refused","refusal":"denied"}}]}`},
		{"tool call", 200, `{"choices":[{"finish_reason":"tool_calls","message":{"tool_calls":[{"id":"call","type":"function","function":{"name":"tool","arguments":"{}"}}]}}]}`},
		{"broken response", 200, `{"choices":[`},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			engine := setupAIOCRContract(t, func(w http.ResponseWriter, _ *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(test.status)
				_, _ = io.WriteString(w, test.body)
			})
			const path = "assets/ai-ocr.png"
			util.SetAssetText(path, "previous result")
			t.Cleanup(func() { util.RemoveAssetText(path) })
			if response := requestAIOCR(t, engine, path); response.Code == 0 || calls != 1 || util.GetAssetText(path) != "previous result" {
				t.Fatalf("failure overwrote text or retried without image: %+v, calls=%d", response, calls)
			}
		})
	}
}

func TestAPIContractAIOCRNotebookIsolationAndEncryptedRejection(t *testing.T) {
	var received []byte
	calls := 0
	engine := setupAIOCRContract(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		received, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, aiOCRSuccess)
	})
	const path = "assets/ai-ocr.png"
	for index, boxID := range []string{"20261003100001-abcdefg", "20261003100002-abcdefg"} {
		box := conf.NewBoxConf()
		config, _ := json.Marshal(box)
		directory := filepath.Join(util.DataDir, boxID, ".siyuan")
		if err := os.MkdirAll(directory, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "conf.json"), config, 0600); err != nil {
			t.Fatal(err)
		}
		imageData := writeAIOCRImage(t, filepath.Join(util.DataDir, boxID, filepath.FromSlash(path)), uint8(index+10))
		reference := path + "?box=" + boxID
		util.SetAssetText(reference, "previous notebook result")
		t.Cleanup(func() { util.RemoveAssetText(reference) })
		util.SetAssetText(path, "global result")
		t.Cleanup(func() { util.RemoveAssetText(path) })
		response := requestAIOCR(t, engine, reference+"&style=thumb#preview")
		if response.Code != 0 || !bytes.Contains(received, []byte(base64.StdEncoding.EncodeToString(imageData))) ||
			util.GetAssetText(reference) != response.Data.Text || util.GetAssetText(path) != "global result" {
			t.Fatalf("notebook identity was lost: %+v", response)
		}
	}
	const encryptedBox = "20261003100003-abcdefg"
	box := conf.NewBoxConf()
	box.Encrypted = true
	config, _ := json.Marshal(box)
	directory := filepath.Join(util.DataDir, encryptedBox, ".siyuan")
	if err := os.MkdirAll(directory, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "conf.json"), config, 0600); err != nil {
		t.Fatal(err)
	}
	imageData := writeAIOCRImage(t, filepath.Join(util.DataDir, encryptedBox, filepath.FromSlash(path)), 12)
	reference := path + "?box=" + encryptedBox
	before := calls
	for _, value := range []string{reference, reference + "#preview", "assets/missing.png?box=" + encryptedBox} {
		if response := requestAIOCR(t, engine, value); response.Code == 0 || calls != before {
			t.Fatalf("encrypted image reached model: %+v", response)
		}
	}
	if data, err := os.ReadFile(filepath.Join(util.DataDir, encryptedBox, filepath.FromSlash(path))); err != nil || !bytes.Equal(data, imageData) {
		t.Fatal("encrypted rejection changed source data")
	}
}

func TestAPIContractAIOCRAdmissionAndCancellation(t *testing.T) {
	started := make(chan struct{}, 1)
	engine := setupAIOCRContract(t, func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	})
	provider := model.Conf.AI.Providers[0]
	if err := os.WriteFile(filepath.Join(util.DataDir, "assets", "invalid.png"), []byte("invalid image"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"https://example.com/image.png", "assets/../storage/secret.png", "assets/missing.png", "assets/invalid.png"} {
		if response := requestAIOCR(t, engine, path); response.Code == 0 {
			t.Fatalf("accepted invalid path: %s", path)
		}
	}
	provider.Enabled = false
	if response := requestAIOCR(t, engine, "assets/ai-ocr.png"); response.Code == 0 {
		t.Fatal("disabled provider accepted")
	}
	provider.Enabled = true
	provider.Protocol = "unsupported"
	if response := requestAIOCR(t, engine, "assets/ai-ocr.png"); response.Code == 0 {
		t.Fatal("unsupported protocol accepted")
	}
	provider.Protocol = ""
	select {
	case <-started:
		t.Fatal("invalid request reached provider")
	default:
	}
	const path = "assets/ai-ocr.png"
	util.SetAssetText(path, "previous result")
	t.Cleanup(func() { util.RemoveAssetText(path) })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/api/ai/ocr", strings.NewReader(`{"path":"assets/ai-ocr.png"}`)).WithContext(ctx)
	done := make(chan struct{})
	go func() { engine.ServeHTTP(recorder, request); close(done) }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("model request did not start")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("model request did not cancel")
	}
	requireAPIContract(t, "POST", "/api/ai/ocr", recorder)
	if !strings.Contains(recorder.Body.String(), `"code":-1`) || util.GetAssetText(path) != "previous result" {
		t.Fatal("cancellation changed existing OCR")
	}
}

func TestAPIContractAIOCREmptyTextAndOriginalResolution(t *testing.T) {
	var received []byte
	engine := setupAIOCRContract(t, func(w http.ResponseWriter, r *http.Request) {
		received, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":""}}]}`)
	})
	const path = "assets/ai-ocr.png"
	util.SetAssetText(path, "previous text")
	t.Cleanup(func() { util.RemoveAssetText(path) })
	var imageData bytes.Buffer
	if err := png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 4096, 32))); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(util.DataDir, filepath.FromSlash(path)), imageData.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	response := requestAIOCR(t, engine, path)
	if response.Code != 0 || response.Data.Text != "" || !util.ExistsAssetText(path) || util.GetAssetText(path) != "" {
		t.Fatalf("valid empty transcription was not saved: %+v", response)
	}
	if !bytes.Contains(received, []byte(base64.StdEncoding.EncodeToString(imageData.Bytes()))) {
		t.Fatal("long image was downscaled before OCR")
	}
}

func TestAPIContractAIOCRConvertedFormats(t *testing.T) {
	for _, extension := range []string{"bmp", "tif", "tiff", "heic", "heif"} {
		t.Run(extension, func(t *testing.T) {
			var received []byte
			engine := setupAIOCRContract(t, func(w http.ResponseWriter, r *http.Request) {
				received, _ = io.ReadAll(r.Body)
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, aiOCRSuccess)
			})
			var source bytes.Buffer
			img := image.NewRGBA(image.Rect(0, 0, 4096, 16))
			img.Set(2, 3, color.RGBA{R: 255, A: 255})
			width, height, mimeType := 4096, 16, "image/png"
			var err error
			switch extension {
			case "bmp":
				err = bmp.Encode(&source, img)
			case "tif", "tiff":
				err = tiff.Encode(&source, img, nil)
			default:
				var data []byte
				data, err = os.ReadFile("../heif/testdata/basic.heic")
				if err == nil {
					source.Write(data)
					width, height, err = heif.ImageSize(data)
				}
				mimeType = "image/jpeg"
			}
			if err != nil {
				t.Fatal(err)
			}
			path := "assets/converted." + extension
			filename := filepath.Join(util.DataDir, filepath.FromSlash(path))
			if err = os.WriteFile(filename, source.Bytes(), 0600); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { util.RemoveAssetText(path) })
			response := requestAIOCR(t, engine, path+"#preview")
			if response.Code != 0 || response.Data.Text != "first  column\nsecond line" || util.GetAssetText(path) != response.Data.Text {
				t.Fatalf("converted OCR failed: %+v", response)
			}
			var request struct {
				Messages []struct {
					Content json.RawMessage `json:"content"`
				} `json:"messages"`
			}
			if err = json.Unmarshal(received, &request); err != nil || len(request.Messages) != 2 {
				t.Fatalf("invalid model request: %s", received)
			}
			var parts []struct {
				ImageURL struct {
					URL string `json:"url"`
				} `json:"image_url"`
			}
			if err = json.Unmarshal(request.Messages[1].Content, &parts); err != nil || len(parts) != 1 {
				t.Fatalf("invalid image parts: %s", received)
			}
			prefix := "data:" + mimeType + ";base64,"
			if !strings.HasPrefix(parts[0].ImageURL.URL, prefix) {
				t.Fatalf("unexpected converted MIME: %s", parts[0].ImageURL.URL[:min(80, len(parts[0].ImageURL.URL))])
			}
			data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(parts[0].ImageURL.URL, prefix))
			if err != nil {
				t.Fatal(err)
			}
			config, _, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil || config.Width != width || config.Height != height {
				t.Fatalf("conversion changed resolution: %+v, %v", config, err)
			}
			if extension == "bmp" || extension == "tif" || extension == "tiff" {
				decoded, err := png.Decode(bytes.NewReader(data))
				if err != nil || color.NRGBAModel.Convert(decoded.At(2, 3)) != (color.NRGBA{R: 255, A: 255}) {
					t.Fatal("bitmap conversion lost source pixels")
				}
			}
			unchanged, err := os.ReadFile(filename)
			if err != nil || !bytes.Equal(unchanged, source.Bytes()) {
				t.Fatal("conversion changed source asset")
			}
		})
	}
}

func TestAPIContractAIOCRInvalidConversions(t *testing.T) {
	calls := 0
	engine := setupAIOCRContract(t, func(http.ResponseWriter, *http.Request) { calls++ })
	var oversized bytes.Buffer
	if err := tiff.Encode(&oversized, image.NewGray(image.Rect(0, 0, 8000, 5001)), &tiff.Options{Compression: tiff.Deflate}); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name string
		data []byte
	}{
		{"broken.bmp", []byte{'B', 'M', 0, 0}},
		{"broken.tiff", []byte{'I', 'I', 42, 0, 8, 0, 0, 0}},
		{"broken.heic", append([]byte{0, 0, 0, 24}, []byte("ftypheic\x00\x00\x00\x00heicmif1")...)},
		{"image.svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)},
		{"oversized.tiff", oversized.Bytes()},
		{"oversized.bmp", bytes.Repeat([]byte{'B'}, 20*1024*1024+1)},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := "assets/" + test.name
			if err := os.WriteFile(filepath.Join(util.DataDir, filepath.FromSlash(path)), test.data, 0600); err != nil {
				t.Fatal(err)
			}
			util.SetAssetText(path, "previous text")
			t.Cleanup(func() { util.RemoveAssetText(path) })
			if response := requestAIOCR(t, engine, path); response.Code == 0 || calls != 0 || util.GetAssetText(path) != "previous text" {
				t.Fatalf("invalid conversion reached model or changed OCR: %+v, calls=%d", response, calls)
			}
		})
	}
}
