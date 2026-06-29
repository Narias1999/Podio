export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      contact_submissions: {
        Row: {
          created_at: string
          email: string
          handled: boolean
          id: string
          message: string
          name: string
          organization: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string
          email: string
          handled?: boolean
          id?: string
          message: string
          name: string
          organization?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          handled?: boolean
          id?: string
          message?: string
          name?: string
          organization?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          age_max: number | null
          age_min: number | null
          id: string
          name: string
          race_id: string
          sex: string | null
          sort_order: number
        }
        Insert: {
          age_max?: number | null
          age_min?: number | null
          id?: string
          name: string
          race_id: string
          sex?: string | null
          sort_order: number
        }
        Update: {
          age_max?: number | null
          age_min?: number | null
          id?: string
          name?: string
          race_id?: string
          sex?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          max_users: number
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_users?: number
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          max_users?: number
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          id: string
          organization_id: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      races: {
        Row: {
          banner_url: string | null
          created_at: string
          description: string | null
          discipline: string
          ends_at: string | null
          id: string
          is_multi_stage: boolean
          location: string
          name: string
          organization_id: string
          organizer_id: string
          registrations_closed: boolean
          slug: string
          starts_at: string
          status: string
        }
        Insert: {
          banner_url?: string | null
          created_at?: string
          description?: string | null
          discipline: string
          ends_at?: string | null
          id?: string
          is_multi_stage?: boolean
          location: string
          name: string
          organization_id: string
          organizer_id: string
          registrations_closed?: boolean
          slug: string
          starts_at: string
          status?: string
        }
        Update: {
          banner_url?: string | null
          created_at?: string
          description?: string | null
          discipline?: string
          ends_at?: string | null
          id?: string
          is_multi_stage?: boolean
          location?: string
          name?: string
          organization_id?: string
          organizer_id?: string
          registrations_closed?: boolean
          slug?: string
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "races_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      registrations: {
        Row: {
          bib_number: number | null
          category_id: string
          id: string
          race_id: string
          rider_id: string
          status: string
        }
        Insert: {
          bib_number?: number | null
          category_id: string
          id?: string
          race_id: string
          rider_id: string
          status?: string
        }
        Update: {
          bib_number?: number | null
          category_id?: string
          id?: string
          race_id?: string
          rider_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "registrations_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      results: {
        Row: {
          captured_at: string | null
          dnf_reason: string | null
          dsq_reason: string | null
          elapsed_seconds: number | null
          finish_time: string | null
          group_position: number | null
          id: string
          net_seconds: number | null
          position: number | null
          registration_id: string
          stage_id: string
          status: string
        }
        Insert: {
          captured_at?: string | null
          dnf_reason?: string | null
          dsq_reason?: string | null
          elapsed_seconds?: number | null
          finish_time?: string | null
          group_position?: number | null
          id?: string
          net_seconds?: number | null
          position?: number | null
          registration_id: string
          stage_id: string
          status?: string
        }
        Update: {
          captured_at?: string | null
          dnf_reason?: string | null
          dsq_reason?: string | null
          elapsed_seconds?: number | null
          finish_time?: string | null
          group_position?: number | null
          id?: string
          net_seconds?: number | null
          position?: number | null
          registration_id?: string
          stage_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "results_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "results_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      riders: {
        Row: {
          date_of_birth: string
          document_number: string
          eps: string | null
          id: string
          name: string
          nationality: string | null
          phone: string | null
          sex: string
          team: string | null
        }
        Insert: {
          date_of_birth: string
          document_number: string
          eps?: string | null
          id?: string
          name: string
          nationality?: string | null
          phone?: string | null
          sex: string
          team?: string | null
        }
        Update: {
          date_of_birth?: string
          document_number?: string
          eps?: string | null
          id?: string
          name?: string
          nationality?: string | null
          phone?: string | null
          sex?: string
          team?: string | null
        }
        Relationships: []
      }
      stage_category_starts: {
        Row: {
          category_id: string
          id: string
          stage_id: string
          started_at: string
        }
        Insert: {
          category_id: string
          id?: string
          stage_id: string
          started_at: string
        }
        Update: {
          category_id?: string
          id?: string
          stage_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_category_starts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_category_starts_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      stages: {
        Row: {
          date: string
          distance_km: number | null
          id: string
          name: string
          race_id: string
          results_locked: boolean
          stage_number: number
          stage_type: string
        }
        Insert: {
          date: string
          distance_km?: number | null
          id?: string
          name: string
          race_id: string
          results_locked?: boolean
          stage_number: number
          stage_type: string
        }
        Update: {
          date?: string
          distance_km?: number | null
          id?: string
          name?: string
          race_id?: string
          results_locked?: boolean
          stage_number?: number
          stage_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "stages_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      tt_start_order: {
        Row: {
          id: string
          position: number
          registration_id: string
          stage_id: string
          start_time: string | null
        }
        Insert: {
          id?: string
          position: number
          registration_id: string
          stage_id: string
          start_time?: string | null
        }
        Update: {
          id?: string
          position?: number
          registration_id?: string
          stage_id?: string
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tt_start_order_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tt_start_order_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      user_role: "super_admin" | "admin" | "operator"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      user_role: ["super_admin", "admin", "operator"],
    },
  },
} as const
