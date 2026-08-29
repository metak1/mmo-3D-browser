import { NPC_QUEST_IDS, NPCS, QUESTS, SPAWN_POINTS } from "@mmo/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { GameSession } from "../GameSession";
import { PlayerStatsSnapshot } from "../clientState";
import { computeNpcQuestStates, computeQuestAreaMarkers, questStateFor } from "./npcAndQuestsPanel";

const QUEST_ID = "test_quest";
const NPC_ID = "test_npc";

function sessionWith(questProgress: [string, number][], questCompleted: [string, number][]): GameSession {
  const localPlayerSchema = { questProgress, questCompleted } as unknown as PlayerStatsSnapshot;
  return { localPlayerSchema } as unknown as GameSession;
}

beforeEach(() => {
  QUESTS[QUEST_ID] = {
    id: QUEST_ID,
    name: "Test Quest",
    description: "",
    giverNpcId: NPC_ID,
    objectiveEnemyTypeId: "test_enemy",
    objectiveCount: 5,
    rewardXp: 10,
  };
  NPC_QUEST_IDS[NPC_ID] = [QUEST_ID];
  NPCS[NPC_ID] = { id: NPC_ID, name: "Test NPC", x: 0, z: 0, yOffset: 0, mapId: "overworld" };
  SPAWN_POINTS.length = 0;
});

describe("questStateFor", () => {
  it("is available when nothing has been accepted or completed", () => {
    const session = sessionWith([], []);
    expect(questStateFor(session, QUEST_ID)).toBe("available");
  });

  it("is active when progress is below the objective count", () => {
    const session = sessionWith([[QUEST_ID, 2]], []);
    expect(questStateFor(session, QUEST_ID)).toBe("active");
  });

  it("is ready when progress has reached the objective count", () => {
    const session = sessionWith([[QUEST_ID, 5]], []);
    expect(questStateFor(session, QUEST_ID)).toBe("ready");
  });

  it("is completed once turned in, regardless of any lingering progress entry", () => {
    const session = sessionWith([[QUEST_ID, 5]], [[QUEST_ID, Date.now()]]);
    expect(questStateFor(session, QUEST_ID)).toBe("completed");
  });

  it("is available (not active/ready/completed) with no player schema loaded yet", () => {
    const session = { localPlayerSchema: undefined } as unknown as GameSession;
    expect(questStateFor(session, QUEST_ID)).toBe("available");
  });
});

describe("computeQuestAreaMarkers", () => {
  it("returns nothing for a quest with no matching spawn points", () => {
    const session = sessionWith([[QUEST_ID, 0]], []);
    expect(computeQuestAreaMarkers(session)).toEqual([]);
  });

  it("centers on and bounds every matching spawn point, numbered by acceptance order", () => {
    SPAWN_POINTS.push(
      { id: "s1", enemyTypeId: "test_enemy", mapId: "overworld", x: -10, z: 0 },
      { id: "s2", enemyTypeId: "test_enemy", mapId: "overworld", x: 10, z: 0 },
      { id: "s3", enemyTypeId: "other_enemy", mapId: "overworld", x: 999, z: 999 }, // unrelated quest, excluded
    );
    const session = sessionWith([[QUEST_ID, 0]], []);

    const markers = computeQuestAreaMarkers(session);
    expect(markers).toHaveLength(1);
    expect(markers[0].x).toBe(0); // centroid of (-10,0) and (10,0)
    expect(markers[0].z).toBe(0);
    expect(markers[0].number).toBe(1);
    expect(markers[0].radius).toBeGreaterThan(10); // bounds the spawns plus QUEST_AREA_PADDING
  });
});

describe("computeNpcQuestStates", () => {
  it("reports 'none' for an NPC whose quest is already completed", () => {
    const session = sessionWith([], [[QUEST_ID, Date.now()]]);
    expect(computeNpcQuestStates(session).get(NPC_ID)).toBe("none");
  });

  it("reports 'available' when the NPC has an unaccepted quest", () => {
    const session = sessionWith([], []);
    expect(computeNpcQuestStates(session).get(NPC_ID)).toBe("available");
  });

  it("reports 'ready' even if the NPC also has another quest still in progress (ready takes priority)", () => {
    const otherQuestId = "test_quest_2";
    QUESTS[otherQuestId] = { ...QUESTS[QUEST_ID], id: otherQuestId, giverNpcId: NPC_ID, objectiveCount: 5 };
    NPC_QUEST_IDS[NPC_ID] = [otherQuestId, QUEST_ID];

    // otherQuestId still in progress (active), QUEST_ID ready to turn in.
    const session = sessionWith(
      [
        [otherQuestId, 1],
        [QUEST_ID, 5],
      ],
      [],
    );
    expect(computeNpcQuestStates(session).get(NPC_ID)).toBe("ready");
  });
});
