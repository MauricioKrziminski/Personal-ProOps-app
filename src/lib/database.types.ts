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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          archived: boolean
          closing_day: number | null
          created_at: string
          credit_limit_cents: number | null
          currency: string
          due_day: number | null
          id: string
          initial_balance_cents: number
          name: string
          payment_account_id: string | null
          type: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          archived?: boolean
          closing_day?: number | null
          created_at?: string
          credit_limit_cents?: number | null
          currency?: string
          due_day?: number | null
          id?: string
          initial_balance_cents?: number
          name: string
          payment_account_id?: string | null
          type?: string
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          archived?: boolean
          closing_day?: number | null
          created_at?: string
          credit_limit_cents?: number | null
          currency?: string
          due_day?: number | null
          id?: string
          initial_balance_cents?: number
          name?: string
          payment_account_id?: string | null
          type?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_payment_account_id_fkey"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_routing: {
        Row: {
          note: string | null
          phone: string
          updated_at: string
          use_python_agent: boolean
        }
        Insert: {
          note?: string | null
          phone: string
          updated_at?: string
          use_python_agent?: boolean
        }
        Update: {
          note?: string | null
          phone?: string
          updated_at?: string
          use_python_agent?: boolean
        }
        Relationships: []
      }
      ai_events: {
        Row: {
          confidence: number | null
          created_at: string
          created_transaction_ids: string[] | null
          error: string | null
          id: string
          input_tokens: number | null
          message_raw_id: string | null
          model: string
          output_tokens: number | null
          result: Json | null
          user_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          created_transaction_ids?: string[] | null
          error?: string | null
          id?: string
          input_tokens?: number | null
          message_raw_id?: string | null
          model: string
          output_tokens?: number | null
          result?: Json | null
          user_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          created_transaction_ids?: string[] | null
          error?: string | null
          id?: string
          input_tokens?: number | null
          message_raw_id?: string | null
          model?: string
          output_tokens?: number | null
          result?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_events_message_raw_id_fkey"
            columns: ["message_raw_id"]
            isOneToOne: false
            referencedRelation: "messages_raw"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts_sent: {
        Row: {
          channel: string | null
          created_at: string
          id: string
          kind: string
          ref: string
          sent_on: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          channel?: string | null
          created_at?: string
          id?: string
          kind: string
          ref: string
          sent_on?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          channel?: string | null
          created_at?: string
          id?: string
          kind?: string
          ref?: string
          sent_on?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_sent_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_sent_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_valuations: {
        Row: {
          as_of: string
          asset_id: string
          created_at: string
          id: string
          value_cents: number
          workspace_id: string
        }
        Insert: {
          as_of?: string
          asset_id: string
          created_at?: string
          id?: string
          value_cents: number
          workspace_id?: string
        }
        Update: {
          as_of?: string
          asset_id?: string
          created_at?: string
          id?: string
          value_cents?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_valuations_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_valuations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          acquired_at: string | null
          archived: boolean
          class: string
          created_at: string
          current_value_cents: number
          id: string
          is_liability: boolean
          name: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          acquired_at?: string | null
          archived?: boolean
          class?: string
          created_at?: string
          current_value_cents: number
          id?: string
          is_liability?: boolean
          name: string
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          acquired_at?: string | null
          archived?: boolean
          class?: string
          created_at?: string
          current_value_cents?: number
          id?: string
          is_liability?: boolean
          name?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          id: string
          payload: Json | null
          provider: string | null
          received_at: string
          result: string | null
          type: string | null
          workspace_id: string | null
        }
        Insert: {
          id: string
          payload?: Json | null
          provider?: string | null
          received_at?: string
          result?: string | null
          type?: string | null
          workspace_id?: string | null
        }
        Update: {
          id?: string
          payload?: Json | null
          provider?: string | null
          received_at?: string
          result?: string | null
          type?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          category: string
          created_at: string
          id: string
          limit_cents: number
          month: string | null
          rollover: boolean
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          limit_cents: number
          month?: string | null
          rollover?: boolean
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          limit_cents?: number
          month?: string | null
          rollover?: boolean
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      card_invoices: {
        Row: {
          account_id: string
          closing_date: string
          created_at: string
          due_date: string
          id: string
          paid_at: string | null
          payment_transaction_id: string | null
          reference_month: string
          settled_manually: boolean
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          account_id: string
          closing_date: string
          created_at?: string
          due_date: string
          id?: string
          paid_at?: string | null
          payment_transaction_id?: string | null
          reference_month: string
          settled_manually?: boolean
          status?: string
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          account_id?: string
          closing_date?: string
          created_at?: string
          due_date?: string
          id?: string
          paid_at?: string | null
          payment_transaction_id?: string | null
          reference_month?: string
          settled_manually?: boolean
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_invoices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_invoices_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_invoices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_invoices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      categorization_rules: {
        Row: {
          account_id: string | null
          category: string | null
          created_at: string
          hits: number
          id: string
          match_type: string
          pattern: string
          priority: number
          source: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          category?: string | null
          created_at?: string
          hits?: number
          id?: string
          match_type?: string
          pattern: string
          priority?: number
          source?: string
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          account_id?: string | null
          category?: string | null
          created_at?: string
          hits?: number
          id?: string
          match_type?: string
          pattern?: string
          priority?: number
          source?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorization_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorization_rules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorization_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      debts: {
        Row: {
          account_id: string | null
          archived: boolean
          created_at: string
          due_day: number | null
          id: string
          installment_cents: number | null
          installments: number | null
          installments_paid: number
          interest_rate_monthly: number
          kind: string
          name: string
          principal_cents: number
          remaining_cents: number
          started_at: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          archived?: boolean
          created_at?: string
          due_day?: number | null
          id?: string
          installment_cents?: number | null
          installments?: number | null
          installments_paid?: number
          interest_rate_monthly?: number
          kind?: string
          name: string
          principal_cents: number
          remaining_cents: number
          started_at?: string
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          account_id?: string | null
          archived?: boolean
          created_at?: string
          due_day?: number | null
          id?: string
          installment_cents?: number | null
          installments?: number | null
          installments_paid?: number
          interest_rate_monthly?: number
          kind?: string
          name?: string
          principal_cents?: number
          remaining_cents?: number
          started_at?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_actions: {
        Row: {
          action: Json
          created_at: string
          expires_at: string
          id: string
          missing: string
          phone: string
          raw_text: string
          slot: string
          thread_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          action: Json
          created_at?: string
          expires_at?: string
          id?: string
          missing: string
          phone: string
          raw_text: string
          slot?: string
          thread_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          action?: Json
          created_at?: string
          expires_at?: string
          id?: string
          missing?: string
          phone?: string
          raw_text?: string
          slot?: string
          thread_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_actions_phone_fkey"
            columns: ["phone"]
            isOneToOne: false
            referencedRelation: "user_sessions"
            referencedColumns: ["phone"]
          },
        ]
      }
      executed_actions: {
        Row: {
          action_index: number
          action_type: string
          executed_at: string
          result_id: string | null
          wa_message_id: string
        }
        Insert: {
          action_index: number
          action_type: string
          executed_at?: string
          result_id?: string | null
          wa_message_id: string
        }
        Update: {
          action_index?: number
          action_type?: string
          executed_at?: string
          result_id?: string | null
          wa_message_id?: string
        }
        Relationships: []
      }
      goal_contributions: {
        Row: {
          amount_cents: number
          created_at: string
          goal_id: string
          id: string
          note: string | null
          occurred_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          goal_id: string
          id?: string
          note?: string | null
          occurred_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          goal_id?: string
          id?: string
          note?: string | null
          occurred_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_contributions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_contributions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_contributions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          archived: boolean
          created_at: string
          deadline: string | null
          id: string
          name: string
          saved_cents: number
          target_cents: number
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          deadline?: string | null
          id?: string
          name: string
          saved_cents?: number
          target_cents: number
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          deadline?: string | null
          id?: string
          name?: string
          saved_cents?: number
          target_cents?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          account_id: string | null
          created_at: string
          error: string | null
          filename: string | null
          id: string
          source: string
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          error?: string | null
          filename?: string | null
          id?: string
          source: string
          status?: string
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          error?: string | null
          filename?: string | null
          id?: string
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      import_items: {
        Row: {
          amount_cents: number
          batch_id: string
          created_at: string
          dedupe_hash: string | null
          description: string | null
          id: string
          kind: string
          merchant: string | null
          occurred_at: string
          raw: Json | null
          status: string
          suggested_account_id: string | null
          suggested_category: string | null
          transaction_id: string | null
          workspace_id: string
        }
        Insert: {
          amount_cents: number
          batch_id: string
          created_at?: string
          dedupe_hash?: string | null
          description?: string | null
          id?: string
          kind?: string
          merchant?: string | null
          occurred_at: string
          raw?: Json | null
          status?: string
          suggested_account_id?: string | null
          suggested_category?: string | null
          transaction_id?: string | null
          workspace_id: string
        }
        Update: {
          amount_cents?: number
          batch_id?: string
          created_at?: string
          dedupe_hash?: string | null
          description?: string | null
          id?: string
          kind?: string
          merchant?: string | null
          occurred_at?: string
          raw?: Json | null
          status?: string
          suggested_account_id?: string | null
          suggested_category?: string | null
          transaction_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_items_suggested_account_id_fkey"
            columns: ["suggested_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_plans: {
        Row: {
          account_id: string | null
          category: string | null
          created_at: string
          description: string | null
          first_occurred_at: string
          id: string
          installments: number
          merchant: string | null
          total_cents: number
          user_id: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          first_occurred_at: string
          id?: string
          installments: number
          merchant?: string | null
          total_cents: number
          user_id: string
          workspace_id?: string
        }
        Update: {
          account_id?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          first_occurred_at?: string
          id?: string
          installments?: number
          merchant?: string | null
          total_cents?: number
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_plans_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          status: string
          type: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          payload: Json
          processed_at?: string | null
          status?: string
          type?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          status?: string
          type?: string
        }
        Relationships: []
      }
      messages_queue: {
        Row: {
          batch_id: string | null
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          message_type: string | null
          payload: Json
          phone: string
          processed_at: string | null
          retry_count: number
          status: string
          thread_id: string
          user_id: string | null
          wa_message_id: string
          workspace_id: string | null
        }
        Insert: {
          batch_id?: string | null
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          message_type?: string | null
          payload: Json
          phone: string
          processed_at?: string | null
          retry_count?: number
          status?: string
          thread_id: string
          user_id?: string | null
          wa_message_id: string
          workspace_id?: string | null
        }
        Update: {
          batch_id?: string | null
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          message_type?: string | null
          payload?: Json
          phone?: string
          processed_at?: string | null
          retry_count?: number
          status?: string
          thread_id?: string
          user_id?: string | null
          wa_message_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_queue_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages_raw: {
        Row: {
          created_at: string
          direction: string
          id: string
          message_type: string | null
          payload: Json
          phone: string
          user_id: string | null
          wa_message_id: string
        }
        Insert: {
          created_at?: string
          direction: string
          id?: string
          message_type?: string | null
          payload: Json
          phone: string
          user_id?: string | null
          wa_message_id: string
        }
        Update: {
          created_at?: string
          direction?: string
          id?: string
          message_type?: string | null
          payload?: Json
          phone?: string
          user_id?: string | null
          wa_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_raw_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      net_worth_snapshots: {
        Row: {
          as_of: string
          cash_cents: number
          created_at: string
          id: string
          investments_cents: number
          liabilities_cents: number
          net_cents: number
          other_assets_cents: number
          workspace_id: string
        }
        Insert: {
          as_of?: string
          cash_cents: number
          created_at?: string
          id?: string
          investments_cents: number
          liabilities_cents: number
          net_cents: number
          other_assets_cents: number
          workspace_id: string
        }
        Update: {
          as_of?: string
          cash_cents?: number
          created_at?: string
          id?: string
          investments_cents?: number
          liabilities_cents?: number
          net_cents?: number
          other_assets_cents?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "net_worth_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      note_folders: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          name: string
          parent_id: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "note_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_folders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_folders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          category: string | null
          content: string
          created_at: string
          deleted_at: string | null
          folder_id: string | null
          id: string
          pinned: boolean
          search_tsv: unknown
          source: string
          tags: string[] | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          deleted_at?: string | null
          folder_id?: string | null
          id?: string
          pinned?: boolean
          search_tsv?: unknown
          source?: string
          tags?: string[] | null
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          deleted_at?: string | null
          folder_id?: string | null
          id?: string
          pinned?: boolean
          search_tsv?: unknown
          source?: string
          tags?: string[] | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "note_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_actions: {
        Row: {
          action: Json
          created_at: string
          expires_at: string
          id: string
          phone: string
          resolved_at: string | null
          status: string
          summary: string
          thread_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          action: Json
          created_at?: string
          expires_at?: string
          id?: string
          phone: string
          resolved_at?: string | null
          status?: string
          summary: string
          thread_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          action?: Json
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          resolved_at?: string | null
          status?: string
          summary?: string
          thread_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_actions_phone_fkey"
            columns: ["phone"]
            isOneToOne: false
            referencedRelation: "user_sessions"
            referencedColumns: ["phone"]
          },
        ]
      }
      profiles: {
        Row: {
          alerts_enabled: boolean
          created_at: string
          display_name: string | null
          expo_push_token: string | null
          id: string
          locale: string
          phone: string | null
          timezone: string
          updated_at: string
          whatsapp_verified: boolean
        }
        Insert: {
          alerts_enabled?: boolean
          created_at?: string
          display_name?: string | null
          expo_push_token?: string | null
          id: string
          locale?: string
          phone?: string | null
          timezone?: string
          updated_at?: string
          whatsapp_verified?: boolean
        }
        Update: {
          alerts_enabled?: boolean
          created_at?: string
          display_name?: string | null
          expo_push_token?: string | null
          id?: string
          locale?: string
          phone?: string | null
          timezone?: string
          updated_at?: string
          whatsapp_verified?: boolean
        }
        Relationships: []
      }
      recurring_transactions: {
        Row: {
          account_id: string | null
          active: boolean
          amount_cents: number
          auto_confirm: boolean
          category: string | null
          created_at: string
          currency: string
          description: string | null
          dtstart: string | null
          end_date: string | null
          id: string
          kind: string
          last_error: string | null
          materialized_until: string | null
          next_run_at: string
          rrule: string
          run_attempts: number
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          amount_cents: number
          auto_confirm?: boolean
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          dtstart?: string | null
          end_date?: string | null
          id?: string
          kind: string
          last_error?: string | null
          materialized_until?: string | null
          next_run_at: string
          rrule: string
          run_attempts?: number
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          account_id?: string | null
          active?: boolean
          amount_cents?: number
          auto_confirm?: boolean
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          dtstart?: string | null
          end_date?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          materialized_until?: string | null
          next_run_at?: string
          rrule?: string
          run_attempts?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          active: boolean
          channel: string
          created_at: string
          id: string
          last_error: string | null
          next_run_at: string
          recurrence: string | null
          send_attempts: number
          source: string
          timezone: string
          title: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          channel?: string
          created_at?: string
          id?: string
          last_error?: string | null
          next_run_at: string
          recurrence?: string | null
          send_attempts?: number
          source?: string
          timezone?: string
          title: string
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          active?: boolean
          channel?: string
          created_at?: string
          id?: string
          last_error?: string | null
          next_run_at?: string
          recurrence?: string | null
          send_attempts?: number
          source?: string
          timezone?: string
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          environment: string | null
          external_id: string | null
          is_trial: boolean
          plan: string
          product_id: string | null
          provider: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          environment?: string | null
          external_id?: string | null
          is_trial?: boolean
          plan?: string
          product_id?: string | null
          provider?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          environment?: string | null
          external_id?: string | null
          is_trial?: boolean
          plan?: string
          product_id?: string | null
          provider?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string | null
          amount_cents: number
          attachment_path: string | null
          category: string | null
          counterparty_account_id: string | null
          created_at: string
          currency: string
          debt_id: string | null
          description: string | null
          due_at: string | null
          id: string
          installment_no: number | null
          installment_plan_id: string | null
          invoice_id: string | null
          kind: string
          merchant: string | null
          occurred_at: string
          paid_at: string | null
          recurring_id: string | null
          source: string
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          amount_cents: number
          attachment_path?: string | null
          category?: string | null
          counterparty_account_id?: string | null
          created_at?: string
          currency?: string
          debt_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          installment_no?: number | null
          installment_plan_id?: string | null
          invoice_id?: string | null
          kind: string
          merchant?: string | null
          occurred_at?: string
          paid_at?: string | null
          recurring_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          account_id?: string | null
          amount_cents?: number
          attachment_path?: string | null
          category?: string | null
          counterparty_account_id?: string | null
          created_at?: string
          currency?: string
          debt_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          installment_no?: number | null
          installment_plan_id?: string | null
          invoice_id?: string | null
          kind?: string
          merchant?: string | null
          occurred_at?: string
          paid_at?: string | null
          recurring_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_counterparty_account_id_fkey"
            columns: ["counterparty_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "debts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_installment_plan_id_fkey"
            columns: ["installment_plan_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "card_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_recurring_id_fkey"
            columns: ["recurring_id"]
            isOneToOne: false
            referencedRelation: "recurring_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          created_at: string
          debounce_task_name: string | null
          last_message_at: string | null
          phone: string
          session_epoch: number
          thread_id: string
          timezone: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          debounce_task_name?: string | null
          last_message_at?: string | null
          phone: string
          session_epoch?: number
          thread_id: string
          timezone?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          debounce_task_name?: string | null
          last_message_at?: string | null
          phone?: string
          session_epoch?: number
          thread_id?: string
          timezone?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          invited_by: string
          phone: string
          role: string
          status: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by: string
          phone: string
          role?: string
          status?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string
          phone?: string
          role?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          plan: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          owner_id: string
          plan?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          plan?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _account_balances: {
        Args: { uid: string }
        Returns: {
          account_id: string
          balance_cents: number
          name: string
          type: string
        }[]
      }
      _affordability: {
        Args: { amount_cents: number; installments?: number; uid: string }
        Returns: {
          can_afford: boolean
          installment_cents: number
          worst_balance_cents: number
          worst_day: string
        }[]
      }
      _alerts_to_send: {
        Args: never
        Returns: {
          body: string
          expo_push_token: string
          kind: string
          phone: string
          ref: string
          title: string
          user_id: string
          workspace_id: string
        }[]
      }
      _apply_entitlement: {
        Args: {
          p_active: boolean
          p_app_user_id: string
          p_environment: string
          p_event_id: string
          p_expires_on: string
          p_external_id: string
          p_is_trial: boolean
          p_payload: Json
          p_plan: string
          p_product_id: string
          p_provider: string
        }
        Returns: string
      }
      _budgets_status: {
        Args: { ref_month?: string; uid: string }
        Returns: {
          base_limit_cents: number
          category: string
          limit_cents: number
          month: string
          rollover: boolean
          rollover_cents: number
          spent_cents: number
        }[]
      }
      _bump_rule_hits: { Args: { rule_id: string }; Returns: undefined }
      _card_summary: {
        Args: { uid: string }
        Returns: {
          account_id: string
          available_limit_cents: number
          closing_date: string
          closing_day: number
          credit_limit_cents: number
          due_date: string
          due_day: number
          invoice_id: string
          invoice_total_cents: number
          name: string
          oldest_overdue_invoice_id: string
          overdue_count: number
          overdue_total_cents: number
          reference_month: string
          unpaid_total_cents: number
        }[]
      }
      _cash_flow_forecast: {
        Args: { days?: number; uid: string }
        Returns: {
          balance_cents: number
          day: string
          in_cents: number
          out_cents: number
        }[]
      }
      _close_due_invoices: { Args: never; Returns: number }
      _default_workspace: { Args: { uid: string }; Returns: string }
      _match_rule: {
        Args: { texto: string; ws_id: string }
        Returns: {
          account_id: string
          category: string
          rule_id: string
        }[]
      }
      _monthly_cashflow: {
        Args: { months_back?: number; uid: string }
        Returns: {
          expense_cents: number
          income_cents: number
          month: string
        }[]
      }
      _payoff_strategy: {
        Args: { estrategia?: string; uid: string }
        Returns: {
          debt_id: string
          interest_rate_monthly: number
          months_left: number
          name: string
          priority: number
          remaining_cents: number
          total_interest_cents: number
        }[]
      }
      _plan_status: {
        Args: { ws_id: string }
        Returns: {
          ai_messages_month: number
          can_import: boolean
          current_period_end: string
          is_trial: boolean
          max_ai_messages_month: number
          max_members: number
          members: number
          plan: string
          provider: string
          status: string
        }[]
      }
      _prepare_import_batch: {
        Args: { p_batch_id: string }
        Returns: {
          categorizados: number
          duplicados: number
          total: number
        }[]
      }
      _promote_due_transactions: { Args: never; Returns: number }
      _snapshot_net_worth: { Args: never; Returns: number }
      _tx_summary: {
        Args: { from_date: string; to_date: string; uid: string }
        Returns: {
          category: string
          kind: string
          total_cents: number
          tx_count: number
        }[]
      }
      _upcoming_bills: {
        Args: { days?: number; uid: string }
        Returns: {
          amount_cents: number
          due_date: string
          kind: string
          overdue: boolean
          ref_id: string
          title: string
        }[]
      }
      _workspace_ids: { Args: { uid: string }; Returns: string[] }
      accept_pending_invites: { Args: never; Returns: number }
      account_balances: {
        Args: never
        Returns: {
          account_id: string
          balance_cents: number
          name: string
          type: string
        }[]
      }
      affordability: {
        Args: { amount_cents: number; installments?: number }
        Returns: {
          can_afford: boolean
          installment_cents: number
          worst_balance_cents: number
          worst_day: string
        }[]
      }
      annual_by_category: {
        Args: { p_year: number }
        Returns: {
          category: string
          kind: string
          total_cents: number
          tx_count: number
        }[]
      }
      annual_summary: {
        Args: { p_year: number }
        Returns: {
          balance_cents: number
          expense_cents: number
          income_cents: number
          savings_rate: number
          tx_count: number
        }[]
      }
      approve_import_items: { Args: { p_item_ids: string[] }; Returns: number }
      budgets_status: {
        Args: { ref_month?: string }
        Returns: {
          base_limit_cents: number
          category: string
          limit_cents: number
          month: string
          rollover: boolean
          rollover_cents: number
          spent_cents: number
        }[]
      }
      cancel_subscription: { Args: never; Returns: string }
      card_summary: {
        Args: never
        Returns: {
          account_id: string
          available_limit_cents: number
          closing_date: string
          closing_day: number
          credit_limit_cents: number
          due_date: string
          due_day: number
          invoice_id: string
          invoice_total_cents: number
          name: string
          oldest_overdue_invoice_id: string
          overdue_count: number
          overdue_total_cents: number
          reference_month: string
          unpaid_total_cents: number
        }[]
      }
      cash_flow_forecast: {
        Args: { days?: number }
        Returns: {
          balance_cents: number
          day: string
          in_cents: number
          out_cents: number
        }[]
      }
      claim_jobs: {
        Args: { batch_size?: number }
        Returns: {
          attempts: number
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          status: string
          type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_thread_batch: {
        Args: { p_thread_id: string }
        Returns: {
          batch_id: string | null
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          message_type: string | null
          payload: Json
          phone: string
          processed_at: string | null
          retry_count: number
          status: string
          thread_id: string
          user_id: string | null
          wa_message_id: string
          workspace_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "messages_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_installment_plan: {
        Args: {
          p_account_id: string
          p_category?: string
          p_description?: string
          p_installments: number
          p_merchant?: string
          p_occurred_at: string
          p_total_cents: number
        }
        Returns: string
      }
      debt_schedule: {
        Args: { p_debt_id: string }
        Returns: {
          balance_cents: number
          due_date: string
          installment_no: number
          interest_cents: number
          payment_cents: number
          principal_cents: number
        }[]
      }
      expenses_monthly: {
        Args: { months_back?: number }
        Returns: {
          month: string
          total_cents: number
        }[]
      }
      expenses_summary: {
        Args: { from_date: string; to_date: string }
        Returns: {
          category: string
          expense_count: number
          total_cents: number
        }[]
      }
      expire_draft_actions: { Args: never; Returns: number }
      expire_pending_actions: {
        Args: { p_thread_id?: string }
        Returns: number
      }
      financial_health: {
        Args: never
        Returns: {
          budget_adherence: number
          debt_ratio: number
          months_of_reserve: number
          savings_rate: number
          score: number
        }[]
      }
      goal_deposit: {
        Args: {
          p_amount_cents: number
          p_goal_id: string
          p_note?: string
          p_occurred_at?: string
        }
        Returns: number
      }
      monthly_cashflow: {
        Args: { months_back?: number }
        Returns: {
          expense_cents: number
          income_cents: number
          month: string
        }[]
      }
      my_default_workspace: { Args: never; Returns: string }
      net_worth: {
        Args: never
        Returns: {
          cash_cents: number
          investments_cents: number
          liabilities_cents: number
          net_cents: number
          other_assets_cents: number
        }[]
      }
      net_worth_series: {
        Args: { months_back?: number }
        Returns: {
          cash_cents: number
          investments_cents: number
          liabilities_cents: number
          month: string
          net_cents: number
          other_assets_cents: number
        }[]
      }
      note_folder_counts: {
        Args: never
        Returns: {
          folder_id: string
          notes_count: number
        }[]
      }
      note_tag_counts: {
        Args: never
        Returns: {
          notes_count: number
          tag: string
        }[]
      }
      note_tags_of: { Args: { txt: string }; Returns: string[] }
      pay_debt_installment: {
        Args: {
          p_account_id?: string
          p_amount_cents: number
          p_debt_id: string
          p_paid_at?: string
        }
        Returns: number
      }
      pay_invoice: {
        Args: { p_account_id: string; p_invoice_id: string; p_paid_at?: string }
        Returns: string
      }
      payoff_strategy: {
        Args: { estrategia?: string }
        Returns: {
          debt_id: string
          interest_rate_monthly: number
          months_left: number
          name: string
          priority: number
          remaining_cents: number
          total_interest_cents: number
        }[]
      }
      plan_status: {
        Args: never
        Returns: {
          ai_messages_month: number
          can_import: boolean
          current_period_end: string
          is_trial: boolean
          max_ai_messages_month: number
          max_members: number
          members: number
          plan: string
          provider: string
          status: string
        }[]
      }
      routes_to_python: { Args: { p_phone: string }; Returns: boolean }
      save_budget: {
        Args: {
          p_category: string
          p_limit_cents: number
          p_month?: string
          p_rollover?: boolean
        }
        Returns: string
      }
      settle_invoice: {
        Args: { p_invoice_id: string; p_paid_at?: string }
        Returns: string
      }
      transactions_summary: {
        Args: { from_date: string; to_date: string }
        Returns: {
          category: string
          kind: string
          total_cents: number
          tx_count: number
        }[]
      }
      upcoming_bills: {
        Args: { days?: number }
        Returns: {
          amount_cents: number
          due_date: string
          kind: string
          overdue: boolean
          ref_id: string
          title: string
        }[]
      }
      update_asset_value: {
        Args: { p_as_of?: string; p_asset_id: string; p_value_cents: number }
        Returns: number
      }
      year_end_balances: {
        Args: { p_year: number }
        Returns: {
          balance_cents: number
          kind: string
          name: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
