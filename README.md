<div align="center">
  <img src=".github/logo.svg" width="120" alt="OpenTape logo"/>

  <h1>OpenTape</h1>

  <p>A free, open-source screen recorder for macOS. Pick what to record, hit stop, and share the clip.</p>

  [![License: MIT](https://img.shields.io/badge/license-MIT-D1440D?style=flat&colorA=18181C)](LICENSE)
  [![macOS 15+](https://img.shields.io/badge/macOS-15%2B-D1440D?style=flat&colorA=18181C)](#install)
  [![Built with Tauri](https://img.shields.io/badge/built_with-Tauri_2-D1440D?style=flat&colorA=18181C)](https://tauri.app)

  <p>
    <a href="https://github.com/aidankmcalister/OpenTape/issues">Issues</a>
    ·
    <a href="CONTRIBUTING.md">Contributing</a>
  </p>
</div>

## What it does

Pick a display, window or area from a floating bar and hit Record. When you stop, a preview opens: copy the clip straight into a post, save it, or open it in the editor. Along the way, OpenTape suggests zooms where you clicked and smooths the cursor. Made for demos, READMEs, pull requests and posts.

- **Record** a display, a window or an area, with the microphone and system audio.
- **Auto zoom** on clicks and typing, following the cursor while zoomed.
- **A smooth cursor** in several styles, with optional click effects.
- **Frame it** on a gradient, color or picture, at Auto, 16:9, 9:16, 1:1 or 4:5.
- **Edit lightly:** cut, trim, speed up and blur, with undo and ⌘K.
- **Export** to MP4 or GIF, up to 4K at 60 fps, to a file or the clipboard.

## Status

Early: version 0.1.2. The app updates itself; to hear about new versions, star the repo and choose **Watch → Custom → Releases**.

## Install

Download [OpenTape.dmg](https://github.com/aidankmcalister/OpenTape/releases/latest/download/OpenTape.dmg) for Apple silicon Macs on macOS 15 or later. Open it and drag OpenTape to Applications.

Or install it with Homebrew:

```sh
brew install --cask aidankmcalister/tap/opentape
```

To build it yourself, follow [Set up](CONTRIBUTING.md#set-up) in the contributing guide.

## Privacy

Everything stays on your Mac. There's no account and no cloud. The app checks GitHub for a new version at launch and when you click Check now. If you turn on Share anonymous usage (it's off until you do), official builds also send a count when the app opens, a recording finishes, the editor opens and an export finishes or fails, with the app version and export format. That's all: no recordings, file names, IP address or ID that lasts past a launch. The code is in [usage.rs](src-tauri/src/usage.rs), and builds from source send nothing. It needs Screen Recording permission, plus the microphone only if you choose one. Recordings wait in a hidden folder until you save or export them, and closing them deletes that copy.

## Contributing

Bug reports and small fixes are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

[MIT](LICENSE). The bundled fonts, Space Grotesk and IBM Plex Mono, are under the SIL Open Font License 1.1.
