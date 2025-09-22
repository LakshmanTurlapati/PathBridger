// Core data interfaces matching V1 structure for compatibility

export interface JobTitle {
  id: string;
  label: string;
}

export interface Course {
  id: string;
  label: string;
}

export interface SuggestedCourse {
  title: string;
  confidence: number;
  skill_gaps: string[];
  related_jobs: string[];
  reasoning: string;
  created_at: string;
  // New fields for enhanced syllabi
  enhanced_syllabus?: EnhancedSyllabus;
  original_course_id?: string;
  improvement_type: 'new_course' | 'enhanced_syllabus';
}

export interface EnhancedSyllabus {
  original_course_id: string;
  enhanced_course: import('./syllabus.models').CourseWithSyllabus;
  enhancement_details: CourseEnhancement;
  confidence_score: number;
  improvement_summary: string;
}

export interface CourseMapping {
  [jobTitle: string]: string; // One-to-one mapping from job title to course
}

export interface JobSuggestionMapping {
  [jobTitle: string]: string; // One-to-one mapping from job title to suggested course
}

// AI Analysis interfaces
export interface AnalysisRequest {
  job_titles: string[];
  courses: string[];
  max_courses_per_job: number;
}

export interface AnalysisResponse {
  success: boolean;
  mappings?: CourseMapping;
  job_suggestion_mappings?: JobSuggestionMapping;
  suggested_courses?: SuggestedCourse[];
  overall_confidence?: number;
  confidence_analysis?: {
    [jobTitle: string]: {
      confidence_score: number;
      skill_gaps: string[];
      missing_competencies: string[];
    };
  };
  ai_reasoning?: { [jobTitle: string]: string };
  thresholds?: { [jobTitle: string]: number };
  threshold_reasoning?: { [jobTitle: string]: string };
  method?: string;
  progress_step?: number;
}

// Excel data interfaces
export interface ExcelCourse {
  title: string;
  code?: string;
  description?: string;
  credit_hours?: number;
}

export interface ExcelParsingResult {
  courses: ExcelCourse[];
  totalRows: number;
  validRows: number;
  errors: string[];
}

// Application state interfaces
export interface AppState {
  currentStep: number;
  isLoading: boolean;
  jobTitles: JobTitle[];
  courses: Course[];
  suggestedCourses: SuggestedCourse[];
  mappings: CourseMapping;
  jobSuggestionMappings: JobSuggestionMapping;
  overallConfidence: number;
  statusMessage: string;
  hasExcelData: boolean;
}

// Settings interfaces
export interface AppSettings {
  grokApiKey?: string;
  encryptedApiKey?: string;
  lastUpdated?: string;
  theme?: 'light' | 'dark' | 'auto';
  autoSaveProgress?: boolean;
}

// Log entry for processing feedback
export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  operation?: string;
  progress?: number;
}

// Course enhancement tracking
export interface CourseEnhancement {
  courseId: string;
  courseName: string;
  originalWeekCount: number;
  enhancedWeekCount: number;
  gapsFilled: number[];
  topicsEnhanced: { original: string; enhanced: string }[];
  assignmentsMoved: { from: string; to: string }[];
  enhancementTimestamp: string;
  enhancementSummary: string;
}

// UI Component interfaces
export interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  type?: 'regular' | 'suggestion';
}

export interface DragState {
  isDragging: boolean;
  sourceId: string;
  sourceX: number;
  sourceY: number;
  currentX: number;
  currentY: number;
  targetId: string | null;
}

// xAI Grok API interfaces (OpenAI-compatible format)
export interface GrokRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  reasoning_effort?: 'low' | 'high';
  search_parameters?: {
    mode?: 'auto' | 'on' | 'off';
    return_citations?: boolean;
    sources?: Array<{ type: 'web' | 'x' | 'news' | 'rss' }>;
    from_date?: string;
    to_date?: string;
  };
  response_format?: {
    type: 'json_schema';
    schema: any;
  };
}

export interface GrokResponse {
  choices: Array<{
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    num_sources_used?: number; // For Live Search
  };
  model: string;
  id: string;
  created: number;
}

// Threshold analysis interfaces (matching V1 dual threshold system)
export interface JobThreshold {
  job_title: string;
  threshold: number;
  reasoning: string;
  risk_category?: string;
  complexity_level?: string;
}

export interface ThresholdAnalysisResponse {
  threshold_analysis: JobThreshold[];
}