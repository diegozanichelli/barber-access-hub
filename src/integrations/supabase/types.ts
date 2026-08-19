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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      cancelled_openings: {
        Row: {
          cancelled_by: string
          counts_snapshot: Json
          created_at: string
          id: string
          reason: string
          shift_snapshot: Json
        }
        Insert: {
          cancelled_by: string
          counts_snapshot: Json
          created_at?: string
          id?: string
          reason: string
          shift_snapshot: Json
        }
        Update: {
          cancelled_by?: string
          counts_snapshot?: Json
          created_at?: string
          id?: string
          reason?: string
          shift_snapshot?: Json
        }
        Relationships: []
      }
      cash_counts: {
        Row: {
          coins_005: number
          coins_010: number
          coins_025: number
          coins_050: number
          coins_1: number
          count_type: string
          counted_by: string
          created_at: string
          id: string
          notes: string | null
          notes_10: number
          notes_100: number
          notes_2: number
          notes_20: number
          notes_200: number
          notes_5: number
          notes_50: number
          shift_id: string
          total_calculated: number
        }
        Insert: {
          coins_005?: number
          coins_010?: number
          coins_025?: number
          coins_050?: number
          coins_1?: number
          count_type: string
          counted_by: string
          created_at?: string
          id?: string
          notes?: string | null
          notes_10?: number
          notes_100?: number
          notes_2?: number
          notes_20?: number
          notes_200?: number
          notes_5?: number
          notes_50?: number
          shift_id: string
          total_calculated?: number
        }
        Update: {
          coins_005?: number
          coins_010?: number
          coins_025?: number
          coins_050?: number
          coins_1?: number
          count_type?: string
          counted_by?: string
          created_at?: string
          id?: string
          notes?: string | null
          notes_10?: number
          notes_100?: number
          notes_2?: number
          notes_20?: number
          notes_200?: number
          notes_5?: number
          notes_50?: number
          shift_id?: string
          total_calculated?: number
        }
        Relationships: [
          {
            foreignKeyName: "cash_counts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_withdrawals: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          note: string | null
          partner_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          shift_id: string
          status: Database["public"]["Enums"]["withdrawal_status"]
          unit_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          partner_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shift_id: string
          status?: Database["public"]["Enums"]["withdrawal_status"]
          unit_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          partner_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shift_id?: string
          status?: Database["public"]["Enums"]["withdrawal_status"]
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_withdrawals_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_withdrawals_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          full_name: string
          id: string
          requested_role: Database["public"]["Enums"]["app_role"] | null
          status: Database["public"]["Enums"]["approval_status"]
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          full_name?: string
          id: string
          requested_role?: Database["public"]["Enums"]["app_role"] | null
          status?: Database["public"]["Enums"]["approval_status"]
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          full_name?: string
          id?: string
          requested_role?: Database["public"]["Enums"]["app_role"] | null
          status?: Database["public"]["Enums"]["approval_status"]
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          actual_opening_total: number
          closed_at: string | null
          closed_by: string | null
          closing_total: number | null
          created_at: string
          expected_closing_total: number | null
          expected_opening_total: number
          id: string
          opened_at: string
          opened_by: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          actual_opening_total?: number
          closed_at?: string | null
          closed_by?: string | null
          closing_total?: number | null
          created_at?: string
          expected_closing_total?: number | null
          expected_opening_total?: number
          id?: string
          opened_at?: string
          opened_by: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          actual_opening_total?: number
          closed_at?: string | null
          closed_by?: string | null
          closing_total?: number | null
          created_at?: string
          expected_closing_total?: number | null
          expected_opening_total?: number
          id?: string
          opened_at?: string
          opened_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["transaction_category"]
          client_name: string | null
          created_at: string
          description: string | null
          id: string
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          photo_url: string | null
          reversed_at: string | null
          reversed_by: string | null
          reverses_transaction_id: string | null
          shift_id: string
          transaction_type: string
          unit_id: string
          user_id: string
        }
        Insert: {
          amount: number
          category: Database["public"]["Enums"]["transaction_category"]
          client_name?: string | null
          created_at?: string
          description?: string | null
          id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          photo_url?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reverses_transaction_id?: string | null
          shift_id: string
          transaction_type: string
          unit_id: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["transaction_category"]
          client_name?: string | null
          created_at?: string
          description?: string | null
          id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          photo_url?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reverses_transaction_id?: string | null
          shift_id?: string
          transaction_type?: string
          unit_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_reverses_transaction_id_fkey"
            columns: ["reverses_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      correct_opening_cash_count: {
        Args: { _quantities: Json; _reason: string; _shift_id: string }
        Returns: number
      }
      decide_transaction_change_request: {
        Args: { _approve: boolean; _decision_note?: string; _request_id: string }
        Returns: undefined
      }
      delete_empty_open_shift: {
        Args: { _reason: string; _shift_id: string }
        Returns: undefined
      }
      list_transaction_change_requests: { Args: never; Returns: Json[] }
      request_transaction_change: {
        Args: {
          _action: "edit" | "delete"
          _proposed_amount?: number | null
          _proposed_description?: string | null
          _reason: string
          _transaction_id: string
        }
        Returns: string
      }
      close_shift: {
        Args: {
          _notes?: string
          _quantities: Json
          _shift_id: string
        }
        Returns: Json
      }
      create_partner_withdrawal: {
        Args: {
          _amount: number
          _note?: string
          _partner_id: string
          _shift_id: string
        }
        Returns: string
      }
      current_unit_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
      list_partners: {
        Args: never
        Returns: {
          full_name: string
          id: string
          unit_id: string
        }[]
      }
      open_shift: {
        Args: {
          _notes?: string
          _quantities: Json
          _unit_id: string
        }
        Returns: string
      }
      receive_handover: {
        Args: {
          _notes?: string
          _pending_shift_id: string
          _quantities: Json
        }
        Returns: Json
      }
      resolve_shift_dispute: {
        Args: { _note: string; _shift_id: string }
        Returns: undefined
      }
      respond_partner_withdrawal: {
        Args: {
          _decision: Database["public"]["Enums"]["withdrawal_status"]
          _withdrawal_id: string
        }
        Returns: Database["public"]["Enums"]["withdrawal_status"]
      }
      resolve_withdrawal_dispute: {
        Args: { _note: string; _withdrawal_id: string }
        Returns: undefined
      }
      reverse_transaction: {
        Args: { _reason: string; _transaction_id: string }
        Returns: string
      }
      unit_safe_balance: { Args: { _unit_id: string }; Returns: number }
    }
    Enums: {
      app_role: "atendente" | "supervisor" | "socio" | "auditor"
      approval_status: "pending" | "approved" | "rejected"
      payment_method: "Pix" | "Crédito" | "Débito" | "Dinheiro"
      transaction_category:
        | "Bebida"
        | "Assinatura Nova"
        | "Renovação"
        | "Despesa"
        | "Sangria"
      withdrawal_status: "pending" | "approved" | "disputed"
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
      app_role: ["atendente", "supervisor", "socio", "auditor"],
      approval_status: ["pending", "approved", "rejected"],
      payment_method: ["Pix", "Crédito", "Débito", "Dinheiro"],
      transaction_category: [
        "Bebida",
        "Assinatura Nova",
        "Renovação",
        "Despesa",
        "Sangria",
      ],
      withdrawal_status: ["pending", "approved", "disputed"],
    },
  },
} as const
