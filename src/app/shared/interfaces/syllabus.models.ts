/**
 * Syllabus data models for course content display and gap analysis
 */

export interface WeeklySchedule {
  week: number;
  date: string;
  topics: string[];
  assignments?: string;
  dueDate?: string;
}

export interface SyllabusContent {
  courseCode: string;
  courseNumber: string;
  courseTitle: string;
  category: string;
  rawContent: string;
  weeklySchedule: WeeklySchedule[];
  keyTopics: string[];
  learningObjectives?: string[];
  prerequisites?: string[];
}

export interface CourseWithSyllabus {
  id: string;
  code: string;
  number: string;
  title: string;
  category: string;
  description?: string;
  creditHours?: number;
  syllabus?: SyllabusContent;
  syllabusFile?: string;
  contentLength?: number;
}

export interface GapAnalysisResult {
  courseId: string;
  courseTitle: string;
  coveredTopics: string[];
  missingTopics: string[];
  suggestedTopics: string[];
  coveragePercentage: number;
  recommendations: string[];
}

export interface CurriculumGapReport {
  timestamp: Date;
  analyzedCourses: number;
  totalGaps: number;
  overallCoverage: number;
  gapsByCategory: Map<string, GapAnalysisResult[]>;
  prioritizedRecommendations: string[];
}

export interface SyllabusComparisonResult {
  course1: CourseWithSyllabus;
  course2: CourseWithSyllabus;
  commonTopics: string[];
  uniqueToCourse1: string[];
  uniqueToCourse2: string[];
  similarityScore: number;
}