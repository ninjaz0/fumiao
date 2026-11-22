import { chat } from "./index.js";
import { chatStudio } from "./studio.js";
import { chatStreaming } from "./stream.js";

// Published versions referenced by existing databases and frozen jobs.
export const releases = [chat, chatStudio, chatStreaming] as const;
export const studio = [chatStudio, chatStreaming, "兼容对话"] as const;
