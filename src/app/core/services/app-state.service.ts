import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest } from 'rxjs';
import { map, tap, debounceTime } from 'rxjs/operators';
import { 
  AppState, 
  JobTitle, 
  Course, 
  SuggestedCourse, 
  CourseMapping,
  JobSuggestionMapping,
  LogEntry,
  AnalysisRequest,
  AnalysisResponse 
} from '../../shared/interfaces/data-models';
import { APP_CONSTANTS } from '../../shared/constants/app-constants';
import { SettingsService } from './settings.service';

@Injectable({
  providedIn: 'root'
})
export class AppStateService {
  // Core application state
  private readonly initialState: AppState = {
    currentStep: 1,
    isLoading: false,
    jobTitles: [],
    courses: [],
    suggestedCourses: [],
    mappings: {},
    jobSuggestionMappings: {},
    overallConfidence: 1.0,
    statusMessage: 'Ready to start. Upload course data or use defaults.',
    hasExcelData: false
  };

  private readonly stateSubject = new BehaviorSubject<AppState>(this.loadInitialState());

  // Individual state observables for fine-grained subscriptions
  private readonly logsSubject = new BehaviorSubject<LogEntry[]>([]);
  private readonly processingSubject = new BehaviorSubject<boolean>(false);
  private readonly progressSubject = new BehaviorSubject<number>(0);

  // Public observables
  public readonly state$ = this.stateSubject.asObservable();
  public readonly logs$ = this.logsSubject.asObservable();
  public readonly isProcessing$ = this.processingSubject.asObservable();
  public readonly progress$ = this.progressSubject.asObservable();

  // Derived observables
  public readonly canProceedToStep2$ = this.state$.pipe(
    map(state => state.courses.length > 0 || state.hasExcelData)
  );

  public readonly canProceedToStep3$ = this.state$.pipe(
    map(state => state.jobTitles.length > 0 && (state.courses.length > 0 || state.hasExcelData))
  );

  public readonly canAnalyzePaths$ = this.state$.pipe(
    map(state => 
      state.jobTitles.length > 0 && 
      (state.courses.length > 0 || state.hasExcelData) && 
      !!this.settingsService.getGrokApiKey()
    )
  );

  constructor(private settingsService: SettingsService) {
    // Auto-save state changes with debounce
    setTimeout(() => {
      if (this.settingsService.isAutoSaveEnabled()) {
        this.state$.pipe(
          debounceTime(APP_CONSTANTS.UI_CONFIG.AUTO_SAVE_DELAY),
          tap(state => this.saveState(state))
        ).subscribe();
      }
    });
  }

  /**
   * Load initial state from localStorage or defaults
   */
  private loadInitialState(): AppState {
    try {
      const stored = localStorage.getItem(APP_CONSTANTS.STORAGE_KEYS.APP_STATE);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AppState>;
        return { ...this.initialState, ...parsed };
      }
    } catch (error) {
      console.warn('Failed to load app state from localStorage:', error);
    }

    return this.initialState;
  }

  /**
   * Save current state to localStorage
   */
  private saveState(state: AppState): void {
    try {
      if (this.settingsService.isAutoSaveEnabled()) {
        localStorage.setItem(APP_CONSTANTS.STORAGE_KEYS.APP_STATE, JSON.stringify(state));
      }
    } catch (error) {
      console.error('Failed to save app state:', error);
    }
  }

  /**
   * Get current state synchronously
   */
  getCurrentState(): AppState {
    return this.stateSubject.value;
  }

  /**
   * Update state and notify subscribers
   */
  private updateState(updates: Partial<AppState>): void {
    const currentState = this.getCurrentState();
    const newState = { ...currentState, ...updates };
    this.stateSubject.next(newState);
  }

  /**
   * Reset to initial state
   */
  resetState(): void {
    this.stateSubject.next(this.initialState);
    this.clearLogs();
    this.setProgress(0);
    this.setProcessing(false);
  }

  /**
   * Reset to specific step
   */
  resetToStep(stepNumber: number): void {
    const currentState = this.getCurrentState();
    const updates: Partial<AppState> = {
      currentStep: stepNumber,
      isLoading: false
    };

    // Clear data for subsequent steps
    if (stepNumber <= 1) {
      updates.courses = [];
      updates.jobTitles = [];
      updates.mappings = {};
      updates.jobSuggestionMappings = {};
      updates.suggestedCourses = [];
      updates.overallConfidence = 1.0;
      updates.hasExcelData = false;
    } else if (stepNumber <= 2) {
      updates.jobTitles = [];
      updates.mappings = {};
      updates.jobSuggestionMappings = {};
      updates.suggestedCourses = [];
      updates.overallConfidence = 1.0;
    } else if (stepNumber <= 3) {
      updates.mappings = {};
      updates.jobSuggestionMappings = {};
      updates.suggestedCourses = [];
      updates.overallConfidence = 1.0;
    }

    this.updateState(updates);
    this.clearLogs();
    this.setProgress(0);
  }

  // Step management methods
  setCurrentStep(step: number): void {
    this.updateState({ currentStep: step });
  }

  getCurrentStep(): number {
    return this.getCurrentState().currentStep;
  }

  // Loading state management
  setLoading(isLoading: boolean): void {
    this.updateState({ isLoading });
  }

  // Course data management
  setCourses(courses: Course[]): void {
    this.updateState({ 
      courses,
      hasExcelData: courses.length > 0,
      statusMessage: `Loaded ${courses.length} courses`
    });
  }

  addCourse(course: Course): void {
    const currentState = this.getCurrentState();
    const courses = [...currentState.courses, course];
    this.setCourses(courses);
  }

  removeCourse(courseId: string): void {
    const currentState = this.getCurrentState();
    const courses = currentState.courses.filter(c => c.id !== courseId);
    this.setCourses(courses);
  }

  // Job titles management
  setJobTitles(jobTitles: JobTitle[]): void {
    this.updateState({ 
      jobTitles,
      statusMessage: `Loaded ${jobTitles.length} job titles`
    });
  }

  addJobTitle(jobTitle: JobTitle): void {
    const currentState = this.getCurrentState();
    const jobTitles = [...currentState.jobTitles, jobTitle];
    this.setJobTitles(jobTitles);
  }

  removeJobTitle(jobId: string): void {
    const currentState = this.getCurrentState();
    const jobTitles = currentState.jobTitles.filter(j => j.id !== jobId);
    this.setJobTitles(jobTitles);
  }

  // Analysis results management
  setAnalysisResults(response: AnalysisResponse): void {
    const updates: Partial<AppState> = {
      mappings: response.mappings || {},
      jobSuggestionMappings: response.job_suggestion_mappings || {},
      suggestedCourses: response.suggested_courses || [],
      overallConfidence: response.overall_confidence || 1.0,
      currentStep: 4
    };

    // Set appropriate status message
    if (response.overall_confidence && response.overall_confidence < 0.9) {
      updates.statusMessage = `AI analysis complete - Low confidence (${(response.overall_confidence * 100).toFixed(0)}%). Check suggestions.`;
    } else {
      updates.statusMessage = 'AI analysis complete - review the mappings below';
    }

    this.updateState(updates);
  }

  // Status message management
  setStatusMessage(message: string): void {
    this.updateState({ statusMessage: message });
  }

  // Processing feedback management
  setProcessing(isProcessing: boolean): void {
    this.processingSubject.next(isProcessing);
  }

  setProgress(progress: number): void {
    this.progressSubject.next(Math.max(0, Math.min(100, progress)));
  }

  addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): void {
    const currentLogs = this.logsSubject.value;
    const newLog: LogEntry = {
      ...entry,
      id: Date.now().toString(),
      timestamp: new Date().toISOString()
    };
    this.logsSubject.next([...currentLogs, newLog]);
  }

  clearLogs(): void {
    this.logsSubject.next([]);
  }

  // Default data management
  loadDefaultCourses(): void {
    const courses: Course[] = APP_CONSTANTS.DEFAULT_COURSES.map((course, index) => ({
      id: `course-${index + 1}`,
      label: course
    }));
    this.setCourses(courses);
  }

  loadDefaultJobTitles(): void {
    const jobTitles: JobTitle[] = APP_CONSTANTS.DEFAULT_JOB_TITLES.map((job, index) => ({
      id: `job-${index + 1}`,
      label: job
    }));
    this.setJobTitles(jobTitles);
  }

  // Excel data management
  setHasExcelData(hasData: boolean): void {
    this.updateState({ hasExcelData: hasData });
  }

  // Helper methods for UI components
  createAnalysisRequest(): AnalysisRequest {
    const state = this.getCurrentState();
    return {
      job_titles: state.jobTitles.map(job => job.label),
      courses: state.courses.map(course => course.label),
      max_courses_per_job: 1,
      job_data: state.jobTitles // Pass full job data including descriptions
    };
  }

  // Export/Import functionality
  exportState(): Partial<AppState> {
    const state = this.getCurrentState();
    return {
      jobTitles: state.jobTitles,
      courses: state.courses,
      mappings: state.mappings,
      jobSuggestionMappings: state.jobSuggestionMappings,
      suggestedCourses: state.suggestedCourses,
      overallConfidence: state.overallConfidence,
      currentStep: state.currentStep
    };
  }

  importState(importedState: Partial<AppState>): void {
    this.updateState(importedState);
  }

  // Validation helpers
  isReadyForStep(stepNumber: number): boolean {
    const state = this.getCurrentState();
    
    switch (stepNumber) {
      case 1:
        return true;
      case 2:
        return state.courses.length > 0 || state.hasExcelData;
      case 3:
        return state.jobTitles.length > 0 && (state.courses.length > 0 || state.hasExcelData);
      case 4:
        return state.jobTitles.length > 0 && 
               (state.courses.length > 0 || state.hasExcelData) && 
               this.settingsService.hasApiKey();
      default:
        return false;
    }
  }

  // Analytics helpers
  getAnalyticsSummary(): {
    totalCourses: number;
    totalJobs: number;
    mappedJobs: number;
    unmappedJobs: number;
    suggestedCoursesCount: number;
    overallConfidence: number;
  } {
    const state = this.getCurrentState();
    
    return {
      totalCourses: state.courses.length,
      totalJobs: state.jobTitles.length,
      mappedJobs: Object.keys(state.mappings).length,
      unmappedJobs: state.jobTitles.length - Object.keys(state.mappings).length,
      suggestedCoursesCount: state.suggestedCourses.length,
      overallConfidence: state.overallConfidence
    };
  }

  // Clear specific data
  clearMappings(): void {
    this.updateState({
      mappings: {},
      jobSuggestionMappings: {},
      suggestedCourses: [],
      overallConfidence: 1.0
    });
  }

  clearCourses(): void {
    this.updateState({
      courses: [],
      hasExcelData: false,
      mappings: {},
      jobSuggestionMappings: {},
      suggestedCourses: [],
      overallConfidence: 1.0
    });
  }

  clearJobTitles(): void {
    this.updateState({
      jobTitles: [],
      mappings: {},
      jobSuggestionMappings: {},
      suggestedCourses: [],
      overallConfidence: 1.0
    });
  }
}