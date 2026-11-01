// Types for the Supabase schema in /supabase/migrations.
// Hand-written in the same shape as `supabase gen types typescript`.
// After changing the schema you can regenerate them with:
//   npx supabase gen types typescript --project-id <id> > lib/database.types.ts

export type DispatchCapability = "plan" | "courier" | "pack" | "verify" | "correct" | "finance";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SubmissionStatus = "pending" | "approved" | "rejected";
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
      dispatch_grants: {
        Row: {
          id: string;
          user_id: string;
          capability: DispatchCapability;
          reason: string | null;
          granted_by: string | null;
          granted_at: string;
          revoked_by: string | null;
          revoked_at: string | null;
          revoke_reason: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      dispatch_tutes: {
        Row: {
          id: string;
          title: string;
          short_code: string;
          version_label: string;
          qty_per_parcel: number;
          archived_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      dispatch_settings: {
        Row: {
          id: boolean;
          sender_name: string;
          sender_line1: string;
          sender_line2: string;
          sender_line3: string;
          sender_city: string;
          sender_contact_name: string;
          sender_phone1: string;
          sender_phone2: string;
          default_cod: number;
          default_weight_g: number;
          default_pieces: number;
          require_verification: boolean;
          allow_self_verify: boolean;
          student_retention_months: number;
          recipient_retention_days: number;
          courier_file_retention_days: number;
          import_file_retention_days: number;
          citypak_template_file: string | null;
          citypak_template_verified: boolean;
          citypak_template_verified_by: string | null;
          citypak_template_verified_at: string | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      students: {
        Row: {
          id: string;
          batch_id: string;
          student_no: string;
          full_name: string;
          address_line1: string;
          address_line2: string;
          address_line3: string;
          city: string;
          region: string;
          phone1: string | null;
          phone2: string | null;
          phone1_raw: string | null;
          delivery_note: string;
          is_active: boolean;
          anonymised_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "students_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
        ];
      };
      student_imports: {
        Row: {
          id: string;
          batch_id: string | null;
          file_name: string;
          storage_path: string | null;
          sha256: string;
          size_bytes: number;
          row_count: number;
          counts: Json;
          applied_at: string | null;
          applied_count: number | null;
          file_deleted_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: { file_deleted_at?: string | null };
        Relationships: [];
      };
      dispatch_rounds: {
        Row: {
          id: string;
          name: string;
          batch_id: string;
          sending_month: string;
          group_label: string;
          subject: string;
          ref_prefix: string;
          default_cod: number;
          default_weight_g: number;
          default_pieces: number;
          planned_handover: string | null;
          notes: string;
          state: "draft" | "finalised" | "active" | "closed" | "cancelled";
          manifest_version: number;
          created_by: string | null;
          created_at: string;
          updated_by: string | null;
          updated_at: string;
          finalised_by: string | null;
          finalised_at: string | null;
          closed_by: string | null;
          closed_at: string | null;
          close_note: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "dispatch_rounds_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
        ];
      };
      round_tutes: {
        Row: {
          id: string;
          round_id: string;
          paper_id: string | null;
          manual_title: string | null;
          title: string;
          short_code: string;
          version_label: string;
          qty_per_parcel: number;
          is_extra: boolean;
          sort_order: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      round_students: {
        Row: {
          round_id: string;
          student_id: string;
          cod_amount: number | null;
          note: string;
          excluded_tute_ids: string[];
          extra_tute_ids: string[];
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "round_students_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      parcels: {
        Row: {
          id: string;
          round_id: string;
          student_id: string;
          reference: string;
          tracking_no: string | null;
          replaces_parcel_id: string | null;
          registration_state: "unregistered" | "registered" | "voided";
          pack_state: "planned" | "packed" | "verified";
          delivery_state: "awaiting_pickup" | "handed_over" | "in_transit" | "delivered" | "failed" | "returned";
          on_hold: boolean;
          cod_expected: number;
          weight_g: number;
          pieces: number;
          assigned_to: string | null;
          packed_by: string | null;
          packed_at: string | null;
          verified_by: string | null;
          verified_at: string | null;
          manifest_version: number;
          row_version: number;
          handover_id: string | null;
          delivery_note: string | null;
          cod_writeoff: number;
          cod_writeoff_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "parcels_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      parcel_recipients: {
        Row: {
          parcel_id: string;
          name: string;
          address_line1: string;
          address_line2: string;
          address_line3: string;
          city: string;
          phone1: string | null;
          phone2: string | null;
          anonymised_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "parcel_recipients_parcel_id_fkey";
            columns: ["parcel_id"];
            isOneToOne: true;
            referencedRelation: "parcels";
            referencedColumns: ["id"];
          },
        ];
      };
      parcel_items: {
        Row: { parcel_id: string; round_tute_id: string; qty: number };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "parcel_items_parcel_id_fkey";
            columns: ["parcel_id"];
            isOneToOne: false;
            referencedRelation: "parcels";
            referencedColumns: ["id"];
          },
        ];
      };
      parcel_events: {
        Row: {
          id: number;
          parcel_id: string;
          round_id: string;
          type: string;
          from_state: string | null;
          to_state: string | null;
          actor: string | null;
          source: "manual" | "import" | "system" | "scan";
          reason: string | null;
          details: Json;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      carrier_files: {
        Row: {
          id: string;
          round_id: string | null;
          kind:
            | "citypak_template"
            | "manifest_export"
            | "tracking_sheet"
            | "waybill_pdf"
            | "status_report"
            | "settlement_report"
            | "handover_receipt";
          storage_path: string;
          file_name: string;
          sha256: string;
          size_bytes: number;
          row_count: number | null;
          summary: Json;
          created_by: string | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      parcel_exceptions: {
        Row: {
          id: string;
          parcel_id: string;
          round_id: string;
          kind: "missing_item" | "damaged" | "wrong_address" | "label_problem" | "returned" | "cod_issue" | "other";
          note: string;
          opened_by: string | null;
          opened_at: string;
          resolution: "fixed" | "reship" | "void" | "write_off" | null;
          resolution_note: string | null;
          resolved_by: string | null;
          resolved_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "parcel_exceptions_parcel_id_fkey";
            columns: ["parcel_id"];
            isOneToOne: false;
            referencedRelation: "parcels";
            referencedColumns: ["id"];
          },
        ];
      };
      handovers: {
        Row: {
          id: string;
          round_id: string;
          state: "open" | "confirmed" | "cancelled";
          courier_rep: string;
          courier_ref: string;
          counted_count: number | null;
          note: string;
          receipt_file: string | null;
          opened_by: string | null;
          opened_at: string;
          confirmed_by: string | null;
          confirmed_at: string | null;
          cancelled_by: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      cod_settlements: {
        Row: {
          id: string;
          reference: string;
          settled_on: string;
          remitted: number;
          note: string;
          file_id: string | null;
          state: "draft" | "confirmed" | "cancelled";
          dispute_note: string | null;
          created_by: string | null;
          created_at: string;
          confirmed_by: string | null;
          confirmed_at: string | null;
          cancelled_by: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      cod_settlement_lines: {
        Row: {
          id: string;
          settlement_id: string;
          parcel_id: string;
          collected: number;
          fee: number;
          added_by: string | null;
          added_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "cod_settlement_lines_parcel_id_fkey";
            columns: ["parcel_id"];
            isOneToOne: false;
            referencedRelation: "parcels";
            referencedColumns: ["id"];
          },
        ];
      };
      handover_parcels: {
        Row: {
          id: string;
          handover_id: string;
          parcel_id: string;
          added_by: string | null;
          added_at: string;
          released_by: string | null;
          released_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "handover_parcels_parcel_id_fkey";
            columns: ["parcel_id"];
            isOneToOne: false;
            referencedRelation: "parcels";
            referencedColumns: ["id"];
          },
        ];
      };
      parcel_scans: {
        Row: {
          id: string;
          idempotency_key: string | null;
          round_id: string;
          parcel_id: string | null;
          raw_code: string | null;
          action: "lookup" | "pack" | "verify";
          result: string;
          response: Json;
          operator: string | null;
          device_id: string | null;
          event_id: number | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
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
      tasks: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          assignee_id: string;
          role_id: string | null;
          exam_id: string | null;
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
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          assignee_id: string;
          role_id?: string | null;
          exam_id?: string | null;
          centre_id?: string | null;
          quantity?: number | null;
          due_date?: string | null;
          priority?: "normal" | "high";
          status?: TaskStatus;
          created_by?: string | null;
        };
        Update: {
          title?: string;
          description?: string | null;
          assignee_id?: string;
          role_id?: string | null;
          exam_id?: string | null;
          centre_id?: string | null;
          quantity?: number | null;
          due_date?: string | null;
          priority?: "normal" | "high";
          status?: TaskStatus;
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
      scan_lookup: { Args: { p_round: string; p_code: string; p_action: string; p_device?: string | null }; Returns: Json };
      parcel_scan_confirm: {
        Args: {
          p_parcel: string;
          p_action: string;
          p_idem: string;
          p_row_version: number;
          p_checked: string[];
          p_device?: string | null;
        };
        Returns: Json;
      };
      parcel_unpack: { Args: { p_parcel: string; p_reason: string; p_row_version: number }; Returns: undefined };
      handover_open: { Args: { p_round: string }; Returns: string };
      handover_scan: { Args: { p_handover: string; p_code: string }; Returns: Json };
      handover_release: { Args: { p_handover: string; p_parcel: string }; Returns: undefined };
      handover_confirm: {
        Args: { p_handover: string; p_counted: number; p_courier_rep: string; p_courier_ref: string; p_note: string; p_receipt?: string | null };
        Returns: number;
      };
      handover_cancel: { Args: { p_handover: string; p_reason: string }; Returns: undefined };
      dispatch_handover_list: {
        Args: { p_round: string };
        Returns: {
          id: string;
          state: "open" | "confirmed" | "cancelled";
          courier_rep: string;
          courier_ref: string;
          counted_count: number | null;
          note: string;
          receipt_file: string | null;
          opened_at: string;
          confirmed_at: string | null;
          confirmed_name: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
          parcels: number;
        }[];
      };
      delivery_set: { Args: { p_parcels: string[]; p_state: string; p_reason: string; p_evidence?: string | null }; Returns: Json };
      dispatch_cod_rows: {
        Args: { p_round: string | null; p_attention_only?: boolean };
        Returns: {
          parcel_id: string;
          round_id: string;
          round_name: string;
          reference: string;
          tracking_no: string | null;
          delivery_state: string;
          registration_state: string;
          cod_expected: number;
          due: number;
          paid: number;
          fees: number;
          pending: number;
          written_off: number;
          writeoff_reason: string | null;
          outstanding: number;
          status: "voided" | "waiting" | "in_draft" | "over" | "nothing_due" | "settled" | "unpaid" | "part_paid";
        }[];
      };
      settlement_save: { Args: { p_id: string | null; p: Json }; Returns: string };
      settlement_add_lines: { Args: { p_id: string; p_rows: Json }; Returns: Json };
      settlement_set_line: { Args: { p_line: string; p_collected: number; p_fee: number }; Returns: undefined };
      settlement_remove_line: { Args: { p_line: string }; Returns: undefined };
      settlement_attach: { Args: { p_id: string; p_file: string | null }; Returns: undefined };
      settlement_confirm: { Args: { p_id: string; p_dispute_note?: string | null }; Returns: Json };
      settlement_cancel: { Args: { p_id: string; p_reason: string }; Returns: undefined };
      cod_writeoff_set: { Args: { p_parcel: string; p_amount: number; p_reason: string }; Returns: undefined };
      dispatch_settlements: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          reference: string;
          settled_on: string;
          remitted: number;
          note: string;
          state: "draft" | "confirmed" | "cancelled";
          dispute_note: string | null;
          file_id: string | null;
          parcels: number;
          collected: number;
          fees: number;
          created_name: string | null;
          confirmed_name: string | null;
          confirmed_at: string | null;
        }[];
      };
      round_close_check: { Args: { p_round: string }; Returns: Json };
      round_close: { Args: { p_round: string; p_note: string }; Returns: undefined };
      round_reopen: { Args: { p_round: string; p_reason: string }; Returns: undefined };
      dispatch_report_rounds: {
        Args: { p_from: string; p_to: string };
        Returns: {
          round_id: string;
          name: string;
          sending_month: string;
          state: string;
          live: number;
          voided: number;
          replacements: number;
          handed_over: number;
          delivered: number;
          returned: number;
          unresolved: number;
          open_exceptions: number;
          cod_expected: number;
          cod_paid: number | null;
          cod_fees: number | null;
          cod_written_off: number | null;
          cod_outstanding: number | null;
        }[];
      };
      dispatch_report_people: {
        Args: { p_from: string; p_to: string };
        Returns: { name: string | null; packed: number; verified: number; handed_over: number }[];
      };
      student_delete: { Args: { p_student: string }; Returns: undefined };
      dispatch_batch_clear: { Args: { p_batch: string; p_confirm: string }; Returns: Json };
      dispatch_retention_run: { Args: { p_now?: string }; Returns: Json };
      dispatch_retention_files: { Args: { p_now?: string }; Returns: { id: string; storage_path: string }[] };
      dispatch_retention_mark_deleted: { Args: { p_ids: string[] }; Returns: number };
      parcel_void: { Args: { p_parcel: string; p_reason: string }; Returns: undefined };
      parcel_replace: { Args: { p_parcel: string; p_reason: string; p?: Json }; Returns: string };
      exception_open: { Args: { p_parcel: string; p_kind: string; p_note: string }; Returns: string };
      exception_resolve: { Args: { p_exception: string; p_resolution: string; p_note: string }; Returns: undefined };
      parcel_assign: { Args: { p_round: string; p_parcels: string[]; p_packer: string | null }; Returns: number };
      dispatch_packers: { Args: Record<PropertyKey, never>; Returns: { id: string; name: string }[] };
      dispatch_pack_list: {
        Args: { p_round: string };
        Returns: {
          parcel_id: string;
          reference: string;
          tracking_no: string | null;
          student_no: string;
          items: string | null;
          pack_state: string;
          on_hold: boolean;
          registration_state: string;
          assigned_to: string | null;
          assigned_name: string | null;
          packed_name: string | null;
          packed_at: string | null;
          verified_name: string | null;
          verified_at: string | null;
          row_version: number;
        }[];
      };
      round_save: { Args: { p: Json }; Returns: string };
      round_set_tutes: { Args: { p_round: string; p_tutes: Json }; Returns: undefined };
      round_set_students: { Args: { p_round: string; p_rows: Json }; Returns: number };
      dispatch_tute_save: { Args: { p: Json }; Returns: string };
      dispatch_tute_counts: {
        Args: { p_round: string };
        Returns: {
          round_tute_id: string;
          short_code: string;
          title: string;
          is_extra: boolean;
          parcels: number;
          copies: number;
          packed_parcels: number;
          packed_copies: number;
        }[];
      };
      dispatch_tute_archive: { Args: { p_id: string }; Returns: undefined };
      round_cancel: { Args: { p_round: string; p_reason: string }; Returns: undefined };
      round_finalise: { Args: { p_round: string }; Returns: number };
      parcel_correct: { Args: { p_parcel: string; p: Json; p_reason: string; p_row_version: number }; Returns: undefined };
      carrier_file_record: {
        Args: {
          p_round: string | null;
          p_kind: string;
          p_path: string;
          p_name: string;
          p_sha256: string;
          p_size: number;
          p_rows: number | null;
          p_summary: Json;
        };
        Returns: string;
      };
      tracking_apply: { Args: { p_round: string; p_file: string; p_rows: Json }; Returns: Json };
      citypak_template_set: { Args: { p_file: string | null; p_verified: boolean }; Returns: undefined };
      dispatch_log_download: { Args: { p_file: string }; Returns: undefined };
      has_dispatch: { Args: { p_cap: string }; Returns: boolean };
      dispatch_my_caps: { Args: Record<PropertyKey, never>; Returns: string[] };
      dispatch_grant: { Args: { p_user: string; p_cap: string; p_reason?: string | null }; Returns: undefined };
      dispatch_revoke: { Args: { p_user: string; p_cap: string; p_reason?: string | null }; Returns: undefined };
      dispatch_settings_save: { Args: { p: Json }; Returns: undefined };
      student_save: { Args: { p: Json; p_expected_updated_at?: string | null }; Returns: string };
      student_set_active: { Args: { p_id: string; p_active: boolean }; Returns: undefined };
      student_import_start: {
        Args: {
          p_batch: string;
          p_file_name: string;
          p_storage_path: string | null;
          p_sha256: string;
          p_size: number;
          p_rows: number;
        };
        Returns: string;
      };
      students_import_apply: { Args: { p_import: string; p_rows: Json; p_counts?: Json }; Returns: number };
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
export type Task = Tables<"tasks">;
export type Exam = Tables<"exams">;
export type Paper = Tables<"papers">;
export type PaperStage = Tables<"paper_stages">;
