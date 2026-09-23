import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

test("human and agent form submissions share results; agent receives tool output", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  let submit;
  let tool;
  const items = [];
  const list = { set innerHTML(value) { items.length = 0; }, append(item) { items.push(item.textContent); } };
  const form = { addEventListener(event, handler) { assert.equal(event, "submit"); submit = handler; } };
  const document = {
    querySelector(selector) { return selector === "form" ? form : selector === "#results" ? list : {}; },
    createElement() { return {}; },
    modelContext: { registerTool(value) { tool = value; } },
  };
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document, FormData: class { constructor(target) { this.target = target; } get() { return this.target.query; } },
  });
  let prevented = false;
  submit({ target: { query: "keyboard" }, preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(items.length, 1);
  let response;
  submit({ target: { query: "dock" }, agentInvoked: true, preventDefault() {}, respondWith(value) { response = value; } });
  assert.ok(response);
  const result = await response;
  assert.equal(JSON.parse(result.content[0].text)[0].sku, "DK-02");
  assert.deepEqual(JSON.parse(JSON.stringify(await tool.execute({ query: "dock" }))), JSON.parse(JSON.stringify(result)));
  submit({ target: { query: "not-a-product" }, agentInvoked: true, preventDefault() {}, respondWith(value) { response = value; } });
  assert.deepEqual(JSON.parse((await response).content[0].text), []);
});
