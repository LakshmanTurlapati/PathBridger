import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { AppStateService } from '../../core/services/app-state.service';
import {
  JobTitle,
  Course,
  SuggestedCourse,
  CourseMapping,
  AnalysisResponse
} from '../../shared/interfaces/data-models';

@Component({
  selector: 'app-results-view',
  templateUrl: './results-view.component.html',
  styleUrls: ['./results-view.component.scss'],
  standalone: false
})
export class ResultsViewComponent implements OnInit, OnDestroy {
  @Input() showResults = false;

  @Output() jobDetailsClick = new EventEmitter<JobTitle>();
  @Output() exportResults = new EventEmitter<void>();

  // Data from app state
  mappings: CourseMapping = {};
  jobTitles: JobTitle[] = [];
  courses: Course[] = [];
  suggestedCourses: SuggestedCourse[] = [];

  private destroy$ = new Subject<void>();

  // For template access
  readonly Object = Object;

  constructor(private appStateService: AppStateService) {}

  ngOnInit(): void {
    this.appStateService.state$
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.mappings = state.mappings;
        this.jobTitles = state.jobTitles;
        this.courses = state.courses;
        this.suggestedCourses = state.suggestedCourses;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Get mapped jobs count
   */
  get mappedJobsCount(): number {
    return Object.keys(this.mappings).length;
  }

  /**
   * Get unmapped jobs count
   */
  get unmappedJobsCount(): number {
    const mappedJobs = Object.keys(this.mappings);
    return this.jobTitles.length - mappedJobs.length;
  }

  /**
   * Get mapping coverage percentage for a job
   */
  getMappingCoveragePercent(jobTitle: string): number {
    return this.mappings[jobTitle] ? 85 : 0;
  }

  /**
   * Get mapped course label for a job
   */
  getMappedCourseLabel(jobTitle: string): string {
    const mapping = this.mappings[jobTitle];
    if (!mapping || !Array.isArray(mapping) || mapping.length === 0) {
      return 'No course mapped';
    }
    const firstCourse = mapping[0];
    return typeof firstCourse === 'string' ? firstCourse : firstCourse.label || 'Unknown course';
  }

  /**
   * Check if any jobs have descriptions
   */
  hasJobDescriptions(): boolean {
    return this.jobTitles.some(job => job.description && job.description.trim().length > 0);
  }

  /**
   * Get jobs with descriptions
   */
  getJobsWithDescriptions(): JobTitle[] {
    return this.jobTitles.filter(job => job.description && job.description.trim().length > 0);
  }

  /**
   * Get skills covered by mapped courses for a job
   */
  getSkillsCovered(job: JobTitle): string[] {
    if (!job.skills || job.skills.length === 0) {
      return [];
    }

    const mappedCourses = this.mappings[job.label];
    if (!mappedCourses || mappedCourses.length === 0) {
      return [];
    }

    // Assume 70% skills covered for mapped courses
    const coveredCount = Math.floor(job.skills.length * 0.7);
    return job.skills.slice(0, coveredCount);
  }

  /**
   * Get skills gap for a job
   */
  getSkillsGap(job: JobTitle): string[] {
    if (!job.skills || job.skills.length === 0) {
      return [];
    }

    const covered = this.getSkillsCovered(job);
    return job.skills.filter(skill => !covered.includes(skill));
  }

  /**
   * Show job details dialog
   */
  showJobDetails(job: JobTitle): void {
    this.jobDetailsClick.emit(job);
  }

  /**
   * Export results
   */
  onExportResults(): void {
    this.exportResults.emit();
  }

  /**
   * Get coverage class based on percentage
   */
  getCoverageClass(percent: number): string {
    if (percent >= 80) return 'high';
    if (percent >= 50) return 'medium';
    return 'low';
  }

  /**
   * Check if there are any results to display
   */
  get hasResults(): boolean {
    return this.mappedJobsCount > 0 || this.suggestedCourses.length > 0;
  }
}
