import type { Download } from "../api";

export const CATEGORY_NAMES = ["Compressed", "Documents", "Music", "Programs", "Video"];

/** Tree node keys look like "all", "all:Video", "unfinished:Music", "finished", "queue". */
export function matchesFilter(d: Download, key: string): boolean {
  const [group, category] = key.split(":");
  if (category && d.category !== category) return false;
  switch (group) {
    case "unfinished":
      return d.status !== "completed";
    case "finished":
      return d.status === "completed";
    case "queue":
      return d.status !== "completed";
    default:
      return true;
  }
}

export function filterTitle(key: string): string {
  const [group, category] = key.split(":");
  const g = { all: "All Downloads", unfinished: "Unfinished", finished: "Finished", queue: "Main download queue" }[group] ?? group;
  return category ? `${g} \\ ${category}` : g;
}
