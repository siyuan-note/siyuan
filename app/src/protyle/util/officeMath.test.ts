import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {extractOfficeMathHTML} from "./officeMath";

describe("extractOfficeMathHTML", () => {
    it("extracts PowerPoint OMML before HTML sanitization", () => {
        const html = "<p><!--[if gte msEquation 12]><m:oMathPara><m:oMath><m:r><span>SNR</span></m:r></m:oMath></m:oMathPara><![endif]--><![if !msEquation]><span>SNR</span><![endif]></p>";
        assert.equal(extractOfficeMathHTML(html), "<m:oMathPara><m:oMath><m:r><span>SNR</span></m:r></m:oMath></m:oMathPara>");
    });

    it("ignores ordinary HTML", () => {
        assert.equal(extractOfficeMathHTML("<p>SNR</p>"), "");
    });
});
