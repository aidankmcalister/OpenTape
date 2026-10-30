# Contributing

Thanks for wanting to help. The project is early, so bug reports with clear steps and small fixes help most right now.

## Talk first

For a bug, open an issue with the bug template. For an idea or a bigger change, open an issue before writing code so we can agree on the approach. A pull request that arrives without a discussion might not fit the plan.

## Set up

You need:

- macOS 15 or later. The capture code is built against macOS 15 APIs (`macos_15_0` in `src-tauri/Cargo.toml`). It's developed and tested on macOS 26 on Apple silicon.
- Xcode Command Line Tools: `xcode-select --install`.
- Rust, through [rustup](https://rustup.rs). The crate uses the 2024 edition, so you need Rust 1.85 or later.
- [bun](https://bun.sh).
- [cargo-about](https://github.com/EmbarkStudios/cargo-about), only for `tauri build`: `cargo install cargo-about --locked --features cli`.

Then run it:

```sh
bun install
bun tauri dev
```

The app opens to the record bar at the bottom of your screen, with an icon in the menu bar. There's no main window; clicking the Dock icon or New recording in the menu brings the record bar back.

To work on the editor without recording first, run `bun run dev:editor`. It opens `~/Downloads/OpenTape test clip/recording.mov`, with the `events.jsonl` and `meta.json` beside it if they're there. `EDIT_VIDEO=latest bun run dev:editor` opens the newest video in Downloads instead, and `EDIT_VIDEO=/path/to/video.mp4 bun run dev:editor` opens any video.

To test anything involving permissions, build a debug app instead with `bun tauri build --debug`. It's signed with a local certificate named `screen-recorder dev` (`bundle.macOS.signingIdentity` in `src-tauri/tauri.conf.json`), so macOS keeps your permission between rebuilds. Make a self-signed code-signing certificate with that name in Keychain Access, or change the field. `bun tauri build` makes the app in `src-tauri/target/release/bundle/macos/`.

## Check it

Before opening a pull request, run:

```sh
bun run check
```

It must pass. It runs `tsc`, ESLint, Prettier, `bun test`, `cargo fmt`, Clippy, `cargo test`, and a guard that fails if the generated bindings are stale. Smaller scripts: `bun run lint`, `bun run test`, `bun run format`.

Every `tauri build` regenerates `src-tauri/THIRD-PARTY-NOTICES.txt`, the license notices of the npm packages, Rust crates and fonts that ship in the app, and bundles it. Run `bun run notices` after changing dependencies and commit the result.

The TypeScript types in `src/lib/bindings.ts` are generated from the Rust types by ts-rs. After you change a Rust type the frontend uses, run `bun run bindings` and commit the result.

## Permissions

- Screen Recording. On first launch a permissions window opens with a button for each permission. macOS applies Screen Recording only to a new process, so once it's on the window offers Restart OpenTape. Under `bun tauri dev`, macOS asks on behalf of your terminal app instead of OpenTape.
- Microphone. The permissions window asks for it, or macOS asks the first time you record with one chosen in the record bar. If you say no, the recording goes ahead without it, and the bar says Microphone access is off. System audio needs nothing more than Screen Recording.
- Nothing else. The cursor log polls the cursor position and shape. It also reads macOS's count of key presses to note when a key was pressed (only the time, never which key), so the editor can suggest zooms and speed-ups where you typed. None of it needs Accessibility or Input Monitoring permission, and it stays with the recording on your Mac.

## Where things go

A recording waits in a hidden folder (`~/Library/Application Support/com.aidankmcalister.opentape/recordings/`) only while the preview or editor shows it. Save in the preview, or Export in the editor, puts a file in `~/Downloads` (or the folder chosen in Settings). Closing either window deletes the hidden copy, and asks first if nothing was saved. If the app crashes, the next launch keeps the last recording quietly. Restore previous recording, in the record bar's gear menu or the menu bar menu, opens it in the preview so it can still be saved, and a new recording replaces it. Quitting while recording stops the recording the way Stop does.

Warnings, errors and crashes go to a small log, `~/Library/Logs/com.aidankmcalister.opentape/OpenTape.log`, that stays on your Mac.

## How the code is laid out

```
src/                     the frontend (React, TypeScript, Tailwind)
  main.tsx               one entry for every window; picks a page by window label
  pages/                 one page per window: RecordBar, Picker, RecordingPreview, Editor, Settings, Permissions
  components/            looks: shared ones at the top (Pill, MorphPill)
    ui/                  shadcn components on Base UI
    picker/ editor/ …    pieces that belong to one window
  hooks/                 state: shared hooks at the top (Tauri events, pointer hover, morph)
    bar/ picker/ …       hooks that belong to one window
  lib/                   logic: shared at the top (geometry, time) and bindings.ts, generated from Rust
    bar/ picker/ …       logic that belongs to one window, with its tests; editor/ splits the editor by concept: appearance, cursor, clips, regions, zoom, sound, playback, export, project

src-tauri/src/           the Rust side
  lib.rs                 entry point: state, window setup, page events, system-wide keys, the command list
  recording.rs           the recording status, start, pause, restart, stop
  current_recording.rs   the recording you just made: save, copy, edit, close, and which window shows
  capture/               ScreenCaptureKit capture to a crash-safe .mov, the pause timeline, the cursor log
  export/                the editor's export: framing, zoom, cursor, click rings, sound mix, and typing spots
  stage.rs               the stage's frames and sound, read from the recording
  picker/                the picker session, its sources and the overlay windows
  windows/               the record bar, preview and editor windows; floating.rs shows, hides and places them
  macos/                 AppKit wrappers: main thread, panels, alerts, and the glass
  geometry.rs            points and rectangles, top-left and bottom-left
  settings.rs            app settings (settings.json) and the Settings window
  permissions.rs         Screen Recording and microphone access, and the permissions window
  update.rs              checks for, downloads and installs updates
  tray.rs                the menu-bar icon and its menu
  util.rs                small shared helpers and the error type commands return
```

[GLOSSARY.md](GLOSSARY.md) names things. Use those names in code, issues and pull requests. A few rules keep the code easy to change:

- Logic, state and looks live in separate folders: `lib/name.ts` is plain logic, `hooks/useName.ts` holds React state, and `components/Name.tsx` or `pages/Name.tsx` decides how it looks. Components never call Rust directly, so a redesign only touches `pages/` and `components/`.
- The top of `components/`, `hooks/` and `lib/` is shared by every window. A subfolder (`bar`, `picker`, `preview`, `editor`) belongs to one window. Import with `@/…` between folders and `./…` inside one.
- Colors and sizes come only from the design tokens in `src/index.css`. ESLint rejects raw colors and pixel font sizes in class names.
- Rust stays small and handles only what needs the OS: capture, windows and files. Everything else goes in TypeScript.

## Pull requests

- Keep each one to a single change, with a title that says what it does, in the [Conventional Commits](https://www.conventionalcommits.org) style: `feat:`, `fix:`, `refactor:`, `perf:`, `docs:`, `test:`, `ci:` or `chore:`, then a short lowercase summary.
- Say how you tested it. Most changes need you to run the app, since screen capture can't run in CI.
- Don't commit recordings or anything from `temp/`.

## Releasing

For maintainers. Set the new version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, commit, then push a matching tag:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The release workflow builds a signed, notarized `OpenTape.dmg` for Apple silicon, plus the signed updater archive and `latest.json` that installed copies check, and attaches them to a draft release. Read the notes, then publish it. It needs the `APPLE_*` and `TAURI_SIGNING_PRIVATE_KEY*` repository secrets.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE), the same as the project. There's no CLA.
