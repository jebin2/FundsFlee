export interface Category {
  id: string;
  name: string;
  parent_id?: string;
  color: string;
  icon: string;
  is_default: boolean;
  created_at: string;
}
