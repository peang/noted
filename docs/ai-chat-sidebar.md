# AI Chat Sidebar — Implementation Plan

## Overview
Add an AI chat sidebar integrated with OpenCode Go API. Right sidebar becomes tabbed: **Documents** | **Chat**.

---

## API: OpenCode Go

- Endpoint: `https://opencode.ai/zen/go/v1/chat/completions` (OpenAI-compatible)
- Models list: `https://opencode.ai/zen/go/v1/models`
- API key from: `opencode.ai/auth` (Go subscription)
- Default model: `deepseek-v4-flash`

---

## Files

| File | Action |
|------|--------|
| `src/store/chatStore.ts` | **New** — Chat state, messages, API key, model |
| `src/services/opencode.ts` | **New** — API calls (fetchModels, sendMessage with SSE) |
| `src/components/ChatPanel.tsx` | **New** — Chat UI (setup screen + chat view) |
| `src/App.tsx` | **Modify** — Right sidebar becomes tabbed panel |
| `src/store/noteStore.ts` | **Modify** — Add `rightSidebarTab` state |

---

## Store (`chatStore.ts`)

### State
- `apiKey: string | null` — persisted to localStorage
- `messages: {role, content}[]` — persisted to localStorage
- `model: string` — persisted to localStorage (default: `deepseek-v4-flash`)
- `availableModels: {id, name}[]` — fetched from API on key save
- `isLoading: boolean`
- `chatError: string | null`

### Actions
- `setApiKey(key: string)` — save key, fetch models
- `sendMessage(content: string)` — stream response, append to messages
- `fetchModels()` — GET available models from API
- `setModel(model: string)`
- `clearChat()`

### Persistence Keys
- `noted_go_api_key`
- `noted_chat_messages`
- `noted_chat_model`

---

## API Service (`opencode.ts`)

- `fetchModels(apiKey)` → `GET https://opencode.ai/zen/go/v1/models` → `{id, name}[]`
- `sendChatMessage(apiKey, model, messages)` → `POST https://opencode.ai/zen/go/v1/chat/completions` with SSE streaming

Request body:
```json
{
  "model": "deepseek-v4-flash",
  "messages": [{"role": "user", "content": "..."}],
  "stream": true
}
```

Headers:
```
Authorization: Bearer <api-key>
Content-Type: application/json
```

---

## Right Sidebar Refactor

Current: simple "Open Documents" panel in `App.tsx` (lines 312-385).

Replace with tabbed panel:
```
┌─────────────────┐
│ [Documents] [Chat] │  ← tab bar
├─────────────────┤
│                     │
│  Panel content      │  ← switches based on active tab
│                     │
└─────────────────┘
```

### Tab States
- **Documents** — existing open tabs list (current behavior)
- **Chat** — `<ChatPanel />` component

### Toggle Button
Stay as floating button in main workspace (top-right). Click toggles right sidebar open/closed. When closed, tab state preserved.

---

## ChatPanel Component

### State: No API Key
- Title: "Chat"
- Message: "Enter your OpenCode Go API key to start chatting."
- Input field + "Save" button
- Link to `opencode.ai/auth`

### State: API Key Set
- Scrollable message list
  - User messages: right-aligned
  - Assistant messages: left-aligned, markdown rendered
- Input box + send button at bottom
- Model selector dropdown (populated from `fetchModels`)
- "Clear chat" button (small, top area)
- Loading indicator during streaming

---

## Flow

1. User clicks floating toggle → right sidebar opens
2. User clicks "Chat" tab
3. **No key** → setup screen shown
4. User pastes Go API key, clicks Save
5. `fetchModels()` called → model dropdown populated
6. User can now chat
7. Messages persist across sessions via localStorage

---

## Chat history

- Conversations are saved as sessions (`ChatSession` in `chatStore.ts`): `id`, `title` (from the first message), `workspace`, `createdAt`, `updatedAt`, `messages`.
- Stored in localStorage under `noted_chat_sessions`; `noted_chat_active_session` remembers the open one. The old single-conversation key `noted_chat_messages` is migrated once into a session that shows in every workspace.
- Sessions belong to the open workspace (folder name, or the sandbox). Switching folders opens that workspace's latest session. Same-named folders share history.
- At most 30 sessions per workspace are kept; if localStorage is full the oldest other sessions are dropped.
- New Chat archives the current conversation instead of clearing it. Removing the API key keeps the history.
- UI: history button in the chat header (search, rename, delete with in-place confirm), `ModelPicker` (searchable, grouped by model family), `ui/Button` for every button.

## Tools

`list_files` (last-modified dates, optional `folder` and `modified_within_days`), `read_file`, `write_file` (needs approval, shows a diff). The last round is sent without tools plus a nudge so the model has to answer. Some models write tool calls as `<｜DSML｜invoke …>` text; that is parsed into real tool calls and hidden from the chat.

## Layout

- Ctrl/Cmd+\ collapses the file sidebar to a rail (state is remembered). Both sidebars remember open/closed; the chat width is restored too.
- Every view header has the same `ChatToggleButton`, including the landing page.
