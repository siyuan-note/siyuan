// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var frontend string
			if !legacyParseArgs(arg, ret, legacyBind("frontend", &frontend, true, true)) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/batchUpdatePackage", `{"frontend":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.BatchUpdatePackage.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getUpdatedPackage", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var frontend string
			if !legacyParseArgs(arg, ret, legacyBind("frontend", &frontend, true, true)) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getUpdatedPackage", `{"frontend":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetUpdatedPackage.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("updateBazaarPackage", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var pkgType, packageName, frontend, keyword string
			if !legacyParseArgs(arg, ret,
				legacyBind("packageType", &pkgType, true, true),
				legacyBind("packageName", &packageName, true, true),
				legacyBind("frontend", &frontend, true, true),
				legacyBind("keyword", &keyword, false, false),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/updateBazaarPackage", `{"packageType":"plugins","packageName":" valid ","frontend":" valid ","keyword":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.UpdateBazaarPackage.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getInstalledPackageSize", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var pkgType, packageName string
			if !legacyParseArgs(arg, ret,
				legacyBind("packageType", &pkgType, true, true),
				legacyBind("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getInstalledPackageSize", `{"packageType":"plugins","packageName":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetInstalledPackageSize.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getBazaarPackage", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var pkgType, packageName, frontend string
			if !legacyParseArgs(arg, ret,
				legacyBind("packageType", &pkgType, true, true),
				legacyBind("packageName", &packageName, true, true),
				legacyBind("frontend", &frontend, false, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getBazaarPackage", `{"packageType":"plugins","packageName":" valid ","frontend":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetBazaarPackage.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getBazaarPackageRatings", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var pkgType string
			var packageNamesArg []any
			if !legacyParseArgs(arg, ret,
				legacyBind("packageType", &pkgType, true, true),
				legacyBind("packageNames", &packageNamesArg, true, false),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getBazaarPackageRatings", `{"packageType":"plugins","packageNames":[]}`, legacy, func(body []byte) error {
			_, err := apicontract.GetBazaarPackageRatings.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getBazaarPackageUserRatings", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var pkgType string
			var packageNamesArg []any
			if !legacyParseArgs(arg, ret,
				legacyBind("packageType", &pkgType, true, true),
				legacyBind("packageNames", &packageNamesArg, true, false),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getBazaarPackageUserRatings", `{"packageType":"plugins","packageNames":[]}`, legacy, func(body []byte) error {
			_, err := apicontract.GetBazaarPackageUserRatings.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getBazaarPackageRating", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var pkgType, packageName string
			if !legacyParseArgs(arg, ret,
				legacyBind("packageType", &pkgType, true, true),
				legacyBind("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getBazaarPackageRating", `{"packageType":"plugins","packageName":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetBazaarPackageRating.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("setBazaarPackageRating", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var pkgType, packageName string
			var ratingArg float64
			if !legacyParseArgs(arg, ret,
				legacyBind("packageType", &pkgType, true, true),
				legacyBind("packageName", &packageName, true, true),
				legacyBind("rating", &ratingArg, true, false),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/setBazaarPackageRating", `{"packageType":"plugins","packageName":" valid ","rating":3}`, legacy, func(body []byte) error {
			_, err := apicontract.SetBazaarPackageRating.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getBazaarPackageREADME", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var repoURL, repoHash, pkgType string
			if !legacyParseArgs(arg, ret,
				legacyBind("repoURL", &repoURL, true, true),
				legacyBind("repoHash", &repoHash, true, true),
				legacyBind("packageType", &pkgType, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getBazaarPackageREADME", `{"repoURL":" valid ","repoHash":" valid ","packageType":"plugins"}`, legacy, func(body []byte) error {
			_, err := apicontract.GetBazaarPackageREADME.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getBazaarPlugin", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword string
			if !legacyParseArgs(arg, ret,
				legacyBind("frontend", &frontend, true, true),
				legacyBind("keyword", &keyword, false, false),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getBazaarPlugin", `{"frontend":" valid ","keyword":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetBazaarPlugin.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getInstalledPlugin", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword string
			if !legacyParseArgs(arg, ret,
				legacyBind("frontend", &frontend, true, true),
				legacyBind("keyword", &keyword, false, false),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getInstalledPlugin", `{"frontend":" valid ","keyword":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetInstalledPlugin.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("installBazaarPlugin", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword, repoURL, repoHash, repoRef, packageName string
			if !legacyParseArgs(arg, ret,
				legacyBind("frontend", &frontend, true, true),
				legacyBind("keyword", &keyword, false, false),
				legacyBind("repoURL", &repoURL, true, true),
				legacyBind("repoHash", &repoHash, true, true),
				legacyBind("repoRef", &repoRef, false, false),
				legacyBind("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/installBazaarPlugin", `{"frontend":" valid ","keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.InstallBazaarPlugin.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("uninstallBazaarPlugin", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword, packageName string
			if !legacyParseArgs(arg, ret,
				legacyBind("frontend", &frontend, false, false),
				legacyBind("keyword", &keyword, false, false),
				legacyBind("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/uninstallBazaarPlugin", `{"frontend":" valid ","keyword":" valid ","packageName":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.UninstallBazaarPlugin.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getBazaarWidget", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			if !legacyParseArgs(arg, ret, legacyBind("keyword", &keyword, false, false)) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getBazaarWidget", `{"keyword":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetBazaarWidget.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getInstalledWidget", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			if !legacyParseArgs(arg, ret, legacyBind("keyword", &keyword, false, false)) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getInstalledWidget", `{"keyword":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetInstalledWidget.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("installBazaarWidget", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var keyword, repoURL, repoHash, repoRef, packageName string
			if !legacyParseArgs(arg, ret,
				legacyBind("keyword", &keyword, false, false),
				legacyBind("repoURL", &repoURL, true, true),
				legacyBind("repoHash", &repoHash, true, true),
				legacyBind("repoRef", &repoRef, false, false),
				legacyBind("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/installBazaarWidget", `{"keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.InstallBazaarWidget.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("uninstallBazaarWidget", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var keyword, packageName string
			if !legacyParseArgs(arg, ret,
				legacyBind("keyword", &keyword, false, false),
				legacyBind("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/uninstallBazaarWidget", `{"keyword":" valid ","packageName":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.UninstallBazaarWidget.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getBazaarIcon", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			if !legacyParseArgs(arg, ret, legacyBind("keyword", &keyword, false, false)) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getBazaarIcon", `{"keyword":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetBazaarIcon.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getInstalledIcon", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			if !legacyParseArgs(arg, ret, legacyBind("keyword", &keyword, false, false)) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getInstalledIcon", `{"keyword":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetInstalledIcon.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("installBazaarIcon", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var keyword, repoURL, repoHash, repoRef, packageName string
			if !legacyParseArgs(arg, ret,
				legacyBind("keyword", &keyword, false, false),
				legacyBind("repoURL", &repoURL, true, true),
				legacyBind("repoHash", &repoHash, true, true),
				legacyBind("repoRef", &repoRef, false, false),
				legacyBind("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/installBazaarIcon", `{"keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.InstallBazaarIcon.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("uninstallBazaarIcon", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var keyword, packageName string
			if !legacyParseArgs(arg, ret,
				legacyBind("keyword", &keyword, false, false),
				legacyBind("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/uninstallBazaarIcon", `{"keyword":" valid ","packageName":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.UninstallBazaarIcon.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getBazaarTemplate", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			if !legacyParseArgs(arg, ret, legacyBind("keyword", &keyword, false, false)) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getBazaarTemplate", `{"keyword":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetBazaarTemplate.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getInstalledTemplate", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var keyword string
			if !legacyParseArgs(arg, ret, legacyBind("keyword", &keyword, false, false)) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getInstalledTemplate", `{"keyword":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetInstalledTemplate.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("installBazaarTemplate", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var keyword, repoURL, repoHash, repoRef, packageName string
			if !legacyParseArgs(arg, ret,
				legacyBind("keyword", &keyword, false, false),
				legacyBind("repoURL", &repoURL, true, true),
				legacyBind("repoHash", &repoHash, true, true),
				legacyBind("repoRef", &repoRef, false, false),
				legacyBind("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/installBazaarTemplate", `{"keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.InstallBazaarTemplate.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("uninstallBazaarTemplate", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var keyword, packageName string
			if !legacyParseArgs(arg, ret,
				legacyBind("keyword", &keyword, false, false),
				legacyBind("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/uninstallBazaarTemplate", `{"keyword":" valid ","packageName":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.UninstallBazaarTemplate.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getBazaarTheme", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword string
			if !legacyParseArgs(arg, ret,
				legacyBind("frontend", &frontend, false, false),
				legacyBind("keyword", &keyword, false, false),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getBazaarTheme", `{"frontend":" valid ","keyword":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetBazaarTheme.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("getInstalledTheme", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword string
			if !legacyParseArgs(arg, ret,
				legacyBind("frontend", &frontend, false, false),
				legacyBind("keyword", &keyword, false, false),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/getInstalledTheme", `{"frontend":" valid ","keyword":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.GetInstalledTheme.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("installBazaarTheme", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword, repoURL, repoHash, repoRef, packageName string
			if !legacyParseArgs(arg, ret,
				legacyBind("frontend", &frontend, false, false),
				legacyBind("keyword", &keyword, false, false),
				legacyBind("repoURL", &repoURL, true, true),
				legacyBind("repoHash", &repoHash, true, true),
				legacyBind("repoRef", &repoRef, false, false),
				legacyBind("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/installBazaarTheme", `{"frontend":" valid ","keyword":" valid ","repoURL":" valid ","repoHash":" valid ","repoRef":" valid ","packageName":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.InstallBazaarTheme.Decode(bytes.NewReader(body))
			return err
		})
	})
	t.Run("uninstallBazaarTheme", func(t *testing.T) {
		legacy := func(c *gin.Context) (result *gulu.Result) {
			ret := gulu.Ret.NewResult()
			defer func() { result = ret }()

			arg, ok := legacyJSONArg(c, ret)
			if !ok {
				return
			}

			var frontend, keyword, packageName string
			if !legacyParseArgs(arg, ret,
				legacyBind("frontend", &frontend, false, false),
				legacyBind("keyword", &keyword, false, false),
				legacyBind("packageName", &packageName, true, true),
			) {
				return
			}
			return
		}
		checkLegacyInputCompatibility(t, "/api/bazaar/uninstallBazaarTheme", `{"frontend":" valid ","keyword":" valid ","packageName":" valid "}`, legacy, func(body []byte) error {
			_, err := apicontract.UninstallBazaarTheme.Decode(bytes.NewReader(body))
			return err
		})
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
	cases := [][2]any{{pkg, bazaarPackage(pkg)}, {&bazaar.Package{}, bazaarPackage(&bazaar.Package{})}, {appearance, bazaarAppearance(appearance)}, {(*conf.Appearance)(nil), bazaarAppearance(nil)}, {[]*bazaar.Package{nil, pkg}, bazaarPackages([]*bazaar.Package{nil, pkg})}, {([]*bazaar.Package)(nil), bazaarPackages(nil)}, {[]*bazaar.Package{}, bazaarPackages([]*bazaar.Package{})}}
	for _, pair := range cases {
		left, _ := json.Marshal(pair[0])
		right, _ := json.Marshal(pair[1])
		if !bytes.Equal(left, right) {
			t.Fatalf("transport mismatch:\n%s\n%s", left, right)
		}
	}
}

func TestBazaarContractAppearanceTransportCompatibility(t *testing.T) {
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name       string
		appearance *conf.Appearance
	}{
		{"nil", nil},
		{"zero", &conf.Appearance{}},
		{"defaults", conf.NewAppearance()},
		{"configured", &conf.Appearance{
			CompactMode:              true,
			MenuMouseScroll:          true,
			PDFTheme:                 &conf.PDFTheme{Light: "dark", Dark: "light", AnnoColor: "#abcdef"},
			OutlineKeepCurrentExpand: true,
			MobileBars:               &conf.MobileBars{AutoHide: new(false), SidebarSwipe: new(true)},
		}},
		{"disabled", &conf.Appearance{
			PDFTheme:   &conf.PDFTheme{},
			MobileBars: &conf.MobileBars{AutoHide: new(false), SidebarSwipe: new(false), SidebarButtons: new(false)},
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload := bazaarAppearance(test.appearance)
			expected, err := json.Marshal(test.appearance)
			if err != nil {
				t.Fatal(err)
			}
			actual, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(actual, expected) {
				t.Fatalf("appearance transport mismatch:\ngot  %s\nwant %s", actual, expected)
			}
			response, err := json.Marshal(apicontract.Success(apicontract.BazaarAppearancePackagesData{Appearance: payload}))
			if err != nil {
				t.Fatal(err)
			}
			for _, endpoint := range []string{"installBazaarIcon", "uninstallBazaarIcon", "installBazaarTheme", "uninstallBazaarTheme"} {
				if err := bundle.ValidateResponse(http.MethodPost, "/api/bazaar/"+endpoint, response); err != nil {
					t.Errorf("%s: %v", endpoint, err)
				}
			}
		})
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
