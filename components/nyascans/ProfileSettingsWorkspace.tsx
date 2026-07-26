"use client";

import {
  ArrowSquareOut,
  Camera,
  CheckCircle,
  FloppyDisk,
  ImageSquare,
  Trash,
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

function profileUpdatePayload(profile: OwnProfile) {
  return {
    username: profile.username,
    bio: profile.bio,
    preferredLanguage: profile.preferredLanguage,
    profileVisibility: profile.privacy?.profileVisibility ?? "PUBLIC",
    followersVisibility: profile.privacy?.followersVisibility ?? "PUBLIC",
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
  };
}

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
        body: JSON.stringify(profileUpdatePayload(profile)),
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
    setMediaBusy(slot);
    setError("");
    try {
      let uploadProfile = profile;
      if (uploadProfile.revision < 1) {
        const profileResponse = await fetch("/api/v1/profiles", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(profileUpdatePayload(uploadProfile)),
        });
        const profilePayload = (await profileResponse.json()) as {
          revision?: number;
          username?: string;
          error?: { message?: string };
        };
        if (
          !profileResponse.ok ||
          typeof profilePayload.revision !== "number"
        ) {
          throw new Error(
            profilePayload.error?.message ??
              "Save the profile before uploading media.",
          );
        }
        uploadProfile = {
          ...uploadProfile,
          username: profilePayload.username ?? uploadProfile.username,
          revision: profilePayload.revision,
        };
        setProfile((current) =>
          current
            ? {
                ...current,
                username: uploadProfile.username,
                revision: uploadProfile.revision,
              }
            : current,
        );
        setInitial(JSON.stringify(uploadProfile));
      }
      const body = new FormData();
      body.set("slot", slot);
      body.set("revision", String(uploadProfile.revision));
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
      const mediaKey = slot === "avatar" ? "avatarUrl" : "bannerUrl";
      setProfile((current) =>
        current
          ? {
              ...current,
              revision: payload.revision!,
              [mediaKey]: payload.url ?? null,
            }
          : current,
      );
      setInitial((current) => {
        const baseline = JSON.parse(current || JSON.stringify(uploadProfile)) as OwnProfile;
        return JSON.stringify({
          ...baseline,
          revision: payload.revision,
          [mediaKey]: payload.url ?? null,
        });
      });
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
      const mediaKey = slot === "avatar" ? "avatarUrl" : "bannerUrl";
      setProfile((current) =>
        current
          ? { ...current, revision: payload.revision!, [mediaKey]: null }
          : current,
      );
      setInitial((current) => {
        const baseline = JSON.parse(current) as OwnProfile;
        return JSON.stringify({
          ...baseline,
          revision: payload.revision,
          [mediaKey]: null,
        });
      });
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
      <section className="profile-settings-card profile-media-composer">
        <div className="profile-media-banner-stage">
          {profile.bannerUrl ? (
            // Profile media uses a revisioned, authorization-aware endpoint.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.bannerUrl} alt="Profile banner preview" />
          ) : (
            <span><ImageSquare size={30} /> Add a profile banner</span>
          )}
          <span className="profile-media-avatar-preview">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="Avatar preview" />
            ) : (
              profile.displayName.slice(0, 1).toUpperCase()
            )}
          </span>
          <label className="profile-media-action is-banner">
            <ImageSquare size={17} />
            {profile.bannerUrl ? "Change banner" : "Upload banner"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={mediaBusy !== null}
              onChange={(event) => {
                void uploadMedia("banner", event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {profile.bannerUrl ? (
            <button
              className="profile-media-remove is-banner"
              type="button"
              disabled={mediaBusy !== null}
              onClick={() => void removeMedia("banner")}
              aria-label="Remove profile banner"
            >
              <Trash size={16} />
            </button>
          ) : null}
        </div>
        <div className="profile-media-avatar-stage">
          <label className="profile-media-action is-avatar">
            <Camera size={17} />
            {profile.avatarUrl ? "Change avatar" : "Upload avatar"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={mediaBusy !== null}
              onChange={(event) => {
                void uploadMedia("avatar", event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {profile.avatarUrl ? (
            <button
              className="profile-media-remove is-avatar"
              type="button"
              disabled={mediaBusy !== null}
              onClick={() => void removeMedia("avatar")}
            >
              <Trash size={16} /> Remove
            </button>
          ) : null}
          {mediaBusy ? <small role="status">Processing verified {mediaBusy}…</small> : null}
          {!mediaBusy && profile.revision < 1 ? (
            <small>Your profile will be saved automatically with the first upload.</small>
          ) : null}
        </div>
      </section>
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
