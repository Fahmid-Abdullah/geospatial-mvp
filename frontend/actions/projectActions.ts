"use server";
import { supabase } from "@/lib/supabaseClient";
import { ProjectType } from "@/types/tableTypes";

export async function GetProjects(): Promise<ProjectType[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name");

  if (error) {
    console.error("Project Fetch Error:", error);
    throw error;
  }

  return data ?? [];
}

export async function CreateProject({ project_name }: { project_name: string }): Promise<ProjectType> {
  const { data, error } = await supabase
    .from("projects")
    .insert({ name: project_name })
    .select("id, name")
    .single();

  if (error) {
    console.error("Project Create Error:", error);
    throw error;
  }

  return data;
}

export async function UpdateProject({ project_id, project_name }: { project_id: string; project_name: string }): Promise<ProjectType> {
  const { data, error } = await supabase
    .from("projects")
    .update({ name: project_name })
    .eq("id", project_id)
    .select("id, name")
    .single();

  if (error) {
    console.error("Project Update Error:", error);
    throw error;
  }

  return data;
}

export async function DeleteProject({ project_id }: { project_id: string }): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", project_id)

  if (error) {
    console.error("Project Delete Error:", error);
    throw error;
  }
}