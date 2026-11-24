// Types for the Supabase schema in /supabase/migrations.
// Hand-written in the same shape as `supabase gen types typescript`.
// After changing the schema you can regenerate them with:
//   npx supabase gen types typescript --project-id <id> > lib/supabase/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SubmissionStatus = "pending" | "approved" | "rejected";
export type ConcessionCard = "free" | "half" | "paid";
export type ConcessionStatus = "applied" | "verified" | "under_review" | "ended";
export type ConcessionRelationship = "mother" | "father" | "guardian";
export type ConcessionAttendance = "present" | "absent" | "excused";
export type PayoutStatus = "unpaid" | "paid";
export type TaskStatus = "waiting" | "open" | "done" | "cancelled";
export type PaperStageName =
  | "create_si"
  | "typeset_si"
  | "convert"
  | "typeset_en"
  | "review_si"
  | "review_en"
  | "handover"
  | "scheme"
  | "scheme_rewrite"
  | "scheme_en"
  | "mark";
export type PaperFileTag = "paper" | "corrected" | "images" | "answers" | "marked" | "source" | "final" | "other";
export type FeeFollowupStatus = "pending" | "messaged" | "excused" | "dropped";

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
          page_access: Json | null;
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
          page_access?: Json | null;
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
          page_access?: Json | null;
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
      member_pay_starts: {
        Row: {
          user_id: string;
          from_month: string;
          set_by: string | null;
          set_at: string;
        };
        Insert: {
          user_id: string;
          from_month: string;
          set_by?: string | null;
          set_at?: string;
        };
        Update: {
          user_id?: string;
          from_month?: string;
          set_by?: string | null;
          set_at?: string;
        };
        Relationships: [];
      };
      member_salaries: {
        Row: {
          user_id: string;
          role_id: string;
          monthly_amount: number;
          from_month: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          role_id: string;
          monthly_amount?: number;
          from_month?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          role_id?: string;
          monthly_amount?: number;
          from_month?: string;
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
      batches: {
        Row: {
          id: string;
          name: string;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: { id?: string; name: string; is_active?: boolean; sort_order?: number };
        Update: { name?: string; is_active?: boolean; sort_order?: number };
        Relationships: [];
      };
      exams: {
        Row: {
          id: string;
          batch_id: string;
          name: string;
          exam_date: string | null;
          is_active: boolean;
          series_id: string | null;
          number: number | null;
          created_at: string;
        };
        Insert: { id?: string; batch_id: string; name: string; exam_date?: string | null; is_active?: boolean };
        Update: { batch_id?: string; name?: string; exam_date?: string | null; is_active?: boolean };
        Relationships: [
          {
            foreignKeyName: "exams_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
        ];
      };
      centres: {
        Row: {
          id: string;
          name: string;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: { id?: string; name: string; is_active?: boolean; sort_order?: number };
        Update: { name?: string; is_active?: boolean; sort_order?: number };
        Relationships: [];
      };
      concession_students: {
        Row: {
          id: string;
          student_no: string;
          full_name: string;
          batch_id: string;
          centre_id: string | null;
          card_type: ConcessionCard;
          status: ConcessionStatus;
          status_changed_at: string;
          created_by: string | null;
          created_at: string;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [
          {
            foreignKeyName: "concession_students_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "concession_students_centre_id_fkey";
            columns: ["centre_id"];
            isOneToOne: false;
            referencedRelation: "centres";
            referencedColumns: ["id"];
          },
        ];
      };
      concession_student_private: {
        Row: {
          student_id: string;
          gn_division: string;
          certificate_issued_on: string | null;
          reason: string;
          monthly_amount: number | null;
          consent_on: string | null;
          verified_by: string | null;
          verified_at: string | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [
          {
            foreignKeyName: "concession_student_private_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: true;
            referencedRelation: "concession_students";
            referencedColumns: ["id"];
          },
        ];
      };
      concession_guardians: {
        Row: {
          id: string;
          student_id: string;
          relationship: ConcessionRelationship;
          full_name: string;
          occupation: string;
          phone: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          student_id: string;
          relationship: ConcessionRelationship;
          full_name: string;
          occupation: string;
          phone?: string | null;
        };
        Update: { relationship?: ConcessionRelationship; full_name?: string; occupation?: string; phone?: string | null };
        Relationships: [
          {
            foreignKeyName: "concession_guardians_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "concession_students";
            referencedColumns: ["id"];
          },
        ];
      };
      concession_documents: {
        Row: {
          id: string;
          student_id: string;
          storage_path: string;
          file_name: string;
          mime_type: string | null;
          size_bytes: number;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          student_id: string;
          storage_path: string;
          file_name: string;
          mime_type?: string | null;
          size_bytes: number;
          uploaded_by: string;
        };
        Update: { [_ in never]: never };
        Relationships: [
          {
            foreignKeyName: "concession_documents_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "concession_students";
            referencedColumns: ["id"];
          },
        ];
      };
      concession_card_history: {
        Row: {
          id: number;
          student_id: string;
          card_type: ConcessionCard;
          status: ConcessionStatus;
          note: string;
          changed_by: string | null;
          changed_at: string;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [
          {
            foreignKeyName: "concession_card_history_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "concession_students";
            referencedColumns: ["id"];
          },
        ];
      };
      exam_series: {
        Row: {
          id: string;
          batch_id: string;
          name: string;
          code: string;
          default_parts: { name: string; max_marks: number }[];
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          batch_id: string;
          name: string;
          code: string;
          default_parts?: { name: string; max_marks: number }[];
          is_active?: boolean;
        };
        Update: {
          batch_id?: string;
          name?: string;
          code?: string;
          default_parts?: { name: string; max_marks: number }[];
          is_active?: boolean;
        };
        Relationships: [];
      };
      exam_parts: {
        Row: { id: string; exam_id: string; name: string; max_marks: number; sort_order: number; created_at: string };
        Insert: { exam_id: string; name: string; max_marks: number; sort_order?: number };
        Update: { name?: string; max_marks?: number; sort_order?: number };
        Relationships: [
          {
            foreignKeyName: "exam_parts_exam_id_fkey";
            columns: ["exam_id"];
            isOneToOne: false;
            referencedRelation: "exams";
            referencedColumns: ["id"];
          },
        ];
      };
      concession_results: {
        Row: {
          id: string;
          student_id: string;
          exam_id: string;
          attendance: ConcessionAttendance;
          note: string;
          entered_by: string | null;
          entered_at: string;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      concession_part_marks: {
        Row: { result_id: string; part_id: string; marks: number };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      concession_payments: {
        Row: {
          student_id: string;
          month: string;
          status: "paid" | "unpaid";
          amount: number | null;
          paid_on: string | null;
          note: string;
          recorded_by: string | null;
          updated_at: string;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      concession_flags: {
        Row: {
          id: string;
          student_id: string;
          kind: "needs_review" | "warning" | "top";
          reason: string;
          raised_by: string | null;
          raised_at: string;
          resolved_by: string | null;
          resolved_at: string | null;
          resolve_note: string;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      papers: {
        Row: {
          id: string;
          title: string;
          kind: "paper" | "tute";
          exam_id: string | null;
          notes: string | null;
          status: "in_progress" | "done" | "cancelled";
          medium: "si" | "both";
          part: "mcq" | "essay" | "full";
          exam_day: string | null;
          lms_link: string | null;
          physical_link: string | null;
          handed_over_at: string | null;
          files_cleared_at: string | null;
          files_cleared_count: number | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          /** Tutes: the batch it is for (papers take their batch from the exam). */
        };
        Insert: { [_ in never]: never };
        /** Only the service role (file clean-up) updates papers directly. */
        Update: { files_cleared_at?: string | null; files_cleared_count?: number | null };
        Relationships: [
          {
            foreignKeyName: "papers_exam_id_fkey";
            columns: ["exam_id"];
            isOneToOne: false;
            referencedRelation: "exams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "papers_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      paper_stages: {
        Row: {
          id: string;
          paper_id: string;
          stage: PaperStageName;
          position: number;
          owner_id: string | null;
          start_date: string | null;
          due_date: string | null;
          link: string | null;
          status: "waiting" | "in_progress" | "done" | "skipped";
          started_at: string | null;
          completed_at: string | null;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [
          {
            foreignKeyName: "paper_stages_paper_id_fkey";
            columns: ["paper_id"];
            isOneToOne: false;
            referencedRelation: "papers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "paper_stages_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      paper_notes: {
        Row: {
          id: string;
          paper_id: string;
          stage: PaperStageName | null;
          author_id: string | null;
          body: string;
          created_at: string;
        };
        Insert: { id?: string; paper_id: string; stage?: PaperStageName | null; author_id: string; body: string };
        Update: { [_ in never]: never };
        Relationships: [
          {
            foreignKeyName: "paper_notes_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          device: string | null;
          created_at: string;
          last_used_at: string | null;
          session_id: string | null;
        };
        Insert: { id?: string; user_id: string; endpoint: string; p256dh: string; auth: string; device?: string | null };
        Update: { last_used_at?: string | null };
        Relationships: [];
      };
      paper_files: {
        Row: {
          id: string;
          paper_id: string;
          stage: PaperStageName;
          version: number;
          storage_path: string;
          file_name: string;
          mime_type: string | null;
          size_bytes: number;
          note: string | null;
          tag: PaperFileTag;
          is_main: boolean;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          paper_id: string;
          stage: PaperStageName;
          version: number;
          storage_path: string;
          file_name: string;
          mime_type?: string | null;
          size_bytes: number;
          note?: string | null;
          tag?: PaperFileTag;
          is_main?: boolean;
          uploaded_by: string;
        };
        Update: { [_ in never]: never };
        Relationships: [
          {
            foreignKeyName: "paper_files_paper_id_fkey";
            columns: ["paper_id"];
            isOneToOne: false;
            referencedRelation: "papers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "paper_files_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      text_templates: {
        Row: { id: string; user_id: string; body: string; created_at: string };
        Insert: { id?: string; user_id?: string; body: string };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      task_files: {
        Row: {
          id: string;
          task_id: string;
          kind: "brief" | "work";
          storage_path: string;
          file_name: string;
          mime_type: string | null;
          size_bytes: number;
          uploaded_by: string | null;
          seen_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          kind: "brief" | "work";
          storage_path: string;
          file_name: string;
          mime_type?: string | null;
          size_bytes: number;
          uploaded_by: string;
        };
        Update: { [_ in never]: never };
        Relationships: [
          {
            foreignKeyName: "task_files_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_files_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      task_types: {
        Row: {
          id: string;
          name: string;
          icon: string | null;
          color: string;
          description: string | null;
          role_id: string | null;
          default_assignee_id: string | null;
          title_template: string | null;
          due_days: number | null;
          priority: "normal" | "high";
          fields: Json;
          active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          icon?: string | null;
          color?: string;
          description?: string | null;
          role_id?: string | null;
          default_assignee_id?: string | null;
          title_template?: string | null;
          due_days?: number | null;
          priority?: "normal" | "high";
          fields?: Json;
          active?: boolean;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          icon?: string | null;
          color?: string;
          description?: string | null;
          role_id?: string | null;
          default_assignee_id?: string | null;
          title_template?: string | null;
          due_days?: number | null;
          priority?: "normal" | "high";
          fields?: Json;
          active?: boolean;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          assignee_id: string;
          role_id: string | null;
          exam_id: string | null;
          fix_note: string | null;
          sent_back_at: string | null;
          centre_id: string | null;
          quantity: number | null;
          due_date: string | null;
          priority: "normal" | "high";
          status: TaskStatus;
          paper_stage_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          type_id: string | null;
          details: Json;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          assignee_id: string;
          role_id?: string | null;
          exam_id?: string | null;
          fix_note?: string | null;
          sent_back_at?: string | null;
          centre_id?: string | null;
          quantity?: number | null;
          due_date?: string | null;
          priority?: "normal" | "high";
          status?: TaskStatus;
          created_by?: string | null;
          type_id?: string | null;
          details?: Json;
        };
        Update: {
          title?: string;
          description?: string | null;
          assignee_id?: string;
          role_id?: string | null;
          exam_id?: string | null;
          fix_note?: string | null;
          sent_back_at?: string | null;
          centre_id?: string | null;
          quantity?: number | null;
          due_date?: string | null;
          priority?: "normal" | "high";
          status?: TaskStatus;
          type_id?: string | null;
          details?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_type_id_fkey";
            columns: ["type_id"];
            isOneToOne: false;
            referencedRelation: "task_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_exam_id_fkey";
            columns: ["exam_id"];
            isOneToOne: false;
            referencedRelation: "exams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_centre_id_fkey";
            columns: ["centre_id"];
            isOneToOne: false;
            referencedRelation: "centres";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_paper_stage_id_fkey";
            columns: ["paper_stage_id"];
            isOneToOne: false;
            referencedRelation: "paper_stages";
            referencedColumns: ["id"];
          },
        ];
      };
      app_settings: {
        Row: {
          id: boolean;
          monthly_budget: number;
          deadline_enabled: boolean;
          deadline_day: number;
          reminder_days: number;
          paper_file_days: number;
          paper_default_owners: Json;
          lms_group_link: string | null;
          physical_group_link: string | null;
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
          resubmitted_at: string | null;
          reviewed_at: string | null;
          rate_item_id: string | null;
          exam_id: string | null;
          centre_id: string | null;
          task_id: string | null;
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
          resubmitted_at?: string | null;
          reviewed_at?: string | null;
          rate_item_id?: string | null;
          exam_id?: string | null;
          centre_id?: string | null;
          task_id?: string | null;
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
          resubmitted_at?: string | null;
          reviewed_at?: string | null;
          rate_item_id?: string | null;
          exam_id?: string | null;
          centre_id?: string | null;
          task_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "submissions_exam_id_fkey";
            columns: ["exam_id"];
            isOneToOne: false;
            referencedRelation: "exams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_centre_id_fkey";
            columns: ["centre_id"];
            isOneToOne: false;
            referencedRelation: "centres";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
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
      submission_videos: {
        Row: {
          id: string;
          submission_id: string;
          user_id: string;
          drive_file_id: string;
          name: string;
          source: "edited" | "external";
          folder_name: string | null;
          mime_type: string | null;
          size_bytes: number | null;
          duration_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          submission_id: string;
          user_id: string;
          drive_file_id: string;
          name: string;
          source: "edited" | "external";
          folder_name?: string | null;
          mime_type?: string | null;
          size_bytes?: number | null;
          duration_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          submission_id?: string;
          user_id?: string;
          drive_file_id?: string;
          name?: string;
          source?: "edited" | "external";
          folder_name?: string | null;
          mime_type?: string | null;
          size_bytes?: number | null;
          duration_ms?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "submission_videos_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "submissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submission_videos_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      fee_classes: {
        Row: {
          id: string;
          batch_id: string;
          name: string;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
          /** Physical, Online or Both (Both splits by the paid list's Institute column). */
          mode: ClassMode;
        };
        Insert: {
          id?: string;
          batch_id: string;
          name: string;
          is_active?: boolean;
          mode?: ClassMode;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          batch_id?: string;
          name?: string;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
          mode?: ClassMode;
        };
        Relationships: [
          {
            foreignKeyName: "fee_classes_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
        ];
      };
      fee_month_imports: {
        Row: {
          id: string;
          class_id: string;
          month: string;
          file_name: string;
          raw_row_count: number;
          unique_student_count: number;
          duplicates_merged: number;
          uploaded_by: string | null;
          uploaded_at: string;
        };
        Insert: {
          id?: string;
          class_id: string;
          month: string;
          file_name?: string;
          raw_row_count?: number;
          unique_student_count?: number;
          duplicates_merged?: number;
          uploaded_by?: string | null;
          uploaded_at?: string;
        };
        Update: {
          id?: string;
          class_id?: string;
          month?: string;
          file_name?: string;
          raw_row_count?: number;
          unique_student_count?: number;
          duplicates_merged?: number;
          uploaded_by?: string | null;
          uploaded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fee_month_imports_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "fee_classes";
            referencedColumns: ["id"];
          },
        ];
      };
      fee_month_students: {
        Row: {
          id: string;
          class_id: string;
          month: string;
          student_key: string;
          full_name: string;
          email_norm: string;
          raw_email: string;
          whatsapp_norm: string | null;
          raw_whatsapp: string;
          mobile_norm: string | null;
          raw_mobile: string;
          institute: string;
          district: string;
          is_new_student: boolean;
          amount: number | null;
          export_label: string;
          raw_classes: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          class_id: string;
          month: string;
          student_key: string;
          full_name: string;
          email_norm?: string;
          raw_email?: string;
          whatsapp_norm?: string | null;
          raw_whatsapp?: string;
          mobile_norm?: string | null;
          raw_mobile?: string;
          institute?: string;
          district?: string;
          is_new_student?: boolean;
          amount?: number | null;
          export_label?: string;
          raw_classes?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          class_id?: string;
          month?: string;
          student_key?: string;
          full_name?: string;
          email_norm?: string;
          raw_email?: string;
          whatsapp_norm?: string | null;
          raw_whatsapp?: string;
          mobile_norm?: string | null;
          raw_mobile?: string;
          institute?: string;
          district?: string;
          is_new_student?: boolean;
          amount?: number | null;
          export_label?: string;
          raw_classes?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fee_month_students_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "fee_classes";
            referencedColumns: ["id"];
          },
        ];
      };
      fee_message_templates: {
        Row: {
          id: string;
          name: string;
          body: string;
          is_default: boolean;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          body: string;
          is_default?: boolean;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          body?: string;
          is_default?: boolean;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      fee_due_followups: {
        Row: {
          id: string;
          class_id: string;
          due_month: string;
          student_key: string;
          student_name: string;
          email_norm: string;
          whatsapp_norm: string | null;
          status: FeeFollowupStatus;
          label: string;
          message_count: number;
          last_messaged_at: string | null;
          last_messaged_by: string | null;
          last_template_id: string | null;
          note: string;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          class_id: string;
          due_month: string;
          student_key: string;
          student_name?: string;
          email_norm?: string;
          whatsapp_norm?: string | null;
          status?: FeeFollowupStatus;
          label?: string;
          message_count?: number;
          last_messaged_at?: string | null;
          last_messaged_by?: string | null;
          last_template_id?: string | null;
          note?: string;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          class_id?: string;
          due_month?: string;
          student_key?: string;
          student_name?: string;
          email_norm?: string;
          whatsapp_norm?: string | null;
          status?: FeeFollowupStatus;
          label?: string;
          message_count?: number;
          last_messaged_at?: string | null;
          last_messaged_by?: string | null;
          last_template_id?: string | null;
          note?: string;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fee_due_followups_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "fee_classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_due_followups_last_template_id_fkey";
            columns: ["last_template_id"];
            isOneToOne: false;
            referencedRelation: "fee_message_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      class_tutes: {
        Row: {
          id: string;
          /** Not used since 073 (one shelf for every batch); always null. */
          batch_id: string | null;
          class_id: string | null;
          code: string;
          name: string;
          paper_id: string | null;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
          pages: number | null;
          reorder_level: number | null;
          print_batch: number;
          /** Last shelf count (a count of 0 saves no stock move). */
          counted_at: string | null;
          /** Cover thumbnail path in the private "tute-covers" bucket. */
          cover_path: string | null;
        };
        Insert: {
          id?: string;
          batch_id?: string | null;
          class_id?: string | null;
          code?: string;
          name: string;
          paper_id?: string | null;
          pages?: number | null;
          reorder_level?: number | null;
          print_batch?: number;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          batch_id?: string | null;
          class_id?: string | null;
          code?: string;
          name?: string;
          paper_id?: string | null;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "class_tutes_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "class_tutes_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "fee_classes";
            referencedColumns: ["id"];
          },
        ];
      };
      class_month_tutes: {
        Row: {
          id: string;
          class_id: string;
          month: string;
          tute_id: string;
          sort_order: number;
          note: string;
          added_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          class_id: string;
          month: string;
          tute_id: string;
          sort_order?: number;
          note?: string;
          added_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          class_id?: string;
          month?: string;
          tute_id?: string;
          sort_order?: number;
          note?: string;
          added_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "class_month_tutes_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "fee_classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "class_month_tutes_tute_id_fkey";
            columns: ["tute_id"];
            isOneToOne: false;
            referencedRelation: "class_tutes";
            referencedColumns: ["id"];
          },
        ];
      };
      tute_printers: {
        Row: {
          id: string;
          name: string;
          phone: string;
          notes: string;
          usual_days: number;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      tute_print_jobs: {
        Row: {
          id: string;
          tute_id: string;
          printer_id: string | null;
          qty: number;
          received_qty: number;
          status: TutePrintJobStatus;
          cost: number | null;
          due_date: string | null;
          note: string;
          created_by: string | null;
          created_at: string;
          started_at: string | null;
          received_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "tute_print_jobs_tute_id_fkey";
            columns: ["tute_id"];
            isOneToOne: false;
            referencedRelation: "class_tutes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tute_print_jobs_printer_id_fkey";
            columns: ["printer_id"];
            isOneToOne: false;
            referencedRelation: "tute_printers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tute_print_jobs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tute_stock_moves: {
        Row: {
          id: string;
          tute_id: string;
          qty: number;
          kind: TuteMoveKind;
          class_id: string | null;
          month: string | null;
          ref_id: string | null;
          note: string;
          flag: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "tute_stock_moves_tute_id_fkey";
            columns: ["tute_id"];
            isOneToOne: false;
            referencedRelation: "class_tutes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tute_stock_moves_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "fee_classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tute_stock_moves_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      student_addresses: {
        Row: {
          student_key: string;
          full_name: string;
          whatsapp: string | null;
          address: string;
          lms_address: string;
          district: string;
          checked: boolean;
          checked_by: string | null;
          checked_at: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      post_rounds: {
        Row: {
          id: string;
          batch_id: string;
          month: string;
          kind: "main" | "top_up";
          status: PostRoundStatus;
          receipt_total: number | null;
          created_by: string | null;
          created_at: string;
          handed_over_by: string | null;
          handed_over_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      post_parcels: {
        Row: {
          id: string;
          round_id: string;
          number: number;
          student_key: string;
          full_name: string;
          whatsapp: string | null;
          address: string;
          district: string;
          tracking_no: string | null;
          status: PostParcelStatus;
          packed_by: string | null;
          packed_at: string | null;
          status_at: string | null;
          wa_sent_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "post_parcels_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "post_rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      post_parcel_items: {
        Row: {
          id: string;
          parcel_id: string;
          tute_id: string;
          class_id: string | null;
          student_key: string;
          month: string;
          qty: number;
          active: boolean;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "post_parcel_items_parcel_id_fkey";
            columns: ["parcel_id"];
            isOneToOne: false;
            referencedRelation: "post_parcels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_parcel_items_tute_id_fkey";
            columns: ["tute_id"];
            isOneToOne: false;
            referencedRelation: "class_tutes";
            referencedColumns: ["id"];
          },
        ];
      };
      tute_stock_reservations: {
        Row: {
          id: string;
          tute_id: string;
          round_id: string;
          month: string;
          qty: number;
          status: "active" | "committed" | "released";
          created_at: string;
          resolved_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
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
      exam_series_next: { Args: { p_series: string; p_exam_date?: string | null }; Returns: string };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_active_member: { Args: Record<PropertyKey, never>; Returns: boolean };
      nic_birth_date: { Args: { nic: string }; Returns: string | null };
      is_main_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      set_member_pay_start: { Args: { p_user: string; p_next: boolean }; Returns: string | null };
      my_two_step_on: { Args: Record<PropertyKey, never>; Returns: boolean };
      push_subscription_save: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_device: string };
        Returns: undefined;
      };
      push_subscription_refresh: { Args: { p_endpoint: string }; Returns: boolean };
      live_push_subscriptions: {
        Args: { p_user: string };
        Returns: { id: string; endpoint: string; p256dh: string; auth: string }[];
      };
      claimed_drive_videos: {
        Args: { p_ids: string[]; p_submission?: string | null };
        Returns: { drive_file_id: string; mine: boolean }[];
      };
      log_event: { Args: { p_action: string; p_target?: string | null; p_details?: Json }; Returns: undefined };
      close_pay_month: { Args: { p_month: string; p_note?: string | null }; Returns: number };
      reopen_pay_month: { Args: { p_month: string }; Returns: undefined };
      open_pay_period: { Args: { p_day: string }; Returns: string };
      work_deadline: { Args: { p_month: string }; Returns: string | null };
      work_deadlines: { Args: { p_months: string[] }; Returns: { month: string; deadline: string | null }[] };
      set_month_deadline: { Args: { p_month: string; p_last_day: string | null }; Returns: undefined };
      send_deadline_reminders: { Args: Record<PropertyKey, never>; Returns: number };
      create_paper: {
        Args: {
          p_title: string;
          p_kind: string;
          p_exam: string | null;
          p_notes: string | null;
          p_stages: Json;
          p_medium?: string;
          p_part?: string;
          p_exam_day?: string | null;
        };
        Returns: string;
      };
      update_paper_stage: {
        Args: { p_stage: string; p_owner: string | null; p_start: string | null; p_due: string | null; p_action?: string };
        Returns: undefined;
      };
      task_file_seen: { Args: { p_file: string }; Returns: undefined };
      set_main_paper_file: { Args: { p_file: string }; Returns: undefined };
      update_paper_file: { Args: { p_file: string; p_name: string; p_tag: string; p_note: string }; Returns: undefined };
      notify_stage_files: { Args: { p_paper: string; p_stage: string; p_files: string[] }; Returns: number };
      paper_library: {
        Args: Record<PropertyKey, never>;
        Returns: {
          file_id: string;
          paper_id: string;
          title: string;
          kind: "paper" | "tute";
          part: "mcq" | "essay" | "full";
          medium: "si" | "both";
          exam_day: string | null;
          exam_name: string | null;
          batch_name: string | null;
          stage: PaperStageName;
          version: number;
          file_name: string;
          size_bytes: number;
          created_at: string;
        }[];
      };
      paper_add_past: {
        Args: { p_title: string; p_part: string; p_medium: string; p_exam_day?: string | null; p_exam?: string | null };
        Returns: string;
      };
      set_stage_link: { Args: { p_stage: string; p_link: string | null }; Returns: undefined };
      set_paper_links: { Args: { p_paper: string; p_lms: string | null; p_physical: string | null }; Returns: undefined };
      storage_usage: { Args: Record<PropertyKey, never>; Returns: { bucket: string; files: number; bytes: number }[] };
      set_paper_file_days: { Args: { p_days: number }; Returns: undefined };
      set_paper_default_owners: { Args: { p_owners: Json }; Returns: undefined };
      group_links: {
        Args: Record<PropertyKey, never>;
        Returns: { lms_group_link: string | null; physical_group_link: string | null }[];
      };
      has_page: { Args: { p_page: string; p_edit?: boolean }; Returns: boolean };
      team_directory: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          name: string;
          email: string | null;
          phone: string | null;
          whatsapp: string | null;
          is_active: boolean;
        }[];
      };
      paper_settings: {
        Args: Record<PropertyKey, never>;
        Returns: {
          paper_file_days: number;
          paper_default_owners: Json;
          lms_group_link: string | null;
          physical_group_link: string | null;
        }[];
      };
      set_group_links: { Args: { p_lms: string | null; p_physical: string | null }; Returns: undefined };
      paper_contacts: {
        Args: { p_paper: string };
        Returns: { stage: string; user_id: string; full_name: string; whatsapp: string | null }[];
      };
      set_paper_status: { Args: { p_paper: string; p_status: string }; Returns: undefined };
      concession_missing: { Args: { p_id: string; p_card?: string | null }; Returns: string[] };
      concession_student_save: { Args: { p: Json; p_expected_updated_at?: string | null }; Returns: string };
      concession_student_set_card: {
        Args: { p_id: string; p_card: string; p_status: string; p_note?: string; p_expected_updated_at?: string | null };
        Returns: undefined;
      };
      concession_student_delete: { Args: { p_id: string }; Returns: string[] };
      concession_document_opened: { Args: { p_doc: string }; Returns: undefined };
      concession_roster: {
        Args: { p_exam: string };
        Returns: { student_id: string; student_no: string; full_name: string; card_type: ConcessionCard; centre_id: string | null }[];
      };
      concession_results_save: { Args: { p_exam: string; p_rows: Json }; Returns: number };
      concession_payment_set: {
        Args: {
          p_student: string;
          p_month: string;
          p_status: "paid" | "unpaid" | null;
          p_amount?: number | null;
          p_paid_on?: string | null;
          p_note?: string;
        };
        Returns: undefined;
      };
      concession_flag_raise: { Args: { p_student: string; p_kind: string; p_reason: string }; Returns: string };
      concession_flag_resolve: { Args: { p_flag: string; p_note?: string }; Returns: undefined };
      concession_result_totals: {
        Args: { p_from: string; p_to: string; p_student?: string | null };
        Returns: {
          student_id: string;
          exam_id: string;
          exam_date: string;
          attendance: ConcessionAttendance;
          total: number | null;
          max_total: number | null;
          parts_marked: number;
          parts: number;
        }[];
      };
      concession_students_import: { Args: { p_rows: Json; p_file_name: string }; Returns: number };
      concession_payments_import: { Args: { p_rows: Json; p_file_name: string }; Returns: number };
      set_payouts_paid: {
        Args: { p_ids: string[]; p_paid: boolean; p_paid_on?: string | null; p_reference?: string | null };
        Returns: number;
      };
      fee_class_save: {
        Args: { p_id: string | null; p_batch_id: string; p_name: string; p_is_active?: boolean; p_mode?: ClassMode | null };
        Returns: string;
      };
      class_paid_count_save: { Args: { p_class: string; p_count: number }; Returns: undefined };
      class_paid_count_undo: { Args: { p_class: string }; Returns: number };
      class_month_tutes_copy: { Args: { p_class: string; p_from_month: string; p_to_month: string }; Returns: number };
      class_ops_overview: {
        Args: { p_month: string };
        Returns: {
          class_id: string;
          batch_id: string;
          batch_name: string;
          name: string;
          mode: ClassMode;
          is_active: boolean;
          /** Newest paid count this month (uploaded list or typed), null before the first. */
          paid: number | null;
          paid_at: string | null;
          paid_source: "upload" | "typed" | null;
          last_month: number | null;
          /** Students the tutes are planned for (paid list, forecast or month-end estimate). */
          expected: number;
          tutes_this: number;
          tutes_next: number;
        }[];
      };
      fee_class_delete: { Args: { p_id: string }; Returns: undefined };
      fee_month_replace_import: {
        Args: {
          p_class_id: string;
          p_month: string;
          p_file_name: string;
          p_raw_count: number;
          p_duplicates_merged: number;
          p_rows: Json;
        };
        Returns: number;
      };
      fee_month_delete_import: { Args: { p_class_id: string; p_month: string }; Returns: undefined };
      fee_followup_set: {
        Args: {
          p_class_id: string;
          p_due_month: string;
          p_student_key: string;
          p_student_name: string;
          p_email_norm: string;
          p_whatsapp_norm: string | null;
          p_status: FeeFollowupStatus;
          p_label?: string | null;
          p_note?: string | null;
          p_template_id?: string | null;
          p_increment_message?: boolean;
        };
        Returns: Database["public"]["Tables"]["fee_due_followups"]["Row"];
      };
      fee_template_save: {
        Args: { p_id: string | null; p_name: string; p_body: string; p_is_default?: boolean };
        Returns: string;
      };
      fee_template_delete: { Args: { p_id: string }; Returns: undefined };
      fee_batch_concession_labels: {
        Args: { p_batch_id: string };
        Returns: { full_name: string; card_type: ConcessionCard; status: ConcessionStatus; phones: string[] }[];
      };
      class_tute_delete: { Args: { p_id: string }; Returns: undefined };
      class_month_tute_attach: {
        Args: { p_class_id: string; p_month: string; p_tute_id: string; p_note?: string };
        Returns: string;
      };
      class_month_tute_remove: { Args: { p_id: string }; Returns: undefined };
      class_month_tute_reorder: { Args: { p_class_id: string; p_month: string; p_ids: string[] }; Returns: undefined };
      tute_stock_summary: { Args: { p_month: string | null }; Returns: TuteStockRow[] };
      tute_stock_levels: {
        Args: { p_tute_ids?: string[] | null; p_paper_ids?: string[] | null };
        Returns: {
          tute_id: string;
          batch_id: string | null;
          paper_id: string | null;
          name: string;
          on_hand: number;
          in_print: number;
        }[];
      };
      post_addresses_save: {
        Args: {
          p_rows: { student_key: string; full_name: string; whatsapp: string | null; address: string; district: string }[];
        };
        Returns: number;
      };
      post_address_save: { Args: { p_student_key: string; p_address: string; p_checked?: boolean }; Returns: undefined };
      post_addresses_confirm: { Args: { p_keys: string[] }; Returns: number };
      post_month_students: {
        Args: { p_batch: string; p_month: string };
        Returns: {
          student_key: string;
          full_name: string;
          classes: string;
          whatsapp: string | null;
          address: string | null;
          checked: boolean;
          problem: string;
          tutes_due: number;
          tutes_sent: number;
        }[];
      };
      post_round_build: { Args: { p_batch: string; p_month: string; p_kind: "main" | "top_up" }; Returns: string };
      post_parcel_pack: { Args: { p_parcel: string; p_packed?: boolean }; Returns: undefined };
      post_parcel_set_tracking: { Args: { p_parcel: string; p_tracking: string }; Returns: undefined };
      post_parcel_void: { Args: { p_parcel: string }; Returns: undefined };
      post_round_cancel: { Args: { p_round: string }; Returns: undefined };
      post_round_handover: { Args: { p_round: string; p_receipt_total?: number | null }; Returns: number };
      post_parcel_set_status: {
        Args: { p_parcel: string; p_status: "delivered" | "returned" | "lost"; p_copies_ok?: boolean };
        Returns: undefined;
      };
      post_parcel_whatsapp_sent: { Args: { p_parcel: string }; Returns: undefined };
      tute_pace_status: { Args: Record<string, never>; Returns: { samples: number; needed: number }[] };
      post_risk_learning: { Args: Record<string, never>; Returns: { resolved: number; returned: number; needed: number }[] };
      post_round_risks: { Args: { p_round: string }; Returns: { parcel_id: string; risk: number; reason: string }[] };
      tute_forecast_report: {
        Args: { p_batch: string | null };
        Returns: {
          class_id: string;
          class_name: string;
          month: string;
          forecast: number;
          actual: number;
          method: TuteForecastMethod;
        }[];
      };
      tute_today: { Args: Record<string, never>; Returns: { low: number; out: number; late: number; due_soon: number } };
      send_tute_stock_alerts: { Args: { p_tute?: string | null }; Returns: number };
      tute_save: {
        Args: {
          p_id: string | null;
          p_name: string;
          p_code?: string;
          p_is_active?: boolean;
          p_pages?: number | null;
          p_reorder_level?: number | null;
          p_print_batch?: number;
          p_paper_id?: string | null;
          p_opening_stock?: number | null;
        };
        Returns: string;
      };
      tute_paper_options: { Args: Record<string, never>; Returns: { id: string; title: string; medium: string }[] };
      tute_settings_save: {
        Args: { p_tute: string; p_pages: number | null; p_reorder_level: number | null; p_print_batch: number };
        Returns: undefined;
      };
      tute_printer_save: {
        Args: {
          p_id: string | null;
          p_name: string;
          p_phone?: string;
          p_notes?: string;
          p_usual_days?: number;
          p_is_active?: boolean;
        };
        Returns: string;
      };
      tute_print_job_create: {
        Args: {
          p_tute: string;
          p_qty: number;
          p_printer?: string | null;
          p_due_date?: string | null;
          p_cost?: number | null;
          p_note?: string;
        };
        Returns: string;
      };
      tute_print_job_update: {
        Args: {
          p_id: string;
          p_qty: number;
          p_printer?: string | null;
          p_due_date?: string | null;
          p_cost?: number | null;
          p_note?: string;
        };
        Returns: undefined;
      };
      tute_print_job_set_status: { Args: { p_id: string; p_status: "printing" | "cancelled" }; Returns: undefined };
      tute_print_job_receive: { Args: { p_id: string; p_qty: number; p_cost?: number | null }; Returns: number };
      tute_stock_issue: {
        Args: {
          p_tute: string;
          p_qty: number;
          p_kind: "class_issue" | "damaged";
          p_class?: string | null;
          p_month?: string | null;
          p_note?: string;
        };
        Returns: number;
      };
      tute_stock_count: { Args: { p_tute: string; p_counted: number; p_note?: string }; Returns: number };
      tute_set_cover: { Args: { p_id: string; p_path?: string | null }; Returns: string | null };
    };
    Enums: {
      submission_status: SubmissionStatus;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type PostRoundStatus = "packing" | "handed_over" | "cancelled";
export type PostParcelStatus = "planned" | "packed" | "handed_over" | "delivered" | "returned" | "lost" | "void";
export type TutePrintJobStatus = "planned" | "printing" | "received" | "cancelled";
export type TuteMoveKind =
  | "opening_stock"
  | "print_in"
  | "class_issue"
  | "post_out"
  | "return_in"
  | "damaged"
  | "count_fix";
/** not_counted = no count, stock move or print job yet. */
export type TuteStockStatus = "ok" | "low" | "out" | "not_scheduled" | "not_counted";
export type TuteStockRow = {
  tute_id: string;
  code: string;
  name: string;
  is_active: boolean;
  pages: number | null;
  print_batch: number;
  reorder_level: number | null;
  paper_id: string | null;
  paper_ready: boolean;
  on_hand: number;
  in_print: number;
  open_jobs: number;
  need_this: number;
  given_this: number;
  need_next: number;
  /** Needed the month after next (for "print together" hints). */
  need_after: number;
  safety: number;
  loss_extra: number;
  /** Copies to print now, rounded up to print_batch (0 = covered). */
  print_now: number;
  lead_days: number;
  print_by: string | null;
  status: TuteStockStatus;
  classes: TuteClassNeed[];
  classes_next: TuteClassNeed[];
};
export type TuteForecastMethod = "last_month" | "avg3" | "smooth" | "trend" | "start_rule" | "none";
export type ClassMode = "physical" | "online" | "both";

export type TuteClassNeed = {
  id: string;
  name: string;
  /** The class's batch name. */
  batch?: string;
  expected: number;
  online: number;
  uploaded: boolean;
  /** Paid so far this month (null before the first upload). */
  paid: number | null;
  /** Month-end estimate from how payments usually come in (null while learning). */
  pace: number | null;
  low: number;
  high: number;
  method: TuteForecastMethod;
  given: number;
  /** Copies handed out in class only (class_issue, excluding Speed Post post_out). */
  hall_given?: number;
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
export type Task = Tables<"tasks">;
export type Exam = Tables<"exams">;
export type Paper = Tables<"papers">;
export type PaperStage = Tables<"paper_stages">;
