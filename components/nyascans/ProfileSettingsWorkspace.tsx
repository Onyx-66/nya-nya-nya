"use client";

import {
  ArrowSquareOut,
  CheckCircle,
  FloppyDisk,
  WarningCircle,
} from "@phosphor-icons/react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type OwnProfile = {
  username: string;
  displayName: string;
  bio: string;
  preferredLanguage: string;
  socialLinks: Array<{ label?: string; url?: string }>;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  revision: number;
  privacy?: {
    profileVisibility?: "PUBLIC" | "PRIVATE";
    followersVisibility?: "PUBLIC" | "PRIVATE";
    showReadingHistory?: boolean;
    showChapterNumbers?: boolean;
    showLibrarySummary?: boolean;
  };
};

export function ProfileSettingsWorkspace({
  onSaved,
}: {
  onSaved?: (message: string) => void;
}) {
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [initial, setInitial] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mediaBusy, setMediaBusy] = useState<"avatar" | "banner" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/profiles", {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          data?: OwnProfile;
          error?: { message?: string };
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.error?.message ?? "Profile could not be loaded.");
        }
        setProfile(payload.data);
        setInitial(JSON.stringify(payload.data));
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Profile could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const dirty = useMemo(
    () => Boolean(profile) && JSON.stringify(profile) !== initial,
    [initial, profile],
  );

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!profile || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/v1/profiles", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: profile.username,
          bio: profile.bio,
          preferredLanguage: profile.preferredLanguage,
          profileVisibility:
            profile.privacy?.profileVisibility ?? "PUBLIC",
          followersVisibility:
            profile.privacy?.followersVisibility ?? "PUBLIC",
          showReadingHistory: Boolean(profile.privacy?.showReadingHistory),
          showChapterNumbers: Boolean(profile.privacy?.showChapterNumbers),
          showLibrarySummary: Boolean(profile.privacy?.showLibrarySummary),
          socialLinks: profile.socialLinks
            .filter((entry) => entry.label?.trim() && entry.url?.trim())
            .map((entry) => ({
              label: entry.label!.trim(),
              url: entry.url!.trim(),
            })),
          revision: profile.revision,
        }),
      });
      const payload = (await response.json()) as {
        revision?: number;
        username?: string;
        error?: { message?: string };
      };
      if (!response.ok || typeof payload.revision !== "number") {
        throw new Error(payload.error?.message ?? "Profile could not be saved.");
      }
      const nextProfile = {
        ...profile,
        username: payload.username ?? profile.username,
        revision: payload.revision,
      };
      setProfile(nextProfile);
      setInitial(JSON.stringify(nextProfile));
      onSaved?.("Profile saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Profile could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function uploadMedia(
    slot: "avatar" | "banner",
    file: File | undefined,
  ) {
    if (!profile || !file || mediaBusy) return;
    if (profile.revision < 1) {
      setError("Save the profile before uploading media.");
      return;
    }
    setMediaBusy(slot);
    setError("");
    try {
      const body = new FormData();
      body.set("slot", slot);
      body.set("revision", String(profile.revision));
      body.set("file", file);
      const response = await fetch("/api/v1/profile-media", {
        method: "PUT",
        body,
      });
      const payload = (await response.json()) as {
        revision?: number;
        url?: string;
        error?: { message?: string };
      };
      if (!response.ok || typeof payload.revision !== "number") {
        throw new Error(payload.error?.message ?? "Profile media could not be saved.");
      }
      const nextProfile = {
        ...profile,
        revision: payload.revision,
        [slot === "avatar" ? "avatarUrl" : "bannerUrl"]:
          payload.url ?? null,
      };
      setProfile(nextProfile);
      setInitial(JSON.stringify(nextProfile));
      onSaved?.(`${slot === "avatar" ? "Avatar" : "Banner"} saved.`);
    } catch (mediaError) {
      setError(
        mediaError instanceof Error
          ? mediaError.message
          : "Profile media could not be saved.",
      );
    } finally {
      setMediaBusy(null);
    }
  }

  async function removeMedia(slot: "avatar" | "banner") {
    if (!profile || profile.revision < 1 || mediaBusy) return;
    if (!window.confirm(`Remove the current profile ${slot}?`)) return;
    setMediaBusy(slot);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/profile-media?slot=${slot}&revision=${profile.revision}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as {
        revision?: number;
        error?: { message?: string };
      };
      if (!response.ok || typeof payload.revision !== "number") {
        throw new Error(
          payload.error?.message ?? "Profile media could not be removed.",
        );
      }
      const nextProfile = {
        ...profile,
        revision: payload.revision,
        [slot === "avatar" ? "avatarUrl" : "bannerUrl"]: null,
      };
      setProfile(nextProfile);
      setInitial(JSON.stringify(nextProfile));
      onSaved?.(`${slot === "avatar" ? "Avatar" : "Banner"} removed.`);
    } catch (mediaError) {
      setError(
        mediaError instanceof Error
          ? mediaError.message
          : "Profile media could not be removed.",
      );
    } finally {
      setMediaBusy(null);
    }
  }

  if (loading) {
    return (
      <section className="profile-settings-state" role="status">
        Loading profile settings…
      </section>
    );
  }
  if (!profile) {
    return (
      <section className="profile-settings-state" role="alert">
        <WarningCircle size={24} />
        <strong>Profile settings unavailable</strong>
        <span>{error}</span>
      </section>
    );
  }

  return (
    <form className="profile-settings-workspace" onSubmit={save}>
      <header>
        <div>
          <p className="eyebrow">Public identity</p>
          <h2>Profile</h2>
          <p>Control what other readers see. Reading history remains private until you explicitly share it.</p>
        </div>
        {profile.revision > 0 ? (
          <a
            className="button button-secondary"
            href={`/u/${encodeURIComponent(profile.username)}`}
            target="_blank"
            rel="noreferrer"
          >
            Preview public profile <ArrowSquareOut size={16} />
          </a>
        ) : null}
      </header>
      {error ? (
        <div className="profile-settings-alert" role="alert">
          <WarningCircle size={18} /> {error}
        </div>
      ) : null}
      <section className="profile-settings-card">
        <div>
          <h3>Identity</h3>
          <p>Your username becomes the stable public profile address.</p>
        </div>
        <div className="profile-settings-grid">
          <label>
            <span>Username</span>
            <input
              required
              minLength={3}
              maxLength={30}
              pattern="[A-Za-z0-9_]+"
              value={profile.username}
              onChange={(event) =>
                setProfile((current) =>
                  current ? { ...current, username: event.target.value } : current,
                )
              }
            />
            <small>Letters, numbers, and underscores.</small>
          </label>
          <label>
            <span>Preferred language</span>
            <select
              value={profile.preferredLanguage}
              onChange={(event) =>
                setProfile((current) =>
                  current
                    ? { ...current, preferredLanguage: event.target.value }
                    : current,
                )
              }
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="es">Español</option>
              <option value="ar">العربية</option>
              <option value="ja">日本語</option>
            </select>
          </label>
          <label className="profile-settings-wide">
            <span>Bio</span>
            <textarea
              rows={5}
              maxLength={500}
              value={profile.bio}
              onChange={(event) =>
                setProfile((current) =>
                  current ? { ...current, bio: event.target.value } : current,
                )
              }
            />
            <small>{profile.bio.length}/500</small>
          </label>
        </div>
      </section>
      <section className="profile-settings-card">
        <div>
          <h3>Avatar and banner</h3>
          <p>Verified static images are stored privately and served through profile visibility checks.</p>
        </div>
        <div className="profile-media-fields">
          {(
            [
              ["avatar", "Avatar", profile.avatarUrl],
              ["banner", "Banner", profile.bannerUrl],
            ] as const
          ).map(([slot, label, url]) => (
            <div className={`profile-media-field is-${slot}`} key={slot}>
              <span className="profile-media-preview">
                {url ? (
                  // Profile media uses a revisioned, authorization-aware endpoint.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={`${label} preview`} />
                ) : (
                  <small>No {label.toLowerCase()} uploaded</small>
                )}
              </span>
              <label>
                <strong>{label}</strong>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  disabled={mediaBusy !== null || profile.revision < 1}
                  onChange={(event) => {
                    void uploadMedia(slot, event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              {url ? (
                <button
                  type="button"
                  disabled={mediaBusy !== null}
                  onClick={() => void removeMedia(slot)}
                >
                  Remove
                </button>
              ) : null}
              {mediaBusy === slot ? <small>Processing verified image…</small> : null}
            </div>
          ))}
        </div>
      </section>
      <section className="profile-settings-card">
        <div>
          <h3>Privacy</h3>
          <p>These settings are enforced by the public profile API.</p>
        </div>
        <div className="profile-privacy-grid">
          <label>
            <span>Profile visibility</span>
            <select
              value={profile.privacy?.profileVisibility ?? "PUBLIC"}
              onChange={(event) =>
                setProfile((current) =>
                  current
                    ? {
                        ...current,
                        privacy: {
                          ...current.privacy,
                          profileVisibility: event.target.value as
                            | "PUBLIC"
                            | "PRIVATE",
                        },
                      }
                    : current,
                )
              }
            >
              <option value="PUBLIC">Public</option>
              <option value="PRIVATE">Private</option>
            </select>
          </label>
          <label>
            <span>Followers and following</span>
            <select
              value={profile.privacy?.followersVisibility ?? "PUBLIC"}
              onChange={(event) =>
                setProfile((current) =>
                  current
                    ? {
                        ...current,
                        privacy: {
                          ...current.privacy,
                          followersVisibility: event.target.value as
                            | "PUBLIC"
                            | "PRIVATE",
                        },
                      }
                    : current,
                )
              }
            >
              <option value="PUBLIC">Public counts</option>
              <option value="PRIVATE">Private</option>
            </select>
          </label>
          {(
            [
              [
                "showReadingHistory",
                "Share recent reading",
                "Shows a limited list of recently read public chapters.",
              ],
              [
                "showChapterNumbers",
                "Show chapter numbers",
                "Only applies when recent reading is shared.",
              ],
              [
                "showLibrarySummary",
                "Share Library summary",
                "Shows counts by reading status, never individual private entries.",
              ],
            ] as const
          ).map(([key, title, body]) => (
            <label className="profile-privacy-toggle" key={key}>
              <input
                type="checkbox"
                checked={Boolean(profile.privacy?.[key])}
                onChange={(event) =>
                  setProfile((current) =>
                    current
                      ? {
                          ...current,
                          privacy: {
                            ...current.privacy,
                            [key]: event.target.checked,
                          },
                        }
                      : current,
                  )
                }
              />
              <span>
                <strong>{title}</strong>
                <small>{body}</small>
              </span>
            </label>
          ))}
        </div>
      </section>
      <footer className="profile-settings-actions">
        <span>
          {dirty ? (
            <>
              <WarningCircle size={17} /> Unsaved changes
            </>
          ) : (
            <>
              <CheckCircle size={17} /> Saved
            </>
          )}
        </span>
        <button
          className="button button-primary"
          type="submit"
          disabled={!dirty || saving}
        >
          <FloppyDisk size={17} />
          {saving ? "Saving…" : "Save profile"}
        </button>
      </footer>
    </form>
  );
}
