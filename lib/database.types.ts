// Types for the Supabase schema in /supabase/migrations.
// Hand-written in the same shape as `supabase gen types typescript`.
// After changing the schema you can regenerate them with:
//   npx supabase gen types typescript --project-id <id> > lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SubmissionStatus = "pending" | "approved" | "rejected";
export type PayoutStatus = "unpaid" | "paid";

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          phone: string | null;
          whatsapp: string | null;
          nic: string | null;
          avatar_path: string | null;
          date_of_birth: string | null;
          is_admin: boolean;
          is_main_admin: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string;
          phone?: string | null;
          whatsapp?: string | null;
          nic?: string | null;
          avatar_path?: string | null;
          is_admin?: boolean;
          is_main_admin?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          phone?: string | null;
          whatsapp?: string | null;
          nic?: string | null;
          avatar_path?: string | null;
          is_admin?: boolean;
          is_main_admin?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      bank_details: {
        Row: {
          user_id: string;
          bank_name: string;
          branch: string;
          account_holder: string;
          account_number: string;
          account_last4: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          bank_name: string;
          branch: string;
          account_holder: string;
          account_number: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          bank_name?: string;
          branch?: string;
          account_holder?: string;
          account_number?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bank_details_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      sections: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      roles: {
        Row: {
          id: string;
          section_id: string;
          name: string;
          description: string | null;
          is_salaried: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          section_id: string;
          name: string;
          description?: string | null;
          is_salaried?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          section_id?: string;
          name?: string;
          description?: string | null;
          is_salaried?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "roles_section_id_fkey";
            columns: ["section_id"];
            isOneToOne: false;
            referencedRelation: "sections";
            referencedColumns: ["id"];
          },
        ];
      };
      member_salaries: {
        Row: {
          user_id: string;
          role_id: string;
          monthly_amount: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          role_id: string;
          monthly_amount?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          role_id?: string;
          monthly_amount?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "member_salaries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_salaries_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      activity_log: {
        Row: {
          id: number;
          created_at: string;
          actor_id: string | null;
          actor_name: string;
          action: string;
          entity_type: string;
          entity_id: string | null;
          target_user_id: string | null;
          target_name: string | null;
          summary: string;
          details: Json;
        };
        // Written only by database functions.
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      pay_months: {
        Row: {
          month: string;
          closed_at: string;
          closed_by: string | null;
          note: string | null;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [
          {
            foreignKeyName: "pay_months_closed_by_fkey";
            columns: ["closed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payouts: {
        Row: {
          id: string;
          month: string;
          payslip_no: string;
          user_id: string | null;
          member_name: string;
          member_email: string;
          member_phone: string | null;
          member_nic: string | null;
          bank_name: string | null;
          bank_branch: string | null;
          account_holder: string | null;
          account_last4: string | null;
          salary_amount: number;
          work_amount: number;
          total_amount: number;
          approved_items: number;
          approved_units: number;
          salary_lines: Json;
          work_lines: Json;
          status: PayoutStatus;
          paid_on: string | null;
          paid_at: string | null;
          paid_by: string | null;
          payment_reference: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [
          {
            foreignKeyName: "payouts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_paid_by_fkey";
            columns: ["paid_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_month_fkey";
            columns: ["month"];
            isOneToOne: false;
            referencedRelation: "pay_months";
            referencedColumns: ["month"];
          },
        ];
      };
      notifications: {
        Row: {
          id: number;
          user_id: string;
          kind: string;
          title: string;
          body: string | null;
          link: string | null;
          dedupe_key: string | null;
          created_at: string;
          read_at: string | null;
        };
        // Created only by database functions; people can mark their own as read.
        Insert: { [_ in never]: never };
        Update: { read_at?: string | null };
        Relationships: [];
      };
      month_deadlines: {
        Row: {
          month: string;
          deadline: string;
          set_by: string | null;
          created_at: string;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      app_settings: {
        Row: {
          id: boolean;
          monthly_budget: number;
          deadline_enabled: boolean;
          deadline_day: number;
          reminder_days: number;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          monthly_budget?: number;
          deadline_enabled?: boolean;
          deadline_day?: number;
          reminder_days?: number;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          monthly_budget?: number;
          deadline_enabled?: boolean;
          deadline_day?: number;
          reminder_days?: number;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      announcements: {
        Row: {
          id: string;
          title: string;
          body: string | null;
          pinned: boolean;
          expires_on: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          body?: string | null;
          pinned?: boolean;
          expires_on?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          body?: string | null;
          pinned?: boolean;
          expires_on?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_items: {
        Row: {
          id: string;
          role_id: string;
          name: string;
          unit: string;
          price: number;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          role_id: string;
          name: string;
          unit?: string;
          price?: number;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          role_id?: string;
          name?: string;
          unit?: string;
          price?: number;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rate_items_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      member_roles: {
        Row: {
          user_id: string;
          role_id: string;
          assigned_at: string;
        };
        Insert: {
          user_id: string;
          role_id: string;
          assigned_at?: string;
        };
        Update: {
          user_id?: string;
          role_id?: string;
          assigned_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "member_roles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_roles_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      submissions: {
        Row: {
          id: string;
          user_id: string;
          role_id: string;
          work_month: string;
          title: string;
          description: string | null;
          quantity: number;
          date_done: string;
          links: string[];
          status: SubmissionStatus;
          admin_comment: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          rate_item_id: string | null;
          unit_price: number | null;
          amount: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role_id: string;
          work_month: string;
          title: string;
          description?: string | null;
          quantity?: number;
          date_done: string;
          links?: string[];
          status?: SubmissionStatus;
          admin_comment?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          rate_item_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          role_id?: string;
          work_month?: string;
          title?: string;
          description?: string | null;
          quantity?: number;
          date_done?: string;
          links?: string[];
          status?: SubmissionStatus;
          admin_comment?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          rate_item_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "submissions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_rate_item_id_fkey";
            columns: ["rate_item_id"];
            isOneToOne: false;
            referencedRelation: "rate_items";
            referencedColumns: ["id"];
          },
        ];
      };
      submission_attachments: {
        Row: {
          id: string;
          submission_id: string;
          user_id: string;
          storage_path: string;
          file_name: string;
          mime_type: string | null;
          size_bytes: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          submission_id: string;
          user_id: string;
          storage_path: string;
          file_name: string;
          mime_type?: string | null;
          size_bytes: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          submission_id?: string;
          user_id?: string;
          storage_path?: string;
          file_name?: string;
          mime_type?: string | null;
          size_bytes?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "submission_attachments_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "submissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submission_attachments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      approved_work_summary: {
        Row: {
          user_id: string;
          work_month: string;
          role_id: string;
          approved_count: number;
          total_quantity: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_active_member: { Args: Record<PropertyKey, never>; Returns: boolean };
      nic_birth_date: { Args: { nic: string }; Returns: string | null };
      is_main_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      log_event: { Args: { p_action: string; p_target?: string | null; p_details?: Json }; Returns: undefined };
      close_pay_month: { Args: { p_month: string; p_note?: string | null }; Returns: number };
      reopen_pay_month: { Args: { p_month: string }; Returns: undefined };
      work_deadline: { Args: { p_month: string }; Returns: string | null };
      work_deadlines: { Args: { p_months: string[] }; Returns: { month: string; deadline: string | null }[] };
      set_month_deadline: { Args: { p_month: string; p_last_day: string | null }; Returns: undefined };
      send_deadline_reminders: { Args: Record<PropertyKey, never>; Returns: number };
      set_payouts_paid: {
        Args: { p_ids: string[]; p_paid: boolean; p_paid_on?: string | null; p_reference?: string | null };
        Returns: number;
      };
    };
    Enums: {
      submission_status: SubmissionStatus;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];

export type Profile = Tables<"profiles">;
export type Section = Tables<"sections">;
export type Role = Tables<"roles">;
export type Submission = Tables<"submissions">;
export type SubmissionAttachment = Tables<"submission_attachments">;
export type RateItem = Tables<"rate_items">;
export type Announcement = Tables<"announcements">;
export type Payout = Tables<"payouts">;
export type ActivityEntry = Tables<"activity_log">;
export type AppNotification = Tables<"notifications">;
