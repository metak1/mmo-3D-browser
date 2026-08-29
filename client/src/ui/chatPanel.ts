import { CHAT_MAX_LENGTH, ChatBroadcast, ChatChannel, ChatMessage, SetTimeOfDayMessage } from "@mmo/shared";
import { activeRoom } from "../clientState";
import { GameSession } from "../GameSession";
import { makeDraggable } from "./DraggablePanel";

const chatPanel = document.getElementById("chat-panel")!;
const chatLogEl = document.getElementById("chat-log")!;
const chatInputEl = document.getElementById("chat-input") as HTMLInputElement;
const chatTabEls = [...document.querySelectorAll<HTMLButtonElement>("[data-chat-channel]")];

makeDraggable(chatPanel, "chat");

// Say/Party/Guild are kept as fully separate logs (each capped at 100 rows independently, same
// limit the combined log used to share) rather than one shared feed with a color-coded row per
// channel - the tabs used to only pick which channel your OWN messages went to; every incoming
// message still landed in the same scrolling list regardless of which tab was active, so a busy
// Say channel could bury a Guild message before anyone switched tabs to see it. Switching tabs
// now re-renders #chat-log from that channel's own stored history instead of just changing where
// new outgoing messages go.
function renderActiveChatLog(session: GameSession) {
  chatLogEl.replaceChildren(...session.chatHistory[session.activeChatChannel]);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

export function setupChatPanel(session: GameSession) {
  for (const tab of chatTabEls) {
    tab.addEventListener("click", () => {
      session.activeChatChannel = tab.dataset.chatChannel as ChatChannel;
      for (const other of chatTabEls) other.classList.toggle("active", other === tab);
      renderActiveChatLog(session);
    });
  }

  chatInputEl.addEventListener("keydown", (e) => {
    if (e.code !== "Enter") return;
    const text = chatInputEl.value.trim();
    chatInputEl.value = "";
    chatInputEl.blur(); // hands movement/hotkeys back to the game immediately
    if (!text) return;
    if (text.startsWith("/")) {
      handleSlashCommand(session, text);
      return;
    }
    const message: ChatMessage = { channel: session.activeChatChannel, text: text.slice(0, CHAT_MAX_LENGTH) };
    activeRoom?.send("chat", message);
  });
}

const TIME_OF_DAY_NAMED: Record<string, number> = {
  midnight: 0,
  night: 0,
  dawn: 0.25,
  sunrise: 0.25,
  morning: 0.25,
  noon: 0.5,
  midday: 0.5,
  day: 0.5,
  dusk: 0.75,
  sunset: 0.75,
  evening: 0.75,
};

// Parses "/time"'s one argument into a 0..1 DayNightCycle fraction - either an hour (0-24,
// matching formatTimeOfDay's own mapping: 0/24=midnight, 6=dawn, 12=noon, 18=dusk) or one of the
// named times above. Returns null for anything that parses as neither.
function parseTimeOfDayArg(arg: string | undefined): number | null {
  if (!arg) return null;
  const named = TIME_OF_DAY_NAMED[arg.toLowerCase()];
  if (named !== undefined) return named;
  const hour = Number(arg);
  if (!Number.isFinite(hour)) return null;
  return (((hour % 24) + 24) % 24) / 24;
}

// The one admin-only "/" chat command so far - typed into the same box as regular messages, but
// intercepted client-side before it would ever reach the server as a literal "say". The actual
// admin-role check happens server-side (WorldRoom.handleSetTimeOfDay) and comes back as a
// "not_admin" action_failed toast if the sender isn't one - this only handles client-side syntax
// (a malformed argument never round-trips at all).
function handleSlashCommand(session: GameSession, text: string) {
  const [rawCmd, ...args] = text.slice(1).trim().split(/\s+/);
  const cmd = rawCmd?.toLowerCase();
  if (cmd === "time") {
    if (session.isDungeon) {
      session.showActionFeedback("The /time command only works in the overworld");
      return;
    }
    const fraction = parseTimeOfDayArg(args[0]);
    if (fraction === null) {
      session.showActionFeedback("Usage: /time <0-24 | dawn | noon | dusk | night>");
      return;
    }
    const message: SetTimeOfDayMessage = { fraction };
    activeRoom?.send("set_time_of_day", message);
    return;
  }
  session.showActionFeedback(`Unknown command: /${rawCmd ?? ""}`);
}

// The room.onMessage("chat", ...) registration itself stays in main.ts (it's connection setup);
// this is the actual per-message logic it delegates to.
export function handleChatBroadcast(session: GameSession, payload: ChatBroadcast) {
  const row = document.createElement("div");
  row.className = `chat-message ${payload.channel}`;
  const sender = document.createElement("span");
  sender.className = "chat-sender";
  sender.textContent = `${payload.senderName}: `;
  row.appendChild(sender);
  row.appendChild(document.createTextNode(payload.text));

  const history = session.chatHistory[payload.channel];
  history.push(row);
  while (history.length > 100) history.shift();

  // Only touch the visible log if this message's own channel is the one currently showing -
  // a Party message arriving while the Say tab is open gets recorded (renderActiveChatLog
  // will show it once the player switches over) but doesn't interrupt/scroll what's on screen.
  if (payload.channel === session.activeChatChannel) {
    const wasAtBottom = chatLogEl.scrollTop + chatLogEl.clientHeight >= chatLogEl.scrollHeight - 4;
    chatLogEl.appendChild(row);
    while (chatLogEl.children.length > 100) chatLogEl.removeChild(chatLogEl.firstChild!);
    if (wasAtBottom) chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  if (payload.channel === "say") {
    session.avatars.get(payload.senderSessionId)?.chatBubble.show(payload.text);
  }
}
