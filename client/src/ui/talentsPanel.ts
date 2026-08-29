import { isTalentUnlocked, RefundTalentMessage, SpendTalentMessage, TALENTS } from "@mmo/shared";
import { activeRoom, PlayerStatsSnapshot } from "../clientState";
import { hideTalentTooltip, positionTalentTooltip, showTalentTooltip } from "./tooltips";
import { makeDraggable } from "./DraggablePanel";

export const talentPanel = document.getElementById("talent-panel")!;
const talentListEl = document.getElementById("talent-list")!;
const talentPointsEl = document.querySelector<HTMLElement>("[data-talent-points]")!;

makeDraggable(talentPanel, "talents");

const SVG_NS = "http://www.w3.org/2000/svg";

// A real prerequisite tree (see shared/src/types.ts's isTalentUnlocked): nodes are grid-positioned
// by tier/column, locked ones are greyed out and unclickable until their prerequisite has a point
// in it, and an SVG overlay draws a connector from every node to its prerequisite. The overlay is
// rebuilt from scratch alongside the nodes every render, then measured against their actual laid-
// out positions (getBoundingClientRect, relative to talentListEl's own box) once they're in the
// DOM - simpler than hand-computing tier/column pixel math, and stays correct if the grid's sizing
// ever changes.
export function renderTalents(player: PlayerStatsSnapshot) {
  talentPointsEl.textContent = `${player.talentPoints} point${player.talentPoints === 1 ? "" : "s"}`;

  const ranks = new Map(player.talentRanks);
  const defs = Object.values(TALENTS).filter((def) => def.classId === player.classId);

  talentListEl.innerHTML = "";
  const linesEl = document.createElementNS(SVG_NS, "svg");
  linesEl.setAttribute("class", "talent-tree-lines");
  talentListEl.appendChild(linesEl);

  for (const def of defs) {
    const rank = ranks.get(def.id) ?? 0;
    const maxed = rank >= def.maxRank;
    const unlocked = isTalentUnlocked(def.id, player.talentRanks);
    const locked = !unlocked && rank <= 0;

    const node = document.createElement("button");
    node.dataset.talentId = def.id;
    node.style.gridRow = String(def.tier);
    node.style.gridColumn = String(def.column + 1);
    node.className = "talent-node" + (locked ? " locked" : maxed ? " maxed" : rank > 0 ? " ranked" : "");
    node.innerHTML = `
      <span class="talent-node-name">${def.name}</span>
      <span class="talent-node-rank">${rank} / ${def.maxRank}</span>
    `;
    if (!locked && !maxed) {
      node.addEventListener("click", () => {
        const message: SpendTalentMessage = { talentId: def.id };
        activeRoom?.send("spend_talent", message);
      });
    }
    if (rank > 0) {
      node.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const message: RefundTalentMessage = { talentId: def.id };
        activeRoom?.send("refund_talent", message);
      });
    }
    node.addEventListener("mouseenter", (event) => showTalentTooltip(def, rank, locked, event as MouseEvent));
    node.addEventListener("mousemove", (event) => positionTalentTooltip(event as MouseEvent));
    node.addEventListener("mouseleave", hideTalentTooltip);
    talentListEl.appendChild(node);
  }

  const containerRect = talentListEl.getBoundingClientRect();
  linesEl.setAttribute("width", String(containerRect.width));
  linesEl.setAttribute("height", String(containerRect.height));
  for (const def of defs) {
    if (!def.prerequisiteTalentId) continue;
    const parentEl = talentListEl.querySelector<HTMLElement>(`[data-talent-id="${def.prerequisiteTalentId}"]`);
    const childEl = talentListEl.querySelector<HTMLElement>(`[data-talent-id="${def.id}"]`);
    if (!parentEl || !childEl) continue;

    const p = parentEl.getBoundingClientRect();
    const c = childEl.getBoundingClientRect();
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(p.left + p.width / 2 - containerRect.left));
    line.setAttribute("y1", String(p.bottom - containerRect.top));
    line.setAttribute("x2", String(c.left + c.width / 2 - containerRect.left));
    line.setAttribute("y2", String(c.top - containerRect.top));
    line.setAttribute("class", (ranks.get(def.prerequisiteTalentId) ?? 0) > 0 ? "talent-tree-line unlocked" : "talent-tree-line");
    linesEl.appendChild(line);
  }
}
