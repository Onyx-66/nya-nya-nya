export type AccessType = "FREE" | "PAID";

export type SeriesCard = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  type: "Manga" | "Manhwa" | "Manhua";
  status: "Ongoing" | "Completed" | "Hiatus" | "Paused" | "Upcoming";
  access: AccessType;
  rating: number;
  followers: string;
  chapter: string;
  updated: string;
  cover: string;
  accent: string;
  genres: string[];
  direction: "RTL" | "LTR" | "VERTICAL";
  synopsis: string;
  originalTitle: string;
  creator: string;
  originalLanguage: string;
  originCountry: string;
  releaseYear: number | null;
  chapterCount: number;
  team: {
    name: string;
    slug: string;
    initials: string;
  };
};

const coreSeries: SeriesCard[] = [
  {
    id: "ser_neon_ronin",
    slug: "neon-ronin",
    title: "Neon Ronin",
    subtitle: "Blade protocol: broken",
    type: "Manga",
    status: "Ongoing",
    access: "PAID",
    rating: 4.8,
    followers: "41.2K",
    chapter: "Ch. 48",
    updated: "12 min",
    cover: "/art/cover-neon-ronin.png",
    accent: "#39a9ff",
    genres: ["Action", "Cyberpunk", "Mystery"],
    direction: "RTL",
    synopsis:
      "A disgraced security runner inherits a sword that remembers every broken oath in the city.",
    originalTitle: "ネオン浪人",
    creator: "Rin Aoyama",
    originalLanguage: "Japanese",
    originCountry: "Japan",
    releaseYear: 2024,
    chapterCount: 48,
    team: { name: "Black Kite", slug: "black-kite", initials: "BK" },
  },
  {
    id: "ser_glass_orchard",
    slug: "the-glass-orchard",
    title: "The Glass Orchard",
    subtitle: "Every bloom keeps a secret",
    type: "Manhwa",
    status: "Ongoing",
    access: "FREE",
    rating: 4.9,
    followers: "29.7K",
    chapter: "Ep. 31",
    updated: "38 min",
    cover: "/art/cover-glass-orchard.png",
    accent: "#39a9ff",
    genres: ["Fantasy", "Drama", "Romance"],
    direction: "VERTICAL",
    synopsis:
      "A botanist discovers that the crystal fruit in her inherited greenhouse preserves memories that were meant to disappear.",
    originalTitle: "유리 과수원",
    creator: "Hana Seo",
    originalLanguage: "Korean",
    originCountry: "South Korea",
    releaseYear: 2025,
    chapterCount: 31,
    team: { name: "Lumen House", slug: "lumen-house", initials: "LH" },
  },
  {
    id: "ser_signal_zero",
    slug: "signal-zero",
    title: "Signal Zero",
    subtitle: "The last broadcast is alive",
    type: "Manhwa",
    status: "Ongoing",
    access: "PAID",
    rating: 4.7,
    followers: "18.3K",
    chapter: "Ep. 22",
    updated: "2 hr",
    cover: "/art/cover-signal-zero.png",
    accent: "#39a9ff",
    genres: ["Sci-Fi", "Thriller", "Survival"],
    direction: "VERTICAL",
    synopsis:
      "A radio engineer hears a warning from tomorrow and has one night to change the transmission.",
    originalTitle: "시그널 제로",
    creator: "Jae-min Kwon",
    originalLanguage: "Korean",
    originCountry: "South Korea",
    releaseYear: 2025,
    chapterCount: 22,
    team: { name: "Black Kite", slug: "black-kite", initials: "BK" },
  },
  {
    id: "ser_crown_tides",
    slug: "crown-of-tides",
    title: "Crown of Tides",
    subtitle: "The sea remembers its heir",
    type: "Manhua",
    status: "Completed",
    access: "PAID",
    rating: 4.6,
    followers: "33.9K",
    chapter: "Ch. 86",
    updated: "1 day",
    cover: "/art/cover-crown-of-tides.png",
    accent: "#39a9ff",
    genres: ["Adventure", "Fantasy", "Political"],
    direction: "LTR",
    synopsis:
      "An exiled mapmaker is claimed by a drowned kingdom and the storm-bound crown hidden beneath it.",
    originalTitle: "潮汐王冠",
    creator: "Lin Yue",
    originalLanguage: "Chinese",
    originCountry: "China",
    releaseYear: 2022,
    chapterCount: 86,
    team: { name: "Tide Letter", slug: "tide-letter", initials: "TL" },
  },
  {
    id: "ser_moon_parcel",
    slug: "moon-parcel",
    title: "Moon Parcel",
    subtitle: "Delivery before dawn",
    type: "Manga",
    status: "Ongoing",
    access: "FREE",
    rating: 4.5,
    followers: "12.6K",
    chapter: "Issue 17",
    updated: "2 days",
    cover: "/art/cover-moon-parcel.png",
    accent: "#39a9ff",
    genres: ["Comedy", "Urban Fantasy", "Slice of Life"],
    direction: "LTR",
    synopsis:
      "A night courier and a very opinionated cat deliver impossible packages across a city that rearranges itself at sunrise.",
    originalTitle: "Moon Parcel",
    creator: "Mara Bell",
    originalLanguage: "English",
    originCountry: "United States",
    releaseYear: 2025,
    chapterCount: 17,
    team: { name: "Lumen House", slug: "lumen-house", initials: "LH" },
  },
  {
    id: "ser_ash_aster",
    slug: "ash-and-aster",
    title: "Ash & Aster",
    subtitle: "A garden at the end",
    type: "Manga",
    status: "Upcoming",
    access: "FREE",
    rating: 4.4,
    followers: "8.1K",
    chapter: "Preview",
    updated: "Friday",
    cover: "/art/cover-ash-aster.png",
    accent: "#39a9ff",
    genres: ["Fantasy", "Coming of Age", "Drama"],
    direction: "RTL",
    synopsis:
      "Two apprentices cultivate the final living seeds while an ash winter closes around their mountain sanctuary.",
    originalTitle: "灰とアスター",
    creator: "Mio Kagawa",
    originalLanguage: "Japanese",
    originCountry: "Japan",
    releaseYear: 2026,
    chapterCount: 5,
    team: { name: "Paper Lantern", slug: "paper-lantern", initials: "PL" },
  },
];

const testingSeriesRows = [
  ["ser_blue_hour_alchemist", "blue-hour-alchemist", "Blue Hour Alchemist", "Manga", "蒼時の錬金術師", "A novice alchemist can only transmute memories during the blue hour before sunrise.", "Japan", "Japanese", "RTL", "Fantasy", "Mystery", 4.7, 3],
  ["ser_regents_shadow", "the-regents-shadow", "The Regent's Shadow", "Manhwa", "섭정의 그림자", "A palace archivist discovers that the regent's shadow has been signing orders of its own.", "South Korea", "Korean", "VERTICAL", "Historical", "Mystery", 4.8, 3],
  ["ser_jade_circuit", "jade-circuit", "Jade Circuit", "Manhua", "玉回路", "An exiled engineer rebuilds ancient cultivation arrays as programmable jade machines.", "China", "Chinese", "LTR", "Action", "Sci-Fi", 4.6, 3],
  ["ser_atlas_falling_stars", "atlas-of-falling-stars", "Atlas of Falling Stars", "Manga", "墜星地図", "A student cartographer maps the places where fallen stars rewrite the laws of distance.", "Japan", "Japanese", "RTL", "Adventure", "Drama", 4.9, 3],
  ["ser_saffron_blade", "saffron-blade", "Saffron Blade", "Manhwa", "사프란 검", "A retired royal guard opens a spice shop and finds every customer tied to her final mission.", "South Korea", "Korean", "VERTICAL", "Action", "Slice of Life", 4.7, 3],
  ["ser_lanterns_winter", "lanterns-beyond-winter", "Lanterns Beyond Winter", "Manhua", "冬尽灯明", "Two lantern makers guide lost spirits through a winter that refuses to end.", "China", "Chinese", "LTR", "Drama", "Supernatural", 4.5, 3],
  ["ser_last_cartographer", "the-last-cartographer", "The Last Cartographer", "Manga", "最後の地図師", "The final licensed mapmaker must chart a continent that moves whenever it is observed.", "Japan", "Japanese", "RTL", "Adventure", "Fantasy", 4.8, 3],
  ["ser_crimson_tea_house", "crimson-tea-house", "Crimson Tea House", "Manhwa", "진홍 찻집", "A tea master solves supernatural disputes by brewing the one memory nobody wants to taste.", "South Korea", "Korean", "VERTICAL", "Mystery", "Supernatural", 4.6, 3],
  ["ser_celestial_mechanic", "celestial-mechanic", "Celestial Mechanic", "Manhua", "天工维修师", "A mechanic repairing divine weapons learns the heavens are overdue for maintenance.", "China", "Chinese", "LTR", "Action", "Fantasy", 4.7, 3],
  ["ser_after_school_exorcists", "after-school-exorcists", "After School Exorcists", "Manga", "放課後祓魔部", "Five students keep their school safe from urban legends before the last train home.", "Japan", "Japanese", "RTL", "Comedy", "Supernatural", 4.4, 3],
  ["ser_duchess_disasters", "a-duchess-of-small-disasters", "A Duchess of Small Disasters", "Manhwa", "소소한 재앙의 공작부인", "A meticulous duchess handles magical catastrophes that are never quite important enough for heroes.", "South Korea", "Korean", "VERTICAL", "Comedy", "Romance", 4.9, 3],
  ["ser_river_dragons_promise", "river-dragons-promise", "River Dragon's Promise", "Manhua", "江龙之约", "A ferry captain must honor a promise made to the river dragon who saved her village.", "China", "Chinese", "LTR", "Adventure", "Romance", 4.8, 3],
  ["ser_paper_moon_detective", "paper-moon-detective", "Paper Moon Detective", "Manga", "紙月探偵", "A private detective follows clues hidden in paper moons that appear above unsolved cases.", "Japan", "Japanese", "RTL", "Mystery", "Thriller", 4.5, 3],
  ["ser_villainess_receipts", "the-villainess-keeps-receipts", "The Villainess Keeps Receipts", "Manhwa", "악녀는 영수증을 보관한다", "Reborn as a notorious heiress, an accountant defeats court intrigue with impeccable records.", "South Korea", "Korean", "VERTICAL", "Comedy", "Romance", 4.9, 3],
  ["ser_fortress_quiet_gods", "fortress-of-quiet-gods", "Fortress of Quiet Gods", "Manhua", "静神堡", "A border captain discovers the silent statues defending her fortress are sleeping gods.", "China", "Chinese", "LTR", "Action", "Historical", 4.6, 3],
  ["ser_orbiting_you", "orbiting-you", "Orbiting You", "Manga", "君をめぐる軌道", "Two astronomy students keep meeting at the same observatory in slightly different timelines.", "Japan", "Japanese", "RTL", "Romance", "Sci-Fi", 4.8, 3],
  ["ser_apothecary_carthage", "the-apothecary-of-carthage", "The Apothecary of Carthage", "Manhwa", "قرطاج의 약제사", "A harbor apothecary deciphers remedies left by sailors from cities that no longer exist.", "Tunisia", "Arabic", "VERTICAL", "Historical", "Mystery", 4.7, 3],
  ["ser_black_salt_requiem", "black-salt-requiem", "Black Salt Requiem", "Manhua", "玄盐镇魂曲", "A musician hunts sea-born curses using an instrument strung with crystallized black salt.", "China", "Chinese", "LTR", "Action", "Supernatural", 4.5, 3],
  ["ser_cat_courier_midnight", "cat-courier-midnight", "Cat Courier Midnight", "Manga", "夜更けの猫便", "A street cat delivers letters between dreams and expects payment in grilled fish.", "Japan", "Japanese", "RTL", "Comedy", "Slice of Life", 4.6, 3],
] as const;

const testingCovers = [
  "/art/cover-neon-ronin.png",
  "/art/cover-glass-orchard.png",
  "/art/cover-signal-zero.png",
  "/art/cover-crown-of-tides.png",
  "/art/cover-ash-aster.png",
  "/art/cover-moon-parcel.png",
] as const;

const testingSeries: SeriesCard[] = testingSeriesRows.map((row, index) => {
  const [
    id,
    slug,
    title,
    type,
    originalTitle,
    synopsis,
    originCountry,
    originalLanguage,
    direction,
    firstGenre,
    secondGenre,
    rating,
    chapterCount,
  ] = row;
  return {
    id,
    slug,
    title,
    subtitle: `${firstGenre} · ${secondGenre}`,
    type,
    status: index % 5 === 3 ? "Completed" : "Ongoing",
    access: index % 3 === 1 ? "PAID" : "FREE",
    rating,
    followers: `${(5.9 + index * 0.67).toFixed(1)}K`,
    chapter: `Ch. ${chapterCount}`,
    updated: `${2 + index * 3} hr`,
    cover: testingCovers[index % testingCovers.length],
    accent: "#39a9ff",
    genres: [firstGenre, secondGenre],
    direction,
    synopsis,
    originalTitle,
    creator: `${title} Studio`,
    originalLanguage,
    originCountry,
    releaseYear: 2026 - (index % 4),
    chapterCount,
    team: {
      name: index % 2 ? "Black Kite" : "Lumen House",
      slug: index % 2 ? "black-kite" : "lumen-house",
      initials: index % 2 ? "BK" : "LH",
    },
  };
});

export const demoSeries: SeriesCard[] = [...coreSeries, ...testingSeries];

export const latestUpdates = [
  {
    title: "Neon Ronin",
    slug: "neon-ronin",
    chapters: [
      { label: "Chapter 48", slug: "chapter-48", time: "12 min", access: "Paid" },
      { label: "Chapter 47", slug: "chapter-47", time: "7d", access: "Paid" },
      { label: "Chapter 46", slug: "chapter-46", time: "14d", access: "Free" },
      { label: "Chapter 45", slug: "chapter-45", time: "21d", access: "Free" },
      { label: "Chapter 44", slug: "chapter-44", time: "28d", access: "Free" },
    ],
  },
  {
    title: "The Glass Orchard",
    slug: "the-glass-orchard",
    chapters: [
      { label: "Episode 31", slug: "episode-31", time: "38 min", access: "Free" },
      { label: "Episode 30", slug: "episode-30", time: "3d", access: "Free" },
      { label: "Episode 29", slug: "episode-29", time: "10d", access: "Free" },
      { label: "Episode 28", slug: "episode-28", time: "17d", access: "Free" },
      { label: "Episode 27", slug: "episode-27", time: "24d", access: "Free" },
    ],
  },
  {
    title: "Signal Zero",
    slug: "signal-zero",
    chapters: [
      { label: "Episode 22", slug: "episode-22", time: "2 hr", access: "Paid" },
      { label: "Episode 21", slug: "episode-21", time: "6d", access: "Paid" },
      { label: "Episode 20", slug: "episode-20", time: "13d", access: "Free" },
      { label: "Episode 19", slug: "episode-19", time: "20d", access: "Free" },
      { label: "Episode 18", slug: "episode-18", time: "27d", access: "Free" },
    ],
  },
  {
    title: "Crown of Tides",
    slug: "crown-of-tides",
    chapters: [
      { label: "Chapter 86", slug: "chapter-86", time: "1d", access: "Paid" },
      { label: "Chapter 85", slug: "chapter-85", time: "8d", access: "Paid" },
      { label: "Chapter 84", slug: "chapter-84", time: "15d", access: "Free" },
      { label: "Chapter 83", slug: "chapter-83", time: "22d", access: "Free" },
      { label: "Chapter 82", slug: "chapter-82", time: "29d", access: "Free" },
    ],
  },
  {
    title: "Moon Parcel",
    slug: "moon-parcel",
    chapters: [
      { label: "Issue 17", slug: "issue-17", time: "2d", access: "Free" },
      { label: "Issue 16", slug: "issue-16", time: "9d", access: "Free" },
      { label: "Issue 15", slug: "issue-15", time: "16d", access: "Free" },
      { label: "Issue 14", slug: "issue-14", time: "23d", access: "Free" },
      { label: "Issue 13", slug: "issue-13", time: "30d", access: "Free" },
    ],
  },
  {
    title: "Ash & Aster",
    slug: "ash-and-aster",
    chapters: [
      { label: "Preview 5", slug: "preview-5", time: "3d", access: "Free" },
      { label: "Preview 4", slug: "preview-4", time: "10d", access: "Free" },
      { label: "Preview 3", slug: "preview-3", time: "17d", access: "Free" },
      { label: "Preview 2", slug: "preview-2", time: "24d", access: "Free" },
      { label: "Preview 1", slug: "preview-1", time: "31d", access: "Free" },
    ],
  },
];

export function findSeries(slug: string) {
  return demoSeries.find((item) => item.slug === slug);
}
