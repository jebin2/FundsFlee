export interface DuplicateResult {
  is_duplicate: boolean;
  confidence: number;
  duplicate_of_id?: string;
  reason?: string;
}

export interface CategorySummary {
  category: string;
  amount: number;
  percent: number;
  count: number;
}

export interface OptimizationTip {
  title: string;
  description: string;
  potential_saving: number;
  effort: "low" | "medium" | "high";
  quality_impact: "none" | "minimal" | "moderate";
}

export interface AnalysisResult {
  period: string;
  period_type: "day" | "week" | "month" | "custom";
  total_spent: number;
  by_category: CategorySummary[];
  ai_insights: string[];
  optimization_tips: OptimizationTip[];
}
