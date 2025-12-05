import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject, takeUntil } from 'rxjs';
import { AppStateService } from '../../core/services/app-state.service';
import { NotificationService } from '../../core/services/notification.service';
import { JobTitle } from '../../shared/interfaces/data-models';
import { JobDialogComponent, JobDialogData, JobDialogResult } from '../job-dialog/job-dialog.component';
import { JobDetailsDialogComponent } from '../job-details-dialog/job-details-dialog.component';
import { getExperienceLevelLabel } from '../../shared/utils/experience-level.utils';

@Component({
  selector: 'app-job-selection',
  templateUrl: './job-selection.component.html',
  styleUrls: ['./job-selection.component.scss'],
  standalone: false
})
export class JobSelectionComponent implements OnInit, OnDestroy {
  @Input() isLoading = false;
  @Input() maxDisplayedJobs = 8;

  @Output() jobsChanged = new EventEmitter<JobTitle[]>();

  jobs: JobTitle[] = [];
  private destroy$ = new Subject<void>();

  constructor(
    private appStateService: AppStateService,
    private notification: NotificationService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    // Subscribe to jobs from app state
    this.appStateService.state$
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.jobs = state.jobTitles;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Open the job dialog to add new jobs
   */
  openJobDialog(mode: 'add' | 'fetch' | 'both' = 'both'): void {
    const dialogData: JobDialogData = {
      existingJobs: this.jobs,
      mode
    };

    const dialogRef = this.dialog.open(JobDialogComponent, {
      width: '700px',
      maxHeight: '80vh',
      data: dialogData,
      disableClose: false,
      panelClass: 'modern-dialog'
    });

    dialogRef.afterClosed().subscribe((result: JobDialogResult | null) => {
      if (result && result.jobs.length > 0) {
        const updatedJobs = [...this.jobs, ...result.jobs];
        this.appStateService.setJobTitles(updatedJobs);
        this.jobsChanged.emit(updatedJobs);
        this.notification.showSuccess(`Added ${result.jobs.length} job title(s)`);
      }
    });
  }

  /**
   * Remove a job from the list
   */
  removeJob(job: JobTitle, event: MouseEvent): void {
    event.stopPropagation();
    const updatedJobs = this.jobs.filter(j => j.id !== job.id && j.label !== job.label);
    this.appStateService.setJobTitles(updatedJobs);
    this.jobsChanged.emit(updatedJobs);
    this.notification.showInfo(`Removed "${job.label}"`);
  }

  /**
   * Show job details in a dialog
   */
  showJobDetails(job: JobTitle): void {
    this.dialog.open(JobDetailsDialogComponent, {
      data: job,
      width: '600px',
      maxWidth: '90vw',
      panelClass: 'modern-dialog'
    });
  }

  /**
   * Clear all jobs
   */
  clearAllJobs(): void {
    if (this.jobs.length === 0) return;

    this.appStateService.setJobTitles([]);
    this.jobsChanged.emit([]);
    this.notification.showInfo('Cleared all job titles');
  }

  /**
   * Get the job tooltip text
   */
  getJobTooltip(job: JobTitle): string {
    let tooltip = job.label;

    if (job.description) {
      tooltip += `\n\n${job.description}`;
    }

    if (job.skills && job.skills.length > 0) {
      tooltip += `\n\nKey Skills: ${job.skills.join(', ')}`;
    }

    if (job.trends) {
      tooltip += `\n\nMarket Trend: ${job.trends}`;
    }

    if (job.averageSalary) {
      tooltip += `\n\nAverage Salary: ${job.averageSalary}`;
    }

    if (job.experienceLevel) {
      tooltip += `\n\nExperience: ${getExperienceLevelLabel(job.experienceLevel)}`;
    }

    return tooltip;
  }

  /**
   * Check if job has description
   */
  hasJobDescription(job: JobTitle): boolean {
    return !!(job.description && job.description.trim().length > 0);
  }

  /**
   * Get displayed jobs (limited)
   */
  get displayedJobs(): JobTitle[] {
    return this.jobs.slice(0, this.maxDisplayedJobs);
  }

  /**
   * Get remaining jobs count
   */
  get remainingJobsCount(): number {
    return Math.max(0, this.jobs.length - this.maxDisplayedJobs);
  }

  /**
   * Check if there are more jobs than displayed
   */
  get hasMoreJobs(): boolean {
    return this.jobs.length > this.maxDisplayedJobs;
  }

  /**
   * Check if any jobs are loaded
   */
  get hasJobs(): boolean {
    return this.jobs.length > 0;
  }

  /**
   * Get jobs with descriptions count
   */
  get jobsWithDescriptionsCount(): number {
    return this.jobs.filter(j => j.description && j.description.trim().length > 0).length;
  }
}
