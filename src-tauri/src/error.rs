//! The one error type commands return. Inside, the app uses `anyhow`; at the command edge every
//! error becomes one plain string with its causes, like "could not start capture: ...", which is
//! what the frontend shows.

use serde::{Serialize, Serializer};

/// What a fallible `#[tauri::command]` returns. `?` turns any error into a [`CommandError`].
pub(crate) type CmdResult<T = ()> = Result<T, CommandError>;

#[derive(Debug)]
pub(crate) struct CommandError(String);

/// Any error `anyhow` accepts: `anyhow::Error` itself, I/O errors, Tauri errors and so on.
impl<E: Into<anyhow::Error>> From<E> for CommandError {
    fn from(err: E) -> Self {
        Self(message(&err.into()))
    }
}

/// Sent as a plain string, which is what the frontend expects.
impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

/// The error and its causes on one line, outermost first.
pub(crate) fn message(err: &anyhow::Error) -> String {
    format!("{err:#}")
}

#[cfg(test)]
mod tests {
    use anyhow::{Context, anyhow};

    use super::*;

    #[test]
    fn command_error_should_reach_the_frontend_as_a_plain_string_with_its_causes() {
        let err = CommandError::from(anyhow!("disk full").context("could not write meta.json"));
        let json = serde_json::to_string(&err).expect("a string serializes");
        assert_eq!(json, r#""could not write meta.json: disk full""#);
    }

    #[test]
    fn question_mark_should_turn_a_missing_value_into_its_message() {
        fn not_recording() -> CmdResult {
            None::<()>.context("not recording")?;
            Ok(())
        }
        let json = serde_json::to_string(&not_recording().unwrap_err()).expect("serializes");
        assert_eq!(json, r#""not recording""#);
    }
}
