import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { AppStateService } from '../../core/services/app-state.service';
import { SettingsService } from '../../core/services/settings.service';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-analysis-config',
  templateUrl: './analysis-config.component.html',
  styleUrls: ['./analysis-config.component.scss'],
  standalone: false
})
export class AnalysisConfigComponent implements OnInit, OnDestroy {
  @Input() isLoading = false;
  @Input() isProcessing = false;

  @Output() startAnalysis = new EventEmitter<void>();
  @Output() openSettings = new EventEmitter<void>();

  hasApiKey = false;
  coursesCount = 0;
  jobsCount = 0;
  hasSyllabusData = false;

  private destroy$ = new Subject<void>();

  constructor(
    private appStateService: AppStateService,
    private settingsService: SettingsService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    // Check API key status
    this.hasApiKey = this.settingsService.hasApiKey();

    // Subscribe to state changes
    this.appStateService.state$
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.coursesCount = state.courses.length;
        this.jobsCount = state.jobTitles.length;
      });

    // Subscribe to settings changes
    this.settingsService.settings$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.hasApiKey = this.settingsService.hasApiKey();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Start the AI analysis
   */
  onStartAnalysis(): void {
    if (!this.canAnalyze) {
      if (!this.hasApiKey) {
        this.notification.showError('Please configure your API key in settings first');
      } else if (this.coursesCount === 0) {
        this.notification.showError('Please load course data first');
      } else if (this.jobsCount === 0) {
        this.notification.showError('Please add job titles first');
      }
      return;
    }

    this.startAnalysis.emit();
  }

  /**
   * Open settings dialog
   */
  onOpenSettings(): void {
    this.openSettings.emit();
  }

  /**
   * Check if analysis can be started
   */
  get canAnalyze(): boolean {
    return this.hasApiKey && this.coursesCount > 0 && this.jobsCount > 0 && !this.isLoading;
  }

  /**
   * Get prerequisites status
   */
  get prerequisites(): { label: string; met: boolean; action?: string }[] {
    return [
      {
        label: 'API Key Configured',
        met: this.hasApiKey,
        action: 'settings'
      },
      {
        label: 'Course Data Loaded',
        met: this.coursesCount > 0
      },
      {
        label: 'Job Titles Selected',
        met: this.jobsCount > 0
      }
    ];
  }

  /**
   * Get unmet prerequisites count
   */
  get unmetPrerequisitesCount(): number {
    return this.prerequisites.filter(p => !p.met).length;
  }

  /**
   * Check if all prerequisites are met
   */
  get allPrerequisitesMet(): boolean {
    return this.prerequisites.every(p => p.met);
  }
}
