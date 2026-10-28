import { $ } from "bun";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

type Notice = { license: string; text: string; usedBy: string[] };

const root = join(import.meta.dir, "..");
const out = join(root, "src-tauri/THIRD-PARTY-NOTICES.txt");

async function crateNotices(): Promise<Notice[]> {
  const about = await $`cargo about generate --format json --frozen`
    .cwd(join(root, "src-tauri"))
    .json();
  return about.licenses.map(
    (license: {
      id: string;
      text: string;
      used_by: { crate: { name: string; version: string } }[];
    }) => ({
      license: license.id,
      text: license.text,
      usedBy: license.used_by
        .filter(({ crate }) => crate.name !== "opentape")
        .map(({ crate }) => `${crate.name} ${crate.version}`),
    }),
  );
}

async function npmNotices(): Promise<Notice[]> {
  const byText = new Map<string, Notice>();
  const seen = new Set<string>();

  async function visit(name: string, from: string, deep: boolean) {
    let dir = from;
    while (!existsSync(join(dir, "node_modules", name, "package.json"))) {
      if (dir === root) return;
      dir = dirname(dir);
    }
    dir = join(dir, "node_modules", name);
    if (seen.has(dir)) return;
    seen.add(dir);
    const pkg = await Bun.file(join(dir, "package.json")).json();
    const file = readdirSync(dir).find((entry) =>
      /^(licen[cs]e|copying)/i.test(entry),
    );
    const text = file
      ? await Bun.file(join(dir, file)).text()
      : `Licensed under ${pkg.license}.`;
    const notice: Notice = byText.get(text.trim()) ?? {
      license: pkg.license,
      text,
      usedBy: [],
    };
    notice.usedBy.push(`${pkg.name} ${pkg.version}`);
    byText.set(text.trim(), notice);
    const deps = deep
      ? { ...pkg.dependencies, ...pkg.optionalDependencies }
      : {};
    for (const dep of Object.keys(deps)) await visit(dep, dir, true);
  }

  const app = await Bun.file(join(root, "package.json")).json();
  for (const dep of Object.keys(app.dependencies)) await visit(dep, root, true);
  const css = await Bun.file(join(root, "src/index.css")).text();
  for (const [, name] of css.matchAll(/@import "((?:@[^/"]+\/)?[^/".][^/"]*)/g))
    await visit(name, root, false);
  return [...byText.values()];
}

function section(title: string, notices: Notice[]) {
  const rule = "-".repeat(80);
  const body = notices.map(
    ({ license, text, usedBy }) =>
      `${rule}\n${license}\nUsed by: ${usedBy.sort().join(", ")}\n\n${text.trim()}\n`,
  );
  return `${"=".repeat(80)}\n${title}\n${"=".repeat(80)}\n\n${body.join("\n")}`;
}

const notices = [
  "Third-party notices for OpenTape",
  "",
  "OpenTape is MIT licensed (see LICENSE). It includes the open-source software below, whose licenses require these notices to ship with it. Each license text appears once, with the packages that use it. The bundled fonts, Space Grotesk and IBM Plex Mono, are under the SIL Open Font License in the npm section.",
  "",
  section("npm packages", await npmNotices()),
  section("Rust crates", await crateNotices()),
].join("\n");

await Bun.write(out, notices);
console.log(`Wrote ${out}`);
