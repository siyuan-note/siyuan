package apicontract

import (
	"encoding/json"
	"testing"
)

func TestBazaarResponseVariants(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		path string
		body string
	}{
		{"getBazaarPackageRating", `{"code":0,"msg":"","data":{"ratingAvailable":false,"userRating":0}}`},
		{"getBazaarPackageRating", `{"code":0,"msg":"","data":{"ratingAvailable":true,"userRating":4,"rating":{"average":4,"count":1,"distribution":[0,0,0,1,0]}}}`},
		{"getBazaarPackageRating", `{"code":1,"msg":"limited","data":{"errorCode":"bazaarRatingRateLimited"}}`},
		{"getBazaarPackageUserRatings", `{"code":1,"msg":"pending","data":{"errorCode":"bazaarPackagePending"}}`},
		{"getBazaarPackageUserRatings", `{"code":0,"msg":"","data":{"userRatings":null,"eligiblePackageNames":[]}}`},
		{"installLocalBazaarPackage", `{"code":0,"msg":"","data":{"packageType":"plugins","packageName":"name","updated":false}}`},
		{"installLocalBazaarPackage", `{"code":1,"msg":"exists","data":{"reason":"package-exists","packageType":"plugins","packageName":"name","minAppVersion":""}}`},
	} {
		if err := bundle.ValidateResponse("POST", "/api/bazaar/"+test.path, []byte(test.body)); err != nil {
			t.Errorf("%s: %v", test.body, err)
		}
	}
	for _, body := range []string{
		`{"code":0,"msg":"","data":null}`,
		`{"code":0,"msg":"","data":{"ratingAvailable":true,"userRating":1,"rating":{"average":1,"count":1,"distribution":[1]}}}`,
		`{"code":0,"msg":"","data":{"ratingAvailable":true,"userRating":1,"rating":{"average":1,"count":1,"distribution":null}}}`,
		`{"code":1,"msg":"","data":{"errorCode":"unknown"}}`,
	} {
		if err := bundle.ValidateResponse("POST", "/api/bazaar/getBazaarPackageRating", []byte(body)); err == nil {
			t.Errorf("unexpected accepted response %s", body)
		}
	}
	if _, err := json.Marshal(BazaarRatingResult{}); err == nil {
		t.Fatal("unset rating response variant accepted")
	}
}
