import { test } from "node:test";
import assert from "node:assert/strict";
const baseURL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
test("public website and genuine authentication forms render", async (t) => {
  for (const path of ["/", "/login", "/register"]) {
    await t.test(path, async () => {
      const response = await fetch(new URL(path, baseURL));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      const html = await response.text();
      assert.match(html, /FlowPilot/);
      assert.match(html, /<html lang="en"/);
      assert.match(html, /id="main"/);
      if (path === "/")
        for (const section of ["features", "how-it-works", "pricing"])
          assert.match(html, new RegExp(`id="${section}"`));
      else {
        assert.match(html, /type="email"/);
        assert.match(html, /type="password"/);
        assert.match(html, /for="email"/);
        assert.match(html, /for="password"/);
      }
    });
  }
});
