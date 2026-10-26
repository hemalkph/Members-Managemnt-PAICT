// Types for the Supabase schema in /supabase/migrations.
// Hand-written in the same shape as `supabase gen types typescript`.
// After changing the schema you can regenerate them with:
//   npx supabase gen types typescript --project-id <id> > lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SubmissionStatus = "pending" | "approved" | "rejected";

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
