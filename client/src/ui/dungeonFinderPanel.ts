import { CLASSES, ClassId, ClassRole, DUNGEONS, DungeonId, DungeonJoinListingMessage, DungeonOpenListingMessage, DungeonStartMessage } from "@mmo/shared";
import { activeRoom } from "../clientState";
import { GameSession } from "../GameSession";
import { makeDraggable } from "./DraggablePanel";

const dungeonFinderPanel = document.getElementById("dungeon-finder-panel")!;
const dungeonYourGroupEl = document.getElementById("dungeon-your-group")!;
const dungeonRoleChecklistEl = document.getElementById("dungeon-role-checklist")!;
const dungeonListingListEl = document.getElementById("dungeon-listing-list")!;
const dungeonOpenListingBtn = document.querySelector<HTMLButtonElement>("[data-dungeon-open-listing]")!;
const dungeonStartBtn = document.querySelector<HTMLButtonElement>("[data-dungeon-start]")!;

makeDraggable(dungeonFinderPanel, "dungeon-finder");

// Which dungeon the panel is currently showing - set once by openDungeonFinder (from whichever
// portal was clicked, see main.ts's raycast hit-test), then read by every later re-render this
// module's own onAdd/onRemove/onChange listeners in main.ts trigger, none of which pass a dungeon
// id themselves. More than one dungeon can exist now (see DUNGEONS), so this replaces what used
// to be a single always-correct DUNGEON_COMPOSITION/DUNGEON_PARTY_SIZE global pair.
let currentDungeonId: DungeonId | null = null;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function renderDungeonFinderPanel(session: GameSession) {
  const dungeon = currentDungeonId ? DUNGEONS[currentDungeonId] : undefined;
  const partySize = dungeon?.partySize ?? 0;
  const composition = dungeon?.composition ?? ({} as Record<ClassRole, number>);

  const local = session.localSessionId ? session.playerSchemaById.get(session.localSessionId) : undefined;
  const partyId = local?.partyId ?? "";

  // No party ("" partyId) just means "group of one, yourself" - mirrors
  // WorldRoom.handleDungeonStart, which allows the same solo/undersized entry.
  const members = partyId
    ? [...session.playerSchemaById.entries()].filter(([, schema]) => schema.partyId === partyId)
    : local
      ? [[session.localSessionId!, local] as [string, typeof local]]
      : [];

  dungeonYourGroupEl.innerHTML = "";
  const roleCounts: Record<ClassRole, number> = { tank: 0, healer: 0, dps: 0 };
  for (const [sessionId, schema] of members) {
    const className = CLASSES[schema.classId as ClassId]?.name ?? schema.classId;
    const role = CLASSES[schema.classId as ClassId]?.role;
    if (role) roleCounts[role]++;
    const label = sessionId === session.localSessionId ? `${schema.name} (You)` : schema.name;

    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `<span>${label}</span><span class="item-slot-tag">${className}${role ? ` · ${capitalize(role)}` : ""}</span>`;
    dungeonYourGroupEl.appendChild(row);
  }

  // Shown as guidance ("this is the dungeon's designed composition"), not a hard gate -
  // see the Start button below.
  dungeonRoleChecklistEl.innerHTML = (Object.keys(composition) as ClassRole[])
    .map((role) => {
      const have = roleCounts[role];
      const need = composition[role];
      return `<span class="dungeon-role-tag ${have === need ? "filled" : "missing"}">${capitalize(role)} ${have}/${need}</span>`;
    })
    .join("");

  dungeonOpenListingBtn.hidden = !!partyId && session.dungeonListingSchemaById.has(partyId);

  // Composition is guidance, not a requirement - an over-leveled/geared group (down to
  // soloing) can still push Start rather than being blocked, matching the relaxed server-side
  // check in WorldRoom.handleDungeonStart. Only the group size cap is actually enforced.
  const groupSize = members.length;
  dungeonStartBtn.disabled = !dungeon || groupSize < 1 || groupSize > partySize;

  dungeonListingListEl.innerHTML = "";
  for (const [listingPartyId, listing] of session.dungeonListingSchemaById) {
    if (listing.dungeonId !== currentDungeonId) continue; // a listing for a different portal's dungeon
    const size = [...session.playerSchemaById.values()].filter((s) => s.partyId === listingPartyId).length;
    const isOwnGroup = listingPartyId === partyId;
    const wouldFit = !isOwnGroup && size + groupSize <= partySize;
    const leaderLabel = session.playerSchemaById.get(listing.leaderSessionId)?.name ?? "Someone";

    const row = document.createElement("div");
    row.className = "talent-card";
    row.innerHTML = `
      <div class="talent-card-top">
        <span>${leaderLabel}'s Group</span>
        <span class="talent-rank">${size} / ${partySize}</span>
      </div>
    `;

    if (isOwnGroup) {
      const tag = document.createElement("span");
      tag.className = "talent-desc";
      tag.textContent = "This is your group";
      row.appendChild(tag);
    } else {
      const btn = document.createElement("button");
      btn.className = "overlay-button accent";
      btn.textContent = "Join";
      btn.disabled = !wouldFit;
      btn.addEventListener("click", () => {
        const message: DungeonJoinListingMessage = { partyId: listingPartyId };
        activeRoom?.send("dungeon_join_listing", message);
      });
      row.appendChild(btn);
    }
    dungeonListingListEl.appendChild(row);
  }
}

export function openDungeonFinder(session: GameSession, dungeonId: DungeonId) {
  currentDungeonId = dungeonId;
  dungeonFinderPanel.hidden = false;
  renderDungeonFinderPanel(session);
}

export function closeDungeonFinder() {
  dungeonFinderPanel.hidden = true;
}

export function setupDungeonFinderPanel() {
  document.querySelector("[data-dungeon-finder-close]")!.addEventListener("click", () => closeDungeonFinder());
  dungeonOpenListingBtn.addEventListener("click", () => {
    if (!currentDungeonId) return;
    const message: DungeonOpenListingMessage = { dungeonId: currentDungeonId };
    activeRoom?.send("dungeon_open_listing", message);
  });
  dungeonStartBtn.addEventListener("click", () => {
    if (!currentDungeonId) return;
    const message: DungeonStartMessage = { dungeonId: currentDungeonId };
    activeRoom?.send("dungeon_start", message);
  });
}
