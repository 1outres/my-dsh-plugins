/** Button, editor and error copy. The plugin ships English only. */
export const en: Record<string, string> = {
  edit: "Edit",
  "edit.running": "Stop the running turn to edit this message",
  "edit.files": "Messages with attached files can't be edited",
  "edit.noAccess": "You can't branch this session",
  "editor.aria": "Edit message",
  "editor.cancel": "Cancel",
  "editor.send": "Send",
  "editor.sending": "Sending…",
  "editor.note":
    "Sending restarts the conversation from here in a new session and archives this one. Files are not reverted.",
  "editor.images": "{count} image(s) from the original message are sent again.",
  "editor.keys": "{mod}+Enter to send, Esc to cancel",
  "error.unavailable": "This session is not loaded.",
  "error.running": "The session is running. Stop it, then send again.",
  "error.empty": "Enter a message.",
  "error.files": "Messages with attached files can't be edited.",
  "error.boundary": "Could not find where this message starts in the session history.",
  "error.attachment": "Could not read the original images: {detail}",
  "error.fork": "Could not create the new session: {detail}",
  "error.prepare": "Could not prepare the new session: {detail}",
  "error.prompt": "The new session did not accept the message: {detail}",
}
