export type SessionStatus = 'draft' | 'open' | 'finalized';

export type JohariQuadrant = 'open' | 'blind' | 'hidden' | 'unknown';

export interface Session {
  id: string;
  owner_id: string;
  title: string;
  subject_name: string;
  description: string | null;
  expected_participants: number;
  collect_participant_names: boolean;
  allow_small_sample_results: boolean;
  status: SessionStatus;
  created_at: string;
  self_assessment_submitted_at: string | null;
  expires_at: string | null;
  finalized_at: string | null;
}

export interface Adjective {
  id: string;
  adjective: string;
  sort_order: number;
}

export interface SessionResultAdjective {
  session_id: string;
  adjective_id: string;
  quadrant: JohariQuadrant;
  feedback_count: number;
}

export interface SessionResultSnapshot {
  session_id: string;
  participant_count: number;
  generated_at: string;
  calculation_version: string;
  adjectives: SessionResultAdjective[];
}

export interface DashboardProgress {
  expected_participants: number;
  issued_count: number;
  active_invites: number;
  completed_responses: number;
  unfilled_target: number;
  status: SessionStatus;
  expires_at: string | null;
  responded_names?: string[];
}
