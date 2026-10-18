//! Turns a recording into the `.mp4` people share. It's a passthrough: the video is copied as is,
//! so it's quick and loses nothing. macOS's own `avconvert` does the work.

use std::{
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{Context, Result, bail};

const AVCONVERT: &str = "/usr/bin/avconvert";

pub(crate) fn to_mp4(video: &Path, output: &Path) -> Result<()> {
    let result = Command::new(AVCONVERT)
        .args(["--preset", "PresetPassthrough", "--replace", "--source"])
        .arg(video)
        .arg("--output")
        .arg(output)
        .output()
        .context("could not start avconvert")?;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        bail!("could not make the .mp4: {}", stderr.trim());
    }
    Ok(())
}

/// `name.mp4`, with characters a file name can't hold swapped for dashes.
pub(crate) fn file_name(name: &str) -> String {
    format!("{}.mp4", name.replace(['/', ':'], "-"))
}

/// `name.mp4` in `folder`, or `name 2.mp4`, `name 3.mp4` and so on when it's taken, like Finder.
pub(crate) fn free_path(folder: &Path, name: &str, is_taken: impl Fn(&Path) -> bool) -> PathBuf {
    (1..)
        .map(|copy| match copy {
            1 => folder.join(file_name(name)),
            n => folder.join(file_name(&format!("{name} {n}"))),
        })
        .find(|path| !is_taken(path))
        .unwrap_or_else(|| folder.join(file_name(name)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_name_should_drop_characters_a_file_cant_hold() {
        assert_eq!(file_name("a/b: c"), "a-b- c.mp4");
    }

    #[test]
    fn free_path_should_number_names_that_are_taken() {
        let folder = Path::new("/Downloads");
        let taken = [folder.join("Clip.mp4"), folder.join("Clip 2.mp4")];
        let path = free_path(folder, "Clip", |path| taken.iter().any(|t| t == path));
        assert_eq!(path, folder.join("Clip 3.mp4"));
    }
}
