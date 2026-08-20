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
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/bazaar"
)

func TestGetInstalledBazaarPackageRatingsFiltersOfficialPackages(t *testing.T) {
	oldInstalledPackageInfos := bazaarRatingInstalledPackageInfos
	oldExistingPackageNames := bazaarRatingExistingPackageNames
	oldPublicPackageRatings := bazaarRatingPublicPackageRatings
	t.Cleanup(func() {
		bazaarRatingInstalledPackageInfos = oldInstalledPackageInfos
		bazaarRatingExistingPackageNames = oldExistingPackageNames
		bazaarRatingPublicPackageRatings = oldPublicPackageRatings
	})

	bazaarRatingInstalledPackageInfos = func(string) ([]installedPackageInfo, string, string, error) {
		return []installedPackageInfo{
			{Pkg: &bazaar.Package{Name: "official-zero"}},
			{Pkg: &bazaar.Package{Name: "local-zip"}},
			{Pkg: &bazaar.Package{Name: "invalid", InvalidReason: bazaar.PackageInvalidReasonInvalidManifest}},
		}, "", "", nil
	}
	bazaarRatingExistingPackageNames = func(_ context.Context, pkgType string, packageNames []string) ([]string, error) {
		if "plugins" != pkgType {
			t.Fatalf("unexpected package type: %s", pkgType)
		}
		if want := []string{"official-zero", "local-zip"}; !slices.Equal(want, packageNames) {
			t.Fatalf("unexpected installed package names: %v", packageNames)
		}
		return []string{"official-zero"}, nil
	}
	bazaarRatingPublicPackageRatings = func(_ context.Context,
		packageNames []string) (map[string]*bazaar.PackageRating, bool) {
		if want := []string{"official-zero"}; !slices.Equal(want, packageNames) {
			t.Fatalf("unexpected eligible package names: %v", packageNames)
		}
		return map[string]*bazaar.PackageRating{}, true
	}

	ratings, eligiblePackageNames, err := GetInstalledBazaarPackageRatings(context.Background(), "plugins",
		[]string{"official-zero", "local-zip", "invalid", "missing", "official-zero"})
	if nil != err {
		t.Fatal(err)
	}
	if 0 != len(ratings) {
		t.Fatalf("zero-rating official package should not create a rating: %+v", ratings)
	}
	if want := []string{"official-zero"}; !slices.Equal(want, eligiblePackageNames) {
		t.Fatalf("unexpected eligible package names: %v", eligiblePackageNames)
	}
}

func TestGetInstalledBazaarPackageRatingsSkipsRatingsWithoutEligiblePackages(t *testing.T) {
	oldInstalledPackageInfos := bazaarRatingInstalledPackageInfos
	oldExistingPackageNames := bazaarRatingExistingPackageNames
	oldPublicPackageRatings := bazaarRatingPublicPackageRatings
	t.Cleanup(func() {
		bazaarRatingInstalledPackageInfos = oldInstalledPackageInfos
		bazaarRatingExistingPackageNames = oldExistingPackageNames
		bazaarRatingPublicPackageRatings = oldPublicPackageRatings
	})

	bazaarRatingInstalledPackageInfos = func(string) ([]installedPackageInfo, string, string, error) {
		return []installedPackageInfo{{Pkg: &bazaar.Package{Name: "local-zip"}}}, "", "", nil
	}
	bazaarRatingExistingPackageNames = func(context.Context, string, []string) ([]string, error) {
		return []string{}, nil
	}
	bazaarRatingPublicPackageRatings = func(context.Context,
		[]string) (map[string]*bazaar.PackageRating, bool) {
		t.Fatal("public ratings should not load when no requested package is eligible")
		return nil, false
	}

	ratings, eligiblePackageNames, err := GetInstalledBazaarPackageRatings(context.Background(), "plugins",
		[]string{"local-zip"})
	if nil != err || 0 != len(ratings) || 0 != len(eligiblePackageNames) {
		t.Fatalf("unexpected ineligible-only result: ratings=%v eligible=%v err=%v",
			ratings, eligiblePackageNames, err)
	}
}

func TestGetInstalledBazaarPackageUserRatings(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	oldUserToken := bazaarRatingUserToken
	oldInstalledPackageInfos := bazaarRatingInstalledPackageInfos
	oldExistingPackageNames := bazaarRatingExistingPackageNames
	t.Cleanup(func() {
		bazaarRatingCloudServer = oldServer
		bazaarRatingUserToken = oldUserToken
		bazaarRatingInstalledPackageInfos = oldInstalledPackageInfos
		bazaarRatingExistingPackageNames = oldExistingPackageNames
	})
	bazaarRatingUserToken = func() (string, error) { return "secret", nil }
	bazaarRatingInstalledPackageInfos = func(string) ([]installedPackageInfo, string, string, error) {
		return []installedPackageInfo{
			{Pkg: &bazaar.Package{Name: "rated"}},
			{Pkg: &bazaar.Package{Name: "unrated"}},
			{Pkg: &bazaar.Package{Name: "local-zip"}},
		}, "", "", nil
	}
	bazaarRatingExistingPackageNames = func(_ context.Context, pkgType string, packageNames []string) ([]string, error) {
		if "plugins" != pkgType || !slices.Equal([]string{"rated", "unrated", "local-zip"}, packageNames) {
			t.Fatalf("unexpected package filter: type=%s names=%v", pkgType, packageNames)
		}
		return []string{"rated", "unrated"}, nil
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/apis/siyuan/bazaar/getBazaarPackageRating" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		var body struct {
			Token       string `json:"token"`
			PackageName string `json:"packageName"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); nil != err {
			t.Fatal(err)
		}
		if "secret" != body.Token || ("rated" != body.PackageName && "unrated" != body.PackageName) {
			t.Fatalf("unexpected request body: %+v", body)
		}
		writer.Header().Set("Content-Type", "application/json")
		rating := 0
		if "rated" == body.PackageName {
			rating = 4
		}
		_, _ = fmt.Fprintf(writer, `{"code":0,"msg":"","data":{"rating":%d}}`, rating)
	}))
	defer server.Close()
	bazaarRatingCloudServer = func() string { return server.URL }

	userRatings, eligiblePackageNames, err := GetInstalledBazaarPackageUserRatings(context.Background(), "plugins",
		[]string{"rated", "unrated", "local-zip", "missing", "rated"})
	if nil != err {
		t.Fatal(err)
	}
	if !slices.Equal([]string{"rated", "unrated"}, eligiblePackageNames) ||
		4 != userRatings["rated"] || 0 != userRatings["unrated"] {
		t.Fatalf("unexpected user ratings: ratings=%v eligible=%v", userRatings, eligiblePackageNames)
	}
}

func TestGetInstalledBazaarPackageUserRatingsRejectsInvalidCloudData(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	oldUserToken := bazaarRatingUserToken
	oldInstalledPackageInfos := bazaarRatingInstalledPackageInfos
	oldExistingPackageNames := bazaarRatingExistingPackageNames
	t.Cleanup(func() {
		bazaarRatingCloudServer = oldServer
		bazaarRatingUserToken = oldUserToken
		bazaarRatingInstalledPackageInfos = oldInstalledPackageInfos
		bazaarRatingExistingPackageNames = oldExistingPackageNames
	})
	bazaarRatingUserToken = func() (string, error) { return "secret", nil }
	bazaarRatingInstalledPackageInfos = func(string) ([]installedPackageInfo, string, string, error) {
		return []installedPackageInfo{{Pkg: &bazaar.Package{Name: "rated"}}}, "", "", nil
	}
	bazaarRatingExistingPackageNames = func(context.Context, string, []string) ([]string, error) {
		return []string{"rated"}, nil
	}

	for _, response := range []string{
		`{"code":0,"msg":"","data":{"rating":-1}}`,
		`{"code":0,"msg":"","data":{"rating":6}}`,
	} {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(response))
		}))
		bazaarRatingCloudServer = func() string { return server.URL }
		if _, _, err := GetInstalledBazaarPackageUserRatings(context.Background(), "plugins",
			[]string{"rated"}); nil == err {
			server.Close()
			t.Fatalf("expected invalid cloud response to fail: %s", response)
		}
		server.Close()
	}
}

func TestGetInstalledBazaarPackageUserRatingsRejectsOversizedBatch(t *testing.T) {
	oldUserToken := bazaarRatingUserToken
	t.Cleanup(func() { bazaarRatingUserToken = oldUserToken })
	called := false
	bazaarRatingUserToken = func() (string, error) {
		called = true
		return "secret", nil
	}

	packageNames := make([]string, bazaarPackageRatingBatchSize+1)
	if _, _, err := GetInstalledBazaarPackageUserRatings(context.Background(), "plugins", packageNames); nil == err {
		t.Fatal("expected oversized batch to fail")
	}
	if called {
		t.Fatal("oversized batch should fail before loading the user token")
	}
}

func TestRequestBazaarPackageRating(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	t.Cleanup(func() { bazaarRatingCloudServer = oldServer })

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/apis/siyuan/bazaar/getBazaarPackageRating" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); nil != err {
			t.Fatal(err)
		}
		if body["token"] != "secret" || body["packageName"] != "sample" {
			t.Fatalf("unexpected request body: %+v", body)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"code":0,"msg":"","data":{"rating":4}}`))
	}))
	defer server.Close()
	bazaarRatingCloudServer = func() string { return server.URL }

	data := bazaarPackageUserRatingData{}
	err := requestBazaarPackageRating(context.Background(), "/apis/siyuan/bazaar/getBazaarPackageRating", map[string]any{
		"token":       "secret",
		"packageName": "sample",
	}, &data)
	if nil != err || 4 != data.Rating {
		t.Fatalf("unexpected response: data=%+v err=%v", data, err)
	}
}

func TestRequestBazaarPackageRatingStatus(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	oldConf := Conf
	t.Cleanup(func() {
		bazaarRatingCloudServer = oldServer
		Conf = oldConf
	})
	Conf = NewAppConf()
	Conf.Lang = "en"

	var status atomic.Int32
	status.Store(http.StatusUnauthorized)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(int(status.Load()))
	}))
	defer server.Close()
	bazaarRatingCloudServer = func() string { return server.URL }

	data := bazaarPackageUserRatingData{}
	if err := requestBazaarPackageRating(context.Background(), "/rating", map[string]any{}, &data); nil == err {
		t.Fatal("expected unauthorized request to fail")
	}
	status.Store(http.StatusTooManyRequests)
	err := requestBazaarPackageRating(context.Background(), "/rating", map[string]any{}, &data)
	if !errors.Is(err, ErrBazaarRatingRateLimited) {
		t.Fatalf("expected stable rate-limit error, got %v", err)
	}
}

func TestSetBazaarPackageRatingValidatesRangeBeforeRequest(t *testing.T) {
	oldValidator := bazaarRatingValidatePackage
	t.Cleanup(func() { bazaarRatingValidatePackage = oldValidator })
	called := false
	bazaarRatingValidatePackage = func(_ context.Context, _, _ string) (string, error) {
		called = true
		return "token", nil
	}

	if _, _, _, err := SetBazaarPackageRating(context.Background(), "plugins", "sample", -1); nil == err {
		t.Fatal("expected negative rating to fail")
	}
	if called {
		t.Fatal("invalid rating should fail before package validation or cloud request")
	}
}

func TestBazaarPackageRatingCloudResponseValidation(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	oldValidator := bazaarRatingValidatePackage
	t.Cleanup(func() {
		bazaarRatingCloudServer = oldServer
		bazaarRatingValidatePackage = oldValidator
	})
	bazaarRatingValidatePackage = func(_ context.Context, _, _ string) (string, error) { return "token", nil }

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"code":0,"msg":"","data":{"rating":6}}`))
	}))
	defer server.Close()
	bazaarRatingCloudServer = func() string { return server.URL }

	if _, _, _, err := GetBazaarPackageRating(context.Background(), "plugins", "sample"); nil == err {
		t.Fatal("expected invalid cloud rating to fail")
	}
}

func TestSetBazaarPackageRatingRejectsInvalidCloudDistribution(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	oldValidator := bazaarRatingValidatePackage
	t.Cleanup(func() {
		bazaarRatingCloudServer = oldServer
		bazaarRatingValidatePackage = oldValidator
	})
	bazaarRatingValidatePackage = func(_ context.Context, _, _ string) (string, error) { return "token", nil }

	for _, response := range []string{
		`{"code":0,"msg":"","data":{"rating":4,"distribution":[0,0,0,0,0]}}`,
		`{"code":0,"msg":"","data":{"rating":4,"distribution":[0,0,0,1]}}`,
		`{"code":0,"msg":"","data":{"rating":4,"distribution":[0,0,0,1,0,0]}}`,
	} {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(response))
		}))
		bazaarRatingCloudServer = func() string { return server.URL }
		if _, _, _, err := SetBazaarPackageRating(context.Background(), "plugins", "sample", 4); nil == err {
			server.Close()
			t.Fatalf("expected invalid cloud distribution to fail: %s", response)
		}
		server.Close()
	}
}

func TestSetBazaarPackageRatingRequest(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	oldValidator := bazaarRatingValidatePackage
	oldAfterUpdate := bazaarRatingAfterUpdate
	t.Cleanup(func() {
		bazaarRatingCloudServer = oldServer
		bazaarRatingValidatePackage = oldValidator
		bazaarRatingAfterUpdate = oldAfterUpdate
	})
	bazaarRatingValidatePackage = func(_ context.Context, _, _ string) (string, error) { return "secret", nil }
	bazaarRatingAfterUpdate = func(_ context.Context, region int, packageName string,
		distribution [5]int64) (*bazaar.PackageRating, bool) {
		if region < 0 || "sample" != packageName || ([5]int64{0, 0, 0, 1, 0}) != distribution {
			t.Fatalf("unexpected legacy rating update: region=%d package=%s distribution=%v",
				region, packageName, distribution)
		}
		return nil, false
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/apis/siyuan/bazaar/setBazaarPackageRating" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); nil != err {
			t.Fatal(err)
		}
		if body["token"] != "secret" || body["packageName"] != "sample" || body["rating"] != float64(4) {
			t.Fatalf("unexpected request body: %+v", body)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"code":0,"msg":"","data":{"rating":4,"ratingAvailable":false,"publicRating":null,"distribution":[0,0,0,1,0]}}`))
	}))
	defer server.Close()
	bazaarRatingCloudServer = func() string { return server.URL }

	_, ratingAvailable, userRating, err := SetBazaarPackageRating(context.Background(), "plugins", "sample", 4)
	if nil != err || 4 != userRating {
		t.Fatalf("unexpected set response: userRating=%d err=%v", userRating, err)
	}
	if ratingAvailable {
		t.Fatal("global rating should be unavailable before the other region is loaded")
	}
}

func TestSetBazaarPackageRatingUsesPublicRating(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	oldValidator := bazaarRatingValidatePackage
	t.Cleanup(func() {
		bazaarRatingCloudServer = oldServer
		bazaarRatingValidatePackage = oldValidator
	})
	bazaarRatingValidatePackage = func(_ context.Context, _, _ string) (string, error) { return "secret", nil }

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"code":0,"msg":"","data":{"rating":4,"ratingAvailable":true,"publicRating":{"average":4,"count":2,"distribution":[0,0,0,2,0]}}}`))
	}))
	defer server.Close()
	bazaarRatingCloudServer = func() string { return server.URL }

	rating, ratingAvailable, userRating, err := SetBazaarPackageRating(context.Background(), "plugins", "sample-public", 4)
	if nil != err || !ratingAvailable || 4 != userRating || nil == rating || 2 != rating.Count || 4 != rating.Average {
		t.Fatalf("unexpected public rating response: rating=%+v available=%v userRating=%d err=%v",
			rating, ratingAvailable, userRating, err)
	}
}

func TestSetBazaarPackageRatingRejectsInvalidPublicRating(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	oldValidator := bazaarRatingValidatePackage
	t.Cleanup(func() {
		bazaarRatingCloudServer = oldServer
		bazaarRatingValidatePackage = oldValidator
	})
	bazaarRatingValidatePackage = func(_ context.Context, _, _ string) (string, error) { return "secret", nil }

	for _, response := range []string{
		`{"code":0,"msg":"","data":{"rating":4,"ratingAvailable":true}}`,
		`{"code":0,"msg":"","data":{"rating":3,"ratingAvailable":true,"publicRating":{"average":4,"count":1,"distribution":[0,0,0,1,0]}}}`,
		`{"code":0,"msg":"","data":{"rating":4,"publicRating":{"average":4,"count":1,"distribution":[0,0,0,1,0]}}}`,
		`{"code":0,"msg":"","data":{"rating":4,"ratingAvailable":true,"publicRating":{"average":5,"count":1,"distribution":[0,0,0,1,0]}}}`,
		`{"code":0,"msg":"","data":{"rating":4,"ratingAvailable":true,"publicRating":{"average":5,"count":1,"distribution":[0,0,0,0,1]}}}`,
		`{"code":0,"msg":"","data":{"rating":4,"ratingAvailable":false,"publicRating":{"average":4,"count":1,"distribution":[0,0,0,1,0]}}}`,
	} {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(response))
		}))
		bazaarRatingCloudServer = func() string { return server.URL }
		if _, _, _, err := SetBazaarPackageRating(context.Background(), "plugins", "sample-invalid-public", 4); nil == err {
			server.Close()
			t.Fatalf("expected invalid public rating to fail: %s", response)
		}
		server.Close()
	}
}

func TestSetBazaarPackageRatingCancellationWithoutRemainingRatings(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	oldValidator := bazaarRatingValidatePackage
	t.Cleanup(func() {
		bazaarRatingCloudServer = oldServer
		bazaarRatingValidatePackage = oldValidator
	})
	bazaarRatingValidatePackage = func(_ context.Context, _, _ string) (string, error) { return "secret", nil }

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); nil != err {
			t.Error(err)
			return
		}
		if float64(0) != body["rating"] {
			t.Errorf("unexpected cancellation body: %+v", body)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"code":0,"msg":"","data":{"rating":0,"ratingAvailable":true,"publicRating":null}}`))
	}))
	defer server.Close()
	bazaarRatingCloudServer = func() string { return server.URL }

	rating, ratingAvailable, userRating, err := SetBazaarPackageRating(
		context.Background(), "plugins", "sample-cancel-last", 0)
	if nil != err || !ratingAvailable || 0 != userRating || nil != rating {
		t.Fatalf("unexpected last-rating cancellation response: rating=%+v available=%v userRating=%d err=%v",
			rating, ratingAvailable, userRating, err)
	}
}

func TestSetBazaarPackageRatingCancellationWithRemainingRatings(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	oldValidator := bazaarRatingValidatePackage
	t.Cleanup(func() {
		bazaarRatingCloudServer = oldServer
		bazaarRatingValidatePackage = oldValidator
	})
	bazaarRatingValidatePackage = func(_ context.Context, _, _ string) (string, error) { return "secret", nil }

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"code":0,"msg":"","data":{"rating":0,"ratingAvailable":true,"publicRating":{"average":4,"count":1,"distribution":[0,0,0,1,0]}}}`))
	}))
	defer server.Close()
	bazaarRatingCloudServer = func() string { return server.URL }

	rating, ratingAvailable, userRating, err := SetBazaarPackageRating(
		context.Background(), "plugins", "sample-cancel-remaining", 0)
	if nil != err || !ratingAvailable || 0 != userRating || nil == rating || 1 != rating.Count || 4 != rating.Average {
		t.Fatalf("unexpected cancellation response: rating=%+v available=%v userRating=%d err=%v",
			rating, ratingAvailable, userRating, err)
	}
}

func TestSetBazaarPackageRatingLegacyCancellation(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	oldValidator := bazaarRatingValidatePackage
	oldAfterUpdate := bazaarRatingAfterUpdate
	t.Cleanup(func() {
		bazaarRatingCloudServer = oldServer
		bazaarRatingValidatePackage = oldValidator
		bazaarRatingAfterUpdate = oldAfterUpdate
	})
	bazaarRatingValidatePackage = func(_ context.Context, _, _ string) (string, error) { return "secret", nil }
	bazaarRatingAfterUpdate = func(_ context.Context, _ int, packageName string,
		distribution [5]int64) (*bazaar.PackageRating, bool) {
		if "sample-cancel-legacy" != packageName || ([5]int64{}) != distribution {
			t.Fatalf("unexpected legacy cancellation: package=%s distribution=%v", packageName, distribution)
		}
		return nil, true
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"code":0,"msg":"","data":{"rating":0,"ratingAvailable":false,"publicRating":null,"distribution":[0,0,0,0,0]}}`))
	}))
	defer server.Close()
	bazaarRatingCloudServer = func() string { return server.URL }

	rating, ratingAvailable, userRating, err := SetBazaarPackageRating(
		context.Background(), "plugins", "sample-cancel-legacy", 0)
	if nil != err || !ratingAvailable || 0 != userRating || nil != rating {
		t.Fatalf("unexpected legacy cancellation response: rating=%+v available=%v userRating=%d err=%v",
			rating, ratingAvailable, userRating, err)
	}
}

func TestSetBazaarPackageRatingSerializesCloudResponses(t *testing.T) {
	oldServer := bazaarRatingCloudServer
	oldValidator := bazaarRatingValidatePackage
	t.Cleanup(func() {
		bazaarRatingCloudServer = oldServer
		bazaarRatingValidatePackage = oldValidator
	})
	bazaarRatingValidatePackage = func(_ context.Context, _, _ string) (string, error) { return "secret", nil }

	var active atomic.Int32
	var maxActive atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		current := active.Add(1)
		for {
			maximum := maxActive.Load()
			if current <= maximum || maxActive.CompareAndSwap(maximum, current) {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		active.Add(-1)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"code":0,"msg":"","data":{"rating":0,"ratingAvailable":true,"publicRating":null}}`))
	}))
	defer server.Close()
	bazaarRatingCloudServer = func() string { return server.URL }

	start := make(chan struct{})
	errorsCh := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			_, _, _, err := SetBazaarPackageRating(context.Background(), "plugins", "sample-cancel-serial", 0)
			errorsCh <- err
		}()
	}
	close(start)
	for range 2 {
		if err := <-errorsCh; nil != err {
			t.Fatal(err)
		}
	}
	if 1 != maxActive.Load() {
		t.Fatalf("rating submissions were not serialized: max concurrent requests=%d", maxActive.Load())
	}
}
