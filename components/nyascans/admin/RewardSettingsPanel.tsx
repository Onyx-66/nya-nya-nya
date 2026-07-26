"use client";

import {
  ArrowClockwise,
  FloppyDisk,
  Plus,
  Sparkle,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";
import {
  defaultRewardSettings,
  parseRewardSettings,
  type RewardSettings,
} from "@/lib/reward-settings";

type StoreItem = {
  id: string;
  name: string;
  category: string;
};

type RewardSettingsResponse = {
  settings?: RewardSettings;
  revision?: number;
  storeItems?: StoreItem[];
  error?: { message?: string };
};

function rewardId() {
  const suffix = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  return `reward-${suffix}`;
}

export function RewardSettingsPanel() {
  const [settings, setSettings] = useState(defaultRewardSettings);
  const [saved, setSaved] = useState(defaultRewardSettings);
  const [storeItems, setStoreItems] = useState<StoreItem[]>([]);
  const [revision, setRevision] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [status, setStatus] = useState<
    "loading" | "idle" | "saving" | "saved" | "error"
  >("loading");
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  useUnsavedChanges(dirty, "community economy settings");

  async function load() {
    setStatus("loading");
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin/reward-settings", {
        cache: "no-store",
      });
      const payload = (await response.json()) as RewardSettingsResponse;
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Reward settings could not be loaded.",
        );
      }
      const next = parseRewardSettings(payload.settings);
      setSettings(next);
      setSaved(next);
      setRevision(Number(payload.revision ?? 0));
      setStoreItems(payload.storeItems ?? []);
      setHasLoaded(true);
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Reward settings could not be loaded.",
      );
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  async function save() {
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin/reward-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision, settings }),
      });
      const payload = (await response.json()) as RewardSettingsResponse;
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Reward settings could not be saved.",
        );
      }
      const next = parseRewardSettings(payload.settings);
      setSettings(next);
      setSaved(next);
      setRevision(Number(payload.revision ?? revision + 1));
      setStoreItems(payload.storeItems ?? storeItems);
      setStatus("saved");
      setMessage("Shards and Roulette settings are live.");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Reward settings could not be saved.",
      );
    }
  }

  if (!hasLoaded) {
    return (
      <section className="reward-settings-panel">
        <div
          className="admin-state-card"
          role={status === "loading" ? "status" : "alert"}
        >
          <h3>
            {status === "loading"
              ? "Loading community economy"
              : "Community economy could not be loaded"}
          </h3>
          <p>
            {status === "loading"
              ? "Loading Shard rewards and Roulette settings…"
              : message || "The reward settings service is temporarily unavailable."}
          </p>
          {status !== "loading" ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void load()}
            >
              <ArrowClockwise size={16} /> Retry
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="reward-settings-panel">
      <header>
        <div>
          <span className="ops-kicker">
            <Sparkle size={18} /> Community economy
          </span>
          <h2>Shards and daily Roulette</h2>
          <p>
            Configure reader rewards, the verified chapter dwell time, and the
            weighted reward pool used by the once-per-cooldown Roulette.
          </p>
        </div>
        <div className="discussion-settings-actions">
          <button
            type="button"
            disabled={
              !hasLoaded ||
              status === "loading" ||
              status === "saving" ||
              !dirty
            }
            onClick={() => {
              setSettings(saved);
              setMessage("");
              setStatus("idle");
            }}
          >
            Discard changes
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={
              !hasLoaded ||
              status === "loading" ||
              status === "saving" ||
              !dirty
            }
            onClick={() => void save()}
          >
            <FloppyDisk size={17} />
            {status === "saving" ? "Saving…" : "Save economy"}
          </button>
        </div>
      </header>

      {status === "loading" ? (
        <div className="settings-loading">Loading community economy…</div>
      ) : (
        <div className="reward-settings-content">
          <details open>
            <summary>Shard identity and earning rules</summary>
            <div className="reward-settings-grid">
              <label>
                <span>Singular name</span>
                <input
                  value={settings.shardName}
                  onChange={(event) =>
                    setSettings({ ...settings, shardName: event.target.value })
                  }
                />
              </label>
              <label>
                <span>Plural name</span>
                <input
                  value={settings.shardPlural}
                  onChange={(event) =>
                    setSettings({ ...settings, shardPlural: event.target.value })
                  }
                />
              </label>
              <label>
                <span>Icon</span>
                <input
                  value={settings.shardIcon}
                  maxLength={8}
                  onChange={(event) =>
                    setSettings({ ...settings, shardIcon: event.target.value })
                  }
                />
              </label>
              <label>
                <span>Chapter dwell time (seconds)</span>
                <input
                  type="number"
                  min={30}
                  max={7_200}
                  value={settings.chapterMinimumSeconds}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      chapterMinimumSeconds: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Shards per completed chapter</span>
                <input
                  type="number"
                  min={0}
                  value={settings.chapterCompleteShards}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      chapterCompleteShards: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Shards per new comment</span>
                <input
                  type="number"
                  min={0}
                  value={settings.commentCreatedShards}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      commentCreatedShards: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Shards per received upvote</span>
                <input
                  type="number"
                  min={0}
                  value={settings.upvoteReceivedShards}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      upvoteReceivedShards: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
          </details>

          <details open>
            <summary>Roulette cooldown and weighted rewards</summary>
            <div className="roulette-admin-toolbar">
              <label>
                <span>Cooldown (hours)</span>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={settings.rouletteCooldownHours}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      rouletteCooldownHours: Number(event.target.value),
                    })
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setSettings({
                    ...settings,
                    rouletteRewards: [
                      ...settings.rouletteRewards,
                      {
                        id: rewardId(),
                        label: "New reward",
                        type: "SHARDS",
                        amount: 10,
                        weight: 10,
                        itemId: null,
                        enabled: true,
                      },
                    ],
                  })
                }
              >
                <Plus size={16} /> Add reward
              </button>
            </div>
            <div className="roulette-admin-list">
              {settings.rouletteRewards.map((reward, index) => (
                <article key={reward.id}>
                  <label>
                    <span>Label</span>
                    <input
                      value={reward.label}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          rouletteRewards: settings.rouletteRewards.map(
                            (entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, label: event.target.value }
                                : entry,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Type</span>
                    <select
                      value={reward.type}
                      onChange={(event) => {
                        const type = event.target.value as typeof reward.type;
                        setSettings({
                          ...settings,
                          rouletteRewards: settings.rouletteRewards.map(
                            (entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    type,
                                    itemId:
                                      type === "STORE_ITEM"
                                        ? storeItems[0]?.id ?? null
                                        : null,
                                    amount:
                                      type === "STORE_ITEM" ? 0 : Math.max(1, entry.amount),
                                  }
                                : entry,
                          ),
                        });
                      }}
                    >
                      <option value="SHARDS">Shards</option>
                      <option value="ONYX">Onyx</option>
                      <option value="STORE_ITEM">Store item</option>
                    </select>
                  </label>
                  {reward.type === "STORE_ITEM" ? (
                    <label>
                      <span>Store item</span>
                      <select
                        value={reward.itemId ?? ""}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            rouletteRewards: settings.rouletteRewards.map(
                              (entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, itemId: event.target.value }
                                  : entry,
                            ),
                          })
                        }
                      >
                        {storeItems.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name} · {item.category.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      <span>Amount</span>
                      <input
                        type="number"
                        min={1}
                        value={reward.amount}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            rouletteRewards: settings.rouletteRewards.map(
                              (entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, amount: Number(event.target.value) }
                                  : entry,
                            ),
                          })
                        }
                      />
                    </label>
                  )}
                  <label>
                    <span>Weight</span>
                    <input
                      type="number"
                      min={1}
                      value={reward.weight}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          rouletteRewards: settings.rouletteRewards.map(
                            (entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, weight: Number(event.target.value) }
                                : entry,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="theme-switch">
                    <input
                      type="checkbox"
                      checked={reward.enabled}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          rouletteRewards: settings.rouletteRewards.map(
                            (entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, enabled: event.target.checked }
                                : entry,
                          ),
                        })
                      }
                    />
                    <span>Enabled</span>
                  </label>
                  <button
                    type="button"
                    aria-label={`Delete ${reward.label}`}
                    disabled={settings.rouletteRewards.length === 1}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        rouletteRewards: settings.rouletteRewards.filter(
                          (_, entryIndex) => entryIndex !== index,
                        ),
                      })
                    }
                  >
                    <Trash size={17} />
                  </button>
                </article>
              ))}
            </div>
          </details>
        </div>
      )}
      {message ? (
        <p className={`settings-status settings-status-${status}`}>{message}</p>
      ) : null}
    </section>
  );
}
