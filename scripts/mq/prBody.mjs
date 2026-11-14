const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const FENCE = /^\s*```/;
const TASK_FILE = /^docs\/tasks\/(?:0-archive\/)?[A-Z]\/([A-Z][0-9][0-9A-Za-z.]*)\.md$/;

export function landFooter(branch) {
  return `由 \`pnpm mq:land\` 从 \`${branch}\` 开出，CI 通过后自动合入。`;
}

export function unwrap(text) {
  const out = [];
  let fenced = false;
  for (const raw of text.replace(/\r\n/g, "\n").trim().split("\n")) {
    const line = raw.trimEnd();
    if (FENCE.test(line)) fenced = !fenced;
    const previous = out.at(-1);
    const joins = !fenced && !FENCE.test(line) && line.trim() && !LIST_ITEM.test(line) && !/^\s*#/.test(line)
      && previous && !FENCE.test(previous) && !previous.startsWith("#");
    if (joins) out[out.length - 1] = `${previous} ${line.trim()}`;
    else out.push(fenced || !line.trim() ? line : line.trimStart().replace(/^(\d+[.)]|[-*+])\s+/, "$1 "));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function taskIds(files) {
  return [...new Set(files.map((file) => TASK_FILE.exec(file.replaceAll("\\", "/"))?.[1]).filter(Boolean))].sort();
}

export function areas(files) {
  const groups = new Map();
  for (const file of files.map((name) => name.replaceAll("\\", "/"))) {
    const parts = file.split("/");
    const area = parts.length > 2 ? `${parts.slice(0, 2).join("/")}/` : parts.length === 2 ? `${parts[0]}/` : file;
    groups.set(area, (groups.get(area) ?? 0) + 1);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([area, count]) => (count > 1 ? `\`${area}\`（${count}）` : `\`${area}\``));
}

export function skeletonBody({ commits, files = [], branch }) {
  const tasks = taskIds(files);
  const notes = commits.filter(({ body }) => body.trim()).map(({ subject, body }) => `### ${subject}\n\n${unwrap(body)}`);
  return [
    "## 改了什么",
    "",
    "> land 时没有给中文说明（`pnpm mq:land --yes --body <文件>`），下面是从提交自动生成的。",
    "",
    ...commits.map(({ subject }) => `- \`${subject}\``),
    ...(files.length ? ["", "## 范围", "", areas(files).join("、")] : []),
    ...(tasks.length ? ["", "## 关联", "", `任务 ${tasks.join("、")}`] : []),
    ...(notes.length ? ["", "<details><summary>提交说明（英文）</summary>", "", notes.join("\n\n"), "", "</details>"] : []),
    "",
    "---",
    landFooter(branch),
  ].join("\n");
}

export function writtenBody(text, branch) {
  return `${text.replace(/\r\n/g, "\n").trim()}\n\n---\n${landFooter(branch)}`;
}
