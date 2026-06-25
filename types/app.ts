import type { Database } from "@/types/database";

export type Race = Database["public"]["Tables"]["races"]["Row"];
export type Stage = Database["public"]["Tables"]["stages"]["Row"];
export type Category = Database["public"]["Tables"]["categories"]["Row"];
export type StageCategoryStart =
  Database["public"]["Tables"]["stage_category_starts"]["Row"];
export type Rider = Database["public"]["Tables"]["riders"]["Row"];
export type Registration =
  Database["public"]["Tables"]["registrations"]["Row"];
export type TtStartOrder =
  Database["public"]["Tables"]["tt_start_order"]["Row"];
export type Result = Database["public"]["Tables"]["results"]["Row"];

export type StageType =
  | "road"
  | "time_trial"
  | "criterium"
  | "mountain"
  | "sprint";
export type RaceStatus = "draft" | "published" | "completed";
export type ResultStatus = "finished" | "dnf" | "dsq" | "dns";
export type Discipline = "cycling" | "running";
export type Sex = "male" | "female";
