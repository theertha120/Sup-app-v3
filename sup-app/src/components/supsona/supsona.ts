/**
 * Supsona: customisable avatar (like Duolingo/Picrew).
 * Stored as JSON in profiles.avatar (avatar_url in DB).
 */

export const FACE_SHAPES = ["round", "oval", "soft-square"] as const;
export type FaceShapeId = (typeof FACE_SHAPES)[number];

export const HAIR_STYLES = ["short", "long-straight", "curly"] as const;
export type HairStyleId = (typeof HAIR_STYLES)[number];

export const HAIR_COLOURS = [
  "black",
  "brown",
  "blonde",
  "auburn",
  "grey",
  "blue",
  "pink",
] as const;
export type HairColourId = (typeof HAIR_COLOURS)[number];

export const SKIN_TONES = ["warm-light", "light", "medium", "tan", "deep"] as const;
export type SkinToneId = (typeof SKIN_TONES)[number];

export const SHIRT_COLOURS = [
  "white",
  "navy",
  "red",
  "green",
  "yellow",
  "lavender",
  "coral",
] as const;
export type ShirtColourId = (typeof SHIRT_COLOURS)[number];

export interface Supsona {
  faceShape: FaceShapeId;
  hairStyle: HairStyleId;
  hairColour: HairColourId;
  skinTone: SkinToneId;
  shirtColour: ShirtColourId;
}

export const DEFAULT_SUPSONA: Supsona = {
  faceShape: "round",
  hairStyle: "short",
  hairColour: "brown",
  skinTone: "light",
  shirtColour: "lavender",
};

const SUPSONA_JSON_PREFIX = "supsona:";

/** Serialise supsona for storage in avatar_url. */
export function stringifySupsona(s: Supsona): string {
  return SUPSONA_JSON_PREFIX + JSON.stringify(s);
}

/** Parse avatar string: if it's supsona JSON, return Supsona; else null. */
export function parseSupsona(avatar: string | undefined | null): Supsona | null {
  if (!avatar || typeof avatar !== "string" || !avatar.startsWith(SUPSONA_JSON_PREFIX)) {
    return null;
  }
  try {
    const json = avatar.slice(SUPSONA_JSON_PREFIX.length);
    const parsed = JSON.parse(json) as Partial<Supsona>;
    if (
      parsed &&
      FACE_SHAPES.includes(parsed.faceShape as FaceShapeId) &&
      HAIR_STYLES.includes(parsed.hairStyle as HairStyleId) &&
      HAIR_COLOURS.includes(parsed.hairColour as HairColourId) &&
      SKIN_TONES.includes(parsed.skinTone as SkinToneId) &&
      SHIRT_COLOURS.includes(parsed.shirtColour as ShirtColourId)
    ) {
      return parsed as Supsona;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Returns true if avatar value is stored supsona JSON. */
export function isSupsonaAvatar(avatar: string | undefined | null): boolean {
  return Boolean(avatar && typeof avatar === "string" && avatar.startsWith(SUPSONA_JSON_PREFIX));
}

function pickRandom<T>(options: readonly T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

/** Builds a supsona with a random option for every field. */
export function randomSupsona(): Supsona {
  return {
    faceShape: pickRandom(FACE_SHAPES),
    hairStyle: pickRandom(HAIR_STYLES),
    hairColour: pickRandom(HAIR_COLOURS),
    skinTone: pickRandom(SKIN_TONES),
    shirtColour: pickRandom(SHIRT_COLOURS),
  };
}

/** Serialised random supsona, ready to store directly in `avatar_url`. */
export function randomAvatarUrl(): string {
  return stringifySupsona(randomSupsona());
}
