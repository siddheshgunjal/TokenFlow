import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const demoRoot = join(repoRoot, "website/src/demo");

// These files are ported verbatim from the app. `Sidebar.tsx` is deliberately
// excluded because the website adds a `settingsDisabled` prop.
const componentNames = [
  "ActivityHeatmap",
  "BalanceChart",
  "DayDetailPanel",
  "DeepSeekCard",
  "HourlyUsageChart",
  "Icons",
  "Logo",
  "ModelBreakdown",
  "RecentRequests",
  "SelectDropdown",
  "StatCard",
];

const pairs = [
  ["src/lib/mock.ts", "website/src/demo/lib/mock.ts"],
  ["src/lib/types.ts", "website/src/demo/lib/types.ts"],
  ["src/lib/format.ts", "website/src/demo/lib/format.ts"],
  ["src/lib/modelColors.ts", "website/src/demo/lib/modelColors.ts"],
  ["src/lib/useDayUsageDetail.ts", "website/src/demo/lib/useDayUsageDetail.ts"],
  ["src/pages/Dashboard.tsx", "website/src/demo/pages/Dashboard.tsx"],
  ...componentNames.map((name) => [
    `src/components/${name}.tsx`,
    `website/src/demo/components/${name}.tsx`,
  ]),
];

let failures = 0;

for (const [appRelative, demoRelative] of pairs) {
  const appSource = readFileSync(join(repoRoot, appRelative), "utf8");
  const demoSource = readFileSync(join(repoRoot, demoRelative), "utf8");

  if (appSource !== demoSource) {
    console.error(
      `demo:check failed: ${demoRelative} differs from ${appRelative}.`,
    );
    console.error(
      "Re-copy the app file into the website, preserving demo-only overrides.",
    );
    failures += 1;
  }
}

const forbidden = ["@tauri-apps/", "src/lib/api", "src/lib/useCoreSnapshot"];
const forbiddenSource = /from\s+["'][^"']*\/src\//;

for (const file of walk(demoRoot)) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  const label = relative(repoRoot, file);

  for (const token of forbidden) {
    if (text.includes(token)) {
      console.error(`demo:check failed: ${label} references ${token}.`);
      failures += 1;
    }
  }

  if (forbiddenSource.test(text)) {
    console.error(
      `demo:check failed: ${label} imports from the app source tree.`,
    );
    failures += 1;
  }
}

if (failures > 0) process.exit(1);

console.log(
  "demo:check passed: ported demo files are in sync and demo imports are isolated.",
);

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}
