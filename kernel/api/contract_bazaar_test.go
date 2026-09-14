package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestBazaarContractInputCompatibility(t *testing.T) {
	t.Run("batchUpdatePackage", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var frontend string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("frontend", &frontend, true, true)) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"frontend":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"frontend":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/batchUpdatePackage", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.BatchUpdatePackage.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getUpdatedPackage", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var frontend string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("frontend", &frontend, true, true)) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"frontend":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"frontend":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getUpdatedPackage", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetUpdatedPackage.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("updateBazaarPackage", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var pkgType, packageName, frontend, keyword string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("packageType", &pkgType, true, true),
				util.BindJsonArg("packageName", &packageName, true, true),
				util.BindJsonArg("frontend", &frontend, true, true),
				util.BindJsonArg("keyword", &keyword, false, false),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"packageType":"plugins","packageName":" valid ","frontend":" valid ","keyword":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"packageType":"plugins","packageName":" valid ","frontend":" valid ","keyword":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/updateBazaarPackage", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.UpdateBazaarPackage.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getInstalledPackageSize", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var pkgType, packageName string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("packageType", &pkgType, true, true),
				util.BindJsonArg("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"packageType":"plugins","packageName":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"packageType":"plugins","packageName":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getInstalledPackageSize", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetInstalledPackageSize.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getBazaarPackage", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var pkgType, packageName, frontend string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("packageType", &pkgType, true, true),
				util.BindJsonArg("packageName", &packageName, true, true),
				util.BindJsonArg("frontend", &frontend, false, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"packageType":"plugins","packageName":" valid ","frontend":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"packageType":"plugins","packageName":" valid ","frontend":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getBazaarPackage", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetBazaarPackage.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getBazaarPackageRatings", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var pkgType string
			var packageNamesArg []any
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("packageType", &pkgType, true, true),
				util.BindJsonArg("packageNames", &packageNamesArg, true, false),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"packageType":"plugins","packageNames":[]}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"packageType":"plugins","packageNames":[]}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getBazaarPackageRatings", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetBazaarPackageRatings.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getBazaarPackageUserRatings", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var pkgType string
			var packageNamesArg []any
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("packageType", &pkgType, true, true),
				util.BindJsonArg("packageNames", &packageNamesArg, true, false),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"packageType":"plugins","packageNames":[]}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"packageType":"plugins","packageNames":[]}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getBazaarPackageUserRatings", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetBazaarPackageUserRatings.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getBazaarPackageRating", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var pkgType, packageName string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("packageType", &pkgType, true, true),
				util.BindJsonArg("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"packageType":"plugins","packageName":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"packageType":"plugins","packageName":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getBazaarPackageRating", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetBazaarPackageRating.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("setBazaarPackageRating", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var pkgType, packageName string
			var ratingArg float64
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("packageType", &pkgType, true, true),
				util.BindJsonArg("packageName", &packageName, true, true),
				util.BindJsonArg("rating", &ratingArg, true, false),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"packageType":"plugins","packageName":" valid ","rating":3}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"packageType":"plugins","packageName":" valid ","rating":3}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/setBazaarPackageRating", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.SetBazaarPackageRating.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getBazaarPackageREADME", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var repoURL, repoHash, pkgType string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("repoURL", &repoURL, true, true),
				util.BindJsonArg("repoHash", &repoHash, true, true),
				util.BindJsonArg("packageType", &pkgType, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"repoURL":" valid ","repoHash":" valid ","packageType":"plugins"}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"repoURL":" valid ","repoHash":" valid ","packageType":"plugins"}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getBazaarPackageREADME", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetBazaarPackageREADME.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getBazaarPlugin", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("frontend", &frontend, true, true),
				util.BindJsonArg("keyword", &keyword, false, false),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"frontend":" valid ","keyword":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"frontend":" valid ","keyword":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getBazaarPlugin", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetBazaarPlugin.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getInstalledPlugin", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("frontend", &frontend, true, true),
				util.BindJsonArg("keyword", &keyword, false, false),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"frontend":" valid ","keyword":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"frontend":" valid ","keyword":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getInstalledPlugin", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetInstalledPlugin.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("installBazaarPlugin", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword, repoURL, repoHash, repoRef, packageName string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("frontend", &frontend, true, true),
				util.BindJsonArg("keyword", &keyword, false, false),
				util.BindJsonArg("repoURL", &repoURL, true, true),
				util.BindJsonArg("repoHash", &repoHash, true, true),
				util.BindJsonArg("repoRef", &repoRef, false, false),
				util.BindJsonArg("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"frontend":" valid ","keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"frontend":" valid ","keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/installBazaarPlugin", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.InstallBazaarPlugin.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("uninstallBazaarPlugin", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword, packageName string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("frontend", &frontend, false, false),
				util.BindJsonArg("keyword", &keyword, false, false),
				util.BindJsonArg("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"frontend":" valid ","keyword":" valid ","packageName":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"frontend":" valid ","keyword":" valid ","packageName":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/uninstallBazaarPlugin", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.UninstallBazaarPlugin.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getBazaarWidget", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"keyword":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"keyword":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getBazaarWidget", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetBazaarWidget.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getInstalledWidget", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"keyword":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"keyword":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getInstalledWidget", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetInstalledWidget.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("installBazaarWidget", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword, repoURL, repoHash, repoRef, packageName string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("keyword", &keyword, false, false),
				util.BindJsonArg("repoURL", &repoURL, true, true),
				util.BindJsonArg("repoHash", &repoHash, true, true),
				util.BindJsonArg("repoRef", &repoRef, false, false),
				util.BindJsonArg("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/installBazaarWidget", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.InstallBazaarWidget.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("uninstallBazaarWidget", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword, packageName string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("keyword", &keyword, false, false),
				util.BindJsonArg("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"keyword":" valid ","packageName":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"keyword":" valid ","packageName":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/uninstallBazaarWidget", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.UninstallBazaarWidget.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getBazaarIcon", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"keyword":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"keyword":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getBazaarIcon", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetBazaarIcon.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getInstalledIcon", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"keyword":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"keyword":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getInstalledIcon", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetInstalledIcon.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("installBazaarIcon", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword, repoURL, repoHash, repoRef, packageName string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("keyword", &keyword, false, false),
				util.BindJsonArg("repoURL", &repoURL, true, true),
				util.BindJsonArg("repoHash", &repoHash, true, true),
				util.BindJsonArg("repoRef", &repoRef, false, false),
				util.BindJsonArg("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/installBazaarIcon", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.InstallBazaarIcon.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("uninstallBazaarIcon", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword, packageName string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("keyword", &keyword, false, false),
				util.BindJsonArg("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"keyword":" valid ","packageName":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"keyword":" valid ","packageName":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/uninstallBazaarIcon", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.UninstallBazaarIcon.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getBazaarTemplate", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"keyword":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"keyword":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getBazaarTemplate", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetBazaarTemplate.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getInstalledTemplate", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"keyword":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"keyword":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getInstalledTemplate", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetInstalledTemplate.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("installBazaarTemplate", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword, repoURL, repoHash, repoRef, packageName string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("keyword", &keyword, false, false),
				util.BindJsonArg("repoURL", &repoURL, true, true),
				util.BindJsonArg("repoHash", &repoHash, true, true),
				util.BindJsonArg("repoRef", &repoRef, false, false),
				util.BindJsonArg("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/installBazaarTemplate", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.InstallBazaarTemplate.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("uninstallBazaarTemplate", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var keyword, packageName string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("keyword", &keyword, false, false),
				util.BindJsonArg("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"keyword":" valid ","packageName":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"keyword":" valid ","packageName":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/uninstallBazaarTemplate", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.UninstallBazaarTemplate.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getBazaarTheme", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("frontend", &frontend, false, false),
				util.BindJsonArg("keyword", &keyword, false, false),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"frontend":" valid ","keyword":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"frontend":" valid ","keyword":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getBazaarTheme", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetBazaarTheme.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("getInstalledTheme", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("frontend", &frontend, false, false),
				util.BindJsonArg("keyword", &keyword, false, false),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"frontend":" valid ","keyword":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"frontend":" valid ","keyword":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/getInstalledTheme", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.GetInstalledTheme.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("installBazaarTheme", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword, repoURL, repoHash, repoRef, packageName string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("frontend", &frontend, false, false),
				util.BindJsonArg("keyword", &keyword, false, false),
				util.BindJsonArg("repoURL", &repoURL, true, true),
				util.BindJsonArg("repoHash", &repoHash, true, true),
				util.BindJsonArg("repoRef", &repoRef, false, false),
				util.BindJsonArg("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"frontend":" valid ","keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"frontend":" valid ","keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/installBazaarTheme", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.InstallBazaarTheme.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
	t.Run("uninstallBazaarTheme", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := util.JsonArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword, packageName string
			if !util.ParseJsonArgs(arg, ret,
				util.BindJsonArg("frontend", &frontend, false, false),
				util.BindJsonArg("keyword", &keyword, false, false),
				util.BindJsonArg("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		base := map[string]json.RawMessage{}
		if err := json.Unmarshal([]byte(`{"frontend":" valid ","keyword":" valid ","packageName":" valid "}`), &base); err != nil {
			t.Fatal(err)
		}
		bodies := [][]byte{[]byte(`{"frontend":" valid ","keyword":" valid ","packageName":" valid "}`), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
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
			c.Request = httptest.NewRequest(http.MethodPost, "/api/bazaar/uninstallBazaarTheme", bytes.NewReader(body))
			expected := legacy(c)
			_, err := apicontract.UninstallBazaarTheme.Decode(bytes.NewReader(body))
			message := ""
			if err != nil {
				message = err.Error()
			}
			if message != expected.Msg {
				t.Errorf("body %s: got %q, want %q", body, message, expected.Msg)
			}
		}
	})
}

func TestBazaarContractTransportCompatibility(t *testing.T) {
	icon := ""
	enabled := false
	modes := []string{}
	pkg := &bazaar.Package{Author: "a", DisplayName: bazaar.LocaleStrings{"en_US": "name"}, Icon: &icon, Enabled: &enabled, Modes: &modes, Funding: &bazaar.Funding{Custom: []string{}, Links: []bazaar.FundingLink{{Label: "label", URL: "url"}}}, Rating: &bazaar.PackageRating{Average: 3.5, Count: 2, Distribution: [5]int64{0, 0, 1, 1, 0}}}
	appearance := conf.NewAppearance()
	appearance.DarkThemes = []*conf.AppearanceTheme{nil, {Name: "dark", Frontends: []string{"desktop"}}}
	appearance.Icons = []*conf.AppearanceIcon{{Name: "icon"}}
	appearance.BodyGradient = &conf.BodyGradient{Mode: "custom", Light: conf.BodyGradientColor{Color: "#000000", Opacity: 50}}
	appearance.EntryVisibility.Profiles = []*conf.EntryVisibilityProfile{nil, {ID: "custom", Orders: map[string][]string{"menu": {"item"}}}}
	appearance.GlobalFontFamilies = []*conf.EditorFont{nil, {Family: "serif", Weight: 500}}
	cases := [][2]interface{}{{pkg, bazaarPackage(pkg)}, {&bazaar.Package{}, bazaarPackage(&bazaar.Package{})}, {appearance, bazaarAppearance(appearance)}, {(*conf.Appearance)(nil), bazaarAppearance(nil)}, {[]*bazaar.Package{nil, pkg}, bazaarPackages([]*bazaar.Package{nil, pkg})}, {([]*bazaar.Package)(nil), bazaarPackages(nil)}, {[]*bazaar.Package{}, bazaarPackages([]*bazaar.Package{})}}
	for _, pair := range cases {
		left, _ := json.Marshal(pair[0])
		right, _ := json.Marshal(pair[1])
		if !bytes.Equal(left, right) {
			t.Fatalf("transport mismatch:\n%s\n%s", left, right)
		}
	}
}
func TestBazaarContractHTTPFailures(t *testing.T) {
	document, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, body string
		handler    gin.HandlerFunc
		code       int
		msg        string
	}{
		{"getBazaarPackageRatings", `{"packageType":"bad","packageNames":[null]}`, getBazaarPackageRatings, 1, "Invalid package type"},
		{"getBazaarPackageRatings", `{"packageType":"plugins","packageNames":[null]}`, getBazaarPackageRatings, -1, "Field [packageNames]: each element should be of type [String]"},
		{"setBazaarPackageRating", `{"packageType":"plugins","packageName":"valid","rating":2.5}`, setBazaarPackageRating, 1, "Rating must be an integer from 0 to 5"},
		{"installBazaarTheme", `{"repoURL":"url","repoHash":"hash","packageName":"name","mode":null}`, installBazaarTheme, -1, "Fields [mode] and [modeOS] must be provided together"},
		{"installBazaarTheme", `{"repoURL":"url","repoHash":"hash","packageName":"name","mode":null,"modeOS":false}`, installBazaarTheme, -1, "Field [mode] is required"},
		{"installBazaarTheme", `{"repoURL":"url","repoHash":"hash","packageName":"name","mode":2,"modeOS":false}`, installBazaarTheme, -1, "Field [mode] must be 0 or 1"},
	} {
		t.Run(test.name+test.body, func(t *testing.T) {
			engine := gin.New()
			path := "/api/bazaar/" + test.name
			engine.POST(path, test.handler)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(test.body)))
			var response struct {
				Code int
				Msg  string
				Data json.RawMessage
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Code != test.code || response.Msg != test.msg || string(response.Data) != "null" {
				t.Fatal(recorder.Body.String())
			}
			if err := document.ValidateHTTPResponse(http.MethodPost, path, recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestBazaarContractLocalUploadMissingFile(t *testing.T) {
	for _, multipartBody := range []bool{false, true} {
		t.Run(fmt.Sprint(multipartBody), func(t *testing.T) {
			var body bytes.Buffer
			contentType := "application/json"
			if multipartBody {
				writer := multipart.NewWriter(&body)
				writer.WriteField("frontend", "desktop")
				writer.Close()
				contentType = writer.FormDataContentType()
			}
			engine := gin.New()
			engine.POST("/upload", installLocalBazaarPackage)
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/upload", &body)
			request.Header.Set("Content-Type", contentType)
			engine.ServeHTTP(recorder, request)
			var result struct {
				Code int
				Msg  string
			}
			json.Unmarshal(recorder.Body.Bytes(), &result)
			if !reflect.DeepEqual(result, struct {
				Code int
				Msg  string
			}{1, "Marketplace package file is required"}) {
				t.Fatal(recorder.Body.String())
			}
		})
	}
}
