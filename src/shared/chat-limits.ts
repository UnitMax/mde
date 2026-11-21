/**
 * The most characters of one reply or one stretch of reasoning that MDE keeps, both when it reads a conversation from
 * OpenCode and while the text streams in. Ordinary replies are a few thousand characters; one past this is almost
 * always an agent stuck repeating itself, and drawing it all would slow the Inbox down.
 */
export const CHAT_TEXT_LIMIT = 1024 * 1024
