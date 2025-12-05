import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { AppStateService } from '../../core/services/app-state.service';
import { LogEntry } from '../../shared/interfaces/data-models';

@Component({
  selector: 'app-processing-logs',
  templateUrl: './processing-logs.component.html',
  styleUrls: ['./processing-logs.component.scss'],
  standalone: false
})
export class ProcessingLogsComponent implements OnInit, OnDestroy {
  @Input() processingMessage = '';
  @Input() showDialog = false;
  @Input() maxLogsToShow = 5;

  @Output() dialogClosed = new EventEmitter<void>();

  logs: LogEntry[] = [];
  private destroy$ = new Subject<void>();

  constructor(private appStateService: AppStateService) {}

  ngOnInit(): void {
    // Subscribe to logs from the state service
    this.appStateService.logs$
      .pipe(takeUntil(this.destroy$))
      .subscribe(logs => {
        this.logs = logs;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Format timestamp for display
   */
  formatLogTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  /**
   * Get CSS class for log type
   */
  getLogClass(type: string): string {
    return `log-${type}`;
  }

  /**
   * Get the most recent logs to display
   */
  getRecentLogs(): LogEntry[] {
    return this.logs.slice(-this.maxLogsToShow);
  }

  /**
   * Check if there are any logs to show
   */
  get hasLogs(): boolean {
    return this.logs.length > 0;
  }

  /**
   * Close the dialog
   */
  closeDialog(): void {
    this.dialogClosed.emit();
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.appStateService.clearLogs();
  }
}
