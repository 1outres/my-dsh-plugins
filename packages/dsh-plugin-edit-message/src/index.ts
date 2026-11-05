import type { Context } from "@deepseek-ai/cordis"

/**
 * Host half. It owns no runtime behavior: the browser half renders the Edit
 * button and performs the edit through the Session and Workspace services the
 * Web UI already uses. It declares no settings.
 */
export function apply(_ctx: Context): void {}
