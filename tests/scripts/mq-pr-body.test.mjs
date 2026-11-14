import assert from "node:assert/strict";
import test from "node:test";
import { areas, skeletonBody, taskIds, unwrap, writtenBody } from "../../scripts/mq/prBody.mjs";

test("hard-wrapped commit text is joined back into paragraphs and list items, code fences stay as written", () => {
  const body = [
    "The last names that users touch:",
    "",
    "- QQ repair backs up to the data folder",
    "  (not the install folder) instead of FocuSD.",
    "- Signing keys: one helper",
    "  picks the folder.",
    "",
    "```",
    "pnpm verify",
    "  indented",
    "```",
    "Verified on",
    "Windows.",
  ].join("\r\n");
  assert.equal(unwrap(body), [
    "The last names that users touch:",
    "",
    "- QQ repair backs up to the data folder (not the install folder) instead of FocuSD.",
    "- Signing keys: one helper picks the folder.",
    "",
    "```",
    "pnpm verify",
    "  indented",
    "```",
    "Verified on Windows.",
  ].join("\n"));
  assert.equal(unwrap("## Heading\nline one\nline two"), "## Heading\nline one line two");
});

test("tasks touched by the lane and the areas it changed are read from the file list", () => {
  const files = ["docs/tasks/0-archive/D/D31.md", "docs/tasks/F/F31.md", "docs/tasks/README.md", "scripts/mq/land.mjs", "scripts/mq/prBody.mjs", "tests/scripts/mq.test.mjs", "package.json"];
  assert.deepEqual(taskIds(files), ["D31", "F31"]);
  assert.deepEqual(areas(files), ["`docs/tasks/`（3）", "`package.json`", "`scripts/mq/`（2）", "`tests/scripts/`"]);
});

test("without a written body the PR gets a Chinese skeleton, the English commit notes folded away", () => {
  const body = skeletonBody({
    commits: [{ subject: "fix(a): one", body: "Because it\nbroke.\n" }, { subject: "docs: two", body: "" }],
    files: ["scripts/a.mjs", "docs/tasks/D/D9.md"],
    branch: "lane/3",
  });
  assert.equal(body, [
    "## 改了什么",
    "",
    "> land 时没有给中文说明（`pnpm mq:land --yes --body <文件>`），下面是从提交自动生成的。",
    "",
    "- `fix(a): one`",
    "- `docs: two`",
    "",
    "## 范围",
    "",
    "`docs/tasks/`、`scripts/`",
    "",
    "## 关联",
    "",
    "任务 D9",
    "",
    "<details><summary>提交说明（英文）</summary>",
    "",
    "### fix(a): one",
    "",
    "Because it broke.",
    "",
    "</details>",
    "",
    "---",
    "由 `pnpm mq:land` 从 `lane/3` 开出，CI 通过后自动合入。",
  ].join("\n"));
});

test("a written body is kept as given, with the land footer under a rule", () => {
  assert.equal(writtenBody("\r\n## 改了什么\r\n\r\n- 一\r\n\r\n", "lane/1"), "## 改了什么\n\n- 一\n\n---\n由 `pnpm mq:land` 从 `lane/1` 开出，CI 通过后自动合入。");
});
