import { CLASSES, ClassId, ClassRole, DUNGEON_COMPOSITION, DUNGEON_PARTY_SIZE, DungeonJoinListingMessage } from "@mmo/shared";
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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function renderDungeonFinderPanel(session: GameSession) {
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
  dungeonRoleChecklistEl.innerHTML = (Object.keys(DUNGEON_COMPOSITION) as ClassRole[])
    .map((role) => {
      const have = roleCounts[role];
      const need = DUNGEON_COMPOSITION[role];
      return `<span class="dungeon-role-tag ${have === need ? "filled" : "missing"}">${capitalize(role)} ${have}/${need}</span>`;
    })
    .join("");

  dungeonOpenListingBtn.hidden = !!partyId && session.dungeonListingSchemaById.has(partyId);

  // Composition is guidance, not a requirement - an over-leveled/geared group (down to
  // soloing) can still push Start rather than being blocked, matching the relaxed server-side
  // check in WorldRoom.handleDungeonStart. Only the group size cap is actually enforced.
  const groupSize = members.length;
  dungeonStartBtn.disabled = groupSize < 1 || groupSize > DUNGEON_PARTY_SIZE;

  dungeonListingListEl.innerHTML = "";
  for (const [listingPartyId, listing] of session.dungeonListingSchemaById) {
    const size = [...session.playerSchemaById.values()].filter((s) => s.partyId === listingPartyId).length;
    const isOwnGroup = listingPartyId === partyId;
    const wouldFit = !isOwnGroup && size + groupSize <= DUNGEON_PARTY_SIZE;
    const leaderLabel = session.playerSchemaById.get(listing.leaderSessionId)?.name ?? "Someone";

    const row = document.createElement("div");
    row.className = "talent-card";
    row.innerHTML = `
      <div class="talent-card-top">
        <span>${leaderLabel}'s Group</span>
        <span class="talent-rank">${size} / ${DUNGEON_PARTY_SIZE}</span>
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

export function openDungeonFinder(session: GameSession) {
  dungeonFinderPanel.hidden = false;
  renderDungeonFinderPanel(session);
}

export function closeDungeonFinder() {
  dungeonFinderPanel.hidden = true;
}

export function setupDungeonFinderPanel() {
  document.querySelector("[data-dungeon-finder-close]")!.addEventListener("click", () => closeDungeonFinder());
  dungeonOpenListingBtn.addEventListener("click", () => activeRoom?.send("dungeon_open_listing"));
  dungeonStartBtn.addEventListener("click", () => activeRoom?.send("dungeon_start"));
}
