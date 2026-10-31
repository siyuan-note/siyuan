// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractExtensionCopy(t *testing.T) {
	for _, test := range []struct {
		name, dom                                    string
		missing, malformed, brokenUpload, blockedDir bool
	}{
		{name: "text", dom: "<p>Hello</p>"},
		{name: "empty DOM"},
		{name: "missing DOM", missing: true},
		{name: "malformed form", malformed: true},
		{name: "failed upload retains markdown", dom: "<p>Hello</p>", brokenUpload: true},
		{name: "asset directory failure", dom: "<p>Hello</p>", blockedDir: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			assets := setupAssetContractWorkspace(t)
			if test.blockedDir {
				if err := os.Remove(assets); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(assets, []byte("occupied"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			if !test.missing {
				if err := writer.WriteField("dom", test.dom); err != nil {
					t.Fatal(err)
				}
				if err := writer.WriteField("dom", "<p>ignored second value</p>"); err != nil {
					t.Fatal(err)
				}
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest("POST", "/api/extension/copy", &body)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			if test.malformed {
				request = httptest.NewRequest("POST", "/api/extension/copy", strings.NewReader("invalid"))
			}
			if test.brokenUpload {
				if err := request.ParseMultipartForm(1 << 20); err != nil {
					t.Fatal(err)
				}
				request.MultipartForm.File = map[string][]*multipart.FileHeader{"https://example.invalid/image.png": {{Filename: "missing.png", Size: 1}}}
			}
			engine := gin.New()
			engine.POST("/api/extension/copy", extensionCopy)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			requireAPIContract(t, "POST", "/api/extension/copy", recorder)
			var response struct {
				Code int                            `json:"code"`
				Msg  string                         `json:"msg"`
				Data *apicontract.ExtensionCopyData `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if test.missing || test.malformed {
				if recorder.Body.String() != `{"code":0,"msg":"","data":null}` {
					t.Fatalf("empty response changed: %s", recorder.Body.String())
				}
				return
			}
			if test.blockedDir {
				if response.Code != 0 || response.Msg == "" || response.Data != nil {
					t.Fatalf("directory failure changed: %+v", response)
				}
				return
			}
			wantCode := 0
			if test.brokenUpload {
				wantCode = -1
			}
			if response.Code != wantCode || response.Msg != model.Conf.Language(72) || response.Data == nil || response.Data.WithMath {
				t.Fatalf("clip response changed: %+v", response)
			}
			if test.dom != "" && (!strings.Contains(response.Data.Markdown, "Hello") || strings.Contains(response.Data.Markdown, "ignored")) {
				t.Fatalf("DOM selection changed: %s", response.Data.Markdown)
			}
			if _, err := os.Stat(filepath.Dir(assets)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAPIContractExtensionSymAuthentication(t *testing.T) {
	const serverMarkdown = "# Server article\n\n    sample code\n\nInline $x$.\n\n![source](https://example.invalid/original.png)"
	for _, test := range []struct {
		name, href, clipType, contentType, body string
		region, status                          int
		anonymous, emptyToken, noFetch          bool
		networkError, readError, fallback       bool
		download                                bool
	}{
		{name: "authenticated ld246"},
		{name: "authenticated liuyun", region: 1, href: "https://liuyun.io/article/1792972509370"},
		{name: "query and fragment", href: "https://ld246.com/article/1792972509370?p=2#comments"},
		{name: "Markdown content type", contentType: "text/markdown; charset=utf-8"},
		{name: "download original image", download: true},
		{name: "not logged in", anonymous: true, noFetch: true, fallback: true},
		{name: "empty login token", emptyToken: true, noFetch: true, fallback: true},
		{name: "different account region", region: 1, noFetch: true, fallback: true},
		{name: "partial clip", clipType: "part", noFetch: true, fallback: true},
		{name: "ordinary page", href: "https://example.invalid/article/1792972509370", noFetch: true, fallback: true},
		{name: "lookalike host", href: "https://ld246.com.example.invalid/article/1792972509370", noFetch: true, fallback: true},
		{name: "unauthorized", status: http.StatusUnauthorized, fallback: true},
		{name: "forbidden", status: http.StatusForbidden, fallback: true},
		{name: "not found", status: http.StatusNotFound, fallback: true},
		{name: "server failure", status: http.StatusInternalServerError, fallback: true},
		{name: "redirect", status: http.StatusFound, fallback: true},
		{name: "HTML login page with success status", contentType: "text/html; charset=utf-8", fallback: true},
		{name: "missing content type", contentType: "missing", fallback: true},
		{name: "empty article", body: " \n\t", fallback: true},
		{name: "network failure", networkError: true, fallback: true},
		{name: "body read failure", readError: true, fallback: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			assets := setupAssetContractWorkspace(t)
			oldRegion := util.CurrentCloudRegion
			util.CurrentCloudRegion = test.region
			t.Cleanup(func() { util.CurrentCloudRegion = oldRegion })
			user := &conf.User{UserId: "clip-owner", UserToken: "clip-login-token"}
			if test.anonymous {
				user = nil
			} else if test.emptyToken {
				user.UserToken = ""
			}
			model.Conf.SetUser(user)
			markdown := serverMarkdown
			if test.download {
				server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
					if request.Header.Get("Cookie") != "" || request.Header.Get("Authorization") != "" {
						t.Error("image download received account credentials")
					}
					writer.Header().Set("Content-Type", "image/png")
					_, _ = io.WriteString(writer, "original image data")
				}))
				t.Cleanup(server.Close)
				markdown = strings.ReplaceAll(markdown, "https://example.invalid/original.png", server.URL+"/original.png")
			}

			client := httpclient.NewCloudRequest30s().GetClient().GetClient()
			oldTransport := client.Transport
			t.Cleanup(func() { client.Transport = oldTransport })
			calls := 0
			responseBody := &extensionSymTestBody{Reader: strings.NewReader(markdown)}
			client.Transport = extensionSymTestTransport(func(request *http.Request) (*http.Response, error) {
				calls++
				if test.noFetch {
					t.Fatal("clipping must use the submitted DOM without sending account credentials")
				}
				if request.URL.String() != util.GetCloudAccountServer()+"/article/raw/1792972509370" {
					t.Fatalf("unexpected article request: %s", request.URL)
				}
				cookie, err := request.Cookie("symphony")
				if err != nil || cookie.Value != user.UserToken || request.Header.Get("Authorization") != "" {
					t.Fatal("article request must use the current account's symphony Cookie")
				}
				if request.UserAgent() != util.UserAgent {
					t.Fatalf("unexpected User-Agent: %s", request.UserAgent())
				}
				if request.Context().Value(extensionSymTestContextKey{}) != "clip-context" {
					t.Fatal("article request lost the clipping context")
				}
				if test.networkError {
					return nil, errors.New("offline")
				}
				status := test.status
				if status == 0 {
					status = http.StatusOK
				}
				contentType := test.contentType
				if contentType == "" {
					contentType = "text/plain; charset=utf-8"
				}
				header := http.Header{"Content-Type": {contentType}}
				if contentType == "missing" {
					header.Del("Content-Type")
				}
				if status != http.StatusOK || strings.HasPrefix(contentType, "text/html") {
					responseBody.Reader = strings.NewReader("<!DOCTYPE html><title>401 Unauthorized!</title>")
				}
				if test.body != "" {
					responseBody.Reader = strings.NewReader(test.body)
				}
				if test.readError {
					responseBody.readError = true
				}
				if status == http.StatusFound {
					header.Set("Location", "https://assets.ld246.com/article/raw/1792972509370")
				}
				return &http.Response{StatusCode: status, Header: header, Body: responseBody, Request: request}, nil
			})

			href := test.href
			if href == "" {
				href = "https://ld246.com/article/1792972509370"
			}
			const imageURL = "https://example.invalid/browser.png"
			const imageData = "uploaded browser image"
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			assetsOn := "false"
			if test.download {
				assetsOn = "true"
			}
			for name, value := range map[string]string{"dom": `<p>Browser article</p><p><img src="` + imageURL + `"></p>`,
				"href": href, "clipType": test.clipType, "assets": assetsOn} {
				if err := writer.WriteField(name, value); err != nil {
					t.Fatal(err)
				}
			}
			file, err := writer.CreateFormFile(imageURL, "browser.png")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = io.WriteString(file, imageData); err != nil {
				t.Fatal(err)
			}
			if err = writer.Close(); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest("POST", "/api/extension/copy", &body)
			request = request.WithContext(context.WithValue(request.Context(), extensionSymTestContextKey{}, "clip-context"))
			request.Header.Set("Content-Type", writer.FormDataContentType())
			engine := gin.New()
			engine.POST("/api/extension/copy", extensionCopy)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			requireAPIContract(t, "POST", "/api/extension/copy", recorder)
			var response struct {
				Code int                            `json:"code"`
				Data *apicontract.ExtensionCopyData `json:"data"`
			}
			if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Code != 0 || response.Data == nil || strings.Contains(response.Data.Markdown, "Unauthorized") {
				t.Fatalf("invalid clipping result: %s", recorder.Body.String())
			}
			if model.Conf.GetUser() != user {
				t.Fatal("article read failure changed the account login state")
			}
			if (test.noFetch && calls != 0) || (!test.noFetch && calls != 1) {
				t.Fatalf("unexpected outgoing request count: %d", calls)
			}
			if calls != 0 && !test.networkError && !responseBody.closed {
				t.Fatal("article response body was not closed")
			}
			files, err := os.ReadDir(assets)
			if err != nil {
				t.Fatal(err)
			}
			if test.fallback {
				if !strings.Contains(response.Data.Markdown, "Browser article") || strings.Contains(response.Data.Markdown, "Server article") ||
					strings.Contains(response.Data.Markdown, imageURL) || len(files) != 1 || response.Data.WithMath {
					t.Fatalf("DOM fallback lost the browser content or image: %s", recorder.Body.String())
				}
				data, err := os.ReadFile(filepath.Join(assets, files[0].Name()))
				if err != nil || string(data) != imageData || !strings.Contains(response.Data.Markdown, "assets/"+files[0].Name()) {
					t.Fatalf("uploaded image was not localized: %v", err)
				}
			} else {
				if !strings.Contains(response.Data.Markdown, "Server article") || strings.Contains(response.Data.Markdown, "Browser article") ||
					!strings.Contains(response.Data.Markdown, "```") || !response.Data.WithMath {
					t.Fatalf("authenticated Markdown conversion changed: %s", recorder.Body.String())
				}
				if test.download {
					if len(files) != 1 || !strings.Contains(response.Data.Markdown, "assets/"+files[0].Name()) {
						t.Fatalf("original image was not downloaded: %s", recorder.Body.String())
					}
					data, err := os.ReadFile(filepath.Join(assets, files[0].Name()))
					if err != nil || string(data) != "original image data" {
						t.Fatalf("wrong image was stored: %v", err)
					}
				} else if len(files) != 0 || !strings.Contains(response.Data.Markdown, "https://example.invalid/original.png") {
					t.Fatalf("disabled resource download changed: %s", recorder.Body.String())
				}
			}
		})
	}
}

type extensionSymTestContextKey struct{}

type extensionSymTestTransport func(*http.Request) (*http.Response, error)

func (transport extensionSymTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

type extensionSymTestBody struct {
	io.Reader
	readError, closed bool
}

func (body *extensionSymTestBody) Read(data []byte) (int, error) {
	if body.readError {
		return 0, errors.New("incomplete article")
	}
	return body.Reader.Read(data)
}

func (body *extensionSymTestBody) Close() error {
	body.closed = true
	return nil
}

func TestAPIContractExtensionLockedNotebook(t *testing.T) {
	setupAssetContractWorkspace(t)
	const boxID = "20260913000000-extlock"
	box := conf.NewBoxConf()
	box.Encrypted = true
	if err := (&model.Box{ID: boxID}).SaveConf(box); err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, field := range [][2]string{{"dom", "<p>private clip</p>"}, {"notebook", boxID}} {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/api/extension/copy", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.POST("/api/extension/copy", extensionCopy)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, "POST", "/api/extension/copy", recorder)
	if recorder.Body.String() != `{"code":-1,"msg":"encrypted notebook is locked, please unlock it first","data":null}` {
		t.Fatalf("locked notebook admission changed: %s", recorder.Body.String())
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, boxID, "assets")); !os.IsNotExist(err) {
		t.Fatalf("locked notebook assets were accessed: %v", err)
	}
}
