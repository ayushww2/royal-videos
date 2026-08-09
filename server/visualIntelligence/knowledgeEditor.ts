/**
 * Backward-compatible re-exports — implementation lives in royalV2/editorChat.ts.
 */
export {
  type ChatRole,
  type EditorChatMessage as KnowledgeChatMessage,
  type EditorChatHistory as KnowledgeChatHistory,
  getEditorChatHistory as getKnowledgeEditorHistory,
  clearEditorChatHistory as clearKnowledgeEditorHistory,
  handleEditorChat as handleKnowledgeEditorChat,
  getEditorChatHistory,
  clearEditorChatHistory,
  handleEditorChat,
} from "./royalV2/editorChat.js";
