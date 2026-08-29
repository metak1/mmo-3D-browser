import { CLASSES, ClassId, ENEMY_TYPES, getEffectiveStats, xpForNextLevel } from "@mmo/shared";
import { MAIN_STAT_NAME, PlayerStatsSnapshot } from "../clientState";
import { renderEquipment, renderInventory } from "./inventoryPanel";
import { renderTalents } from "./talentsPanel";

const playerLevelEl = document.querySelector<HTMLElement>("[data-player-level]")!;
const playerGoldEl = document.querySelector<HTMLElement>("[data-player-gold]")!;
const playerClassEl = document.querySelector<HTMLElement>("[data-player-class]")!;
const characterClassEl = document.querySelector<HTMLElement>("[data-character-class]")!;
const xpFill = document.querySelector<HTMLElement>("[data-xp-fill]")!;
const xpLabel = document.querySelector<HTMLElement>("[data-xp-label]")!;
const statEls = {
  mainStat: document.querySelector<HTMLElement>("[data-stat-main]")!,
  vitality: document.querySelector<HTMLElement>("[data-stat-vitality]")!,
  luck: document.querySelector<HTMLElement>("[data-stat-luck]")!,
  armor: document.querySelector<HTMLElement>("[data-stat-armor]")!,
};
const mainStatLabelEl = document.querySelector<HTMLElement>("[data-stat-main-label]")!;

export function updateCharacterPanel(player: PlayerStatsSnapshot) {
  const className = CLASSES[player.classId as ClassId]?.name ?? player.classId;
  playerClassEl.textContent = className;
  characterClassEl.textContent = className;
  playerLevelEl.textContent = `Lv. ${player.level}`;
  playerGoldEl.textContent = `💰 ${player.gold}`;

  const needed = xpForNextLevel(player.level);
  const fraction = needed > 0 ? Math.max(0, Math.min(1, player.xp / needed)) : 0;
  xpFill.style.width = `${fraction * 100}%`;
  xpLabel.textContent = `${player.xp} / ${needed} XP`;

  const effective = getEffectiveStats(
    {
      mainStat: player.mainStat,
      vitality: player.vitality,
      luck: player.luck,
      armor: player.armor,
    },
    {
      weapon: player.equippedWeapon,
      offHand: player.equippedOffHand,
      head: player.equippedHead,
      neck: player.equippedNeck,
      shoulders: player.equippedShoulders,
      armor: player.equippedArmor,
      hands: player.equippedHands,
      waist: player.equippedWaist,
      legs: player.equippedLegs,
      feet: player.equippedFeet,
      ring: player.equippedRing,
      trinket: player.equippedTrinket,
    },
  );

  const mainStat = CLASSES[player.classId as ClassId]?.mainStat;
  mainStatLabelEl.textContent = `⚡ ${mainStat ? MAIN_STAT_NAME[mainStat] : "Main Stat"}`;
  statEls.mainStat.textContent = `${effective.mainStat}`;
  statEls.vitality.textContent = `${effective.vitality}`;
  statEls.luck.textContent = `${effective.luck}`;
  statEls.armor.textContent = `${effective.armor}`;

  renderEquipment(player);
  renderInventory(player);
  renderTalents(player);
}

export function hpColor(fraction: number): string {
  return fraction > 0.5 ? "#4fd166" : fraction > 0.25 ? "#e0b23c" : "#e0503c";
}

// True for an enemy type that auto-engages any player within its aggroRange (red hp bar); false
// (the default) for one that only fights back once actually attacked (yellow) - see
// MeleeStats/CasterStats.aggroRange and HealthBar.setTypeColor.
export function isAggressiveEnemyType(enemyTypeId: string): boolean {
  const stats = ENEMY_TYPES[enemyTypeId]?.stats;
  return !!(stats && "aggroRange" in stats && stats.aggroRange);
}

// Same red/yellow already meaningful elsewhere (low HP / mid HP) - reused so the target-panel
// bar matches the in-world HealthBar's passive/aggressive cue (see HealthBar.setTypeColor).
export function typeColor(aggressive: boolean): string {
  return aggressive ? "#e0503c" : "#e0b23c";
}

export function updateHpBar(fillEl: HTMLElement, labelEl: HTMLElement, hp: number, maxHp: number, colorOverride?: string) {
  const fraction = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  fillEl.style.width = `${fraction * 100}%`;
  fillEl.style.background = colorOverride ?? hpColor(fraction);
  labelEl.textContent = `${Math.ceil(hp)}/${Math.ceil(maxHp)}`;
}
