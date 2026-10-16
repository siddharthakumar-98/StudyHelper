
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "ai_calls": {
                  Row: {
                    "cache_read_tokens": number,"cache_write_tokens": number,"cost_usd": number,"created_at": string,"document_id": string | null,"id": string,"input_tokens": number,"model": string,"output_tokens": number,"prompt_version": string,"task": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd"?: number,"created_at"?: string,"document_id"?: string | null,"id"?: string,"input_tokens"?: number,"model": string,"output_tokens"?: number,"prompt_version": string,"task": string
                  }
                  Update: {
                    "cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd"?: number,"created_at"?: string,"document_id"?: string | null,"id"?: string,"input_tokens"?: number,"model"?: string,"output_tokens"?: number,"prompt_version"?: string,"task"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_calls_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    }
                  ]
                },"answer_keys": {
                  Row: {
                    "correct_option_id": string | null,"explanation": string | null,"key_concepts": Json | null,"model_answer": string | null,"question_id": string,"rubric": Json | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "correct_option_id"?: string | null,"explanation"?: string | null,"key_concepts"?: Json | null,"model_answer"?: string | null,"question_id": string,"rubric"?: Json | null,"version": number
                  }
                  Update: {
                    "correct_option_id"?: string | null,"explanation"?: string | null,"key_concepts"?: Json | null,"model_answer"?: string | null,"question_id"?: string,"rubric"?: Json | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "answer_keys_question_id_version_fkey"
      columns: ["question_id","version"]
isOneToOne: true
      referencedRelation: "question_versions"
      referencedColumns: ["question_id","version"]
    }
                  ]
                },"document_files": {
                  Row: {
                    "document_id": string,"file_index": number,"id": string,"mime_type": string,"size_bytes": number,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "document_id": string,"file_index": number,"id"?: string,"mime_type": string,"size_bytes": number,"storage_path": string
                  }
                  Update: {
                    "document_id"?: string,"file_index"?: number,"id"?: string,"mime_type"?: string,"size_bytes"?: number,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_files_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "class_date": string | null,"created_at": string,"id": string,"page_count": number,"status": string,"title": string,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "class_date"?: string | null,"created_at"?: string,"id"?: string,"page_count"?: number,"status"?: string,"title": string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "class_date"?: string | null,"created_at"?: string,"id"?: string,"page_count"?: number,"status"?: string,"title"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"generation_runs": {
                  Row: {
                    "completed_at": string | null,"document_id": string,"id": string,"report": Json | null,"started_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"document_id": string,"id"?: string,"report"?: Json | null,"started_at"?: string
                  }
                  Update: {
                    "completed_at"?: string | null,"document_id"?: string,"id"?: string,"report"?: Json | null,"started_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "generation_runs_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "attempts": number,"created_at": string,"document_id": string,"error": string | null,"id": string,"kind": string,"locked_until": string | null,"next_job_id": string | null,"payload": NonNullable<Json>,"progress": Json | null,"status": Database["public"]['Enums']["job_status"],"step": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"document_id": string,"error"?: string | null,"id"?: string,"kind": string,"locked_until"?: string | null,"next_job_id"?: string | null,"payload"?: NonNullable<Json>,"progress"?: Json | null,"status"?: Database["public"]['Enums']["job_status"],"step"?: number,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"document_id"?: string,"error"?: string | null,"id"?: string,"kind"?: string,"locked_until"?: string | null,"next_job_id"?: string | null,"payload"?: NonNullable<Json>,"progress"?: Json | null,"status"?: Database["public"]['Enums']["job_status"],"step"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "display_name": string | null,"id": string,"role": Database["public"]['Enums']["user_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "display_name"?: string | null,"id": string,"role"?: Database["public"]['Enums']["user_role"]
                  }
                  Update: {
                    "display_name"?: string | null,"id"?: string,"role"?: Database["public"]['Enums']["user_role"]
                  }
                  Relationships: [
                    
                  ]
                },"question_flags": {
                  Row: {
                    "comment": string,"created_at": string,"id": string,"question_id": string,"resolved_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comment": string,"created_at"?: string,"id"?: string,"question_id": string,"resolved_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "comment"?: string,"created_at"?: string,"id"?: string,"question_id"?: string,"resolved_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "question_flags_question_id_fkey"
      columns: ["question_id"]
isOneToOne: false
      referencedRelation: "questions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "question_flags_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"question_versions": {
                  Row: {
                    "basis_quote": string,"conflict_note": string | null,"created_at": string,"options": Json | null,"question_id": string,"review_notes": (string)[],"source_refs": NonNullable<Json>,"stem": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "basis_quote": string,"conflict_note"?: string | null,"created_at"?: string,"options"?: Json | null,"question_id": string,"review_notes"?: (string)[],"source_refs": NonNullable<Json>,"stem": string,"version": number
                  }
                  Update: {
                    "basis_quote"?: string,"conflict_note"?: string | null,"created_at"?: string,"options"?: Json | null,"question_id"?: string,"review_notes"?: (string)[],"source_refs"?: NonNullable<Json>,"stem"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "question_versions_question_id_fkey"
      columns: ["question_id"]
isOneToOne: false
      referencedRelation: "questions"
      referencedColumns: ["id"]
    }
                  ]
                },"questions": {
                  Row: {
                    "batch_key": string | null,"created_at": string,"current_version": number,"difficulty": Database["public"]['Enums']["difficulty"],"generation_run_id": string | null,"id": string,"status": Database["public"]['Enums']["question_status"],"topic_id": string,"type": Database["public"]['Enums']["question_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_key"?: string | null,"created_at"?: string,"current_version"?: number,"difficulty": Database["public"]['Enums']["difficulty"],"generation_run_id"?: string | null,"id"?: string,"status"?: Database["public"]['Enums']["question_status"],"topic_id": string,"type": Database["public"]['Enums']["question_type"]
                  }
                  Update: {
                    "batch_key"?: string | null,"created_at"?: string,"current_version"?: number,"difficulty"?: Database["public"]['Enums']["difficulty"],"generation_run_id"?: string | null,"id"?: string,"status"?: Database["public"]['Enums']["question_status"],"topic_id"?: string,"type"?: Database["public"]['Enums']["question_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "questions_generation_run_id_fkey"
      columns: ["generation_run_id"]
isOneToOne: false
      referencedRelation: "generation_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "questions_topic_id_fkey"
      columns: ["topic_id"]
isOneToOne: false
      referencedRelation: "topics"
      referencedColumns: ["id"]
    }
                  ]
                },"slide_topics": {
                  Row: {
                    "slide_id": string,"topic_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "slide_id": string,"topic_id": string
                  }
                  Update: {
                    "slide_id"?: string,"topic_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "slide_topics_slide_id_fkey"
      columns: ["slide_id"]
isOneToOne: false
      referencedRelation: "source_slides"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "slide_topics_topic_id_fkey"
      columns: ["topic_id"]
isOneToOne: false
      referencedRelation: "topics"
      referencedColumns: ["id"]
    }
                  ]
                },"source_pages": {
                  Row: {
                    "document_id": string,"id": string,"kind": Database["public"]['Enums']["page_kind"],"page_no": number,"source_file_index": number,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "document_id": string,"id"?: string,"kind": Database["public"]['Enums']["page_kind"],"page_no": number,"source_file_index": number,"storage_path": string
                  }
                  Update: {
                    "document_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["page_kind"],"page_no"?: number,"source_file_index"?: number,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "source_pages_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    }
                  ]
                },"source_slides": {
                  Row: {
                    "admin_corrected": boolean,"cropped": boolean,"diagram_description": string | null,"id": string,"legibility": Database["public"]['Enums']["legibility"],"page_id": string,"position_on_page": number,"printed_slide_no": string | null,"tables": NonNullable<Json>,"title": string | null,"uncertain_terms": (string)[],"verbatim_text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_corrected"?: boolean,"cropped"?: boolean,"diagram_description"?: string | null,"id"?: string,"legibility": Database["public"]['Enums']["legibility"],"page_id": string,"position_on_page": number,"printed_slide_no"?: string | null,"tables"?: NonNullable<Json>,"title"?: string | null,"uncertain_terms"?: (string)[],"verbatim_text": string
                  }
                  Update: {
                    "admin_corrected"?: boolean,"cropped"?: boolean,"diagram_description"?: string | null,"id"?: string,"legibility"?: Database["public"]['Enums']["legibility"],"page_id"?: string,"position_on_page"?: number,"printed_slide_no"?: string | null,"tables"?: NonNullable<Json>,"title"?: string | null,"uncertain_terms"?: (string)[],"verbatim_text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "source_slides_page_id_fkey"
      columns: ["page_id"]
isOneToOne: false
      referencedRelation: "source_pages"
      referencedColumns: ["id"]
    }
                  ]
                },"topics": {
                  Row: {
                    "id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"name": string
                  }
                  Update: {
                    "id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "apply_topic_map":
{ Args: { "p_document_id": string,"p_topics": Json }; Returns: string
                           },
"claim_job":
{ Args: { "p_job_id": string,"p_lock_seconds": number }; Returns: {
              "attempts": number,
"created_at": string,
"document_id": string,
"error": string | null,
"id": string,
"kind": string,
"locked_until": string | null,
"next_job_id": string | null,
"payload": NonNullable<Json>,
"progress": Json | null,
"status": Database["public"]['Enums']["job_status"],
"step": number,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: true
        isSetofReturn: false
      } },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"replace_page_slides":
{ Args: { "p_page_id": string,"p_slides": Json }; Returns: number
                           },
"test_reset_app_tables":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           }
          }
          Enums: {
            "difficulty": "easy"|"medium"|"hard","job_status": "pending"|"running"|"done"|"failed","legibility": "clear"|"partial"|"unreadable","page_kind": "pdf_page"|"image","question_status": "draft"|"needs_review"|"active"|"flagged"|"retired","question_type": "mcq"|"saq"|"essay","user_role": "student"|"admin"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "difficulty": ["easy", "medium", "hard"],"job_status": ["pending", "running", "done", "failed"],"legibility": ["clear", "partial", "unreadable"],"page_kind": ["pdf_page", "image"],"question_status": ["draft", "needs_review", "active", "flagged", "retired"],"question_type": ["mcq", "saq", "essay"],"user_role": ["student", "admin"]
          }
        }
} as const
