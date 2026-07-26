"use client";

import {
  ArrowClockwise,
  FloppyDisk,
  Plus,
  Sparkle,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";
import { AdminMediaField } from "@/components/nyascans/admin/AdminMediaField";
import { useCommercialSettings } from "@/components/nyascans/useCommercialSettings";
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
  const { settings: commercial } = useCommercialSettings();
  const coinPlural = commercial.economy.coinPlural;
  const [settings, setSettings] = useState(defaultRewardSettings);
  const [saved, setSaved] = useState(defaultRewardSettings);
  const [storeItems, setStoreItems] = useState<StoreItem[]>([]);
  const [revision, setRevision] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [status, setStatus] = useState<
    "loading" | "idle" | "saving" | "saved" | "error"
  >("loading");
  const [message, setMessage] = useState("");
  const [mediaBusy, setMediaBusy] = useState("");
  const uploadedMediaKeys = useRef(new Set<string>());
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const editingLocked = status === "saving" || Boolean(mediaBusy);
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
      const keepKeys = new Set(
        [...next.rouletteRewards, ...next.roulettePaidRewards]
          .map((reward) => reward.imageKey)
          .filter((key): key is string => Boolean(key)),
      );
      const staleKeys = new Set(
        [
          ...saved.rouletteRewards,
          ...saved.roulettePaidRewards,
        ]
          .map((reward) => reward.imageKey)
          .filter(
            (key): key is string => Boolean(key && !keepKeys.has(key)),
          ),
      );
      for (const key of uploadedMediaKeys.current) {
        if (!keepKeys.has(key)) staleKeys.add(key);
      }
      uploadedMediaKeys.current.clear();
      if (staleKeys.size) void deleteRewardMedia([...staleKeys]);
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

  async function deleteRewardMedia(keys: string[]) {
    await Promise.allSettled(
      keys.map((key) =>
        fetch("/api/v1/admin/roulette-reward-media", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key }),
        }),
      ),
    );
  }

  function discardChanges() {
    const savedKeys = new Set(
      [...saved.rouletteRewards, ...saved.roulettePaidRewards]
        .map((reward) => reward.imageKey)
        .filter((key): key is string => Boolean(key)),
    );
    const orphanKeys = [...uploadedMediaKeys.current].filter(
      (key) => !savedKeys.has(key),
    );
    uploadedMediaKeys.current.clear();
    if (orphanKeys.length) void deleteRewardMedia(orphanKeys);
    setSettings(saved);
    setMessage("");
    setStatus("idle");
  }

  async function setRewardImage(
    pool: "rouletteRewards" | "roulettePaidRewards",
    rewardId: string,
    file: File | null,
  ) {
    if (!file || editingLocked) return;
    const reward = settings[pool].find((entry) => entry.id === rewardId);
    if (!reward) return;
    const busyKey = `${pool}:${reward.id}`;
    setMediaBusy(busyKey);
    setMessage("");
    try {
      const form = new FormData();
      form.set("rewardId", reward.id);
      form.set("file", file);
      const response = await fetch("/api/v1/admin/roulette-reward-media", {
        method: "PUT",
        body: form,
      });
      const payload = (await response.json()) as {
        key?: string;
        error?: { message?: string };
      };
      if (!response.ok || !payload.key) {
        throw new Error(
          payload.error?.message ?? "The reward image could not be uploaded.",
        );
      }
      uploadedMediaKeys.current.add(payload.key);
      setSettings((current) => ({
        ...current,
        [pool]: current[pool].map((entry) =>
          entry.id === rewardId
            ? { ...entry, imageKey: payload.key ?? null }
            : entry,
        ),
      }));
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The reward image could not be uploaded.",
      );
    } finally {
      setMediaBusy("");
    }
  }

  function removeRewardImage(
    pool: "rouletteRewards" | "roulettePaidRewards",
    rewardId: string,
  ) {
    const reward = settings[pool].find((entry) => entry.id === rewardId);
    if (!reward?.imageKey) return;
    setSettings((current) => ({
      ...current,
      [pool]: current[pool].map((entry) =>
        entry.id === rewardId ? { ...entry, imageKey: null } : entry,
      ),
    }));
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
            weighted percentages and site-wide interval drops used by each
            Roulette pool.
          </p>
        </div>
        <div className="discussion-settings-actions">
          <button
            type="button"
            disabled={
              !hasLoaded ||
              status === "loading" ||
              status === "saving" ||
              Boolean(mediaBusy) ||
              !dirty
            }
            onClick={discardChanges}
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
              Boolean(mediaBusy) ||
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
        <fieldset
          className="reward-settings-content"
          disabled={editingLocked}
          aria-busy={editingLocked}
        >
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
            <summary>Free spins, cooldown, and reward pool</summary>
            <div className="roulette-admin-toolbar">
              <p>
                Keep at least eight enabled rewards so the free wheel remains
                balanced and readable.
              </p>
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
                disabled={
                  editingLocked || settings.rouletteRewards.length >= 24
                }
                title={
                  settings.rouletteRewards.length >= 24
                    ? "A Roulette pool can contain at most 24 rewards."
                    : undefined
                }
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
                        imageKey: null,
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
                      <option value="ONYX">{coinPlural}</option>
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
                    <span>Drop rule</span>
                    <select
                      value={reward.distributionMode ?? "WEIGHT"}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          rouletteRewards: settings.rouletteRewards.map(
                            (entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    distributionMode: event.target.value as
                                      | "WEIGHT"
                                      | "GLOBAL_INTERVAL",
                                    globalIntervalSpins:
                                      event.target.value === "GLOBAL_INTERVAL"
                                        ? entry.globalIntervalSpins ?? 250
                                        : null,
                                  }
                                : entry,
                          ),
                        })
                      }
                    >
                      <option value="WEIGHT">Weighted percentage</option>
                      <option value="GLOBAL_INTERVAL">Global spin interval</option>
                    </select>
                  </label>
                  {(reward.distributionMode ?? "WEIGHT") === "GLOBAL_INTERVAL" ? (
                    <label>
                      <span>Guaranteed once per</span>
                      <input
                        type="number"
                        min={2}
                        max={10_000_000}
                        value={reward.globalIntervalSpins ?? 250}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            rouletteRewards: settings.rouletteRewards.map(
                              (entry, entryIndex) =>
                                entryIndex === index
                                  ? {
                                      ...entry,
                                      globalIntervalSpins: Math.max(
                                        2,
                                        Number(event.target.value),
                                      ),
                                    }
                                  : entry,
                            ),
                          })
                        }
                      />
                      <small>global free spins</small>
                    </label>
                  ) : (
                    <label>
                      <span>Drop ratio</span>
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
                      <small>
                        {(
                          (reward.weight /
                            Math.max(1, settings.rouletteRewards
                              .filter(
                                (entry) =>
                                  entry.enabled &&
                                  (entry.distributionMode ?? "WEIGHT") === "WEIGHT",
                              )
                              .reduce((sum, entry) => sum + entry.weight, 0))) *
                          100
                        ).toFixed(2)}
                        % of weighted spins
                      </small>
                    </label>
                  )}
                  <AdminMediaField
                    label="Wheel image"
                    helperText="Shown inside the reward segment and reward list."
                    recommendedDimensions="Square · 256 × 256"
                    accept="image/png,image/jpeg,image/webp"
                    currentUrl={
                      reward.imageKey
                        ? `/api/v1/roulette-reward-media?key=${encodeURIComponent(reward.imageKey)}`
                        : null
                    }
                    busy={editingLocked}
                    cropProfile={{
                      aspect: 1,
                      outputWidth: 256,
                      outputHeight: 256,
                      maxBytes: 900_000,
                    }}
                    onSelect={(file) =>
                      void setRewardImage("rouletteRewards", reward.id, file)
                    }
                    onRemove={() =>
                      removeRewardImage("rouletteRewards", reward.id)
                    }
                  />
                  <label className="theme-switch">
                    <input
                      type="checkbox"
                      checked={reward.enabled}
                      disabled={
                        editingLocked ||
                        (reward.enabled &&
                          settings.rouletteRewards.filter(
                            (entry) => entry.enabled,
                          ).length <= 8)
                      }
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
                    disabled={
                      settings.rouletteRewards.length <= 8 ||
                      editingLocked
                    }
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

          <details open>
            <summary>Paid spins and premium reward pool</summary>
            <div className="roulette-admin-toolbar">
              <p>
                Paid spins use a separate pool with at least eight enabled
                rewards.
              </p>
              <label className="theme-switch">
                <input
                  type="checkbox"
                  checked={settings.roulettePaidSpinsEnabled}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      roulettePaidSpinsEnabled: event.target.checked,
                    })
                  }
                />
                <span>Allow extra spins paid with Shards or {coinPlural}</span>
              </label>
              <label>
                <span>Shards per paid spin</span>
                <input
                  type="number"
                  min={1}
                  max={1_000_000}
                  value={settings.roulettePaidSpinShardCost}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      roulettePaidSpinShardCost: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>{coinPlural} per paid spin</span>
                <input
                  type="number"
                  min={1}
                  max={1_000_000}
                  value={settings.roulettePaidSpinOnyxCost}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      roulettePaidSpinOnyxCost: Number(event.target.value),
                    })
                  }
                />
              </label>
              {(["SHARDS", "ONYX"] as const).map((currency) => (
                <label className="theme-switch" key={currency}>
                  <input
                    type="checkbox"
                    checked={settings.roulettePaidCurrencies.includes(currency)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...new Set([...settings.roulettePaidCurrencies, currency])]
                        : settings.roulettePaidCurrencies.filter(
                            (entry) => entry !== currency,
                          );
                      if (next.length) {
                        setSettings({
                          ...settings,
                          roulettePaidCurrencies: next,
                        });
                      }
                    }}
                  />
                  <span>Accept {currency === "SHARDS" ? settings.shardPlural : coinPlural}</span>
                </label>
              ))}
              <button
                type="button"
                disabled={
                  editingLocked ||
                  settings.roulettePaidRewards.length >= 24
                }
                title={
                  settings.roulettePaidRewards.length >= 24
                    ? "A Roulette pool can contain at most 24 rewards."
                    : undefined
                }
                onClick={() =>
                  setSettings({
                    ...settings,
                    roulettePaidRewards: [
                      ...settings.roulettePaidRewards,
                      {
                        id: `paid-${rewardId()}`,
                        label: "New premium reward",
                        type: "SHARDS",
                        amount: 50,
                        weight: 10,
                        itemId: null,
                        imageKey: null,
                        enabled: true,
                      },
                    ],
                  })
                }
              >
                <Plus size={16} /> Add paid reward
              </button>
            </div>
            <div className="roulette-admin-list">
              {settings.roulettePaidRewards.map((reward, index) => (
                <article key={reward.id}>
                  <label>
                    <span>Label</span>
                    <input
                      value={reward.label}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          roulettePaidRewards: settings.roulettePaidRewards.map(
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
                          roulettePaidRewards: settings.roulettePaidRewards.map(
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
                                      type === "STORE_ITEM"
                                        ? 0
                                        : Math.max(1, entry.amount),
                                  }
                                : entry,
                          ),
                        });
                      }}
                    >
                      <option value="SHARDS">Shards</option>
                      <option value="ONYX">{coinPlural}</option>
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
                            roulettePaidRewards:
                              settings.roulettePaidRewards.map(
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
                            roulettePaidRewards:
                              settings.roulettePaidRewards.map(
                                (entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        amount: Number(event.target.value),
                                      }
                                    : entry,
                              ),
                          })
                        }
                      />
                    </label>
                  )}
                  <label>
                    <span>Drop rule</span>
                    <select
                      value={reward.distributionMode ?? "WEIGHT"}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          roulettePaidRewards: settings.roulettePaidRewards.map(
                            (entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    distributionMode: event.target.value as
                                      | "WEIGHT"
                                      | "GLOBAL_INTERVAL",
                                    globalIntervalSpins:
                                      event.target.value === "GLOBAL_INTERVAL"
                                        ? entry.globalIntervalSpins ?? 250
                                        : null,
                                  }
                                : entry,
                          ),
                        })
                      }
                    >
                      <option value="WEIGHT">Weighted percentage</option>
                      <option value="GLOBAL_INTERVAL">Global spin interval</option>
                    </select>
                  </label>
                  {(reward.distributionMode ?? "WEIGHT") === "GLOBAL_INTERVAL" ? (
                    <label>
                      <span>Guaranteed once per</span>
                      <input
                        type="number"
                        min={2}
                        max={10_000_000}
                        value={reward.globalIntervalSpins ?? 250}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            roulettePaidRewards:
                              settings.roulettePaidRewards.map(
                                (entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        globalIntervalSpins: Math.max(
                                          2,
                                          Number(event.target.value),
                                        ),
                                      }
                                    : entry,
                              ),
                          })
                        }
                      />
                      <small>global paid spins</small>
                    </label>
                  ) : (
                    <label>
                      <span>Drop ratio</span>
                      <input
                        type="number"
                        min={1}
                        value={reward.weight}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            roulettePaidRewards:
                              settings.roulettePaidRewards.map(
                                (entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        weight: Number(event.target.value),
                                      }
                                    : entry,
                              ),
                          })
                        }
                      />
                      <small>
                        {(
                          (reward.weight /
                            Math.max(1, settings.roulettePaidRewards
                              .filter(
                                (entry) =>
                                  entry.enabled &&
                                  (entry.distributionMode ?? "WEIGHT") === "WEIGHT",
                              )
                              .reduce((sum, entry) => sum + entry.weight, 0))) *
                          100
                        ).toFixed(2)}
                        % of weighted spins
                      </small>
                    </label>
                  )}
                  <AdminMediaField
                    label="Wheel image"
                    helperText="Square artwork for this premium segment."
                    recommendedDimensions="Square · 256 × 256"
                    accept="image/png,image/jpeg,image/webp"
                    currentUrl={
                      reward.imageKey
                        ? `/api/v1/roulette-reward-media?key=${encodeURIComponent(reward.imageKey)}`
                        : null
                    }
                    busy={editingLocked}
                    cropProfile={{
                      aspect: 1,
                      outputWidth: 256,
                      outputHeight: 256,
                      maxBytes: 900_000,
                    }}
                    onSelect={(file) =>
                      void setRewardImage(
                        "roulettePaidRewards",
                        reward.id,
                        file,
                      )
                    }
                    onRemove={() =>
                      removeRewardImage("roulettePaidRewards", reward.id)
                    }
                  />
                  <label className="theme-switch">
                    <input
                      type="checkbox"
                      checked={reward.enabled}
                      disabled={
                        editingLocked ||
                        (reward.enabled &&
                          settings.roulettePaidRewards.filter(
                            (entry) => entry.enabled,
                          ).length <= 8)
                      }
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          roulettePaidRewards: settings.roulettePaidRewards.map(
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
                    disabled={
                      settings.roulettePaidRewards.length <= 8 ||
                      editingLocked
                    }
                    onClick={() =>
                      setSettings({
                        ...settings,
                        roulettePaidRewards: settings.roulettePaidRewards.filter(
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

          <details open>
            <summary>Weekly free-spin tasks</summary>
            <div className="roulette-admin-toolbar">
              <p>
                Progress resets every Monday at 00:00 UTC. Completed tasks add
                banked free spins after the reader claims them.
              </p>
              <button
                type="button"
                disabled={
                  editingLocked || settings.rouletteTasks.length >= 24
                }
                title={
                  settings.rouletteTasks.length >= 24
                    ? "Roulette supports at most 24 weekly tasks."
                    : undefined
                }
                onClick={() =>
                  setSettings({
                    ...settings,
                    rouletteTasks: [
                      ...settings.rouletteTasks,
                      {
                        id: `task-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`,
                        label: "New weekly task",
                        description: "Describe what the reader needs to finish.",
                        metric: "CHAPTERS_READ",
                        target: 5,
                        rewardSpins: 1,
                        enabled: true,
                      },
                    ],
                  })
                }
              >
                <Plus size={16} /> Add weekly task
              </button>
            </div>
            <div className="roulette-admin-list roulette-task-admin-list">
              {settings.rouletteTasks.map((task, index) => (
                <article key={task.id}>
                  <label>
                    <span>Task title</span>
                    <input
                      value={task.label}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          rouletteTasks: settings.rouletteTasks.map(
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
                    <span>Description</span>
                    <input
                      value={task.description}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          rouletteTasks: settings.rouletteTasks.map(
                            (entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, description: event.target.value }
                                : entry,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Metric</span>
                    <select
                      value={task.metric}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          rouletteTasks: settings.rouletteTasks.map(
                            (entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    metric: event.target.value as typeof task.metric,
                                  }
                                : entry,
                          ),
                        })
                      }
                    >
                      <option value="CHAPTERS_READ">Chapters read</option>
                      <option value="COMMENTS_POSTED">Comments posted</option>
                      <option value="UPVOTES_RECEIVED">Upvotes received</option>
                    </select>
                  </label>
                  <label>
                    <span>Target</span>
                    <input
                      type="number"
                      min={1}
                      value={task.target}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          rouletteTasks: settings.rouletteTasks.map(
                            (entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, target: Number(event.target.value) }
                                : entry,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Free spins</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={task.rewardSpins}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          rouletteTasks: settings.rouletteTasks.map(
                            (entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    rewardSpins: Number(event.target.value),
                                  }
                                : entry,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="theme-switch">
                    <input
                      type="checkbox"
                      checked={task.enabled}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          rouletteTasks: settings.rouletteTasks.map(
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
                    aria-label={`Delete ${task.label}`}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        rouletteTasks: settings.rouletteTasks.filter(
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
        </fieldset>
      )}
      {message ? (
        <p className={`settings-status settings-status-${status}`}>{message}</p>
      ) : null}
    </section>
  );
}
